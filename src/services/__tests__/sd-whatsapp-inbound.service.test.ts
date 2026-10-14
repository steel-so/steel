import type { SdPhaseCategory } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversation } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  sdCategoryNotFound,
  sdTicketNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/src/repositories/sd-whatsapp.repository')
vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/servicedesk/realtime', () => ({
  publishSdTicketEvent: vi.fn(),
}))
vi.mock('@/src/lib/servicedesk/ai-queue', () => ({
  enqueueSdAiWhatsappReply: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('../sd-automation-engine', () => ({
  fireSdAutomations: vi.fn(async () => undefined),
}))
vi.mock('../sd-contact.service', () => ({
  SdContactService: { findByChannel: vi.fn() },
}))
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: {
    loadConfig: vi.fn(),
    create: vi.fn(),
    markFirstResponse: vi.fn(),
    touchActivity: vi.fn(),
    reopen: vi.fn(),
  },
}))
vi.mock('../sd-ticket-event-recorder', () => ({ recordSdTicketEvent: vi.fn() }))
vi.mock('../sd-ticket-reply-notify', () => ({
  notifySdTicketReply: vi.fn(async () => undefined),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { enqueueSdAiWhatsappReply } from '@/src/lib/servicedesk/ai-queue'
import { publishSdTicketEvent } from '@/src/lib/servicedesk/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { fireSdAutomations } from '../sd-automation-engine'
import { SdContactService } from '../sd-contact.service'
import { SdTicketEngine } from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import { notifySdTicketReply } from '../sd-ticket-reply-notify'
import {
  mirrorSdWhatsappMessage,
  publishSdTicketMessage,
  SdWhatsappInboundService,
  sendSdWhatsappText,
} from '../sd-whatsapp-inbound.service'

const sdWa = vi.mocked(SdWhatsappRepository)
const tickets = vi.mocked(SdTicketRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const messages = vi.mocked(WhatsAppMessageRepository)
const engine = vi.mocked(SdTicketEngine)
const contacts = vi.mocked(SdContactService)
const send = vi.mocked(WhatsAppSend)
const publishEvent = vi.mocked(publishSdTicketEvent)
const enqueue = vi.mocked(enqueueSdAiWhatsappReply)
const automations = vi.mocked(fireSdAutomations)
const record = vi.mocked(recordSdTicketEvent)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const CONV = 'conv-1'

const connection = (overrides = {}) =>
  createFakeWhatsAppConnection({
    id: 'conn-1',
    workspaceId: WS,
    module: 'SERVICE_DESK',
    ...overrides,
  })

const waContact = (overrides = {}) =>
  createFakeWhatsAppContactWithoutCount({
    id: 'wa-contact-1',
    workspaceId: WS,
    waId: '5511988887777',
    name: 'Ana Souza',
    ...overrides,
  })

const inbound = (overrides = {}) =>
  createFakeWhatsAppMessage({
    id: 'wa-msg-1',
    workspaceId: WS,
    conversationId: CONV,
    direction: 'IN',
    type: 'TEXT',
    text: 'Impressora travada\nnão imprime nada',
    ...overrides,
  })

function phase(category: SdPhaseCategory) {
  return {
    id: 'p1',
    name: category,
    color: null,
    category,
    completionPercent: 0,
    position: 0,
    wipLimit: 0,
    pausesSla: false,
  }
}

const ticket = (overrides = {}) =>
  createFakeSdTicket({
    id: 't1',
    workspaceId: WS,
    number: 12,
    type: 'INCIDENT',
    whatsappConversationId: CONV,
    requesterId: 'req-1',
    participants: [
      {
        userId: 'part-1',
        user: {
          id: 'part-1',
          name: 'Participante',
          email: 'p@x.com',
          image: null,
        },
      },
    ],
    ...overrides,
  })

const config = (settingsOverrides = {}) => ({
  settings: createFakeSdSettings({
    workspaceId: WS,
    portalTicketTypes: ['INCIDENT' as const],
    ...settingsOverrides,
  }),
  prefixes: DEFAULT_SD_TICKET_PREFIXES,
})

const sdContact = {
  id: 'sd-contact-1',
  userId: 'user-1',
  customers: [] as { id: string; kind: 'CLIENT' | 'COMPANY' }[],
}

beforeEach(() => {
  engine.loadConfig.mockResolvedValue(ok(config()))
  engine.create.mockResolvedValue(ok(ticket({ whatsappConversationId: null })))
  engine.markFirstResponse.mockResolvedValue(ok(undefined as never))
  engine.touchActivity.mockResolvedValue(ok(undefined as never))
  engine.reopen.mockResolvedValue(ok(ticket() as never))
  contacts.findByChannel.mockResolvedValue(ok(sdContact as never))
  sdWa.hasMirror.mockResolvedValue(ok(false))
  sdWa.createTicketMessage.mockResolvedValue(ok({ id: 'sd-msg-1' }))
  sdWa.setTicketConversation.mockResolvedValue(ok(undefined))
  sdWa.findOpenTicket.mockResolvedValue(ok(null))
  sdWa.listLinkedTicketIds.mockResolvedValue(ok([]))
  tickets.findById.mockResolvedValue(ok(ticket()))
  tickets.findByIdUnscoped.mockResolvedValue(ok(ticket()))
  conversations.update.mockResolvedValue(ok(createFakeWhatsAppConversation()))
  conversations.findByIdRaw.mockResolvedValue(
    ok(createFakeWhatsAppConversation({ id: CONV, aiHandoff: false })),
  )
  messages.create.mockResolvedValue(
    ok(createFakeWhatsAppMessage({ id: 'wa-out-1', direction: 'OUT' })),
  )
  send.text.mockResolvedValue(ok({ providerMessageId: 'p1' }))
  record.mockResolvedValue(ok(1))
  publishEvent.mockResolvedValue(undefined)
  enqueue.mockResolvedValue(undefined)
})

describe('publishSdTicketMessage()', () => {
  it('avisa o tempo real com a audiência do chamado', async () => {
    await publishSdTicketMessage(
      ticket({
        contact: { id: 'c1', name: 'Ana', email: null, userId: 'user-1' },
      }),
      'agent-1',
    )
    expect(publishEvent).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        type: 'ticket.message',
        ticketId: 't1',
        number: 12,
        actorId: 'agent-1',
      }),
      {
        requesterId: 'req-1',
        participantIds: ['part-1'],
        contactUserId: 'user-1',
      },
    )
  })

  it('usa ator nulo e contato sem usuário por padrão', async () => {
    await publishSdTicketMessage(ticket())
    expect(publishEvent).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ actorId: null }),
      expect.objectContaining({ contactUserId: null }),
    )
  })
})

describe('mirrorSdWhatsappMessage()', () => {
  it('grava a mensagem no histórico do chamado e registra o evento', async () => {
    const created = expectOk(
      await mirrorSdWhatsappMessage({
        ticket: ticket(),
        message: inbound({ type: 'TEXT', text: 'Oi' }),
        authorKind: 'CONTACT',
        authorContactId: 'sd-contact-1',
      }),
    )
    expect(created).toEqual({ id: 'sd-msg-1' })
    expect(sdWa.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't1',
        authorKind: 'CONTACT',
        authorContactId: 'sd-contact-1',
        channel: 'WHATSAPP',
        body: 'Oi',
        whatsappMessageId: 'wa-msg-1',
        attachment: null,
      }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'message.posted' }),
    )
    expect(publishEvent).toHaveBeenCalled()
  })

  it('anexa a mídia apontando para a mensagem do WhatsApp', async () => {
    expectOk(
      await mirrorSdWhatsappMessage({
        ticket: ticket(),
        message: inbound({
          type: 'IMAGE',
          text: 'Print',
          mediaUrl: 'https://minio/x.png',
        }),
        authorKind: 'AGENT',
        authorUserId: 'agent-1',
      }),
    )
    expect(sdWa.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '[Imagem] Print',
        attachment: {
          kind: 'IMAGE',
          mimeType: 'image/*',
          fileName: 'whatsapp-imagem',
          size: 0,
          storageKey: 'whatsapp:wa-msg-1',
          uploadedById: 'agent-1',
        },
      }),
    )
  })

  it('deixa o anexo do contato sem autor de upload', async () => {
    expectOk(
      await mirrorSdWhatsappMessage({
        ticket: ticket(),
        message: inbound({
          type: 'DOCUMENT',
          text: 'nota.pdf',
          mediaUrl: 'https://minio/nota.pdf',
        }),
        authorKind: 'CONTACT',
      }),
    )
    expect(sdWa.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({ uploadedById: null }),
      }),
    )
  })

  it('é idempotente: não duplica o espelho já gravado', async () => {
    sdWa.hasMirror.mockResolvedValue(ok(true))
    expect(
      expectOk(
        await mirrorSdWhatsappMessage({
          ticket: ticket(),
          message: inbound(),
          authorKind: 'CONTACT',
        }),
      ),
    ).toBeNull()
    expect(sdWa.createTicketMessage).not.toHaveBeenCalled()
  })

  it('propaga falhas da checagem e da gravação', async () => {
    sdWa.hasMirror.mockResolvedValue(err(databaseError()))
    expectErr(
      await mirrorSdWhatsappMessage({
        ticket: ticket(),
        message: inbound(),
        authorKind: 'CONTACT',
      }),
      'DATABASE_ERROR',
    )

    sdWa.hasMirror.mockResolvedValue(ok(false))
    sdWa.createTicketMessage.mockResolvedValue(err(databaseError()))
    expectErr(
      await mirrorSdWhatsappMessage({
        ticket: ticket(),
        message: inbound(),
        authorKind: 'CONTACT',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('sendSdWhatsappText()', () => {
  const input = {
    connection: connection(),
    conversationId: CONV,
    waId: '5511988887777',
    text: 'Recebemos sua solicitação',
  }

  it('envia pelo provedor e grava a mensagem de saída', async () => {
    const message = expectOk(
      await sendSdWhatsappText({ ...input, sentByAi: true }),
    )
    expect(send.text).toHaveBeenCalledWith(input.connection, {
      to: '5511988887777',
      text: 'Recebemos sua solicitação',
    })
    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV,
        direction: 'OUT',
        type: 'TEXT',
        status: 'SENT',
        sentByAi: true,
      }),
    )
    expect(conversations.update).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ lastMessageAt: expect.any(Date) }),
    )
    expect(message.id).toBe('wa-out-1')
  })

  it('marca `sentByAi` como falso por padrão', async () => {
    expectOk(await sendSdWhatsappText(input))
    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ sentByAi: false }),
    )
  })

  it('propaga falhas do provedor e da gravação', async () => {
    send.text.mockResolvedValue(err(databaseError()))
    expectErr(await sendSdWhatsappText(input), 'DATABASE_ERROR')

    send.text.mockResolvedValue(ok({ providerMessageId: 'p1' }))
    messages.create.mockResolvedValue(err(databaseError()))
    expectErr(await sendSdWhatsappText(input), 'DATABASE_ERROR')
  })
})

describe('openTicketFromWhatsapp()', () => {
  const base = () => ({
    connection: connection(),
    conversationId: CONV,
    contact: { waId: '5511988887777', name: 'Ana Souza' },
    config: config(),
  })

  it('abre o chamado pela 1ª linha da mensagem, vincula e responde o código', async () => {
    const opened = expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({
        ...base(),
        message: inbound(),
      }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        type: 'INCIDENT',
        title: 'Impressora travada',
        channel: 'WHATSAPP',
        contactId: 'sd-contact-1',
        requesterId: 'user-1',
        description: expect.stringContaining('<p>Impressora travada'),
      }),
      expect.anything(),
      expect.anything(),
    )
    expect(sdWa.setTicketConversation).toHaveBeenCalledWith('t1', CONV)
    expect(opened.whatsappConversationId).toBe(CONV)
    expect(send.text).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn-1' }),
      expect.objectContaining({
        text: expect.stringContaining('*INC-000012*'),
      }),
    )
    expect(automations).toHaveBeenCalledWith('TICKET_CREATED', 't1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', targetId: 't1' }),
    )
  })

  it('usa o rascunho da IA e grava a transcrição como 1ª mensagem', async () => {
    expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({
        ...base(),
        draft: {
          title: 'VPN fora do ar',
          description: 'Desde ontem',
          type: 'SERVICE_REQUEST',
          categoryId: 'cat-1',
          urgencyId: 'urg-1',
        },
        transcript: 'Solicitante: oi',
      }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        title: 'VPN fora do ar',
        type: 'INCIDENT',
        categoryId: 'cat-1',
        urgencyId: 'urg-1',
      }),
      expect.anything(),
      expect.anything(),
    )
    expect(sdWa.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorKind: 'AI',
        body: expect.stringContaining('Solicitante: oi'),
      }),
    )
  })

  it('respeita o tipo do rascunho quando o portal o permite', async () => {
    expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({
        ...base(),
        config: config({ portalTicketTypes: ['SERVICE_REQUEST'] }),
        draft: { type: 'SERVICE_REQUEST' },
      }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ type: 'SERVICE_REQUEST' }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('cai no 1º tipo permitido quando o portal não aceita incidentes', async () => {
    expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({
        ...base(),
        config: config({ portalTicketTypes: ['CHANGE'] }),
      }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ type: 'CHANGE' }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('vincula o cliente e a empresa do contato encontrado', async () => {
    contacts.findByChannel.mockResolvedValue(
      ok({
        ...sdContact,
        customers: [{ id: 'cli-1', kind: 'CLIENT' }],
      } as never),
    )
    expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({ ...base() }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ customerId: 'cli-1', companyId: undefined }),
      expect.anything(),
      expect.anything(),
    )

    contacts.findByChannel.mockResolvedValue(
      ok({
        ...sdContact,
        customers: [{ id: 'emp-1', kind: 'COMPANY' }],
      } as never),
    )
    expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({ ...base() }),
    )
    expect(engine.create).toHaveBeenLastCalledWith(
      WS,
      expect.objectContaining({ companyId: 'emp-1', customerId: undefined }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('abre sem catálogo quando a sugestão da IA não serve ao tipo', async () => {
    engine.create.mockResolvedValueOnce(err(sdCategoryNotFound()))
    expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({
        ...base(),
        draft: { categoryId: 'cat-invalida' },
      }),
    )
    expect(engine.create).toHaveBeenCalledTimes(2)
    expect(engine.create.mock.calls[1]?.[1]).not.toHaveProperty('categoryId')
  })

  it('segue sem contato vinculado quando a busca falha', async () => {
    contacts.findByChannel.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({
        ...base(),
        message: inbound(),
      }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ contactId: undefined, requesterId: null }),
      expect.anything(),
      expect.anything(),
    )
    expect(sdWa.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorKind: 'CONTACT',
        authorContactId: null,
      }),
    )
  })

  it('audita e devolve a falha da criação', async () => {
    engine.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappInboundService.openTicketFromWhatsapp({ ...base() }),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'DATABASE_ERROR',
      }),
    )
    expect(sdWa.setTicketConversation).not.toHaveBeenCalled()
  })

  it('propaga a falha ao vincular a conversa', async () => {
    sdWa.setTicketConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappInboundService.openTicketFromWhatsapp({ ...base() }),
      'DATABASE_ERROR',
    )
  })

  it('não responde o código quando a confirmação está desligada', async () => {
    const opened = expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({
        ...base(),
        config: config({ whatsappSendAcknowledgement: false }),
        message: inbound(),
      }),
    )
    expect(opened.whatsappConversationId).toBe(CONV)
    expect(send.text).not.toHaveBeenCalled()
    expect(sdWa.createTicketMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ authorKind: 'SYSTEM' }),
    )
    expect(automations).toHaveBeenCalledWith('TICKET_CREATED', 't1')
  })

  it('segue quando a resposta com o código falha', async () => {
    send.text.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdWhatsappInboundService.openTicketFromWhatsapp({ ...base() }),
    )
    expect(sdWa.createTicketMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ authorKind: 'SYSTEM' }),
    )
  })
})

describe('route()', () => {
  const input = () => ({
    connection: connection(),
    conversationId: CONV,
    contact: waContact(),
    message: inbound(),
  })

  it('espelha a mensagem no chamado em aberto', async () => {
    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    expect(expectOk(await SdWhatsappInboundService.route(input()))).toBe(
      'mirrored',
    )
    expect(sdWa.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorKind: 'CONTACT',
        channel: 'WHATSAPP',
        authorContactId: 'sd-contact-1',
      }),
    )
    expect(engine.touchActivity).toHaveBeenCalledWith('t1')
    expect(automations).toHaveBeenCalledWith('MESSAGE_RECEIVED', 't1')
  })

  it('cai no contato do chamado quando o número não está no diretório', async () => {
    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    contacts.findByChannel.mockResolvedValue(ok(null))
    tickets.findById.mockResolvedValue(ok(ticket({ contactId: 'do-chamado' })))
    expectOk(await SdWhatsappInboundService.route(input()))
    expect(sdWa.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorContactId: 'do-chamado' }),
    )
  })

  it('reabre o chamado resolvido quando a configuração manda', async () => {
    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    tickets.findById.mockResolvedValue(ok(ticket({ phase: phase('RESOLVED') })))
    engine.loadConfig.mockResolvedValue(
      ok(config({ reopenOnRequesterReply: true })),
    )
    expectOk(await SdWhatsappInboundService.route(input()))
    expect(engine.reopen).toHaveBeenCalled()
  })

  it('segue quando a reabertura falha', async () => {
    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    tickets.findById.mockResolvedValue(ok(ticket({ phase: phase('RESOLVED') })))
    engine.loadConfig.mockResolvedValue(
      ok(config({ reopenOnRequesterReply: true })),
    )
    engine.reopen.mockResolvedValue(err(databaseError()))
    expect(expectOk(await SdWhatsappInboundService.route(input()))).toBe(
      'mirrored',
    )
  })

  it('enfileira a resposta automática da IA enquanto ninguém assumiu', async () => {
    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    tickets.findById.mockResolvedValue(
      ok(ticket({ assigneeId: null, firstRespondedAt: null })),
    )
    engine.loadConfig.mockResolvedValue(
      ok(config({ aiEnabled: true, aiWhatsappAutoReply: true })),
    )
    expect(expectOk(await SdWhatsappInboundService.route(input()))).toBe(
      'mirrored_ai',
    )
    expect(enqueue).toHaveBeenCalledWith(CONV, 'wa-msg-1')
  })

  it('não chama a IA quando já houve transbordo ou atendimento humano', async () => {
    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    engine.loadConfig.mockResolvedValue(
      ok(config({ aiEnabled: true, aiWhatsappAutoReply: true })),
    )
    conversations.findByIdRaw.mockResolvedValue(
      ok(createFakeWhatsAppConversation({ id: CONV, aiHandoff: true })),
    )
    expect(expectOk(await SdWhatsappInboundService.route(input()))).toBe(
      'mirrored',
    )
    expect(enqueue).not.toHaveBeenCalled()

    conversations.findByIdRaw.mockResolvedValue(ok(null))
    expect(expectOk(await SdWhatsappInboundService.route(input()))).toBe(
      'mirrored',
    )

    tickets.findById.mockResolvedValue(ok(ticket({ assigneeId: 'agent-1' })))
    expect(expectOk(await SdWhatsappInboundService.route(input()))).toBe(
      'mirrored',
    )
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('manda a 1ª mensagem para o pré-atendimento da IA', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(config({ aiEnabled: true, aiPreServiceEnabled: true })),
    )
    expect(expectOk(await SdWhatsappInboundService.route(input()))).toBe(
      'pre_service',
    )
    expect(enqueue).toHaveBeenCalledWith(CONV, 'wa-msg-1')
    expect(engine.create).not.toHaveBeenCalled()
  })

  it('abre o chamado direto quando a IA está desligada', async () => {
    expect(expectOk(await SdWhatsappInboundService.route(input()))).toBe(
      'ticket_opened',
    )
    expect(engine.create).toHaveBeenCalled()
  })

  it('propaga falhas da configuração, da busca e do espelho', async () => {
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(await SdWhatsappInboundService.route(input()), 'DATABASE_ERROR')

    engine.loadConfig.mockResolvedValue(ok(config()))
    sdWa.findOpenTicket.mockResolvedValue(err(databaseError()))
    expectErr(await SdWhatsappInboundService.route(input()), 'DATABASE_ERROR')

    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    tickets.findById.mockResolvedValue(err(sdTicketNotFound()))
    expectErr(
      await SdWhatsappInboundService.route(input()),
      'SD_TICKET_NOT_FOUND',
    )

    tickets.findById.mockResolvedValue(ok(ticket()))
    sdWa.hasMirror.mockResolvedValue(err(databaseError()))
    expectErr(await SdWhatsappInboundService.route(input()), 'DATABASE_ERROR')
  })

  it('propaga a falha ao abrir o chamado sem IA', async () => {
    engine.create.mockResolvedValue(err(databaseError()))
    expectErr(await SdWhatsappInboundService.route(input()), 'DATABASE_ERROR')
  })
})

describe('routeInbound()', () => {
  it('não lança quando o roteamento falha', async () => {
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    await expect(
      SdWhatsappInboundService.routeInbound({
        connection: connection(),
        conversationId: CONV,
        contact: waContact(),
        message: inbound(),
      }),
    ).resolves.toBeUndefined()
    expect(engine.create).not.toHaveBeenCalled()
  })

  it('segue o fluxo normal quando o roteamento dá certo', async () => {
    await SdWhatsappInboundService.routeInbound({
      connection: connection(),
      conversationId: CONV,
      contact: waContact(),
      message: inbound(),
    })
    expect(engine.create).toHaveBeenCalled()
  })
})

describe('routeOutboundDevice()', () => {
  it('entra como resposta do agente e marca a 1ª resposta', async () => {
    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    await SdWhatsappInboundService.routeOutboundDevice({
      conversationId: CONV,
      message: inbound({ direction: 'OUT', text: 'Já estou vendo' }),
    })
    expect(sdWa.createTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorKind: 'AGENT' }),
    )
    expect(engine.markFirstResponse).toHaveBeenCalledWith('t1')
    expect(engine.touchActivity).toHaveBeenCalledWith('t1')
  })

  it('ignora sem chamado em aberto, com falha de leitura ou espelho repetido', async () => {
    await SdWhatsappInboundService.routeOutboundDevice({
      conversationId: CONV,
      message: inbound({ direction: 'OUT' }),
    })
    expect(engine.markFirstResponse).not.toHaveBeenCalled()

    sdWa.findOpenTicket.mockResolvedValue(err(databaseError()))
    await SdWhatsappInboundService.routeOutboundDevice({
      conversationId: CONV,
      message: inbound({ direction: 'OUT' }),
    })
    expect(engine.markFirstResponse).not.toHaveBeenCalled()

    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
    tickets.findById.mockResolvedValue(err(sdTicketNotFound()))
    await SdWhatsappInboundService.routeOutboundDevice({
      conversationId: CONV,
      message: inbound({ direction: 'OUT' }),
    })
    expect(engine.markFirstResponse).not.toHaveBeenCalled()

    tickets.findById.mockResolvedValue(ok(ticket()))
    sdWa.hasMirror.mockResolvedValue(ok(true))
    await SdWhatsappInboundService.routeOutboundDevice({
      conversationId: CONV,
      message: inbound({ direction: 'OUT' }),
    })
    expect(engine.markFirstResponse).not.toHaveBeenCalled()
  })
})

describe('onMessageUpdated()', () => {
  it('avisa o chamado vinculado mais recente', async () => {
    sdWa.listLinkedTicketIds.mockResolvedValue(ok(['t1', 't2']))
    await SdWhatsappInboundService.onMessageUpdated(inbound())
    expect(tickets.findByIdUnscoped).toHaveBeenCalledWith('t1')
    expect(publishEvent).toHaveBeenCalled()
  })

  it('não faz nada sem chamados vinculados, com falha de leitura ou chamado sumido', async () => {
    await SdWhatsappInboundService.onMessageUpdated(inbound())
    expect(publishEvent).not.toHaveBeenCalled()

    sdWa.listLinkedTicketIds.mockResolvedValue(err(databaseError()))
    await SdWhatsappInboundService.onMessageUpdated(inbound())
    expect(publishEvent).not.toHaveBeenCalled()

    sdWa.listLinkedTicketIds.mockResolvedValue(ok(['t1']))
    tickets.findByIdUnscoped.mockResolvedValue(err(sdTicketNotFound()))
    await SdWhatsappInboundService.onMessageUpdated(inbound())
    expect(publishEvent).not.toHaveBeenCalled()
  })
})

describe('route() · team notification', () => {
  const notifyReply = vi.mocked(notifySdTicketReply)
  const input = () => ({
    connection: connection(),
    conversationId: CONV,
    contact: waContact(),
    message: inbound(),
  })

  beforeEach(() => {
    notifyReply.mockClear()
    sdWa.findOpenTicket.mockResolvedValue(
      ok({ id: 't1', number: 12, type: 'INCIDENT' }),
    )
  })

  it('tells the team about a new customer message', async () => {
    expectOk(await SdWhatsappInboundService.route(input()))
    expect(notifyReply).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, channel: 'WHATSAPP' }),
    )
  })

  it('stays quiet on a webhook retry of a mirrored message', async () => {
    sdWa.hasMirror.mockResolvedValue(ok(true))
    expectOk(await SdWhatsappInboundService.route(input()))
    expect(notifyReply).not.toHaveBeenCalled()
  })

  it('does not double-notify when the message reopened the ticket', async () => {
    tickets.findById.mockResolvedValue(ok(ticket({ phase: phase('RESOLVED') })))
    engine.loadConfig.mockResolvedValue(
      ok(config({ reopenOnRequesterReply: true })),
    )
    expectOk(await SdWhatsappInboundService.route(input()))
    expect(notifyReply).not.toHaveBeenCalled()
  })

  it('notifies when the reopen failed', async () => {
    tickets.findById.mockResolvedValue(ok(ticket({ phase: phase('RESOLVED') })))
    engine.loadConfig.mockResolvedValue(
      ok(config({ reopenOnRequesterReply: true })),
    )
    engine.reopen.mockResolvedValue(err(databaseError()))
    expectOk(await SdWhatsappInboundService.route(input()))
    expect(notifyReply).toHaveBeenCalledTimes(1)
  })
})
