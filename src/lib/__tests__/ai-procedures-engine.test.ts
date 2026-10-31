import { describe, expect, it, vi } from 'vitest'
import {
  completeMessage,
  conditionHolds,
  currentStep,
  initialState,
  planFor,
  settle,
  submitValue,
} from '@/src/lib/ai/procedures/engine'
import {
  activeSection,
  catalogSection,
  startToolSpec,
  stepDirective,
} from '@/src/lib/ai/procedures/prompt'
import type {
  ProcedureDefinition,
  ProcedureExecutors,
} from '@/src/lib/ai/procedures/types'
import {
  procedureProblems,
  variablesDefinedBy,
} from '@/src/lib/ai/procedures/validate'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'

const base = { required: true, condition: null }

const COLLECT: ProcedureStep = {
  ...base,
  key: 'cpf',
  kind: 'COLLECT',
  title: 'Validar CPF',
  variable: 'cpf',
  prompt: 'o CPF do titular',
  validation: 'CPF',
}
const HTTP: ProcedureStep = {
  ...base,
  key: 'consulta',
  kind: 'HTTP',
  title: 'Consultar',
  method: 'GET',
  url: 'https://api.exemplo.com.br/b?cpf={{cpf}}',
  saves: [{ variable: 'link', path: 'data.link' }],
}
const SEND: ProcedureStep = {
  ...base,
  key: 'envio',
  kind: 'MESSAGE',
  title: 'Enviar',
  text: 'Sua segunda via: {{link}}',
}

const definition = (
  steps: ProcedureStep[],
  maxAttempts = 3,
): ProcedureDefinition => ({
  id: 'p1',
  name: 'Segunda via',
  whenToUse: 'boleto',
  steps,
  maxAttempts,
  handoffMessage: null,
})

const VALID_CPF = '529.982.247-25'

function executors(over: Partial<ProcedureExecutors> = {}): ProcedureExecutors {
  return {
    http: vi.fn().mockResolvedValue({ ok: true, json: { data: { link: 'L1' } } }),
    tool: vi.fn().mockResolvedValue({ ok: true, json: { id: 7 } }),
    ...over,
  }
}

describe('procedure engine', () => {
  it('should wait on a COLLECT step and run nothing after it', async () => {
    const def = definition([COLLECT, HTTP, SEND])
    const ex = executors()
    const result = await settle(def, initialState(def), ex)
    expect(result.outcome).toEqual({ kind: 'waiting', stepKey: 'cpf' })
    expect(ex.http).not.toHaveBeenCalled()
  })

  it('should run the whole procedure in order after a valid value', async () => {
    const def = definition([COLLECT, HTTP, SEND])
    const ex = executors()
    const submitted = submitValue(
      def,
      initialState(def),
      'cpf',
      VALID_CPF,
    )
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    const result = await settle(def, submitted.state, ex)
    expect(result.outcome).toEqual({ kind: 'completed' })
    expect(result.messages).toEqual(['Sua segunda via: L1'])
    expect(ex.http).toHaveBeenCalledWith({
      url: 'https://api.exemplo.com.br/b?cpf=52998224725',
      method: 'GET',
    })
    expect(result.events.map((e) => e.stepKey)).toEqual(['consulta', 'envio'])
  })

  it('should block a value for a step that is not the current one', () => {
    const def = definition([COLLECT, HTTP, SEND])
    const blocked = submitValue(def, initialState(def), 'link', 'x')
    expect(blocked).toMatchObject({
      ok: false,
      reason: 'out_of_order',
      expected: 'cpf',
    })
    if (blocked.ok) return
    expect(blocked.events[0]).toMatchObject({
      status: 'REJECTED',
      kind: 'GUARD',
    })
    expect(currentStep(def, blocked.state)?.key).toBe('cpf')
  })

  it('should report no step when everything is done', async () => {
    const def = definition([SEND])
    const done = await settle(def, initialState(def), executors())
    expect(submitValue(def, done.state, 'cpf', '1')).toMatchObject({
      ok: false,
      reason: 'no_step',
    })
  })

  it('should count invalid values and fail a required step at the limit', () => {
    const def = definition([COLLECT], 2)
    let state = initialState(def)
    const first = submitValue(def, state, 'cpf', '123')
    expect(first).toMatchObject({ ok: false, reason: 'invalid', attemptsLeft: 1 })
    state = first.state
    const second = submitValue(def, state, 'cpf', '456')
    expect(second).toMatchObject({
      ok: false,
      attemptsLeft: 0,
      failed: { kind: 'failed', stepKey: 'cpf' },
    })
    expect(second.state.steps.cpf.status).toBe('FAILED')
  })

  it('should skip an optional COLLECT step after the attempts run out', async () => {
    const optional: ProcedureStep = { ...COLLECT, required: false }
    const def = definition([optional, SEND], 1)
    const failed = submitValue(def, initialState(def), 'cpf', '1')
    expect(failed).toMatchObject({ ok: false, attemptsLeft: 0 })
    expect(failed.state.steps.cpf.status).toBe('SKIPPED')
    expect('failed' in failed && failed.failed).toBeFalsy()
  })

  it('should hand off when a required HTTP step fails', async () => {
    const def = definition([HTTP, SEND])
    const ex = executors({
      http: vi.fn().mockResolvedValue({ ok: false, reason: 'status_500' }),
    })
    const result = await settle(def, initialState(def, { cpf: '1' }), ex)
    expect(result.outcome).toEqual({
      kind: 'failed',
      stepKey: 'consulta',
      reason: 'status_500',
    })
    expect(result.messages).toEqual([])
    expect(result.events[0]).toMatchObject({ status: 'FAILED' })
  })

  it('should skip an optional failing step and go on', async () => {
    const optional: ProcedureStep = { ...HTTP, required: false }
    const def = definition([optional, { ...SEND, text: 'oi' }])
    const ex = executors({
      http: vi.fn().mockResolvedValue({ ok: false, reason: 'timeout' }),
    })
    const result = await settle(def, initialState(def), ex)
    expect(result.outcome).toEqual({ kind: 'completed' })
    expect(result.state.steps.consulta.status).toBe('SKIPPED')
  })

  it('should skip steps whose condition is false, even required ones', async () => {
    const conditional: ProcedureStep = {
      ...HTTP,
      condition: { variable: 'plano', operator: 'equals', value: 'premium' },
    }
    const def = definition([conditional, { ...SEND, text: 'fim' }])
    const skipped = await settle(
      def,
      initialState(def, { plano: 'basico' }),
      executors(),
    )
    expect(skipped.state.steps.consulta.status).toBe('SKIPPED')
    expect(skipped.events[0]).toMatchObject({
      status: 'SKIPPED',
      output: { reason: 'condition_false' },
    })
    const ran = await settle(
      def,
      initialState(def, { plano: 'premium', cpf: '1' }),
      executors(),
    )
    expect(ran.state.steps.consulta.status).toBe('DONE')
  })

  it('should run a TOOL step with interpolated arguments', async () => {
    const tool: ProcedureStep = {
      ...base,
      key: 'ferr',
      kind: 'TOOL',
      title: 'Buscar',
      toolName: 'sd_get_ticket',
      args: { id: '{{ticket}}' },
      saves: [{ variable: 'status', path: 'id' }],
    }
    const def = definition([tool])
    const ex = executors()
    const result = await settle(def, initialState(def, { ticket: 'T9' }), ex)
    expect(ex.tool).toHaveBeenCalledWith('sd_get_ticket', { id: 'T9' })
    expect(result.state.variables.status).toBe('7')
  })

  it('should fail a required TOOL step and hand a failing optional one over', async () => {
    const tool: ProcedureStep = {
      ...base,
      key: 'ferr',
      kind: 'TOOL',
      title: 'Buscar',
      toolName: 'x',
      args: {},
      saves: [],
    }
    const ex = executors({
      tool: vi.fn().mockResolvedValue({ ok: false, reason: 'sem acesso' }),
    })
    const def = definition([tool])
    expect((await settle(def, initialState(def), ex)).outcome).toMatchObject({
      kind: 'failed',
    })
    const optional = definition([{ ...tool, required: false }])
    expect((await settle(optional, initialState(optional), ex)).outcome).toEqual({
      kind: 'completed',
    })
  })

  it('should send the POST body interpolated', async () => {
    const post: ProcedureStep = {
      ...HTTP,
      method: 'POST',
      body: '{"cpf":"{{cpf}}"}',
      saves: [],
    }
    const def = definition([post])
    const ex = executors()
    await settle(def, initialState(def, { cpf: '123' }), ex)
    expect(ex.http).toHaveBeenCalledWith({
      url: 'https://api.exemplo.com.br/b?cpf=123',
      method: 'POST',
      body: { cpf: '123' },
    })
  })

  it('should stop on a HANDOFF step with its message', async () => {
    const handoff: ProcedureStep = {
      ...base,
      key: 'h',
      kind: 'HANDOFF',
      title: 'Humano',
      text: 'Já te passo, {{contact_name}}',
    }
    const def = definition([handoff, SEND])
    const result = await settle(
      def,
      initialState(def, { contact_name: 'Ana' }),
      executors(),
    )
    expect(result.outcome).toEqual({ kind: 'handoff', stepKey: 'h' })
    expect(result.messages).toEqual(['Já te passo, Ana'])
    const silent = definition([{ ...handoff, text: undefined }])
    expect((await settle(silent, initialState(silent), executors())).messages).toEqual([])
  })

  it('should wait for the model on an instruction MESSAGE and complete it', async () => {
    const ai: ProcedureStep = {
      ...base,
      key: 'ia',
      kind: 'MESSAGE',
      title: 'Explicar',
      instruction: 'explique o boleto',
    }
    const def = definition([ai])
    const settled = await settle(def, initialState(def), executors())
    expect(settled.outcome).toEqual({ kind: 'waiting', stepKey: 'ia' })
    const done = completeMessage(def, settled.state, 'Aqui está')
    expect(done.state.steps.ia.status).toBe('DONE')
    expect(done.events[0]).toMatchObject({ status: 'OK' })
    expect((await settle(def, done.state, executors())).outcome).toEqual({
      kind: 'completed',
    })
  })

  it('should not complete a message when the current step is another kind', () => {
    const def = definition([COLLECT])
    const state = initialState(def)
    expect(completeMessage(def, state, 'oi')).toEqual({ state, events: [] })
    const fixed = definition([SEND])
    expect(completeMessage(fixed, initialState(fixed), 'x').events).toEqual([])
    const ended = definition([])
    expect(completeMessage(ended, initialState(ended), 'x').events).toEqual([])
  })

  it('should tolerate a state saved before a step existed', () => {
    const def = definition([COLLECT, SEND])
    const old = { variables: {}, steps: { cpf: { status: 'DONE' as const, attempts: 0 } } }
    expect(currentStep(def, old)?.key).toBe('envio')
    expect(currentStep(definition([COLLECT]), { variables: {}, steps: {} })?.key).toBe(
      'cpf',
    )
  })

  it('should evaluate conditions and plan a preview', () => {
    expect(conditionHolds(COLLECT, {})).toBe(true)
    const step: ProcedureStep = {
      ...SEND,
      condition: { variable: 'n', operator: 'greater_than', value: '2' },
    }
    expect(conditionHolds(step, { n: '3' })).toBe(true)
    expect(conditionHolds(step, {})).toBe(false)
    expect(planFor(definition([COLLECT, step]), { n: '1' })).toEqual([
      { key: 'cpf', title: 'Validar CPF', kind: 'COLLECT', required: true, applies: true },
      { key: 'envio', title: 'Enviar', kind: 'MESSAGE', required: true, applies: false },
    ])
  })
})

describe('procedure definition problems', () => {
  it('should accept a coherent procedure', () => {
    expect(procedureProblems([COLLECT, HTTP, SEND])).toEqual([])
  })

  it('should flag repeated keys, unknown variables and empty messages', () => {
    const problems = procedureProblems([
      HTTP,
      { ...HTTP },
      { ...base, key: 'm', kind: 'MESSAGE', title: 'Vazia' },
      { ...SEND, key: 'c', condition: { variable: 'zzz', operator: 'equals', value: '' } },
    ])
    expect(problems.some((p) => p.includes('chave repetida'))).toBe(true)
    expect(problems.some((p) => p.includes('{{cpf}}'))).toBe(true)
    expect(problems.some((p) => p.includes('texto ou a instrução'))).toBe(true)
    expect(problems.some((p) => p.includes('"zzz"'))).toBe(true)
  })

  it('should flag reserved names, empty lists and too many steps', () => {
    const reserved: ProcedureStep = { ...COLLECT, variable: 'contact_name' }
    expect(procedureProblems([reserved]).some((p) => p.includes('reservado'))).toBe(true)
    expect(procedureProblems([])).toContain('O procedimento precisa de passos')
    const many = Array.from({ length: 31 }, (_, i) => ({
      ...SEND,
      key: `k${i}`,
      text: 'x',
    }))
    expect(procedureProblems(many).some((p) => p.includes('No máximo'))).toBe(true)
  })

  it('should read texts of every kind for placeholders', () => {
    const tool: ProcedureStep = {
      ...base,
      key: 't',
      kind: 'TOOL',
      title: 'T',
      toolName: 'x',
      args: { a: '{{faltando}}' },
      saves: [],
    }
    const handoff: ProcedureStep = {
      ...base,
      key: 'h',
      kind: 'HANDOFF',
      title: 'H',
      text: '{{outra}}',
    }
    const problems = procedureProblems([tool, handoff])
    expect(problems.some((p) => p.includes('{{faltando}}'))).toBe(true)
    expect(problems.some((p) => p.includes('{{outra}}'))).toBe(true)
  })

  it('should list the variables a step defines', () => {
    expect(variablesDefinedBy(COLLECT)).toEqual(['cpf'])
    expect(variablesDefinedBy(HTTP)).toEqual(['link'])
    expect(variablesDefinedBy(SEND)).toEqual([])
  })
})

describe('procedure prompts', () => {
  it('should describe the catalog and the start tool', () => {
    const list = [{ id: 'p1', name: 'Segunda via', whenToUse: 'boleto' }]
    expect(catalogSection(list)).toContain('p1 — Segunda via: boleto')
    expect(startToolSpec(list).parameters).toMatchObject({
      properties: { procedimento: { enum: ['p1'] } },
    })
  })

  it('should mark the current step and give the directive', async () => {
    const def = definition([COLLECT, HTTP, SEND])
    let state = initialState(def)
    expect(activeSection(def, state)).toContain('▶ Validar CPF')
    expect(activeSection(def, state)).toContain('○ Consultar')
    state = {
      variables: {},
      steps: {
        ...state.steps,
        cpf: { status: 'DONE', attempts: 0 },
        consulta: { status: 'SKIPPED', attempts: 0 },
        envio: { status: 'FAILED', attempts: 0 },
      },
    }
    const text = activeSection(def, state)
    expect(text).toContain('✓ Validar CPF')
    expect(text).toContain('– Consultar')
    expect(text).toContain('✗ Enviar')
    expect(text).toContain('Passo atual: nenhum')
    expect(stepDirective(null)).toContain('concluídos')
    expect(stepDirective(COLLECT)).toContain('variavel="cpf"')
    expect(stepDirective({ ...SEND, text: undefined, instruction: 'diga oi' })).toContain(
      'diga oi',
    )
    expect(stepDirective(HTTP)).toContain('sozinho')
  })
})
