import type { WhatsAppConnection, WhatsAppMessageType } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  sdTicketClosed,
  sdWhatsappConversationNotFound,
  sdWhatsappNotConfigured,
  sdWhatsappWindowClosed,
  validationError,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  normalizeSdWhatsappNumber,
  sdWhatsappWindow,
} from '@/src/lib/servicedesk/whatsapp'
import { persistOutboundMedia } from '@/src/lib/whatsapp/media'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import type { WhatsAppSendResult } from '@/src/lib/whatsapp/types'
import {
  toSdWhatsappConversationDTO,
  toSdWhatsappTemplateDTO,
} from '@/src/mappers/sd-whatsapp.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { SdContactRepository } from '@/src/repositories/sd-contact.repository'
import type { SdTicketWithRelations } from '@/src/repositories/sd-ticket.repository'
import {
  type SdWaConversation,
  SdWhatsappRepository,
} from '@/src/repositories/sd-whatsapp.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  SD_WHATSAPP_MEDIA_MAX_BYTES,
  SD_WHATSAPP_MEDIA_TYPES,
  type SdWhatsappConversationsQueryDTO,
  type SdWhatsappLinkDTO,
  type SdWhatsappMessagesQueryDTO,
  type SdWhatsappSendMediaDTO,
  type SdWhatsappSendTemplateDTO,
  type SdWhatsappSendTextDTO,
  type SdWhatsappStartDTO,
} from '@/src/schemas/sd-whatsapp.schema'
import type {
  SdTicketWhatsappDTO,
  SdWhatsappConversationDTO,
  SdWhatsappMessageDTO,
  SdWhatsappTemplateDTO,
} from '@/types/sd-whatsapp'
import { SdAccess, type SdAccessContext } from './sd-access'
import {
  type SdEngineConfig,
  SdTicketEngine,
  sdTicketCode,
} from './sd-ticket-engine'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'
import {
  mirrorSdWhatsappMessage,
  publishSdTicketMessage,
} from './sd-whatsapp-inbound.service'
import { WHATSAPP_OPTED_OUT_MESSAGE } from './whatsapp-opt-out'

/**
 * Aba WhatsApp do chamado (só agentes): a conversa vinculada, envio de
 * texto/mídia/modelo pela conexão do ServiceDesk (espelhado no histórico
 * como resposta pública do agente, canal WHATSAPP), vincular/iniciar/
 * desvincular conversa.
 */

const MODULE = 'SERVICE_DESK' as const
const CLOSED = new Set(['CLOSED', 'CANCELED'])

interface Loaded {
  ctx: SdAccessContext
  config: SdEngineConfig
  ticket: SdTicketWithRelations
}

async function load(
  actorId: string,
  workspaceId: string,
  ticketRef: string,
  action: 'VIEW' | 'EDIT',
): Promise<Result<Loaded>> {
  const ctx = await SdAccess.requireAgent(actorId, workspaceId, {
    resource: 'sd-tickets',
    action,
  })
  if (!ctx.ok) return ctx
  const config = await SdTicketEngine.loadConfig(workspaceId)
  if (!config.ok) return config
  const ticket = await SdTicketEngine.resolveRef(
    workspaceId,
    ticketRef,
    config.value.prefixes,
  )
  if (!ticket.ok) return ticket
  return ok({ ctx: ctx.value, config: config.value, ticket: ticket.value })
}

async function activeConnection(
  workspaceId: string,
  config: SdEngineConfig,
): Promise<Result<WhatsAppConnection | null>> {
  const id = config.settings.whatsappConnectionId
  if (!id) return ok(null)
  return WhatsAppConnectionRepository.findById(id, workspaceId, MODULE)
}

async function linkedConversation(
  loaded: Loaded,
): Promise<Result<SdWaConversation>> {
  const id = loaded.ticket.whatsappConversationId
  if (!id) return err(sdWhatsappConversationNotFound())
  const found = await SdWhatsappRepository.findConversation(
    loaded.ticket.workspaceId,
    id,
    loaded.ticket.id,
  )
  if (!found.ok) return found
  if (!found.value) return err(sdWhatsappConversationNotFound())
  return ok(found.value)
}

function codeOf(config: SdEngineConfig) {
  return (t: { type: string; number: number }) =>
    sdTicketCode(t as Parameters<typeof sdTicketCode>[0], config.prefixes)
}

/** Conversa pronta para envio: vinculada, chamado aberto, dentro da janela. */
async function sendable(
  actorId: string,
  workspaceId: string,
  ticketRef: string,
  kind: 'free' | 'template',
): Promise<Result<Loaded & { conversation: SdWaConversation }>> {
  const loaded = await load(actorId, workspaceId, ticketRef, 'EDIT')
  if (!loaded.ok) return loaded
  if (CLOSED.has(loaded.value.ticket.phase.category))
    return err(sdTicketClosed())
  const conversation = await linkedConversation(loaded.value)
  if (!conversation.ok) return conversation
  // A template starts a business-initiated message: a contact that opted out
  // (LGPD) must not receive it. Free text only answers the contact's window.
  if (kind === 'template' && conversation.value.contact.broadcastOptedOutAt) {
    return err(validationError(WHATSAPP_OPTED_OUT_MESSAGE))
  }
  if (kind === 'free') {
    const last = await SdWhatsappRepository.lastInboundAt(conversation.value.id)
    if (!last.ok) return last
    const window = sdWhatsappWindow(
      conversation.value.connection.provider,
      last.value,
    )
    if (!window.open) return err(sdWhatsappWindowClosed())
  }
  return ok({ ...loaded.value, conversation: conversation.value })
}

/**
 * Grava a mensagem enviada, marca a conversa como em atendimento humano
 * (a IA para de responder) e espelha no histórico do chamado.
 */
async function finalizeSend(
  actorId: string,
  target: Loaded & { conversation: SdWaConversation },
  sent: WhatsAppSendResult,
  message: { type: WhatsAppMessageType; text?: string; mediaUrl?: string },
): Promise<Result<SdWhatsappMessageDTO>> {
  const { ticket, conversation } = target
  const created = await WhatsAppMessageRepository.create({
    workspaceId: ticket.workspaceId,
    conversationId: conversation.id,
    direction: 'OUT',
    type: message.type,
    text: message.text,
    mediaUrl: message.mediaUrl,
    providerMessageId: sent.providerMessageId,
    status: 'SENT',
    senderUserId: actorId,
  })
  if (!created.ok) return created
  await WhatsAppConversationRepository.update(conversation.id, {
    lastMessageAt: new Date(),
    status: 'IN_PROGRESS',
    aiActive: false,
    aiHandoff: true,
  })
  const mirrored = await mirrorSdWhatsappMessage({
    ticket,
    message: created.value,
    authorKind: 'AGENT',
    authorUserId: actorId,
  })
  if (!mirrored.ok) {
    logger.warn('servicedesk.whatsapp.mirror_failed', {
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      reason: mirrored.error.code,
    })
  }
  await SdTicketEngine.markFirstResponse(ticket.id)
  await SdTicketEngine.touchActivity(ticket.id)
  auditMutation({
    entity: 'whatsapp_message',
    action: 'send',
    actorId,
    targetId: created.value.id,
    meta: {
      workspaceId: ticket.workspaceId,
      module: MODULE,
      ticketId: ticket.id,
      type: message.type,
    },
  })
  return ok(toWhatsAppMessageDTO(created.value))
}

async function link(
  actorId: string,
  loaded: Loaded,
  conversation: SdWaConversation,
): Promise<Result<SdTicketWhatsappDTO>> {
  const { ticket } = loaded
  const previous = ticket.whatsappConversationId
  if (previous !== conversation.id) {
    const saved = await SdWhatsappRepository.setTicketConversation(
      ticket.id,
      conversation.id,
    )
    if (!saved.ok) return saved
    await recordSdTicketEvent({
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      actorKind: 'AGENT',
      actorUserId: actorId,
      action: 'whatsapp.linked',
      toValue: {
        id: conversation.id,
        label: conversation.contact.name ?? conversation.contact.waId,
      },
    })
    auditMutation({
      entity: 'sd_ticket',
      action: 'link',
      actorId,
      targetId: ticket.id,
      meta: {
        workspaceId: ticket.workspaceId,
        conversationId: conversation.id,
      },
    })
    await publishSdTicketMessage(ticket, actorId)
  }
  return SdWhatsappService.state(actorId, ticket.workspaceId, ticket.id)
}

export const SdWhatsappService = {
  /** Estado da aba: conexão ativa, conversa vinculada e a janela de 24 h. */
  async state(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdTicketWhatsappDTO>> {
    const loaded = await load(actorId, workspaceId, ticketRef, 'VIEW')
    if (!loaded.ok) return loaded
    const { ticket, config } = loaded.value
    const connection = await activeConnection(workspaceId, config)
    if (!connection.ok) return connection

    let conversation: SdWaConversation | null = null
    if (ticket.whatsappConversationId) {
      const found = await SdWhatsappRepository.findConversation(
        workspaceId,
        ticket.whatsappConversationId,
        ticket.id,
      )
      if (!found.ok) return found
      conversation = found.value
    }
    const provider =
      conversation?.connection.provider ?? connection.value?.provider ?? 'ZAPI'
    let lastInbound: Date | null = null
    if (conversation) {
      const last = await SdWhatsappRepository.lastInboundAt(conversation.id)
      if (!last.ok) return last
      lastInbound = last.value
    }

    let suggested: string | null = null
    if (ticket.contactId) {
      const contact = await SdContactRepository.findById(
        ticket.contactId,
        workspaceId,
      )
      if (contact.ok && contact.value) {
        suggested = normalizeSdWhatsappNumber(
          contact.value.whatsapp ?? contact.value.phone,
        )
      }
    }

    const active = connection.value
    return ok({
      configured: Boolean(active),
      connection: active
        ? {
            id: active.id,
            label: active.label,
            provider: active.provider,
            phoneNumber: active.phoneNumber,
            status: active.status,
          }
        : null,
      conversation: conversation
        ? toSdWhatsappConversationDTO(conversation)
        : null,
      window: sdWhatsappWindow(provider, lastInbound),
      suggestedWaId: suggested,
    })
  },

  async listMessages(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    query: SdWhatsappMessagesQueryDTO,
  ): Promise<Result<SdWhatsappMessageDTO[]>> {
    const loaded = await load(actorId, workspaceId, ticketRef, 'VIEW')
    if (!loaded.ok) return loaded
    if (!loaded.value.ticket.whatsappConversationId) return ok([])
    const conversation = await linkedConversation(loaded.value)
    if (!conversation.ok) return conversation
    const rows = await WhatsAppMessageRepository.listByConversation(
      conversation.value.id,
      {
        cursor: query.cursor,
        limit: query.limit,
        after: conversation.value.clearedAt,
      },
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppMessageDTO))
  },

  async sendText(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    dto: SdWhatsappSendTextDTO,
  ): Promise<Result<SdWhatsappMessageDTO>> {
    const target = await sendable(actorId, workspaceId, ticketRef, 'free')
    if (!target.ok) return target
    const sent = await WhatsAppSend.text(target.value.conversation.connection, {
      to: target.value.conversation.contact.waId,
      text: dto.text,
    })
    if (!sent.ok) return sent
    return finalizeSend(actorId, target.value, sent.value, {
      type: 'TEXT',
      text: dto.text,
    })
  },

  /** Envia um arquivo (guardado no bucket de mídia do WhatsApp). */
  async sendMedia(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    file: { body: Buffer; contentType: string; fileName: string },
    dto: SdWhatsappSendMediaDTO,
  ): Promise<Result<SdWhatsappMessageDTO>> {
    const type =
      SD_WHATSAPP_MEDIA_TYPES[
        file.contentType as keyof typeof SD_WHATSAPP_MEDIA_TYPES
      ]
    if (!type) return err(validationError('Tipo de arquivo não suportado'))
    if (file.body.byteLength === 0) {
      return err(validationError('Arquivo vazio'))
    }
    if (file.body.byteLength > SD_WHATSAPP_MEDIA_MAX_BYTES) {
      return err(validationError('Arquivo muito grande (máx. 16 MB)'))
    }
    const target = await sendable(actorId, workspaceId, ticketRef, 'free')
    if (!target.ok) return target
    const stored = await persistOutboundMedia({
      workspaceId,
      body: file.body,
      contentType: file.contentType,
    })
    if (!stored.ok) return stored
    const sent = await WhatsAppSend.media(
      target.value.conversation.connection,
      {
        to: target.value.conversation.contact.waId,
        mediaUrl: stored.value.url,
        type: type.toLowerCase() as 'image' | 'video' | 'audio' | 'document',
        caption: dto.caption,
        fileName: file.fileName,
      },
    )
    if (!sent.ok) return sent
    return finalizeSend(actorId, target.value, sent.value, {
      type,
      text: dto.caption,
      mediaUrl: stored.value.url,
    })
  },

  /** Modelo aprovado (Meta) — o único envio possível fora da janela. */
  async sendTemplate(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    dto: SdWhatsappSendTemplateDTO,
  ): Promise<Result<SdWhatsappMessageDTO>> {
    const target = await sendable(actorId, workspaceId, ticketRef, 'template')
    if (!target.ok) return target
    const sent = await WhatsAppSend.template(
      target.value.conversation.connection,
      {
        to: target.value.conversation.contact.waId,
        templateName: dto.templateName,
        language: dto.language,
        components: dto.components,
      },
    )
    if (!sent.ok) return sent
    return finalizeSend(actorId, target.value, sent.value, {
      type: 'TEMPLATE',
      text: dto.templateName,
    })
  },

  /** Modelos aprovados da conexão da conversa (ou da ativa). */
  async listTemplates(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdWhatsappTemplateDTO[]>> {
    const loaded = await load(actorId, workspaceId, ticketRef, 'VIEW')
    if (!loaded.ok) return loaded
    let connectionId = loaded.value.config.settings.whatsappConnectionId
    if (loaded.value.ticket.whatsappConversationId) {
      const conversation = await linkedConversation(loaded.value)
      if (conversation.ok) connectionId = conversation.value.connectionId
    }
    if (!connectionId) return ok([])
    const rows = await SdWhatsappRepository.listApprovedTemplates(
      workspaceId,
      connectionId,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdWhatsappTemplateDTO))
  },

  /** Conversas do WhatsApp do ServiceDesk (para vincular a um chamado). */
  async listConversations(
    actorId: string,
    workspaceId: string,
    query: SdWhatsappConversationsQueryDTO,
  ): Promise<Result<SdWhatsappConversationDTO[]>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
    if (!ctx.ok) return ctx
    const config = await SdTicketEngine.loadConfig(workspaceId)
    if (!config.ok) return config
    const rows = await SdWhatsappRepository.listConversations(
      workspaceId,
      query,
    )
    if (!rows.ok) return rows
    return ok(
      rows.value.map((row) =>
        toSdWhatsappConversationDTO(row, codeOf(config.value)),
      ),
    )
  },

  /** Vincula uma conversa existente do ServiceDesk ao chamado. */
  async link(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    dto: SdWhatsappLinkDTO,
  ): Promise<Result<SdTicketWhatsappDTO>> {
    const loaded = await load(actorId, workspaceId, ticketRef, 'EDIT')
    if (!loaded.ok) return loaded
    const conversation = await SdWhatsappRepository.findConversation(
      workspaceId,
      dto.conversationId,
    )
    if (!conversation.ok) return conversation
    if (!conversation.value)
      return err(sdWhatsappConversationNotFound('Conversa não encontrada'))
    return link(actorId, loaded.value, conversation.value)
  },

  /**
   * Inicia (ou retoma) a conversa com o número informado ou o WhatsApp do
   * contato do chamado, pela conexão ativa, e vincula ao chamado.
   */
  async start(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    dto: SdWhatsappStartDTO,
  ): Promise<Result<SdTicketWhatsappDTO>> {
    const loaded = await load(actorId, workspaceId, ticketRef, 'EDIT')
    if (!loaded.ok) return loaded
    const connection = await activeConnection(workspaceId, loaded.value.config)
    if (!connection.ok) return connection
    if (!connection.value) return err(sdWhatsappNotConfigured())

    let raw = dto.waId
    if (!raw && loaded.value.ticket.contactId) {
      const contact = await SdContactRepository.findById(
        loaded.value.ticket.contactId,
        workspaceId,
      )
      if (!contact.ok) return contact
      raw = contact.value?.whatsapp ?? contact.value?.phone ?? undefined
    }
    const waId = normalizeSdWhatsappNumber(raw)
    if (!waId) {
      return err(
        validationError('Informe o número do WhatsApp (com DDI e DDD)'),
      )
    }

    const contact = await WhatsAppContactRepository.upsertByWaId({
      workspaceId,
      waId,
      name: loaded.value.ticket.contact?.name,
    })
    if (!contact.ok) return contact
    const existing = await SdWhatsappRepository.findActiveConversation(
      connection.value.id,
      contact.value.id,
    )
    if (!existing.ok) return existing
    let conversationId = existing.value?.id
    if (!conversationId) {
      const created = await WhatsAppConversationRepository.create({
        workspaceId,
        connectionId: connection.value.id,
        contactId: contact.value.id,
        status: 'IN_PROGRESS',
        aiActive: false,
        aiHandoff: true,
        unreadCount: 0,
      })
      if (!created.ok) return created
      conversationId = created.value.id
    }
    const conversation = await SdWhatsappRepository.findConversation(
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation
    if (!conversation.value) return err(sdWhatsappConversationNotFound())
    return link(actorId, loaded.value, conversation.value)
  },

  async unlink(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdTicketWhatsappDTO>> {
    const loaded = await load(actorId, workspaceId, ticketRef, 'EDIT')
    if (!loaded.ok) return loaded
    const { ticket } = loaded.value
    if (!ticket.whatsappConversationId) {
      return err(sdWhatsappConversationNotFound())
    }
    const saved = await SdWhatsappRepository.setTicketConversation(
      ticket.id,
      null,
    )
    if (!saved.ok) return saved
    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      actorKind: 'AGENT',
      actorUserId: actorId,
      action: 'whatsapp.unlinked',
      fromValue: { id: ticket.whatsappConversationId, label: 'WhatsApp' },
    })
    auditMutation({
      entity: 'sd_ticket',
      action: 'unlink',
      actorId,
      targetId: ticket.id,
      meta: { workspaceId, conversationId: ticket.whatsappConversationId },
    })
    await publishSdTicketMessage(ticket, actorId)
    return SdWhatsappService.state(actorId, workspaceId, ticket.id)
  },
}
