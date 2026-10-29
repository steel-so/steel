import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdAiCatalog,
  createFakeSdAiConversation,
  createFakeSdKbSearchRow,
} from '@/src/__tests__/factories/sd-ai.factory'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-access.helpers'
import { aiQuotaExceeded, databaseError, sdTicketNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-ai.repository')
vi.mock('@/src/repositories/sd-kb-article.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('../ai-usage.service', () => ({
  AiUsageService: { prepare: vi.fn(), record: vi.fn(async () => undefined) },
}))
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: {
    loadConfig: vi.fn(),
    resolveRef: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))
vi.mock('../sd-ticket-event-recorder', () => ({ recordSdTicketEvent: vi.fn() }))
vi.mock('../sd-automation-engine', () => ({
  fireSdAutomations: vi.fn(async () => undefined),
}))
vi.mock('../sd-whatsapp-inbound.service', () => ({
  mirrorSdWhatsappMessage: vi.fn(),
  publishSdTicketMessage: vi.fn(async () => undefined),
  SdWhatsappInboundService: { openTicketFromWhatsapp: vi.fn() },
  sendSdWhatsappText: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { SdAiRepository } from '@/src/repositories/sd-ai.repository'
import { SdKbArticleRepository } from '@/src/repositories/sd-kb-article.repository'
import { AiUsageService } from '../ai-usage.service'
import { SdAiService } from '../sd-ai.service'
import { SdTicketEngine } from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'

const aiRepo = vi.mocked(SdAiRepository)
const kb = vi.mocked(SdKbArticleRepository)
const engine = vi.mocked(SdTicketEngine)
const prepare = vi.mocked(AiUsageService.prepare)
const record = vi.mocked(AiUsageService.record)
const audit = vi.mocked(auditMutation)
const recordEvent = vi.mocked(recordSdTicketEvent)

const WS = 'ws1'
const chat = vi.fn()

const ticket = createFakeSdTicket({
  id: 't1',
  workspaceId: WS,
  number: 7,
  title: 'VPN fora do ar',
  category: { id: 'cat', name: 'Acesso' },
  department: { id: 'dep', name: 'Suporte N1', color: null },
  priority: { id: 'pri', name: 'P1', level: 1, color: null },
})

function preparedCall() {
  return {
    feature: 'SERVICEDESK_COPILOT' as const,
    provider: { id: 'openai' as const, chat, chatStream: vi.fn() },
    model: {
      key: 'openai:gpt-4o-mini',
      provider: 'openai' as const,
      model: 'gpt-4o-mini',
      label: 'GPT-4o mini',
    },
    usdPer1kTokens: 0.01,
  }
}

function reply(text: string) {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'end' as const,
  }
}

function settings(overrides = {}) {
  return createFakeSdSettings({
    workspaceId: WS,
    aiEnabled: true,
    ...overrides,
  })
}

beforeEach(() => {
  actAs('agent')
  engine.loadConfig.mockResolvedValue(
    ok({ settings: settings(), prefixes: DEFAULT_SD_TICKET_PREFIXES }),
  )
  engine.resolveRef.mockResolvedValue(ok(ticket))
  prepare.mockResolvedValue(ok(preparedCall()))
  chat.mockResolvedValue(reply('resposta da IA'))
  aiRepo.listTicketMessages.mockResolvedValue(
    ok([
      {
        authorKind: 'REQUESTER',
        visibility: 'PUBLIC',
        body: 'não conecto',
        createdAt: new Date('2026-09-21T12:00:00.000Z'),
      },
      {
        authorKind: 'INVENTADO' as never,
        visibility: 'INTERNAL',
        body: 'nota',
        createdAt: new Date('2026-09-21T12:05:00.000Z'),
      },
    ]),
  )
  kb.suggest.mockResolvedValue(ok([createFakeSdKbSearchRow({ id: 'a1' })]))
  aiRepo.setTicketAi.mockResolvedValue(ok(undefined))
  aiRepo.recordSuggestion.mockResolvedValue(ok(undefined))
  aiRepo.loadCatalog.mockResolvedValue(ok(createFakeSdAiCatalog()))
})

describe('summarize', () => {
  it('resume, grava em aiSummary e registra evento + trilha', async () => {
    const result = expectOk(await SdAiService.summarize('u1', WS, 't1'))

    expect(result).toEqual({ text: 'resposta da IA' })
    expect(aiRepo.setTicketAi).toHaveBeenCalledWith('t1', {
      aiSummary: 'resposta da IA',
    })
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.summary', actorKind: 'AGENT' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'sd_ticket', targetId: 't1' }),
    )
    // Resumir altera o chamado: exige permissão de edição.
    expect(engine.resolveRef).toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WS, userId: 'u1' }),
    )
  })

  it('manda o contexto do chamado e da base no system prompt', async () => {
    await SdAiService.summarize('u1', WS, 't1')

    const system = chat.mock.calls[0]?.[0].system as string
    expect(system).toContain('Tarefa: resuma o chamado')
    expect(system).toContain('VPN fora do ar')
    expect(system).toContain('Catálogo: Acesso')
    expect(system).toContain('Departamento: Suporte N1')
    expect(system).toContain('solicitante: não conecto')
    // Autor desconhecido vira "sistema".
    expect(system).toContain('sistema (nota interna): nota')
    expect(system).toContain('### [a1]')
    expect(chat.mock.calls[0]?.[0].messages).toEqual([
      { role: 'user', content: 'Gere agora.' },
    ])
  })

  it('omite as linhas do chamado ainda sem classificação nem descrição', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(
        createFakeSdTicket({
          id: 't1',
          workspaceId: WS,
          number: 7,
          description: null,
        }),
      ),
    )

    await SdAiService.summarize('u1', WS, 't1')
    const system = chat.mock.calls[0]?.[0].system as string
    expect(system).not.toContain('Prioridade:')
    expect(system).not.toContain('Catálogo:')
    expect(system).not.toContain('Departamento:')
    expect(system).toContain('(sem descrição)')
  })

  it('propaga a falha ao gravar o resumo', async () => {
    aiRepo.setTicketAi.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.summarize('u1', WS, 't1'), 'DATABASE_ERROR')
  })
})

describe('suggestReply', () => {
  it('passa a orientação do agente mascarando dados pessoais', async () => {
    const result = expectOk(
      await SdAiService.suggestReply('u1', WS, 't1', {
        instructions: 'peça o print e ligue para (11) 98888-7777',
      }),
    )

    expect(result.text).toBe('resposta da IA')
    expect(chat.mock.calls[0]?.[0].messages[0].content).toBe(
      'Orientação do agente: peça o print e ligue para [telefone]',
    )
    expect(aiRepo.setTicketAi).not.toHaveBeenCalled()
    expect(aiRepo.recordSuggestion).toHaveBeenCalledWith({
      workspaceId: WS,
      ticketId: 't1',
      userId: 'u1',
      kind: 'REPLY',
      text: 'resposta da IA',
    })
  })

  it('entrega a sugestão mesmo quando o registro para o painel falha', async () => {
    aiRepo.recordSuggestion.mockResolvedValue(err(databaseError()))
    const result = expectOk(await SdAiService.suggestReply('u1', WS, 't1'))
    expect(result.text).toBe('resposta da IA')
  })

  it('funciona sem orientação (padrão do DTO)', async () => {
    expectOk(await SdAiService.suggestReply('u1', WS, 't1'))
    expect(chat.mock.calls[0]?.[0].messages[0].content).toBe('Gere agora.')
  })
})

describe('draftSolution', () => {
  it('devolve o rascunho da solução sem gravar nada', async () => {
    const result = expectOk(await SdAiService.draftSolution('u1', WS, 't1'))
    expect(result.text).toBe('resposta da IA')
    expect(chat.mock.calls[0]?.[0].system).toContain('registro da solução')
    expect(aiRepo.recordSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SOLUTION', text: 'resposta da IA' }),
    )
  })
})

describe('falhas comuns do copiloto', () => {
  it('recusa solicitantes', async () => {
    actAs('requester')
    expectErr(await SdAiService.summarize('u1', WS, 't1'), 'SD_NOT_AGENT')
  })

  it('recusa quando a IA do módulo está desligada', async () => {
    engine.loadConfig.mockResolvedValue(
      ok({
        settings: settings({ aiEnabled: false }),
        prefixes: DEFAULT_SD_TICKET_PREFIXES,
      }),
    )
    expectErr(await SdAiService.suggestReply('u1', WS, 't1'), 'SD_AI_DISABLED')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('propaga a falha ao carregar a configuração e o chamado inexistente', async () => {
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.draftSolution('u1', WS, 't1'), 'DATABASE_ERROR')

    engine.loadConfig.mockResolvedValue(
      ok({ settings: settings(), prefixes: DEFAULT_SD_TICKET_PREFIXES }),
    )
    engine.resolveRef.mockResolvedValue(err(sdTicketNotFound()))
    expectErr(
      await SdAiService.draftSolution('u1', WS, 'nope'),
      'SD_TICKET_NOT_FOUND',
    )
  })

  it('devolve a cota estourada do workspace', async () => {
    prepare.mockResolvedValue(err(aiQuotaExceeded(12, 10)))
    expectErr(await SdAiService.summarize('u1', WS, 't1'), 'AI_QUOTA_EXCEEDED')
  })

  it('propaga falhas ao montar o contexto do chamado', async () => {
    aiRepo.listTicketMessages.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.summarize('u1', WS, 't1'), 'DATABASE_ERROR')

    aiRepo.listTicketMessages.mockResolvedValue(ok([]))
    kb.suggest.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.summarize('u1', WS, 't1'), 'DATABASE_ERROR')
  })

  it('transforma a exceção do provedor em AI_PROVIDER_UNAVAILABLE', async () => {
    chat.mockRejectedValue(new Error('timeout'))
    const error = expectErr(
      await SdAiService.summarize('u1', WS, 't1'),
      'AI_PROVIDER_UNAVAILABLE',
    )
    expect(error.message).toContain('provedor de IA')
    expect(record).not.toHaveBeenCalled()
  })

  it('também trata exceção que não é Error', async () => {
    chat.mockRejectedValue('boom')
    expectErr(
      await SdAiService.summarize('u1', WS, 't1'),
      'AI_PROVIDER_UNAVAILABLE',
    )
  })

  it('recusa resposta vazia do modelo', async () => {
    chat.mockResolvedValue(reply('   '))
    expectErr(
      await SdAiService.draftSolution('u1', WS, 't1'),
      'AI_PROVIDER_UNAVAILABLE',
    )
  })
})

describe('suggestClassification', () => {
  it('valida a sugestão contra o catálogo do workspace', async () => {
    chat.mockResolvedValue(
      reply(
        JSON.stringify({
          categoryId: 'cat',
          subcategoryId: 'sub',
          serviceId: 'svc',
          impactId: 'imp',
          urgencyId: 'urg',
          priorityId: 'pri',
          departmentId: 'dep',
          tags: ['vpn'],
          confidence: 0.9,
          reasoning: 'acesso',
        }),
      ),
    )

    const result = expectOk(
      await SdAiService.suggestClassification('u1', WS, 't1'),
    )
    expect(result).toMatchObject({
      category: { id: 'cat' },
      subcategory: { id: 'sub' },
      service: { id: 'svc' },
      department: { id: 'dep' },
      tags: ['vpn'],
      confidence: 0.9,
    })
    expect(aiRepo.loadCatalog).toHaveBeenCalledWith(WS, { type: 'INCIDENT' })
    expect(chat.mock.calls[0]?.[0].jsonSchema?.name).toBe('sd_triage')
    expect(aiRepo.recordSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CLASSIFICATION',
        ticketId: 't1',
        payload: expect.objectContaining({ tags: ['vpn'], confidence: 0.9 }),
      }),
    )
  })

  it('propaga a falha ao carregar o catálogo', async () => {
    aiRepo.loadCatalog.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.suggestClassification('u1', WS, 't1'),
      'DATABASE_ERROR',
    )
  })

  it('recusa JSON que o modelo não soube montar', async () => {
    chat.mockResolvedValue(reply('desculpe, não consegui'))
    expectErr(
      await SdAiService.suggestClassification('u1', WS, 't1'),
      'AI_PROVIDER_UNAVAILABLE',
    )
  })

  it('propaga a indisponibilidade do provedor', async () => {
    chat.mockRejectedValue(new Error('timeout'))
    expectErr(
      await SdAiService.suggestClassification('u1', WS, 't1'),
      'AI_PROVIDER_UNAVAILABLE',
    )
  })

  it('recusa sem permissão de agente e com a cota estourada', async () => {
    actAs('requester')
    expectErr(
      await SdAiService.suggestClassification('u1', WS, 't1'),
      'SD_NOT_AGENT',
    )

    actAs('agent')
    prepare.mockResolvedValue(err(aiQuotaExceeded(12, 10)))
    expectErr(
      await SdAiService.suggestClassification('u1', WS, 't1'),
      'AI_QUOTA_EXCEEDED',
    )
  })
})

describe('getChat', () => {
  it('devolve null quando o agente ainda não conversou', async () => {
    aiRepo.findCopilotConversation.mockResolvedValue(ok(null))
    expect(expectOk(await SdAiService.getChat('u1', WS, 't1'))).toBeNull()
    expect(aiRepo.findCopilotConversation).toHaveBeenCalledWith(WS, 't1', 'u1')
  })

  it('serializa a conversa existente', async () => {
    aiRepo.findCopilotConversation.mockResolvedValue(
      ok(
        createFakeSdAiConversation({
          id: 'c1',
          mode: 'COPILOT',
          ticketId: 't1',
          messages: [{ role: 'user', content: 'oi', at: 'now' }],
        }),
      ),
    )
    const dto = expectOk(await SdAiService.getChat('u1', WS, 't1'))
    expect(dto).toMatchObject({ id: 'c1', mode: 'COPILOT' })
  })

  it('propaga a falha de leitura e recusa solicitantes', async () => {
    aiRepo.findCopilotConversation.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.getChat('u1', WS, 't1'), 'DATABASE_ERROR')

    actAs('requester')
    expectErr(await SdAiService.getChat('u1', WS, 't1'), 'SD_NOT_AGENT')
  })
})

describe('chat', () => {
  const conversation = createFakeSdAiConversation({
    id: 'c1',
    mode: 'COPILOT',
    ticketId: 't1',
    userId: 'u1',
  })

  beforeEach(() => {
    aiRepo.findCopilotConversation.mockResolvedValue(ok(conversation))
    aiRepo.createConversation.mockResolvedValue(ok(conversation))
    aiRepo.updateConversation.mockImplementation(async (_id, data) =>
      ok({
        ...conversation,
        messages: (data.messages ?? []) as Prisma.JsonValue,
      }),
    )
  })

  it('cria a conversa do agente na primeira pergunta', async () => {
    aiRepo.findCopilotConversation.mockResolvedValue(ok(null))

    const dto = expectOk(
      await SdAiService.chat('u1', WS, 't1', { message: 'o que falta?' }),
    )
    expect(aiRepo.createConversation).toHaveBeenCalledWith({
      workspaceId: WS,
      mode: 'COPILOT',
      userId: 'u1',
      ticketId: 't1',
    })
    expect(dto.messages.map((m) => m.content)).toEqual([
      'o que falta?',
      'resposta da IA',
    ])
  })

  it('continua a conversa existente e mascara o que o agente escreve', async () => {
    aiRepo.findCopilotConversation.mockResolvedValue(
      ok({
        ...conversation,
        messages: [{ role: 'user', content: 'anterior', at: 'now' }],
      }),
    )

    const dto = expectOk(
      await SdAiService.chat('u1', WS, 't1', {
        message: 'o e-mail é ana@acme.com',
      }),
    )
    expect(aiRepo.createConversation).not.toHaveBeenCalled()
    expect(dto.messages).toHaveLength(3)
    const sent = chat.mock.calls[0]?.[0].messages
    expect(sent).toEqual([
      { role: 'user', content: 'anterior' },
      { role: 'user', content: 'o e-mail é [e-mail]' },
    ])
  })

  it('manda só os 20 turnos mais recentes para o provedor', async () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
      at: 'now',
    }))
    aiRepo.findCopilotConversation.mockResolvedValue(
      ok({ ...conversation, messages: history }),
    )

    await SdAiService.chat('u1', WS, 't1', { message: 'última' })
    const sent = chat.mock.calls[0]?.[0].messages
    expect(sent).toHaveLength(20)
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'última' })
    expect(sent[0]).toEqual({ role: 'user', content: 'm6' })
  })

  it('grava um aviso quando o modelo não responde nada', async () => {
    chat.mockResolvedValue(reply('   '))
    const dto = expectOk(
      await SdAiService.chat('u1', WS, 't1', { message: 'oi' }),
    )
    expect(dto.messages.at(-1)?.content).toBe('Não consegui responder agora.')
  })

  it('recusa solicitantes antes de gastar IA', async () => {
    actAs('requester')
    expectErr(
      await SdAiService.chat('u1', WS, 't1', { message: 'oi' }),
      'SD_NOT_AGENT',
    )
    expect(prepare).not.toHaveBeenCalled()
  })

  it('propaga as falhas de cota, de criação e de gravação', async () => {
    prepare.mockResolvedValue(err(aiQuotaExceeded(12, 10)))
    expectErr(
      await SdAiService.chat('u1', WS, 't1', { message: 'oi' }),
      'AI_QUOTA_EXCEEDED',
    )

    prepare.mockResolvedValue(ok(preparedCall()))
    aiRepo.findCopilotConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.chat('u1', WS, 't1', { message: 'oi' }),
      'DATABASE_ERROR',
    )

    aiRepo.findCopilotConversation.mockResolvedValue(ok(null))
    aiRepo.createConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.chat('u1', WS, 't1', { message: 'oi' }),
      'DATABASE_ERROR',
    )

    aiRepo.createConversation.mockResolvedValue(ok(conversation))
    aiRepo.listTicketMessages.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.chat('u1', WS, 't1', { message: 'oi' }),
      'DATABASE_ERROR',
    )

    aiRepo.listTicketMessages.mockResolvedValue(ok([]))
    chat.mockRejectedValue(new Error('timeout'))
    expectErr(
      await SdAiService.chat('u1', WS, 't1', { message: 'oi' }),
      'AI_PROVIDER_UNAVAILABLE',
    )

    chat.mockResolvedValue(reply('ok'))
    aiRepo.updateConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.chat('u1', WS, 't1', { message: 'oi' }),
      'DATABASE_ERROR',
    )
  })
})

describe('resetChat', () => {
  it('apaga a conversa do agente', async () => {
    aiRepo.findCopilotConversation.mockResolvedValue(
      ok(createFakeSdAiConversation({ id: 'c1', mode: 'COPILOT' })),
    )
    aiRepo.deleteConversation.mockResolvedValue(ok(undefined))

    expectOk(await SdAiService.resetChat('u1', WS, 't1'))
    expect(aiRepo.deleteConversation).toHaveBeenCalledWith('c1')
  })

  it('é no-op quando não havia conversa', async () => {
    aiRepo.findCopilotConversation.mockResolvedValue(ok(null))
    expectOk(await SdAiService.resetChat('u1', WS, 't1'))
    expect(aiRepo.deleteConversation).not.toHaveBeenCalled()
  })

  it('propaga a falha de leitura e a de acesso', async () => {
    aiRepo.findCopilotConversation.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.resetChat('u1', WS, 't1'), 'DATABASE_ERROR')

    actAs('requester')
    expectErr(await SdAiService.resetChat('u1', WS, 't1'), 'SD_NOT_AGENT')
  })
})
