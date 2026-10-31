import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOLETO_STEPS,
  createFakeAiProcedure,
  createFakeAiProcedureRun,
  createFakeAiProcedureVersion,
} from '@/src/__tests__/factories/nov-a5-procedures.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'

vi.mock('@/src/repositories/ai-procedure.repository')
vi.mock('@/src/repositories/ai-procedure-run.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/whatsapp/chatbot/webhook-call', () => ({
  callChatbotWebhook: vi.fn(),
}))
vi.mock('@/src/lib/ai/tools/registry', () => ({
  resolveToolAccess: vi.fn(),
  availableTools: vi.fn(),
  runReadTool: vi.fn(),
}))

import { callChatbotWebhook } from '@/src/lib/whatsapp/chatbot/webhook-call'
import {
  availableTools,
  resolveToolAccess,
  runReadTool,
} from '@/src/lib/ai/tools/registry'
import { AiProcedureRepository } from '@/src/repositories/ai-procedure.repository'
import { AiProcedureRunRepository } from '@/src/repositories/ai-procedure-run.repository'
import {
  AiProcedureRuntime,
  PROCEDURE_DEFAULT_HANDOFF,
  PROCEDURE_STALE_MS,
  type ProcedureSubject,
} from '../ai-procedure-runtime.service'

const procedures = vi.mocked(AiProcedureRepository)
const runs = vi.mocked(AiProcedureRunRepository)
const webhook = vi.mocked(callChatbotWebhook)

const SUBJECT: ProcedureSubject = {
  workspaceId: 'ws1',
  subjectType: 'WHATSAPP_CONVERSATION',
  subjectId: 'conv1',
  channel: 'WHATSAPP',
}
const PROCEDURE = createFakeAiProcedure({ id: 'p1', workspaceId: 'ws1' })
const VERSION = createFakeAiProcedureVersion({ procedureId: 'p1' })
const CPF = '529.982.247-25'

const call = (name: string, args: Record<string, unknown>) => ({
  id: `c_${name}`,
  name,
  arguments: args,
})
const start = (id = 'p1') => call('procedimento_iniciar', { procedimento: id })
const submit = (variavel: string, valor: string) =>
  call('procedimento_registrar', { variavel, valor })

async function turnOf(subject: ProcedureSubject = SUBJECT) {
  const turn = expectOk(await AiProcedureRuntime.beginTurn(subject))
  if (!turn) throw new Error('expected a turn')
  return turn
}

beforeEach(() => {
  vi.clearAllMocks()
  runs.findActive.mockResolvedValue(ok(null))
  runs.countSteps.mockResolvedValue(ok(0))
  runs.create.mockImplementation(async (data) =>
    ok(createFakeAiProcedureRun({ id: 'run1', ...data } as never)),
  )
  runs.save.mockResolvedValue(ok(createFakeAiProcedureRun()))
  procedures.listActive.mockResolvedValue(ok([PROCEDURE]))
  procedures.findVersionByNumber.mockResolvedValue(ok(VERSION))
  procedures.findById.mockResolvedValue(ok(PROCEDURE))
  webhook.mockResolvedValue({ ok: true, json: { link: 'https://boleto/1' } })
})

describe('AiProcedureRuntime.beginTurn', () => {
  it('should offer nothing when no procedure is active', async () => {
    procedures.listActive.mockResolvedValueOnce(ok([]))
    expect(expectOk(await AiProcedureRuntime.beginTurn(SUBJECT))).toBeNull()
  })

  it('should not serve an agent channel without an agent', async () => {
    expect(
      expectOk(
        await AiProcedureRuntime.beginTurn({ ...SUBJECT, channel: 'AGENT' }),
      ),
    ).toBeNull()
  })

  it('should filter by channel', async () => {
    await AiProcedureRuntime.beginTurn(SUBJECT)
    expect(procedures.listActive).toHaveBeenCalledWith('ws1', { whatsapp: true })
    await AiProcedureRuntime.beginTurn({
      ...SUBJECT,
      channel: 'AGENT',
      agentId: 'ag1',
    })
    expect(procedures.listActive).toHaveBeenLastCalledWith('ws1', {
      agentId: 'ag1',
    })
  })

  it('should propagate a failure to list', async () => {
    procedures.listActive.mockResolvedValueOnce(err(databaseError('x')))
    const result = await AiProcedureRuntime.beginTurn(SUBJECT)
    expect(result.ok).toBe(false)
    runs.findActive.mockResolvedValueOnce(err(databaseError('x')))
    expect((await AiProcedureRuntime.beginTurn(SUBJECT)).ok).toBe(false)
  })

  it('should resume a running run on the version it started with', async () => {
    runs.findActive.mockResolvedValueOnce(
      ok(
        createFakeAiProcedureRun({
          id: 'run1',
          procedureId: 'p1',
          versionNumber: 1,
          state: { variables: {}, steps: { cpf: { status: 'PENDING', attempts: 0 } } },
        }),
      ),
    )
    runs.countSteps.mockResolvedValueOnce(ok(4))
    const turn = await turnOf()
    expect(turn.section()).toContain('PROCEDIMENTO EM ANDAMENTO')
    expect(procedures.findVersionByNumber).toHaveBeenCalledWith('p1', 1)
    expect(turn.tools().map((t) => t.name)).toEqual([
      'procedimento_registrar',
      'procedimento_transferir',
    ])
  })

  it('should cancel a stale run and offer the catalog again', async () => {
    runs.findActive.mockResolvedValueOnce(
      ok(
        createFakeAiProcedureRun({
          id: 'old',
          updatedAt: new Date(Date.now() - PROCEDURE_STALE_MS - 1000),
        }),
      ),
    )
    const turn = await turnOf()
    expect(runs.save).toHaveBeenCalledWith(
      'old',
      expect.objectContaining({ status: 'CANCELED' }),
      [],
    )
    expect(turn.section()).toContain('Procedimentos disponíveis')
  })

  it('should cancel a run whose procedure or version is gone', async () => {
    runs.findActive.mockResolvedValueOnce(
      ok(createFakeAiProcedureRun({ id: 'orphan' })),
    )
    procedures.findById.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_NOT_FOUND', message: 'x' }),
    )
    procedures.listActive.mockResolvedValueOnce(ok([]))
    expect(expectOk(await AiProcedureRuntime.beginTurn(SUBJECT))).toBeNull()
    expect(runs.save).toHaveBeenCalledWith(
      'orphan',
      expect.objectContaining({
        status: 'CANCELED',
        failureReason: 'Procedimento removido',
      }),
      [],
    )
  })
})

describe('procedure turn: the happy path', () => {
  it('should start, collect, query and send in order', async () => {
    const events: string[] = []
    const turn = await turnOf({
      ...SUBJECT,
      variables: { contact_name: 'Ana' },
      resolveVariables: async () => ({ contact_phone: '5511' }),
      onEvent: async (e) => {
        events.push(`${e.stepKey}:${e.status}`)
      },
    })
    expect(turn.owns('procedimento_iniciar')).toBe(true)
    expect(turn.owns('outra')).toBe(false)
    expect(turn.section()).toContain('p1 — Segunda via de boleto')
    expect(turn.tools().map((t) => t.name)).toEqual(['procedimento_iniciar'])

    const started = JSON.parse(await turn.handle(start()))
    expect(started).toMatchObject({ status: 'iniciado', passo_atual: 'Validar CPF' })
    expect(turn.tools().map((t) => t.name)).toContain('procedimento_registrar')
    expect(runs.create).toHaveBeenCalledWith(
      expect.objectContaining({ procedureId: 'p1', versionNumber: 1 }),
    )

    const done = JSON.parse(await turn.handle(submit('cpf', CPF)))
    expect(done.status).toBe('encerrado')
    expect(done.enviado_automaticamente_ao_cliente).toEqual([
      'Sua segunda via: https://boleto/1',
    ])
    expect(webhook).toHaveBeenCalledWith({
      url: 'https://api.exemplo.com.br/boletos?cpf=52998224725',
      method: 'GET',
    })
    expect(turn.tools()).toEqual([])
    expect(turn.section()).toBe('')

    const result = await turn.finish('texto do modelo que deve ser ignorado')
    expect(result).toEqual({
      reply: 'Sua segunda via: https://boleto/1',
      handoff: false,
      handoffReason: null,
      ended: true,
    })
    expect(events).toContain('_start:OK')
    expect(events).toContain('cpf:OK')
    expect(events).toContain('envio:OK')
    expect(runs.save).toHaveBeenLastCalledWith(
      'run1',
      expect.objectContaining({ status: 'COMPLETED' }),
      expect.any(Array),
    )
  })

  it('should answer with the model text when a collect step waits', async () => {
    const turn = await turnOf()
    await turn.handle(start())
    const result = await turn.finish('Qual é o seu CPF?')
    expect(result).toMatchObject({
      reply: 'Qual é o seu CPF?',
      handoff: false,
      ended: false,
    })
  })

  it('should pass text through when no run was started', async () => {
    const turn = await turnOf()
    expect(await turn.finish('  oi  ')).toEqual({
      reply: 'oi',
      handoff: false,
      handoffReason: null,
      ended: false,
    })
  })
})

describe('procedure turn: enforcement', () => {
  it('should refuse a value for a step that is not the current one', async () => {
    const turn = await turnOf()
    await turn.handle(start())
    const blocked = JSON.parse(await turn.handle(submit('link', 'x')))
    expect(blocked.status).toBe('erro')
    expect(blocked.erro).toContain('fora de ordem')
    expect(webhook).not.toHaveBeenCalled()
    expect(runs.save).toHaveBeenLastCalledWith(
      'run1',
      expect.anything(),
      [expect.objectContaining({ status: 'REJECTED' })],
    )
  })

  it('should count invalid values and hand off after the last attempt', async () => {
    const turn = await turnOf()
    await turn.handle(start())
    const first = JSON.parse(await turn.handle(submit('cpf', '111')))
    expect(first).toMatchObject({ status: 'erro', tentativas_restantes: 2 })
    await turn.handle(submit('cpf', '222'))
    const last = JSON.parse(await turn.handle(submit('cpf', '333')))
    expect(last.status).toBe('transferir')
    const result = await turn.finish('')
    expect(result).toMatchObject({
      reply: PROCEDURE_DEFAULT_HANDOFF,
      handoff: true,
      ended: true,
    })
  })

  it('should hand off with the configured message when a required query fails', async () => {
    webhook.mockResolvedValueOnce({ ok: false, reason: 'status_500' })
    procedures.findVersionByNumber.mockResolvedValue(
      ok({ ...VERSION, handoffMessage: 'Um atendente continua com você.' }),
    )
    const turn = await turnOf()
    await turn.handle(start())
    await turn.handle(submit('cpf', CPF))
    const result = await turn.finish('')
    expect(result).toEqual({
      reply: 'Um atendente continua com você.',
      handoff: true,
      handoffReason: 'status_500',
      ended: true,
    })
  })

  it('should let the model give up through the handoff tool', async () => {
    const turn = await turnOf()
    await turn.handle(start())
    const out = JSON.parse(
      await turn.handle(call('procedimento_transferir', { motivo: 'cliente irritado' })),
    )
    expect(out.status).toBe('transferir')
    expect(await turn.finish('')).toMatchObject({
      handoff: true,
      handoffReason: 'cliente irritado',
    })
  })

  it('should hand off when the model used the handoff marker', async () => {
    const turn = await turnOf()
    await turn.handle(start())
    const result = await turn.finish('vou chamar alguém', {
      modelRequestedHandoff: true,
    })
    expect(result).toMatchObject({ handoff: true, ended: true })
  })

  it('should reject starts that do not make sense', async () => {
    const turn = await turnOf()
    const unknown = JSON.parse(await turn.handle(start('zzz')))
    expect(unknown.erro).toContain('inexistente')
    await turn.handle(start())
    const twice = JSON.parse(await turn.handle(start()))
    expect(twice.erro).toContain('Já existe')
    const idle = await turnOf()
    const none = JSON.parse(await idle.handle(submit('cpf', '1')))
    expect(none.erro).toContain('Nenhum procedimento')
  })

  it('should report a procedure whose version or run cannot be stored', async () => {
    procedures.findVersionByNumber.mockResolvedValueOnce(ok(null))
    const turn = await turnOf()
    expect(JSON.parse(await turn.handle(start())).erro).toContain('indisponível')
    runs.create.mockResolvedValueOnce(err(databaseError('x')))
    const second = await turnOf()
    expect(JSON.parse(await second.handle(start())).erro).toContain('Falha')
  })

  it('should keep going when saving the trace fails', async () => {
    runs.save.mockResolvedValue(err(databaseError('x')))
    const turn = await turnOf()
    const out = JSON.parse(await turn.handle(start()))
    expect(out.status).toBe('iniciado')
  })

  it('should close an unfinished run only once', async () => {
    const turn = await turnOf()
    await turn.close('sem run')
    expect(runs.save).not.toHaveBeenCalled()
    await turn.handle(start())
    runs.save.mockClear()
    await turn.close('terminou antes')
    await turn.close('de novo')
    expect(runs.save).toHaveBeenCalledTimes(1)
    expect(runs.save).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({ status: 'CANCELED', failureReason: 'terminou antes' }),
      [],
    )
  })
})

describe('procedure turn: step kinds', () => {
  const withSteps = (steps: ProcedureStep[]) => {
    procedures.listActive.mockResolvedValue(
      ok([createFakeAiProcedure({ id: 'p1', steps: steps as never, ownerId: 'owner1' })]),
    )
    procedures.findVersionByNumber.mockResolvedValue(
      ok(createFakeAiProcedureVersion({ steps: steps as never })),
    )
  }
  const base = { required: true, condition: null }

  it('should let the model write an instruction message and finish the run', async () => {
    withSteps([
      { ...base, key: 'ia', kind: 'MESSAGE', title: 'Explicar', instruction: 'explique' },
    ])
    const turn = await turnOf()
    const started = JSON.parse(await turn.handle(start()))
    expect(started.instrucao).toContain('explique')
    const result = await turn.finish('Aqui está a explicação')
    expect(result).toMatchObject({
      reply: 'Aqui está a explicação',
      ended: true,
      handoff: false,
    })
    const silent = await turnOf()
    await silent.handle(start())
    expect(await silent.finish('   ')).toMatchObject({ ended: false })
  })

  it('should run a TOOL step with the owner permissions', async () => {
    withSteps([
      {
        ...base,
        key: 'ferr',
        kind: 'TOOL',
        title: 'Buscar',
        toolName: 'sd_get_ticket',
        args: { id: '{{contact_name}}' },
        saves: [{ variable: 'st', path: 'status' }],
      },
      { ...base, key: 'm', kind: 'MESSAGE', title: 'Dizer', text: 'Status {{st}}' },
    ])
    const fakeTool = { name: 'sd_get_ticket' }
    vi.mocked(resolveToolAccess).mockResolvedValue(ok({} as never))
    vi.mocked(availableTools).mockReturnValue([fakeTool] as never)
    vi.mocked(runReadTool).mockResolvedValue({
      ok: true,
      output: { data: { status: 'ABERTO' }, summary: 's' },
      content: '{}',
    })
    const turn = await turnOf({
      ...SUBJECT,
      variables: { contact_name: 'T1' },
      agentId: 'ag1',
    })
    await turn.handle(start())
    expect(runReadTool).toHaveBeenCalledWith(
      fakeTool,
      expect.objectContaining({ actorId: 'owner1', agentId: 'ag1' }),
      { id: 'T1' },
    )
    expect(await turn.finish('')).toMatchObject({ reply: 'Status ABERTO' })
  })

  it('should fail a TOOL step when the owner is missing or the tool is hidden', async () => {
    const tool: ProcedureStep = {
      ...base,
      key: 'ferr',
      kind: 'TOOL',
      title: 'Buscar',
      toolName: 'x',
      args: {},
      saves: [],
    }
    procedures.listActive.mockResolvedValue(
      ok([createFakeAiProcedure({ id: 'p1', steps: [tool] as never, ownerId: null })]),
    )
    procedures.findVersionByNumber.mockResolvedValue(
      ok(createFakeAiProcedureVersion({ steps: [tool] as never })),
    )
    const noOwner = await turnOf()
    await noOwner.handle(start())
    expect(await noOwner.finish('')).toMatchObject({
      handoff: true,
      handoffReason: 'Procedimento sem responsável',
    })

    procedures.listActive.mockResolvedValue(
      ok([createFakeAiProcedure({ id: 'p1', steps: [tool] as never, ownerId: 'o' })]),
    )
    vi.mocked(resolveToolAccess).mockResolvedValueOnce(err(databaseError('sem acesso')))
    const noAccess = await turnOf()
    await noAccess.handle(start())
    expect((await noAccess.finish('')).handoffReason).toBe('sem acesso')

    vi.mocked(resolveToolAccess).mockResolvedValue(ok({} as never))
    vi.mocked(availableTools).mockReturnValue([])
    const hidden = await turnOf()
    await hidden.handle(start())
    expect((await hidden.finish('')).handoffReason).toBe('Ferramenta indisponível')

    vi.mocked(availableTools).mockReturnValue([{ name: 'x' }] as never)
    vi.mocked(runReadTool).mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'negado' },
      content: '{}',
    })
    const denied = await turnOf()
    await denied.handle(start())
    expect((await denied.finish('')).handoffReason).toBe('negado')
  })

  it('should not send POST requests in a simulation', async () => {
    withSteps([
      {
        ...base,
        key: 'p',
        kind: 'HTTP',
        title: 'Enviar',
        method: 'POST',
        url: 'https://x.com',
        body: '{}',
        saves: [],
      },
    ])
    const turn = await turnOf({ ...SUBJECT, simulate: true })
    await turn.handle(start())
    expect(webhook).not.toHaveBeenCalled()
    expect(await turn.finish('ok')).toMatchObject({ ended: true })
  })

  it('should stop at a HANDOFF step with its message', async () => {
    withSteps([
      { ...base, key: 'h', kind: 'HANDOFF', title: 'Humano', text: 'Já te passo' },
    ])
    const turn = await turnOf()
    const out = JSON.parse(await turn.handle(start()))
    expect(out.status).toBe('encerrado')
    expect(await turn.finish('')).toMatchObject({
      reply: 'Já te passo',
      handoff: true,
    })
  })
})

describe('boleto steps sanity', () => {
  it('should have the three-step example the docs describe', () => {
    expect(BOLETO_STEPS.map((s) => s.kind)).toEqual(['COLLECT', 'HTTP', 'MESSAGE'])
  })
})
