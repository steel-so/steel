import type { WhatsAppConnection } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdContact } from '@/src/__tests__/factories/sd-contact.factory'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversation } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-access.helpers'
import { databaseError, sdTicketNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'
import type { SdWaConversation } from '@/src/repositories/sd-whatsapp.repository'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-whatsapp.repository')
vi.mock('@/src/repositories/sd-contact.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), media: vi.fn(), template: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/media', () => ({
  persistOutboundMedia: vi.fn(),
}))
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: {
    loadConfig: vi.fn(),
    resolveRef: vi.fn(),
    markFirstResponse: vi.fn(),
    touchActivity: vi.fn(),
  },
}))
vi.mock('../sd-ticket-event-recorder', () => ({ recordSdTicketEvent: vi.fn() }))
vi.mock('../sd-whatsapp-inbound.service', () => ({
  mirrorSdWhatsappMessage: vi.fn(),
  publishSdTicketMessage: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { persistOutboundMedia } from '@/src/lib/whatsapp/media'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SdContactRepository } from '@/src/repositories/sd-contact.repository'
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { SdTicketEngine } from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import { SdWhatsappService } from '../sd-whatsapp.service'
import {
  mirrorSdWhatsappMessage,
  publishSdTicketMessage,
} from '../sd-whatsapp-inbound.service'

const engine = vi.mocked(SdTicketEngine)
const sdWa = vi.mocked(SdWhatsappRepository)
const sdContacts = vi.mocked(SdContactRepository)
const connections = vi.mocked(WhatsAppConnectionRepository)
const waContacts = vi.mocked(WhatsAppContactRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const messages = vi.mocked(WhatsAppMessageRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const send = vi.mocked(WhatsAppSend)
const media = vi.mocked(persistOutboundMedia)
const mirror = vi.mocked(mirrorSdWhatsappMessage)
const publish = vi.mocked(publishSdTicketMessage)
const record = vi.mocked(recordSdTicketEvent)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const AGENT = 'agent-1'
const TICKET = 't1'
const CONV = 'conv-1'
const CONN = 'conn-1'

function connection(overrides: Partial<WhatsAppConnection> = {}) {
  return createFakeWhatsAppConnection({
    id: CONN,
    workspaceId: WS,
    module: 'SERVICE_DESK',
    label: 'Central',
    phoneNumber: '5511999999999',
    status: 'CONNECTED',
    ...overrides,
  })
}

function conversation(
  overrides: Partial<SdWaConversation> = {},
): SdWaConversation {
  const base = createFakeWhatsAppConversation({
    id: CONV,
    workspaceId: WS,
    connectionId: CONN,
    status: 'NEW',
  })
  return {
    ...base,
    contact: createFakeWhatsAppContactWithoutCount({
      id: 'wa-contact-1',
      waId: '5511988887777',
      name: 'Ana Souza',
    }),
    connection: connection(),
    messages: [],
    ...overrides,
  }
}

function ticket(overrides = {}) {
  return createFakeSdTicket({
    id: TICKET,
    workspaceId: WS,
    number: 12,
    type: 'INCIDENT',
    whatsappConversationId: CONV,
    contactId: 'c1',
    ...overrides,
  })
}

function config(settingsOverrides = {}) {
  return {
    settings: createFakeSdSettings({
      workspaceId: WS,
      whatsappConnectionId: CONN,
      ...settingsOverrides,
    }),
    prefixes: DEFAULT_SD_TICKET_PREFIXES,
  }
}

/** Mensagem de saída devolvida pelo repositório depois do envio. */
const outbound = (overrides = {}) =>
  createFakeWhatsAppMessage({
    id: 'wa-msg-1',
    workspaceId: WS,
    conversationId: CONV,
    direction: 'OUT',
    type: 'TEXT',
    text: 'Bom dia',
    status: 'SENT',
    ...overrides,
  })

beforeEach(() => {
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  actAs('agent')
  engine.loadConfig.mockResolvedValue(ok(config()))
  engine.resolveRef.mockResolvedValue(ok(ticket()))
  engine.markFirstResponse.mockResolvedValue(ok(undefined as never))
  engine.touchActivity.mockResolvedValue(ok(undefined as never))
  sdWa.findConversation.mockResolvedValue(ok(conversation()))
  sdWa.lastInboundAt.mockResolvedValue(ok(new Date()))
  sdWa.setTicketConversation.mockResolvedValue(ok(undefined))
  sdWa.listConversations.mockResolvedValue(ok([]))
  sdWa.listApprovedTemplates.mockResolvedValue(ok([]))
  sdWa.findActiveConversation.mockResolvedValue(ok(null))
  connections.findById.mockResolvedValue(ok(connection()))
  sdContacts.findById.mockResolvedValue(
    ok(createFakeSdContact({ whatsapp: '5511988887777' })),
  )
  messages.listByConversation.mockResolvedValue(ok([]))
  messages.create.mockResolvedValue(ok(outbound()))
  conversations.update.mockResolvedValue(ok(createFakeWhatsAppConversation()))
  conversations.create.mockResolvedValue(
    ok(createFakeWhatsAppConversation({ id: CONV })),
  )
  waContacts.upsertByWaId.mockResolvedValue(
    ok(createFakeWhatsAppContactWithoutCount({ id: 'wa-contact-1' })),
  )
  send.text.mockResolvedValue(ok({ providerMessageId: 'p1' }))
  send.media.mockResolvedValue(ok({ providerMessageId: 'p2' }))
  send.template.mockResolvedValue(ok({ providerMessageId: 'p3' }))
  media.mockResolvedValue(ok({ url: 'https://minio/ws1/file.pdf' }))
  mirror.mockResolvedValue(ok({ id: 'sd-msg-1' }))
  publish.mockResolvedValue(undefined)
  record.mockResolvedValue(ok(1))
})

describe('state()', () => {
  it('descreve a conexão ativa, a conversa e a janela aberta', async () => {
    const state = expectOk(await SdWhatsappService.state(AGENT, WS, TICKET))
    expect(state).toMatchObject({
      configured: true,
      connection: {
        id: CONN,
        label: 'Central',
        provider: 'ZAPI',
        phoneNumber: '5511999999999',
        status: 'CONNECTED',
      },
      window: { open: true, requiresTemplate: false },
      suggestedWaId: '5511988887777',
    })
    expect(state.conversation?.id).toBe(CONV)
    expect(connections.findById).toHaveBeenCalledWith(CONN, WS, 'SERVICE_DESK')
  })

  it('diz que não há conexão configurada quando a configuração está vazia', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(config({ whatsappConnectionId: null })),
    )
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null, contactId: null })),
    )
    const state = expectOk(await SdWhatsappService.state(AGENT, WS, TICKET))
    expect(state).toMatchObject({
      configured: false,
      connection: null,
      conversation: null,
      suggestedWaId: null,
    })
    expect(connections.findById).not.toHaveBeenCalled()
  })

  it('calcula a janela de 24 h pelo provedor da conversa vinculada', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    sdWa.findConversation.mockResolvedValue(
      ok(conversation({ connection: connection({ provider: 'META' }) })),
    )
    sdWa.lastInboundAt.mockResolvedValue(ok(old))
    const state = expectOk(await SdWhatsappService.state(AGENT, WS, TICKET))
    expect(state.window).toEqual({
      open: false,
      expiresAt: null,
      requiresTemplate: true,
    })
  })

  it('sugere o telefone quando o contato não tem WhatsApp e ignora contato não encontrado', async () => {
    engine.resolveRef.mockResolvedValue(ok(ticket({ contactId: 'c1' })))
    sdContacts.findById.mockResolvedValue(
      ok(createFakeSdContact({ whatsapp: null, phone: '11988887777' })),
    )
    expect(
      expectOk(await SdWhatsappService.state(AGENT, WS, TICKET)).suggestedWaId,
    ).toBe('5511988887777')

    sdContacts.findById.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await SdWhatsappService.state(AGENT, WS, TICKET)).suggestedWaId,
    ).toBeNull()
  })

  it('recusa solicitantes e propaga erros da configuração e do chamado', async () => {
    actAs('requester')
    expectErr(await SdWhatsappService.state('req', WS, TICKET), 'SD_NOT_AGENT')

    actAs('agent')
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.state(AGENT, WS, TICKET),
      'DATABASE_ERROR',
    )

    engine.loadConfig.mockResolvedValue(ok(config()))
    engine.resolveRef.mockResolvedValue(err(sdTicketNotFound()))
    expectErr(
      await SdWhatsappService.state(AGENT, WS, TICKET),
      'SD_TICKET_NOT_FOUND',
    )
  })

  it('propaga falhas ao ler conexão, conversa e última mensagem recebida', async () => {
    connections.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.state(AGENT, WS, TICKET),
      'DATABASE_ERROR',
    )

    connections.findById.mockResolvedValue(ok(connection()))
    sdWa.findConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.state(AGENT, WS, TICKET),
      'DATABASE_ERROR',
    )

    sdWa.findConversation.mockResolvedValue(ok(conversation()))
    sdWa.lastInboundAt.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.state(AGENT, WS, TICKET),
      'DATABASE_ERROR',
    )
  })

  it('cai para a conexão ativa quando a conversa vinculada sumiu', async () => {
    sdWa.findConversation.mockResolvedValue(ok(null))
    const state = expectOk(await SdWhatsappService.state(AGENT, WS, TICKET))
    expect(state.conversation).toBeNull()
    expect(state.window.open).toBe(true)
  })
})

describe('listMessages()', () => {
  it('lista as mensagens da conversa a partir do `clearedAt`', async () => {
    const cleared = new Date('2026-09-01T00:00:00.000Z')
    sdWa.findConversation.mockResolvedValue(
      ok(conversation({ clearedAt: cleared })),
    )
    messages.listByConversation.mockResolvedValue(ok([outbound()]))
    const rows = expectOk(
      await SdWhatsappService.listMessages(AGENT, WS, TICKET, { limit: 50 }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('wa-msg-1')
    expect(messages.listByConversation).toHaveBeenCalledWith(CONV, {
      cursor: undefined,
      limit: 50,
      after: cleared,
    })
  })

  it('devolve lista vazia quando o chamado não tem conversa', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    expect(
      expectOk(
        await SdWhatsappService.listMessages(AGENT, WS, TICKET, { limit: 50 }),
      ),
    ).toEqual([])
    expect(messages.listByConversation).not.toHaveBeenCalled()
  })

  it('recusa quando a conversa sumiu e propaga falhas do banco', async () => {
    sdWa.findConversation.mockResolvedValue(ok(null))
    expectErr(
      await SdWhatsappService.listMessages(AGENT, WS, TICKET, { limit: 50 }),
      'SD_WHATSAPP_CONVERSATION_NOT_FOUND',
    )

    sdWa.findConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.listMessages(AGENT, WS, TICKET, { limit: 50 }),
      'DATABASE_ERROR',
    )

    sdWa.findConversation.mockResolvedValue(ok(conversation()))
    messages.listByConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.listMessages(AGENT, WS, TICKET, { limit: 50 }),
      'DATABASE_ERROR',
    )
  })

  it('recusa solicitantes', async () => {
    actAs('requester')
    expectErr(
      await SdWhatsappService.listMessages('req', WS, TICKET, { limit: 50 }),
      'SD_NOT_AGENT',
    )
  })
})

describe('sendText()', () => {
  it('envia, grava, espelha e marca a primeira resposta', async () => {
    const dto = expectOk(
      await SdWhatsappService.sendText(AGENT, WS, TICKET, { text: 'Bom dia' }),
    )
    expect(send.text).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONN }),
      { to: '5511988887777', text: 'Bom dia' },
    )
    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV,
        direction: 'OUT',
        type: 'TEXT',
        text: 'Bom dia',
        providerMessageId: 'p1',
        status: 'SENT',
        senderUserId: AGENT,
      }),
    )
    expect(conversations.update).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({
        status: 'IN_PROGRESS',
        aiActive: false,
        aiHandoff: true,
      }),
    )
    expect(mirror).toHaveBeenCalledWith(
      expect.objectContaining({ authorKind: 'AGENT', authorUserId: AGENT }),
    )
    expect(engine.markFirstResponse).toHaveBeenCalledWith(TICKET)
    expect(engine.touchActivity).toHaveBeenCalledWith(TICKET)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'whatsapp_message', action: 'send' }),
    )
    expect(dto.id).toBe('wa-msg-1')
  })

  it('segue quando o espelho no chamado falha', async () => {
    mirror.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdWhatsappService.sendText(AGENT, WS, TICKET, { text: 'Bom dia' }),
    )
    expect(engine.markFirstResponse).toHaveBeenCalled()
  })

  it('recusa chamado encerrado', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(
        ticket({
          phase: {
            id: 'p1',
            name: 'Fechado',
            color: null,
            category: 'CLOSED',
            completionPercent: 100,
            position: 9,
            wipLimit: 0,
            pausesSla: false,
          },
        }),
      ),
    )
    expectErr(
      await SdWhatsappService.sendText(AGENT, WS, TICKET, { text: 'Oi' }),
      'SD_TICKET_CLOSED',
    )
    expect(send.text).not.toHaveBeenCalled()
  })

  it('recusa fora da janela de 24 h na Meta', async () => {
    sdWa.findConversation.mockResolvedValue(
      ok(conversation({ connection: connection({ provider: 'META' }) })),
    )
    sdWa.lastInboundAt.mockResolvedValue(ok(null))
    expectErr(
      await SdWhatsappService.sendText(AGENT, WS, TICKET, { text: 'Oi' }),
      'SD_WHATSAPP_WINDOW_CLOSED',
    )
  })

  it('recusa sem conversa vinculada e propaga falhas de envio/gravação', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    expectErr(
      await SdWhatsappService.sendText(AGENT, WS, TICKET, { text: 'Oi' }),
      'SD_WHATSAPP_CONVERSATION_NOT_FOUND',
    )

    engine.resolveRef.mockResolvedValue(ok(ticket()))
    sdWa.lastInboundAt.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.sendText(AGENT, WS, TICKET, { text: 'Oi' }),
      'DATABASE_ERROR',
    )

    sdWa.lastInboundAt.mockResolvedValue(ok(new Date()))
    send.text.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.sendText(AGENT, WS, TICKET, { text: 'Oi' }),
      'DATABASE_ERROR',
    )

    send.text.mockResolvedValue(ok({ providerMessageId: 'p1' }))
    messages.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.sendText(AGENT, WS, TICKET, { text: 'Oi' }),
      'DATABASE_ERROR',
    )
  })

  it('recusa solicitantes', async () => {
    actAs('requester')
    expectErr(
      await SdWhatsappService.sendText('req', WS, TICKET, { text: 'Oi' }),
      'SD_NOT_AGENT',
    )
    expect(send.text).not.toHaveBeenCalled()
  })
})

describe('sendMedia()', () => {
  const file = {
    body: Buffer.from('conteudo'),
    contentType: 'application/pdf',
    fileName: 'manual.pdf',
  }

  it('guarda o arquivo, envia e espelha com a legenda', async () => {
    const dto = expectOk(
      await SdWhatsappService.sendMedia(AGENT, WS, TICKET, file, {
        caption: 'Segue o manual',
      }),
    )
    expect(media).toHaveBeenCalledWith({
      workspaceId: WS,
      body: file.body,
      contentType: 'application/pdf',
    })
    expect(send.media).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONN }),
      {
        to: '5511988887777',
        mediaUrl: 'https://minio/ws1/file.pdf',
        type: 'document',
        caption: 'Segue o manual',
        fileName: 'manual.pdf',
      },
    )
    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DOCUMENT',
        text: 'Segue o manual',
        mediaUrl: 'https://minio/ws1/file.pdf',
      }),
    )
    expect(dto.id).toBe('wa-msg-1')
  })

  it('recusa tipo não suportado, arquivo vazio e acima de 16 MB', async () => {
    expect(
      expectErr(
        await SdWhatsappService.sendMedia(
          AGENT,
          WS,
          TICKET,
          { ...file, contentType: 'application/x-msdownload' },
          {},
        ),
        'VALIDATION_ERROR',
      ).message,
    ).toBe('Tipo de arquivo não suportado')

    expect(
      expectErr(
        await SdWhatsappService.sendMedia(
          AGENT,
          WS,
          TICKET,
          { ...file, body: Buffer.alloc(0) },
          {},
        ),
        'VALIDATION_ERROR',
      ).message,
    ).toBe('Arquivo vazio')

    expect(
      expectErr(
        await SdWhatsappService.sendMedia(
          AGENT,
          WS,
          TICKET,
          { ...file, body: Buffer.alloc(16 * 1024 * 1024 + 1) },
          {},
        ),
        'VALIDATION_ERROR',
      ).message,
    ).toBe('Arquivo muito grande (máx. 16 MB)')

    expect(send.media).not.toHaveBeenCalled()
  })

  it('propaga falhas do armazenamento e do envio', async () => {
    media.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.sendMedia(AGENT, WS, TICKET, file, {}),
      'DATABASE_ERROR',
    )

    media.mockResolvedValue(ok({ url: 'https://minio/ws1/file.pdf' }))
    send.media.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.sendMedia(AGENT, WS, TICKET, file, {}),
      'DATABASE_ERROR',
    )
  })

  it('exige conversa vinculada antes de guardar o arquivo', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    expectErr(
      await SdWhatsappService.sendMedia(AGENT, WS, TICKET, file, {}),
      'SD_WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expect(media).not.toHaveBeenCalled()
  })
})

describe('sendTemplate()', () => {
  const dto = {
    templateName: 'atualizacao',
    language: 'pt_BR',
    components: [{ type: 'body' }],
  }

  it('envia o modelo mesmo fora da janela de 24 h', async () => {
    sdWa.findConversation.mockResolvedValue(
      ok(conversation({ connection: connection({ provider: 'META' }) })),
    )
    sdWa.lastInboundAt.mockResolvedValue(ok(null))
    const message = expectOk(
      await SdWhatsappService.sendTemplate(AGENT, WS, TICKET, dto),
    )
    expect(send.template).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'META' }),
      {
        to: '5511988887777',
        templateName: 'atualizacao',
        language: 'pt_BR',
        components: dto.components,
      },
    )
    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TEMPLATE', text: 'atualizacao' }),
    )
    expect(sdWa.lastInboundAt).not.toHaveBeenCalled()
    expect(message.id).toBe('wa-msg-1')
  })

  it('recusa o modelo quando o contato pediu para não receber mensagens', async () => {
    sdWa.findConversation.mockResolvedValue(
      ok(
        conversation({
          contact: createFakeWhatsAppContactWithoutCount({
            waId: '5511988887777',
            broadcastOptedOutAt: new Date('2026-11-01T10:00:00Z'),
          }),
        }),
      ),
    )
    expectErr(
      await SdWhatsappService.sendTemplate(AGENT, WS, TICKET, dto),
      'VALIDATION_ERROR',
    )
    expect(send.template).not.toHaveBeenCalled()
  })

  it('propaga a falha do provedor', async () => {
    send.template.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.sendTemplate(AGENT, WS, TICKET, dto),
      'DATABASE_ERROR',
    )
  })

  it('recusa solicitantes', async () => {
    actAs('requester')
    expectErr(
      await SdWhatsappService.sendTemplate('req', WS, TICKET, dto),
      'SD_NOT_AGENT',
    )
    expect(send.template).not.toHaveBeenCalled()
  })
})

describe('listTemplates()', () => {
  it('usa a conexão da conversa vinculada', async () => {
    sdWa.listApprovedTemplates.mockResolvedValue(
      ok([createFakeWhatsAppTemplate({ id: 'tpl-1' })]),
    )
    const rows = expectOk(
      await SdWhatsappService.listTemplates(AGENT, WS, TICKET),
    )
    expect(sdWa.listApprovedTemplates).toHaveBeenCalledWith(WS, CONN)
    expect(rows[0]?.id).toBe('tpl-1')
  })

  it('cai para a conexão ativa quando a conversa some ou não existe', async () => {
    sdWa.findConversation.mockResolvedValue(ok(null))
    expectOk(await SdWhatsappService.listTemplates(AGENT, WS, TICKET))
    expect(sdWa.listApprovedTemplates).toHaveBeenCalledWith(WS, CONN)

    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    expectOk(await SdWhatsappService.listTemplates(AGENT, WS, TICKET))
    expect(sdWa.listApprovedTemplates).toHaveBeenLastCalledWith(WS, CONN)
  })

  it('devolve vazio sem conexão configurada e propaga falhas', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(config({ whatsappConnectionId: null })),
    )
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    expect(
      expectOk(await SdWhatsappService.listTemplates(AGENT, WS, TICKET)),
    ).toEqual([])

    engine.loadConfig.mockResolvedValue(ok(config()))
    engine.resolveRef.mockResolvedValue(ok(ticket()))
    sdWa.listApprovedTemplates.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.listTemplates(AGENT, WS, TICKET),
      'DATABASE_ERROR',
    )
  })

  it('recusa solicitantes', async () => {
    actAs('requester')
    expectErr(
      await SdWhatsappService.listTemplates('req', WS, TICKET),
      'SD_NOT_AGENT',
    )
  })
})

describe('listConversations()', () => {
  it('lista as conversas do módulo com o código do chamado em aberto', async () => {
    sdWa.listConversations.mockResolvedValue(
      ok([
        {
          ...conversation(),
          sdTickets: [{ id: 't9', number: 9, type: 'INCIDENT' }],
        },
      ]),
    )
    const rows = expectOk(
      await SdWhatsappService.listConversations(AGENT, WS, {
        q: 'ana',
        limit: 20,
      }),
    )
    expect(sdWa.listConversations).toHaveBeenCalledWith(WS, {
      q: 'ana',
      limit: 20,
    })
    expect(rows[0]?.openTicket).toEqual({
      id: 't9',
      number: 9,
      code: 'INC-000009',
    })
  })

  it('recusa solicitantes e propaga falhas de configuração e listagem', async () => {
    actAs('requester')
    expectErr(
      await SdWhatsappService.listConversations('req', WS, { limit: 20 }),
      'SD_NOT_AGENT',
    )

    actAs('agent')
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.listConversations(AGENT, WS, { limit: 20 }),
      'DATABASE_ERROR',
    )

    engine.loadConfig.mockResolvedValue(ok(config()))
    sdWa.listConversations.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.listConversations(AGENT, WS, { limit: 20 }),
      'DATABASE_ERROR',
    )
  })
})

describe('link()', () => {
  it('vincula a conversa, registra o evento e devolve o novo estado', async () => {
    // 1ª leitura: ainda sem conversa; a releitura do estado já vê o vínculo.
    engine.resolveRef.mockResolvedValueOnce(
      ok(ticket({ whatsappConversationId: null })),
    )
    const state = expectOk(
      await SdWhatsappService.link(AGENT, WS, TICKET, { conversationId: CONV }),
    )
    expect(sdWa.setTicketConversation).toHaveBeenCalledWith(TICKET, CONV)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp.linked' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'sd_ticket', action: 'link' }),
    )
    expect(publish).toHaveBeenCalled()
    expect(state.conversation?.id).toBe(CONV)
  })

  it('é idempotente quando a conversa já é a vinculada', async () => {
    expectOk(
      await SdWhatsappService.link(AGENT, WS, TICKET, { conversationId: CONV }),
    )
    expect(sdWa.setTicketConversation).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('recusa conversa de fora do módulo e propaga falhas', async () => {
    sdWa.findConversation.mockResolvedValue(ok(null))
    expectErr(
      await SdWhatsappService.link(AGENT, WS, TICKET, {
        conversationId: 'outra',
      }),
      'SD_WHATSAPP_CONVERSATION_NOT_FOUND',
    )

    sdWa.findConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.link(AGENT, WS, TICKET, {
        conversationId: CONV,
      }),
      'DATABASE_ERROR',
    )

    sdWa.findConversation.mockResolvedValue(ok(conversation()))
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    sdWa.setTicketConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.link(AGENT, WS, TICKET, {
        conversationId: CONV,
      }),
      'DATABASE_ERROR',
    )
  })

  it('recusa solicitantes e rotula o evento pelo número sem nome', async () => {
    actAs('requester')
    expectErr(
      await SdWhatsappService.link('req', WS, TICKET, {
        conversationId: CONV,
      }),
      'SD_NOT_AGENT',
    )

    actAs('agent')
    engine.resolveRef.mockResolvedValueOnce(
      ok(ticket({ whatsappConversationId: null })),
    )
    sdWa.findConversation.mockResolvedValue(
      ok(
        conversation({
          contact: createFakeWhatsAppContactWithoutCount({
            id: 'wa-contact-1',
            waId: '5511988887777',
            name: null,
          }),
        }),
      ),
    )
    expectOk(
      await SdWhatsappService.link(AGENT, WS, TICKET, { conversationId: CONV }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        toValue: { id: CONV, label: '5511988887777' },
      }),
    )
  })
})

describe('start()', () => {
  it('reaproveita a conversa ativa do contato e vincula ao chamado', async () => {
    engine.resolveRef.mockResolvedValueOnce(
      ok(ticket({ whatsappConversationId: null })),
    )
    sdWa.findActiveConversation.mockResolvedValue(ok({ id: CONV }))
    const state = expectOk(
      await SdWhatsappService.start(AGENT, WS, TICKET, {
        waId: '(11) 98888-7777',
      }),
    )
    expect(waContacts.upsertByWaId).toHaveBeenCalledWith({
      workspaceId: WS,
      waId: '5511988887777',
      name: undefined,
    })
    expect(conversations.create).not.toHaveBeenCalled()
    expect(state.conversation?.id).toBe(CONV)
  })

  it('cria a conversa quando o contato ainda não tem uma aberta', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    expectOk(
      await SdWhatsappService.start(AGENT, WS, TICKET, {
        waId: '5511988887777',
      }),
    )
    expect(conversations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        connectionId: CONN,
        contactId: 'wa-contact-1',
        status: 'IN_PROGRESS',
        aiActive: false,
        aiHandoff: true,
      }),
    )
  })

  it('usa o WhatsApp do contato do chamado quando o número não vem', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null, contactId: 'c1' })),
    )
    sdContacts.findById.mockResolvedValue(
      ok(createFakeSdContact({ whatsapp: null, phone: '11977776666' })),
    )
    expectOk(await SdWhatsappService.start(AGENT, WS, TICKET, {}))
    expect(waContacts.upsertByWaId).toHaveBeenCalledWith(
      expect.objectContaining({ waId: '5511977776666' }),
    )
  })

  it('recusa sem conexão ativa e sem número válido', async () => {
    engine.loadConfig.mockResolvedValue(
      ok(config({ whatsappConnectionId: null })),
    )
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {}),
      'SD_WHATSAPP_NOT_CONFIGURED',
    )

    engine.loadConfig.mockResolvedValue(ok(config()))
    connections.findById.mockResolvedValue(ok(null))
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {}),
      'SD_WHATSAPP_NOT_CONFIGURED',
    )

    connections.findById.mockResolvedValue(ok(connection()))
    engine.resolveRef.mockResolvedValue(ok(ticket({ contactId: null })))
    expect(
      expectErr(
        await SdWhatsappService.start(AGENT, WS, TICKET, {}),
        'VALIDATION_ERROR',
      ).message,
    ).toBe('Informe o número do WhatsApp (com DDI e DDD)')
  })

  it('propaga falhas do contato, do upsert, da busca e da criação', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null, contactId: 'c1' })),
    )
    sdContacts.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {}),
      'DATABASE_ERROR',
    )

    sdContacts.findById.mockResolvedValue(
      ok(createFakeSdContact({ whatsapp: '5511988887777' })),
    )
    waContacts.upsertByWaId.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {}),
      'DATABASE_ERROR',
    )

    waContacts.upsertByWaId.mockResolvedValue(
      ok(createFakeWhatsAppContactWithoutCount({ id: 'wa-contact-1' })),
    )
    sdWa.findActiveConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {}),
      'DATABASE_ERROR',
    )

    sdWa.findActiveConversation.mockResolvedValue(ok(null))
    conversations.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {}),
      'DATABASE_ERROR',
    )
  })

  it('recusa quando a conversa recém-criada não é do módulo', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    sdWa.findConversation.mockResolvedValue(ok(null))
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {
        waId: '5511988887777',
      }),
      'SD_WHATSAPP_CONVERSATION_NOT_FOUND',
    )

    sdWa.findConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {
        waId: '5511988887777',
      }),
      'DATABASE_ERROR',
    )
  })

  it('leva o nome do contato do chamado para o contato do WhatsApp', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(
        ticket({
          whatsappConversationId: null,
          contact: { id: 'c1', name: 'Ana Souza', email: null, userId: null },
        }),
      ),
    )
    expectOk(
      await SdWhatsappService.start(AGENT, WS, TICKET, {
        waId: '5511988887777',
      }),
    )
    expect(waContacts.upsertByWaId).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ana Souza' }),
    )
  })

  it('recusa solicitantes, falha ao ler a conexão e contato sem telefone', async () => {
    actAs('requester')
    expectErr(
      await SdWhatsappService.start('req', WS, TICKET, {}),
      'SD_NOT_AGENT',
    )

    actAs('agent')
    connections.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {}),
      'DATABASE_ERROR',
    )

    connections.findById.mockResolvedValue(ok(connection()))
    sdContacts.findById.mockResolvedValue(
      ok(createFakeSdContact({ whatsapp: null, phone: null })),
    )
    expectErr(
      await SdWhatsappService.start(AGENT, WS, TICKET, {}),
      'VALIDATION_ERROR',
    )
  })
})

describe('unlink()', () => {
  it('desvincula, registra o evento e devolve o estado sem conversa', async () => {
    const state = expectOk(await SdWhatsappService.unlink(AGENT, WS, TICKET))
    expect(sdWa.setTicketConversation).toHaveBeenCalledWith(TICKET, null)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp.unlinked' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'sd_ticket', action: 'unlink' }),
    )
    expect(publish).toHaveBeenCalled()
    expect(state.configured).toBe(true)
  })

  it('recusa quando não há conversa vinculada e propaga a falha ao salvar', async () => {
    engine.resolveRef.mockResolvedValue(
      ok(ticket({ whatsappConversationId: null })),
    )
    expectErr(
      await SdWhatsappService.unlink(AGENT, WS, TICKET),
      'SD_WHATSAPP_CONVERSATION_NOT_FOUND',
    )

    engine.resolveRef.mockResolvedValue(ok(ticket()))
    sdWa.setTicketConversation.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWhatsappService.unlink(AGENT, WS, TICKET),
      'DATABASE_ERROR',
    )
  })

  it('recusa solicitantes', async () => {
    actAs('requester')
    expectErr(await SdWhatsappService.unlink('req', WS, TICKET), 'SD_NOT_AGENT')
  })
})
