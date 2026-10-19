import type { Prisma, WhatsAppConversation } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdAiCatalog,
  createFakeSdAiConversation,
  createFakeSdKbSearchRow,
} from '@/src/__tests__/factories/sd-ai.factory'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversation } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiProviderUnavailable,
  aiQuotaExceeded,
  databaseError,
  sdTicketNotFound,
  whatsappProviderError,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'
import type { SdWaConversation } from '@/src/repositories/sd-whatsapp.repository'

vi.mock('@/src/repositories/sd-ai.repository')
vi.mock('@/src/repositories/sd-kb-article.repository')
vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('@/src/repositories/sd-whatsapp.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
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
  mirrorSdWhatsappMessage: vi.fn(async () => ({ ok: true, value: null })),
  publishSdTicketMessage: vi.fn(async () => undefined),
  SdWhatsappInboundService: { openTicketFromWhatsapp: vi.fn() },
  sendSdWhatsappText: vi.fn(),
}))

import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'
import { SdAiRepository } from '@/src/repositories/sd-ai.repository'
import { SdKbArticleRepository } from '@/src/repositories/sd-kb-article.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { AiUsageService } from '../ai-usage.service'
import { SdAiService } from '../sd-ai.service'
import { SdTicketEngine } from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import {
  mirrorSdWhatsappMessage,
  SdWhatsappInboundService,
  sendSdWhatsappText,
} from '../sd-whatsapp-inbound.service'

const aiRepo = vi.mocked(SdAiRepository)
const kb = vi.mocked(SdKbArticleRepository)
const tickets = vi.mocked(SdTicketRepository)
const waRepo = vi.mocked(SdWhatsappRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const messages = vi.mocked(WhatsAppMessageRepository)
const engine = vi.mocked(SdTicketEngine)
const prepare = vi.mocked(AiUsageService.prepare)
const recordEvent = vi.mocked(recordSdTicketEvent)
const openFromWhatsapp = vi.mocked(
  SdWhatsappInboundService.openTicketFromWhatsapp,
)
const sendText = vi.mocked(sendSdWhatsappText)
const mirror = vi.mocked(mirrorSdWhatsappMessage)

const WS = 'ws1'
const chat = vi.fn()

function settings(overrides = {}) {
  return createFakeSdSettings({
    workspaceId: WS,
    aiEnabled: true,
    aiPreServiceEnabled: true,
    aiAutoTriageEnabled: true,
    aiWhatsappAutoReply: true,
    ...overrides,
  })
}

function config(overrides = {}) {
  return { settings: settings(overrides), prefixes: DEFAULT_SD_TICKET_PREFIXES }
}

function preparedCall() {
  return {
    feature: 'SERVICEDESK_TRIAGE' as const,
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

function triageOutput(overrides: Record<string, unknown> = {}) {
  return reply(
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
      ...overrides,
    }),
  )
}

function turnOutput(overrides: Record<string, unknown> = {}) {
  return reply(
    JSON.stringify({
      reply: 'Tente reiniciar o roteador',
      action: 'answer',
      articleIds: [],
      confidence: 0.9,
      ticket: null,
      ...overrides,
    }),
  )
}

const connection = createFakeWhatsAppConnection({
  id: 'conn1',
  workspaceId: WS,
  module: 'SERVICE_DESK',
})
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: WS,
  waId: '5511988887777',
})

function waConversation(
  overrides: Partial<WhatsAppConversation> = {},
): SdWaConversation {
  return {
    ...createFakeWhatsAppConversation({
      id: 'conv1',
      workspaceId: WS,
      connectionId: connection.id,
      contactId: contact.id,
      ...overrides,
    }),
    contact,
    connection,
    messages: [],
  }
}

const inbound = createFakeWhatsAppMessage({
  id: 'msg1',
  workspaceId: WS,
  conversationId: 'conv1',
  direction: 'IN',
  text: 'a internet caiu',
})

const openTicket = createFakeSdTicket({
  id: 't1',
  workspaceId: WS,
  number: 5,
  type: 'INCIDENT',
})

beforeEach(() => {
  engine.loadConfig.mockResolvedValue(ok(config()))
  prepare.mockResolvedValue(ok(preparedCall()))
  chat.mockResolvedValue(triageOutput())
  aiRepo.loadCatalog.mockResolvedValue(ok(createFakeSdAiCatalog()))
  aiRepo.setTicketAi.mockResolvedValue(ok(undefined))
  kb.suggest.mockResolvedValue(ok([createFakeSdKbSearchRow({ id: 'a1' })]))
})

describe('triageTicket', () => {
  const ticket = createFakeSdTicket({ id: 't1', workspaceId: WS, number: 5 })

  beforeEach(() => {
    tickets.findByIdUnscoped.mockResolvedValue(ok(ticket))
    engine.update.mockResolvedValue(ok(ticket))
  })

  it('aplica as sugestões nos campos vazios e grava aiTriage', async () => {
    const outcome = expectOk(await SdAiService.triageTicket('t1'))

    expect(outcome).toEqual({
      status: 'triaged',
      applied: [
        'categoryId',
        'subcategoryId',
        'serviceId',
        'impactId',
        'urgencyId',
        'departmentId',
        'tags',
      ],
      confidence: 0.9,
    })
    expect(engine.update).toHaveBeenCalledWith(
      ticket,
      expect.objectContaining({
        categoryId: 'cat',
        subcategoryId: 'sub',
        serviceId: 'svc',
        impactId: 'imp',
        urgencyId: 'urg',
        departmentId: 'dep',
        tags: ['vpn'],
      }),
      expect.objectContaining({ kind: 'system', source: 'ai-triage' }),
      expect.anything(),
      { eventMeta: { via: 'ai_triage' }, touchActivity: false },
    )
    // Impacto/urgência recalculam a prioridade: a sugerida não entra.
    expect(engine.update.mock.calls[0]?.[1]).not.toHaveProperty('priorityId')
    expect(aiRepo.setTicketAi).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        aiTriage: expect.objectContaining({
          applied: expect.arrayContaining(['categoryId']),
          model: 'openai:gpt-4o-mini',
        }),
      }),
    )
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.triaged', actorKind: 'AI' }),
    )
  })

  it('aceita a prioridade sugerida quando impacto e urgência já estavam preenchidos', async () => {
    tickets.findByIdUnscoped.mockResolvedValue(
      ok(
        createFakeSdTicket({
          id: 't1',
          workspaceId: WS,
          impactId: 'ja',
          urgencyId: 'ja',
          categoryId: 'ja',
          departmentId: 'ja',
          tags: ['antiga'],
        }),
      ),
    )

    const outcome = expectOk(await SdAiService.triageTicket('t1'))
    expect(outcome).toMatchObject({
      status: 'triaged',
      applied: ['priorityId'],
    })
  })

  it('aplica só a categoria quando a IA não desce ao serviço', async () => {
    chat.mockResolvedValue(
      triageOutput({ subcategoryId: null, serviceId: null }),
    )

    expectOk(await SdAiService.triageTicket('t1'))
    const changes = engine.update.mock.calls[0]?.[1]
    expect(changes).toMatchObject({ categoryId: 'cat' })
    expect(changes).not.toHaveProperty('subcategoryId')
    expect(changes).not.toHaveProperty('serviceId')
  })

  it('não muda nada quando o chamado já está classificado', async () => {
    tickets.findByIdUnscoped.mockResolvedValue(
      ok(
        createFakeSdTicket({
          id: 't1',
          workspaceId: WS,
          categoryId: 'ja',
          impactId: 'ja',
          urgencyId: 'ja',
          priorityId: 'ja',
          departmentId: 'ja',
          tags: ['antiga'],
        }),
      ),
    )

    const outcome = expectOk(await SdAiService.triageTicket('t1'))
    expect(outcome).toMatchObject({ status: 'triaged', applied: [] })
    expect(engine.update).not.toHaveBeenCalled()
  })

  it('segue gravando a triagem quando o motor recusa as mudanças', async () => {
    engine.update.mockResolvedValue(err(sdTicketNotFound()))

    const outcome = expectOk(await SdAiService.triageTicket('t1'))
    expect(outcome).toMatchObject({ status: 'triaged', applied: [] })
    expect(aiRepo.setTicketAi).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        aiTriage: expect.objectContaining({ applied: [] }),
      }),
    )
  })

  it('pula quando o chamado sumiu', async () => {
    tickets.findByIdUnscoped.mockResolvedValue(err(sdTicketNotFound()))
    expect(expectOk(await SdAiService.triageTicket('t1'))).toEqual({
      status: 'skipped',
      reason: 'ticket_not_found',
    })
  })

  it('propaga erros de banco na leitura do chamado e da configuração', async () => {
    tickets.findByIdUnscoped.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.triageTicket('t1'), 'DATABASE_ERROR')

    tickets.findByIdUnscoped.mockResolvedValue(ok(ticket))
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.triageTicket('t1'), 'DATABASE_ERROR')
  })

  it.each([
    ['a IA está desligada', { aiEnabled: false }],
    ['a triagem está desligada', { aiAutoTriageEnabled: false }],
  ])('pula quando %s', async (_label, overrides) => {
    engine.loadConfig.mockResolvedValue(ok(config(overrides)))
    expect(expectOk(await SdAiService.triageTicket('t1'))).toEqual({
      status: 'skipped',
      reason: 'ai_disabled',
    })
  })

  it('pula o chamado já triado', async () => {
    tickets.findByIdUnscoped.mockResolvedValue(
      ok(createFakeSdTicket({ id: 't1', workspaceId: WS, aiTriage: { a: 1 } })),
    )
    expect(expectOk(await SdAiService.triageTicket('t1'))).toEqual({
      status: 'skipped',
      reason: 'already_triaged',
    })
  })

  it.each([
    [aiQuotaExceeded(12, 10), 'ai_quota_exceeded'],
    [aiProviderUnavailable(), 'ai_provider_unavailable'],
    [databaseError(), 'ai_prepare_failed'],
  ])('pula quando o preparo da chamada falha (%#)', async (error, reason) => {
    prepare.mockResolvedValue(err(error))
    expect(expectOk(await SdAiService.triageTicket('t1'))).toEqual({
      status: 'skipped',
      reason,
    })
  })

  it('propaga a falha ao carregar o catálogo', async () => {
    aiRepo.loadCatalog.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.triageTicket('t1'), 'DATABASE_ERROR')
  })

  it('marca falha quando o provedor não responde', async () => {
    chat.mockRejectedValue(new Error('timeout'))
    expect(expectOk(await SdAiService.triageTicket('t1'))).toEqual({
      status: 'failed',
      reason: 'provider_failed',
    })
  })

  it('pula quando o modelo não devolve o JSON pedido', async () => {
    chat.mockResolvedValue(reply('não consegui'))
    expect(expectOk(await SdAiService.triageTicket('t1'))).toEqual({
      status: 'skipped',
      reason: 'unparseable_response',
    })
  })

  it('marca a descrição ausente no texto enviado para a triagem', async () => {
    tickets.findByIdUnscoped.mockResolvedValue(
      ok(createFakeSdTicket({ id: 't1', workspaceId: WS, description: null })),
    )

    expectOk(await SdAiService.triageTicket('t1'))
    expect(chat.mock.calls[0]?.[0].messages[0].content).toContain(
      '(sem descrição)',
    )
  })

  it('propaga a falha ao gravar a triagem', async () => {
    aiRepo.setTicketAi.mockResolvedValue(err(databaseError()))
    expectErr(await SdAiService.triageTicket('t1'), 'DATABASE_ERROR')
  })
})

describe('whatsappReply — roteamento', () => {
  beforeEach(() => {
    waRepo.findConversationUnscoped.mockResolvedValue(ok(waConversation()))
    messages.findById.mockResolvedValue(ok(inbound))
    waRepo.findOpenTicket.mockResolvedValue(ok(null))
    aiRepo.findActiveWhatsappConversation.mockResolvedValue(ok(null))
    aiRepo.createConversation.mockResolvedValue(
      ok(
        createFakeSdAiConversation({
          id: 'ai1',
          workspaceId: WS,
          whatsappConversationId: 'conv1',
        }),
      ),
    )
    aiRepo.updateConversation.mockImplementation(async (_id, data) =>
      ok(
        createFakeSdAiConversation({
          id: 'ai1',
          ...data,
          messages: (data.messages ?? []) as Prisma.JsonValue,
        }),
      ),
    )
    conversations.update.mockResolvedValue(ok(createFakeWhatsAppConversation()))
    chat.mockResolvedValue(turnOutput())
    sendText.mockResolvedValue(
      ok(createFakeWhatsAppMessage({ id: 'out1', direction: 'OUT' })),
    )
  })

  it('pula quando a conversa não é do ServiceDesk', async () => {
    waRepo.findConversationUnscoped.mockResolvedValue(ok(null))
    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'skipped', reason: 'conversation_not_found' })
  })

  it('pula quando a mensagem sumiu ou é de outra conversa', async () => {
    messages.findById.mockResolvedValue(ok(null))
    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'skipped', reason: 'message_not_found' })

    messages.findById.mockResolvedValue(
      ok(createFakeWhatsAppMessage({ conversationId: 'outra' })),
    )
    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'skipped', reason: 'message_not_found' })
  })

  it('propaga as falhas de banco do roteamento', async () => {
    waRepo.findConversationUnscoped.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )

    waRepo.findConversationUnscoped.mockResolvedValue(ok(waConversation()))
    messages.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )

    messages.findById.mockResolvedValue(ok(inbound))
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )

    engine.loadConfig.mockResolvedValue(ok(config()))
    waRepo.findOpenTicket.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('whatsappReply — pré-atendimento', () => {
  const aiConversation = createFakeSdAiConversation({
    id: 'ai1',
    workspaceId: WS,
    whatsappConversationId: 'conv1',
  })

  beforeEach(() => {
    waRepo.findConversationUnscoped.mockResolvedValue(ok(waConversation()))
    messages.findById.mockResolvedValue(ok(inbound))
    waRepo.findOpenTicket.mockResolvedValue(ok(null))
    aiRepo.findActiveWhatsappConversation.mockResolvedValue(ok(null))
    aiRepo.createConversation.mockResolvedValue(ok(aiConversation))
    aiRepo.updateConversation.mockImplementation(async (_id, data) =>
      ok({
        ...aiConversation,
        ...data,
        messages: (data.messages ?? []) as Prisma.JsonValue,
      }),
    )
    conversations.update.mockResolvedValue(ok(createFakeWhatsAppConversation()))
    chat.mockResolvedValue(turnOutput())
    sendText.mockResolvedValue(
      ok(createFakeWhatsAppMessage({ id: 'out1', direction: 'OUT' })),
    )
    openFromWhatsapp.mockResolvedValue(ok(openTicket))
  })

  it('abre a conversa de IA, responde e marca a conversa como atendida pela IA', async () => {
    const outcome = expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )

    expect(aiRepo.createConversation).toHaveBeenCalledWith({
      workspaceId: WS,
      mode: 'PRE_SERVICE',
      whatsappConversationId: 'conv1',
    })
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      aiActive: true,
      aiHandoff: false,
    })
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        waId: contact.waId,
        text: 'Tente reiniciar o roteador',
        sentByAi: true,
      }),
    )
    expect(outcome).toEqual({ status: 'replied', action: 'answer' })
    expect(chat.mock.calls[0]?.[0].system).toContain('Canal: WhatsApp')
  })

  it('reaproveita o pré-atendimento em curso sem reativar a conversa', async () => {
    aiRepo.findActiveWhatsappConversation.mockResolvedValue(
      ok({
        ...aiConversation,
        messages: [{ role: 'user', content: 'anterior', at: 'now' }],
      }),
    )

    expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    expect(aiRepo.createConversation).not.toHaveBeenCalled()
    expect(conversations.update).not.toHaveBeenCalledWith('conv1', {
      aiActive: true,
      aiHandoff: false,
    })
    expect(chat.mock.calls[0]?.[0].messages).toHaveLength(2)
  })

  it('guarda os artigos citados no turno gravado', async () => {
    chat.mockResolvedValue(turnOutput({ articleIds: ['a1'] }))

    expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    const stored = aiRepo.updateConversation.mock.calls[0]?.[1]
      .messages as unknown[]
    expect(stored.at(-1)).toMatchObject({
      role: 'assistant',
      articles: [expect.objectContaining({ id: 'a1' })],
    })
  })

  it('encerra pela base quando a IA declara resolvido', async () => {
    chat.mockResolvedValue(turnOutput({ action: 'resolved' }))

    const outcome = expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    expect(outcome).toEqual({ status: 'replied', action: 'resolved' })
    expect(aiRepo.updateConversation).toHaveBeenCalledWith(
      'ai1',
      expect.objectContaining({ outcome: 'resolved_by_kb' }),
    )
    expect(conversations.update).toHaveBeenLastCalledWith('conv1', {
      aiActive: false,
    })
  })

  it('marca falha quando o envio pelo provedor não vai', async () => {
    sendText.mockResolvedValue(err(whatsappProviderError()))
    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'failed', reason: 'WHATSAPP_PROVIDER_ERROR' })
  })

  it.each([
    ['a IA está desligada', { aiEnabled: false }, 'ai_disabled'],
    [
      'o pré-atendimento está desligado',
      { aiPreServiceEnabled: false },
      'ai_disabled',
    ],
  ])('abre o chamado direto quando %s', async (_label, overrides, reason) => {
    engine.loadConfig.mockResolvedValue(ok(config(overrides)))

    const outcome = expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    expect(outcome).toEqual({ status: 'ticket_opened', ticketId: 't1', reason })
    expect(chat).not.toHaveBeenCalled()
    expect(openFromWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv1',
        transcript: expect.stringContaining('Solicitante: a internet caiu'),
      }),
    )
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.pre_service',
        meta: expect.objectContaining({ channel: 'WHATSAPP', reason }),
      }),
    )
  })

  it('abre o chamado quando o contato pede um atendente', async () => {
    messages.findById.mockResolvedValue(
      ok({ ...inbound, text: 'quero falar com um atendente' }),
    )

    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({
      status: 'ticket_opened',
      ticketId: 't1',
      reason: 'handoff_keyword',
    })
    expect(chat).not.toHaveBeenCalled()
  })

  it('abre o chamado quando a IA falha (ninguém fica sem resposta)', async () => {
    prepare.mockResolvedValue(err(aiQuotaExceeded(12, 10)))

    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({
      status: 'ticket_opened',
      ticketId: 't1',
      reason: 'ai_ai_quota_exceeded',
    })
  })

  it.each([
    ['a IA decide abrir', { action: 'open_ticket' }, 'ai_decision'],
    [
      'a confiança é baixa',
      { action: 'answer', confidence: 0.1 },
      'low_confidence',
    ],
  ])('abre o chamado quando %s', async (_label, overrides, reason) => {
    chat.mockResolvedValue(turnOutput(overrides))

    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'ticket_opened', ticketId: 't1', reason })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('propaga a falha ao abrir o chamado ou ao gravar a conversa', async () => {
    engine.loadConfig.mockResolvedValue(ok(config({ aiEnabled: false })))
    openFromWhatsapp.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )

    openFromWhatsapp.mockResolvedValue(ok(openTicket))
    aiRepo.updateConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )
  })

  it('propaga a falha ao procurar ou criar o pré-atendimento', async () => {
    aiRepo.findActiveWhatsappConversation.mockResolvedValue(
      err(databaseError()),
    )
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )

    aiRepo.findActiveWhatsappConversation.mockResolvedValue(ok(null))
    aiRepo.createConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )
  })

  it('propaga a falha ao gravar o turno respondido', async () => {
    aiRepo.updateConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )
  })

  it('descreve a mídia recebida no lugar do texto', async () => {
    messages.findById.mockResolvedValue(
      ok({ ...inbound, type: 'IMAGE', text: null }),
    )
    engine.loadConfig.mockResolvedValue(ok(config({ aiEnabled: false })))

    expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    expect(openFromWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: expect.stringContaining('[Imagem]'),
      }),
    )
  })
})

describe('whatsappReply — resposta automática no chamado aberto', () => {
  beforeEach(() => {
    waRepo.findConversationUnscoped.mockResolvedValue(ok(waConversation()))
    messages.findById.mockResolvedValue(ok(inbound))
    waRepo.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 5, type: 'INCIDENT' }),
    )
    tickets.findById.mockResolvedValue(ok(openTicket))
    messages.listLatestByConversation.mockResolvedValue(ok([]))
    conversations.update.mockResolvedValue(ok(createFakeWhatsAppConversation()))
    chat.mockResolvedValue(turnOutput())
    sendText.mockResolvedValue(
      ok(createFakeWhatsAppMessage({ id: 'out1', direction: 'OUT' })),
    )
  })

  it('responde e espelha no histórico do chamado', async () => {
    const outcome = expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )

    expect(outcome).toEqual({ status: 'replied', action: 'answer' })
    expect(mirror).toHaveBeenCalledWith(
      expect.objectContaining({ authorKind: 'AI' }),
    )
    // Sem histórico anterior: manda a própria mensagem como único turno.
    expect(chat.mock.calls[0]?.[0].messages).toEqual([
      {
        role: 'user',
        content: wrapUntrusted('a internet caiu', 'whatsapp_message'),
      },
    ])
    expect(chat.mock.calls[0]?.[0].system).toContain(
      'já tem o chamado INC-000005',
    )
  })

  it('usa as mensagens desde a abertura do chamado como contexto', async () => {
    const base = openTicket.createdAt
    messages.listLatestByConversation.mockResolvedValue(
      ok([
        createFakeWhatsAppMessage({
          direction: 'OUT',
          text: 'já estamos vendo',
          createdAt: new Date(base.getTime() + 2000),
        }),
        createFakeWhatsAppMessage({
          direction: 'IN',
          text: 'continua caindo',
          createdAt: new Date(base.getTime() + 1000),
        }),
        createFakeWhatsAppMessage({
          direction: 'IN',
          text: 'antes do chamado',
          createdAt: new Date(base.getTime() - 1000),
        }),
      ]),
    )

    expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    expect(chat.mock.calls[0]?.[0].messages).toEqual([
      {
        role: 'user',
        content: wrapUntrusted('continua caindo', 'whatsapp_message'),
      },
      { role: 'assistant', content: 'já estamos vendo' },
    ])
  })

  it('monta o rascunho padrão quando só há mensagens do time no período', async () => {
    const base = openTicket.createdAt
    messages.listLatestByConversation.mockResolvedValue(
      ok([
        createFakeWhatsAppMessage({
          direction: 'OUT',
          text: 'estamos verificando',
          createdAt: new Date(base.getTime() + 1000),
        }),
      ]),
    )
    chat.mockResolvedValue(turnOutput({ action: 'open_ticket' }))

    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'handoff' })
    expect(chat.mock.calls[0]?.[0].messages).toEqual([
      { role: 'assistant', content: 'estamos verificando' },
    ])
  })

  it.each([
    ['a IA está desligada', { aiEnabled: false }],
    ['a resposta automática está desligada', { aiWhatsappAutoReply: false }],
  ])('pula quando %s', async (_label, overrides) => {
    engine.loadConfig.mockResolvedValue(ok(config(overrides)))
    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'skipped', reason: 'ai_disabled' })
  })

  it.each([
    ['já tem responsável', { ticket: { assigneeId: 'u1' } }],
    ['já teve primeira resposta', { ticket: { firstRespondedAt: new Date() } }],
    ['foi transbordado para humano', { conversation: { aiHandoff: true } }],
  ])('pula quando o chamado %s', async (_label, overrides) => {
    if ('ticket' in overrides && overrides.ticket) {
      tickets.findById.mockResolvedValue(
        ok(createFakeSdTicket({ ...openTicket, ...overrides.ticket })),
      )
    }
    if ('conversation' in overrides && overrides.conversation) {
      waRepo.findConversationUnscoped.mockResolvedValue(
        ok(waConversation(overrides.conversation)),
      )
    }

    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'skipped', reason: 'human_handling' })
  })

  it('avisa o time quando o contato pede humano', async () => {
    messages.findById.mockResolvedValue(
      ok({ ...inbound, text: 'quero um humano' }),
    )

    const outcome = expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    expect(outcome).toEqual({ status: 'handoff' })
    expect(chat).not.toHaveBeenCalled()
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Avisei o time'),
      }),
    )
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      aiActive: false,
      aiHandoff: true,
    })
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.handoff',
        meta: expect.objectContaining({ trigger: 'keyword' }),
      }),
    )
  })

  it('transborda quando a própria IA decide chamar o time', async () => {
    chat.mockResolvedValue(turnOutput({ action: 'open_ticket' }))

    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'handoff' })
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ trigger: 'ai' }),
      }),
    )
  })

  it('marca falha quando a IA ou o envio falham', async () => {
    prepare.mockResolvedValue(err(aiQuotaExceeded(12, 10)))
    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'failed', reason: 'AI_QUOTA_EXCEEDED' })

    prepare.mockResolvedValue(ok(preparedCall()))
    sendText.mockResolvedValue(err(whatsappProviderError()))
    expect(
      expectOk(
        await SdAiService.whatsappReply({
          conversationId: 'conv1',
          messageId: 'msg1',
        }),
      ),
    ).toEqual({ status: 'failed', reason: 'WHATSAPP_PROVIDER_ERROR' })
  })

  it('propaga as falhas de banco do chamado e do histórico', async () => {
    tickets.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )

    tickets.findById.mockResolvedValue(ok(openTicket))
    messages.listLatestByConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('whatsappReply — proteções da resposta automática (ADR 0041)', () => {
  const guarded = () => ({
    ...preparedCall(),
    feature: 'SERVICEDESK_PRE_SERVICE' as const,
    guardrails: {
      piiMaskingPolicy: 'AUTO_REPLIES' as const,
      injectionClassifierEnabled: false,
      limits: {
        forbiddenTopics: [],
        maxDiscountPercent: 0,
        maxRefundAmount: null,
        maxDeadlineDays: null,
      },
    },
  })
  const aiConversation = createFakeSdAiConversation({
    id: 'ai1',
    workspaceId: WS,
    whatsappConversationId: 'conv1',
  })

  beforeEach(() => {
    prepare.mockResolvedValue(ok(guarded()))
    waRepo.findConversationUnscoped.mockResolvedValue(ok(waConversation()))
    messages.findById.mockResolvedValue(ok(inbound))
    conversations.update.mockResolvedValue(ok(createFakeWhatsAppConversation()))
    chat.mockResolvedValue(
      turnOutput({ reply: 'Posso te dar um desconto de 20%!' }),
    )
    sendText.mockResolvedValue(
      ok(createFakeWhatsAppMessage({ id: 'out1', direction: 'OUT' })),
    )
  })

  it('abre o chamado com a nota em vez de mandar o rascunho no pré-atendimento', async () => {
    waRepo.findOpenTicket.mockResolvedValue(ok(null))
    aiRepo.findActiveWhatsappConversation.mockResolvedValue(ok(null))
    aiRepo.createConversation.mockResolvedValue(ok(aiConversation))
    aiRepo.updateConversation.mockImplementation(async (_id, data) =>
      ok({
        ...aiConversation,
        ...data,
        messages: (data.messages ?? []) as Prisma.JsonValue,
      }),
    )
    openFromWhatsapp.mockResolvedValue(ok(openTicket))

    const outcome = expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    expect(chat.mock.calls[0]?.[0].system).toContain(
      'Nunca ofereça nem prometa descontos.',
    )
    expect(outcome).toMatchObject({
      status: 'ticket_opened',
      reason: 'guardrail_discount',
    })
    expect(sendText).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Posso te dar um desconto de 20%!' }),
    )
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.pre_service',
        meta: expect.objectContaining({
          reason: 'guardrail_discount',
          note: expect.stringContaining('desconto'),
        }),
      }),
    )
  })

  it('transborda com a nota no chamado aberto', async () => {
    waRepo.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 5, type: 'INCIDENT' }),
    )
    tickets.findById.mockResolvedValue(ok(openTicket))
    messages.listLatestByConversation.mockResolvedValue(ok([]))

    const outcome = expectOk(
      await SdAiService.whatsappReply({
        conversationId: 'conv1',
        messageId: 'msg1',
      }),
    )
    expect(outcome).toEqual({ status: 'handoff' })
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('precisa de um atendente'),
      }),
    )
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.handoff',
        meta: expect.objectContaining({
          trigger: 'guardrail',
          guardrail: 'discount',
        }),
      }),
    )
  })
})
