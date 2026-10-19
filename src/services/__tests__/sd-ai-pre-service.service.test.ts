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
import {
  aiQuotaExceeded,
  databaseError,
  sdCategoryNotFound,
  sdPhaseNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-ai.repository')
vi.mock('@/src/repositories/sd-kb-article.repository')
vi.mock('@/src/repositories/sd-whatsapp.repository')
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
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import { AiUsageService } from '../ai-usage.service'
import { SdAiService } from '../sd-ai.service'
import { fireSdAutomations } from '../sd-automation-engine'
import { SdTicketEngine } from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import { publishSdTicketMessage } from '../sd-whatsapp-inbound.service'

const aiRepo = vi.mocked(SdAiRepository)
const kb = vi.mocked(SdKbArticleRepository)
const waRepo = vi.mocked(SdWhatsappRepository)
const engine = vi.mocked(SdTicketEngine)
const prepare = vi.mocked(AiUsageService.prepare)
const audit = vi.mocked(auditMutation)
const recordEvent = vi.mocked(recordSdTicketEvent)
const publish = vi.mocked(publishSdTicketMessage)
const automations = vi.mocked(fireSdAutomations)

const WS = 'ws1'
const chat = vi.fn()

function settings(overrides = {}) {
  return createFakeSdSettings({
    workspaceId: WS,
    aiEnabled: true,
    aiPreServiceEnabled: true,
    portalEnabled: true,
    ...overrides,
  })
}

function config(overrides = {}) {
  return {
    settings: settings(overrides),
    prefixes: DEFAULT_SD_TICKET_PREFIXES,
  }
}

function preparedCall() {
  return {
    feature: 'SERVICEDESK_PRE_SERVICE' as const,
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

function turn(overrides: Record<string, unknown> = {}) {
  return reply(
    JSON.stringify({
      reply: 'Tente reiniciar o cliente de VPN',
      action: 'answer',
      articleIds: ['a1'],
      confidence: 0.9,
      ticket: null,
      ...overrides,
    }),
  )
}

const conversation = createFakeSdAiConversation({
  id: 'c1',
  workspaceId: WS,
  userId: 'u1',
  mode: 'PRE_SERVICE',
})

beforeEach(() => {
  actAs('requester')
  engine.loadConfig.mockResolvedValue(ok(config()))
  prepare.mockResolvedValue(ok(preparedCall()))
  chat.mockResolvedValue(turn())
  kb.suggest.mockResolvedValue(
    ok([
      createFakeSdKbSearchRow({ id: 'a1', title: 'VPN', plainText: 'passos' }),
    ]),
  )
  aiRepo.loadCatalog.mockResolvedValue(ok(createFakeSdAiCatalog()))
  aiRepo.createConversation.mockResolvedValue(ok(conversation))
  aiRepo.findConversation.mockResolvedValue(ok(conversation))
  aiRepo.updateConversation.mockImplementation(async (_id, data) =>
    ok({
      ...conversation,
      ...data,
      messages: (data.messages ?? []) as Prisma.JsonValue,
    }),
  )
})

describe('acesso ao pré-atendimento', () => {
  it('recusa quando a IA ou o pré-atendimento estão desligados', async () => {
    engine.loadConfig.mockResolvedValue(ok(config({ aiEnabled: false })))
    const off = expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'SD_AI_DISABLED',
    )
    expect(off.message).toContain('pré-atendimento')

    engine.loadConfig.mockResolvedValue(
      ok(config({ aiPreServiceEnabled: false })),
    )
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'SD_AI_DISABLED',
    )
  })

  it('recusa solicitante quando o portal está desligado, mas deixa o agente', async () => {
    engine.loadConfig.mockResolvedValue(ok(config({ portalEnabled: false })))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'SD_PORTAL_DISABLED',
    )

    actAs('agent')
    expectOk(await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }))
  })

  it('recusa quem não é membro e propaga a falha de configuração', async () => {
    actAs('non-member')
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'FORBIDDEN',
    )

    actAs('requester')
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'DATABASE_ERROR',
    )
  })
})

describe('preServiceMessage', () => {
  it('abre uma conversa nova e devolve a resposta com os artigos citados', async () => {
    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, {
        message: 'não consigo acessar a VPN',
      }),
    )

    expect(aiRepo.createConversation).toHaveBeenCalledWith({
      workspaceId: WS,
      mode: 'PRE_SERVICE',
      userId: 'u1',
    })
    expect(result.reply).toBe('Tente reiniciar o cliente de VPN')
    expect(result.action).toBe('answer')
    expect(result.articles).toEqual([
      { id: 'a1', title: 'VPN', excerpt: 'passos' },
    ])
    expect(result.suggestOpenTicket).toBe(false)
    expect(result.ticketDraft).toMatchObject({
      title: 'não consigo acessar a VPN',
      description: 'não consigo acessar a VPN',
      type: 'INCIDENT',
    })
    expect(result.conversation.messages).toHaveLength(2)
  })

  it('continua a conversa informada e manda só os 16 turnos mais recentes', async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
      at: 'now',
    }))
    aiRepo.findConversation.mockResolvedValue(
      ok({ ...conversation, messages: history }),
    )

    expectOk(
      await SdAiService.preServiceMessage('u1', WS, {
        conversationId: 'c1',
        message: 'ainda não foi',
      }),
    )
    expect(aiRepo.createConversation).not.toHaveBeenCalled()
    expect(chat.mock.calls[0]?.[0].messages).toHaveLength(16)
  })

  it.each([
    ['não é do usuário', { userId: 'outro' }],
    ['é do copiloto', { mode: 'COPILOT' }],
    ['é do WhatsApp', { whatsappConversationId: 'wa1' }],
  ])('recusa a conversa que %s', async (_label, overrides) => {
    aiRepo.findConversation.mockResolvedValue(
      ok({ ...conversation, ...overrides }),
    )
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, {
        conversationId: 'c1',
        message: 'oi',
      }),
      'SD_AI_CONVERSATION_NOT_FOUND',
    )
  })

  it('recusa conversa inexistente, já encerrada ou com falha de leitura', async () => {
    aiRepo.findConversation.mockResolvedValue(ok(null))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, {
        conversationId: 'c1',
        message: 'oi',
      }),
      'SD_AI_CONVERSATION_NOT_FOUND',
    )

    aiRepo.findConversation.mockResolvedValue(
      ok({ ...conversation, outcome: 'resolved_by_kb' }),
    )
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, {
        conversationId: 'c1',
        message: 'oi',
      }),
      'SD_AI_CONVERSATION_CLOSED',
    )

    aiRepo.findConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, {
        conversationId: 'c1',
        message: 'oi',
      }),
      'DATABASE_ERROR',
    )
  })

  it('não gasta IA quando o solicitante pede um humano', async () => {
    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, {
        message: 'quero falar com um atendente',
      }),
    )

    expect(chat).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(result.action).toBe('open_ticket')
    expect(result.suggestOpenTicket).toBe(true)
    expect(result.articles).toEqual([])
    expect(result.reply).toContain('time de atendimento')
    expect(result.ticketDraft.title).toBe('quero falar com um atendente')
  })

  it('reaproveita o último rascunho da IA no transbordo', async () => {
    aiRepo.findConversation.mockResolvedValue(
      ok({
        ...conversation,
        messages: [
          { role: 'user', content: 'sem VPN', at: 'now' },
          {
            role: 'assistant',
            content: 'tentou reiniciar?',
            at: 'now',
            draft: {
              title: 'VPN não conecta',
              description: 'erro 809',
              type: 'INCIDENT',
              categoryId: 'cat',
              subcategoryId: null,
              serviceId: null,
              urgencyId: null,
            },
          },
        ],
      }),
    )

    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, {
        conversationId: 'c1',
        message: 'quero um humano',
      }),
    )
    expect(result.ticketDraft).toMatchObject({
      title: 'VPN não conecta',
      categoryId: 'cat',
    })
  })

  it('troca o tipo do rascunho quando o portal não permite aquele tipo', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(config({ portalTicketTypes: ['SERVICE_REQUEST'] })),
    )
    aiRepo.findConversation.mockResolvedValue(
      ok({
        ...conversation,
        messages: [
          {
            role: 'assistant',
            content: 'ok',
            at: 'now',
            draft: {
              title: 'Mudança grande',
              description: 'x',
              type: 'CHANGE',
              categoryId: null,
              subcategoryId: null,
              serviceId: null,
              urgencyId: null,
            },
          },
        ],
      }),
    )

    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, {
        conversationId: 'c1',
        message: 'atendente por favor',
      }),
    )
    expect(result.ticketDraft.type).toBe('SERVICE_REQUEST')
  })

  it('sugere abrir chamado quando a IA pede ou quando tem pouca confiança', async () => {
    chat.mockResolvedValue(turn({ action: 'open_ticket' }))
    expect(
      expectOk(await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }))
        .suggestOpenTicket,
    ).toBe(true)

    chat.mockResolvedValue(turn({ action: 'answer', confidence: 0.2 }))
    expect(
      expectOk(await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }))
        .suggestOpenTicket,
    ).toBe(true)
  })

  it('cai no texto cru quando o modelo não devolve o JSON pedido', async () => {
    chat.mockResolvedValue(reply('Posso ajudar com outra coisa?'))
    const answered = expectOk(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
    )
    expect(answered.reply).toBe('Posso ajudar com outra coisa?')
    expect(answered.action).toBe('answer')

    chat.mockResolvedValue(reply('   '))
    const empty = expectOk(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
    )
    expect(empty.action).toBe('open_ticket')
    expect(empty.suggestOpenTicket).toBe(true)
  })

  it('valida o caminho do catálogo no rascunho que a IA sugeriu', async () => {
    chat.mockResolvedValue(
      turn({
        ticket: {
          title: 'VPN cai toda hora',
          description: 'desde ontem',
          type: 'CHANGE',
          categoryId: 'cat',
          subcategoryId: 'orfa',
          serviceId: 'svc',
          urgencyId: 'urg',
        },
      }),
    )

    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, { message: 'sem VPN' }),
    )
    expect(result.ticketDraft).toMatchObject({
      title: 'VPN cai toda hora',
      description: 'desde ontem',
      // CHANGE não está liberado no portal → cai no primeiro permitido.
      type: 'INCIDENT',
      categoryId: 'cat',
      subcategoryId: null,
      serviceId: null,
      urgencyId: 'urg',
    })
  })

  it('aceita o caminho completo do catálogo e o tipo permitido', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(config({ portalTicketTypes: ['INCIDENT', 'SERVICE_REQUEST'] })),
    )
    chat.mockResolvedValue(
      turn({
        ticket: {
          title: 'Preciso de acesso à VPN',
          description: 'sou novo no time',
          type: 'SERVICE_REQUEST',
          categoryId: 'cat',
          subcategoryId: 'sub',
          serviceId: 'svc',
          urgencyId: 'urg',
        },
      }),
    )

    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, { message: 'acesso' }),
    )
    expect(result.ticketDraft).toEqual({
      title: 'Preciso de acesso à VPN',
      description: 'sou novo no time',
      type: 'SERVICE_REQUEST',
      categoryId: 'cat',
      subcategoryId: 'sub',
      serviceId: 'svc',
      urgencyId: 'urg',
    })
  })

  it('cai em incidente quando o portal não lista nenhum tipo', async () => {
    engine.loadConfig.mockResolvedValue(ok(config({ portalTicketTypes: [] })))

    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, { message: 'sem VPN' }),
    )
    expect(result.ticketDraft.type).toBe('INCIDENT')
    expect(chat.mock.calls[0]?.[0].system).toContain('tipo entre INCIDENT;')
  })

  it('ignora mensagens gravadas que não são uma lista', async () => {
    aiRepo.findConversation.mockResolvedValue(
      ok({ ...conversation, messages: { nada: true } }),
    )

    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, {
        conversationId: 'c1',
        message: 'quero um atendente',
      }),
    )
    expect(result.ticketDraft.title).toBe('quero um atendente')
  })

  it('usa o título curto da IA só quando tem 3+ caracteres', async () => {
    chat.mockResolvedValue(
      turn({
        ticket: {
          title: 'ab',
          description: '',
          type: null,
          categoryId: null,
          subcategoryId: null,
          serviceId: null,
          urgencyId: null,
        },
      }),
    )
    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, {
        message: 'primeira linha\nsegunda linha',
      }),
    )
    expect(result.ticketDraft.title).toBe('primeira linha')
    expect(result.ticketDraft.description).toBe('primeira linha\nsegunda linha')
  })

  it('agente vê os quatro tipos e a base interna', async () => {
    actAs('agent')
    expectOk(await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }))
    expect(kb.suggest).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ portalOnly: false }),
    )
    expect(chat.mock.calls[0]?.[0].system).toContain(
      'INCIDENT, SERVICE_REQUEST, CHANGE, PROBLEM',
    )
  })

  it('propaga as falhas de cota, de base, de catálogo e de gravação', async () => {
    prepare.mockResolvedValue(err(aiQuotaExceeded(12, 10)))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'AI_QUOTA_EXCEEDED',
    )

    prepare.mockResolvedValue(ok(preparedCall()))
    kb.suggest.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'DATABASE_ERROR',
    )

    kb.suggest.mockResolvedValue(ok([]))
    aiRepo.loadCatalog.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'DATABASE_ERROR',
    )

    aiRepo.loadCatalog.mockResolvedValue(ok(createFakeSdAiCatalog()))
    chat.mockRejectedValue(new Error('timeout'))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'AI_PROVIDER_UNAVAILABLE',
    )

    chat.mockResolvedValue(turn())
    aiRepo.createConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'DATABASE_ERROR',
    )

    aiRepo.createConversation.mockResolvedValue(ok(conversation))
    aiRepo.updateConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.preServiceMessage('u1', WS, { message: 'oi' }),
      'DATABASE_ERROR',
    )
  })
})

describe('preServiceOpenTicket', () => {
  const created = createFakeSdTicket({
    id: 't9',
    workspaceId: WS,
    number: 9,
    type: 'INCIDENT',
  })

  const withDraft = {
    ...conversation,
    messages: [
      { role: 'user', content: 'VPN fora', at: 'now' },
      {
        role: 'assistant',
        content: 'entendi',
        at: 'now',
        draft: {
          title: 'VPN fora do ar',
          description: 'desde ontem',
          type: 'INCIDENT',
          categoryId: 'cat',
          subcategoryId: 'sub',
          serviceId: null,
          urgencyId: 'urg',
        },
      },
    ],
  }

  beforeEach(() => {
    aiRepo.findConversation.mockResolvedValue(ok(withDraft))
    engine.create.mockResolvedValue(ok(created))
    waRepo.createTicketMessage.mockResolvedValue(ok({ id: 'm1' }))
  })

  it('abre o chamado com o rascunho, a transcrição e as automações', async () => {
    const result = expectOk(
      await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {}),
    )

    expect(result).toEqual({ id: 't9', number: 9, code: 'INC-000009' })
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        type: 'INCIDENT',
        title: 'VPN fora do ar',
        description: '<p>desde ontem</p>',
        channel: 'PORTAL',
        requesterId: 'u1',
        portal: true,
        categoryId: 'cat',
        subcategoryId: 'sub',
        urgencyId: 'urg',
      }),
      expect.objectContaining({ kind: 'user', userId: 'u1' }),
      expect.anything(),
    )
    expect(waRepo.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't9',
        authorKind: 'AI',
        channel: 'PLATFORM',
        body: expect.stringContaining('Solicitante: VPN fora'),
      }),
    )
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.pre_service', actorKind: 'AI' }),
    )
    expect(publish).toHaveBeenCalled()
    expect(aiRepo.updateConversation).toHaveBeenCalledWith('c1', {
      outcome: 'ticket_opened',
      ticketId: 't9',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_ticket',
        action: 'create',
        targetId: 't9',
      }),
    )
    expect(automations).toHaveBeenCalledWith('TICKET_CREATED', 't9', {
      actorId: 'u1',
    })
  })

  it('deixa o solicitante sobrescrever título, descrição e tipo', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(config({ portalTicketTypes: ['INCIDENT', 'SERVICE_REQUEST'] })),
    )

    expectOk(
      await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {
        title: 'Preciso de acesso',
        description: 'para o sistema novo',
        type: 'SERVICE_REQUEST',
      }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        type: 'SERVICE_REQUEST',
        title: 'Preciso de acesso',
        description: '<p>para o sistema novo</p>',
      }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('cai no primeiro texto do solicitante quando não há rascunho utilizável', async () => {
    aiRepo.findConversation.mockResolvedValue(
      ok({
        ...conversation,
        messages: [
          {
            role: 'user',
            content: 'tela azul\ndepois de atualizar',
            at: 'now',
          },
          { role: 'user', content: 'voltou a acontecer', at: 'now' },
        ],
      }),
    )

    expectOk(await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {}))
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        title: 'tela azul',
        description:
          '<p>tela azul<br>depois de atualizar</p><p>voltou a acontecer</p>',
      }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('usa o título padrão e abre sem descrição quando não há nada escrito', async () => {
    aiRepo.findConversation.mockResolvedValue(
      ok({ ...conversation, messages: [] }),
    )

    expectOk(await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {}))
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        title: 'Solicitação via assistente',
        description: undefined,
      }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('recusa um tipo que o portal não permite', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(config({ portalTicketTypes: ['INCIDENT'] })),
    )
    const error = expectErr(
      await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {
        type: 'CHANGE',
      }),
      'SD_TICKET_FORBIDDEN',
    )
    expect(error.message).toContain('portal')
    expect(engine.create).not.toHaveBeenCalled()
  })

  it('deixa o agente abrir qualquer tipo', async () => {
    actAs('agent')
    engine.loadConfig.mockResolvedValue(
      ok(config({ portalTicketTypes: ['INCIDENT'] })),
    )
    expectOk(
      await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {
        type: 'CHANGE',
      }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ type: 'CHANGE', portal: false }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('tenta de novo sem catálogo quando a sugestão da IA não serve', async () => {
    engine.create
      .mockResolvedValueOnce(err(sdCategoryNotFound()))
      .mockResolvedValueOnce(ok(created))

    expectOk(await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {}))
    expect(engine.create).toHaveBeenCalledTimes(2)
    expect(engine.create.mock.calls[1]?.[1]).not.toHaveProperty('categoryId')
  })

  it('registra a falha na trilha quando o chamado não pode ser aberto', async () => {
    engine.create.mockResolvedValue(err(sdPhaseNotFound()))

    expectErr(
      await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {}),
      'SD_PHASE_NOT_FOUND',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'SD_PHASE_NOT_FOUND',
      }),
    )
    expect(engine.create).toHaveBeenCalledTimes(1)
  })

  it('propaga a falha ao marcar a conversa como encerrada', async () => {
    aiRepo.updateConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {}),
      'DATABASE_ERROR',
    )
  })

  it('recusa a conversa de outro usuário', async () => {
    aiRepo.findConversation.mockResolvedValue(
      ok({ ...withDraft, userId: 'outro' }),
    )
    expectErr(
      await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {}),
      'SD_AI_CONVERSATION_NOT_FOUND',
    )
  })

  it('recusa quando o pré-atendimento foi desligado no meio do caminho', async () => {
    engine.loadConfig.mockResolvedValue(ok(config({ aiEnabled: false })))
    expectErr(
      await SdAiService.preServiceOpenTicket('u1', WS, 'c1', {}),
      'SD_AI_DISABLED',
    )
    expect(engine.create).not.toHaveBeenCalled()
  })
})

describe('preServiceClose', () => {
  it('encerra a conversa com o desfecho informado', async () => {
    const dto = expectOk(
      await SdAiService.preServiceClose('u1', WS, 'c1', {
        outcome: 'resolved_by_kb',
      }),
    )

    expect(aiRepo.updateConversation).toHaveBeenCalledWith('c1', {
      outcome: 'resolved_by_kb',
    })
    expect(dto.outcome).toBe('resolved_by_kb')
  })

  it('não exige o pré-atendimento ligado para encerrar', async () => {
    engine.loadConfig.mockResolvedValue(ok(config({ aiEnabled: false })))
    expectOk(
      await SdAiService.preServiceClose('u1', WS, 'c1', {
        outcome: 'abandoned',
      }),
    )
  })

  it('recusa não-membros, conversa alheia e falha de gravação', async () => {
    actAs('non-member')
    expectErr(
      await SdAiService.preServiceClose('u1', WS, 'c1', {
        outcome: 'abandoned',
      }),
      'FORBIDDEN',
    )

    actAs('requester')
    aiRepo.findConversation.mockResolvedValue(
      ok({ ...conversation, userId: 'outro' }),
    )
    expectErr(
      await SdAiService.preServiceClose('u1', WS, 'c1', {
        outcome: 'abandoned',
      }),
      'SD_AI_CONVERSATION_NOT_FOUND',
    )

    aiRepo.findConversation.mockResolvedValue(ok(conversation))
    aiRepo.updateConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdAiService.preServiceClose('u1', WS, 'c1', {
        outcome: 'abandoned',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('preServiceMessage — proteções (ADR 0041)', () => {
  it('troca o rascunho por um encaminhamento quando o solicitante toca num assunto proibido', async () => {
    prepare.mockResolvedValue(
      ok({
        ...preparedCall(),
        guardrails: {
          piiMaskingPolicy: 'AUTO_REPLIES' as const,
          injectionClassifierEnabled: false,
          limits: {
            forbiddenTopics: ['processo judicial'],
            maxDiscountPercent: null,
            maxRefundAmount: null,
            maxDeadlineDays: null,
          },
        },
      }),
    )
    chat.mockResolvedValue(turn())

    const result = expectOk(
      await SdAiService.preServiceMessage('u1', WS, {
        message: 'Vou entrar com um processo judicial',
      }),
    )
    expect(result.reply).toContain('precisa de um atendente')
    expect(result.action).toBe('open_ticket')
    expect(result.articles).toEqual([])
    expect(result.suggestOpenTicket).toBe(true)
    // The requester text reaches the model fenced as third-party content.
    expect(JSON.stringify(chat.mock.calls[0]?.[0].messages)).toContain(
      'untrusted_content source=\\"portal_message\\"',
    )
  })
})
