import type {
  SdMessageAuthorKind,
  SdTicketType,
  WhatsAppConnection,
  WhatsAppContact,
  WhatsAppMessage,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { enqueueSdAiWhatsappReply } from '@/src/lib/servicedesk/ai-queue'
import { publishSdTicketEvent } from '@/src/lib/servicedesk/realtime'
import {
  sdPlainTextToHtml,
  sdWhatsappAttachmentKey,
  sdWhatsappAttachmentMeta,
  sdWhatsappMessageBody,
  sdWhatsappTicketOpenedText,
  sdWhatsappTicketTitle,
} from '@/src/lib/servicedesk/whatsapp'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  SdTicketRepository,
  type SdTicketWithRelations,
} from '@/src/repositories/sd-ticket.repository'
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import type { SdAiTicketDraftDTO } from '@/types/sd-ai'
import type { SdContactDTO } from '@/types/sd-contact'
import { fireSdAutomations } from './sd-automation-engine'
import { SdContactService } from './sd-contact.service'
import {
  type SdEngineConfig,
  SdTicketEngine,
  sdSystemActor,
  sdTicketCode,
} from './sd-ticket-engine'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'
import { notifySdTicketReply } from './sd-ticket-reply-notify'

/**
 * Roteamento do WhatsApp do ServiceDesk (fluxo de sistema, sem usuário):
 * o webhook do zap grava contato/conversa/mensagem e chama este service
 * para a conexão com `module = SERVICE_DESK`.
 *
 * Mensagem recebida → chamado em aberto vinculado à conversa? espelha no
 * histórico (autor CONTACT) : pré-atendimento por IA ligado? enfileira a IA
 * : abre o chamado (canal WHATSAPP) e responde com o código.
 *
 * Nada aqui derruba o webhook: erros são logados.
 */

const SOURCE = 'whatsapp'

function audience(t: SdTicketWithRelations) {
  return {
    requesterId: t.requesterId,
    participantIds: t.participants.map((p) => p.userId),
    contactUserId: t.contact?.userId ?? null,
  }
}

/** Aviso de mensagem nova/alterada no chamado (histórico e aba WhatsApp). */
export async function publishSdTicketMessage(
  ticket: SdTicketWithRelations,
  actorId: string | null = null,
): Promise<void> {
  await publishSdTicketEvent(
    ticket.workspaceId,
    {
      type: 'ticket.message',
      ticketId: ticket.id,
      number: ticket.number,
      at: new Date().toISOString(),
      actorId,
    },
    audience(ticket),
  )
}

/** Contato do ServiceDesk pelo número do WhatsApp (`null` se não houver). */
async function findSdContact(
  workspaceId: string,
  waId: string,
): Promise<SdContactDTO | null> {
  const found = await SdContactService.findByChannel(workspaceId, {
    whatsapp: waId,
  })
  if (!found.ok) {
    logger.warn('servicedesk.whatsapp.contact_lookup_failed', {
      workspaceId,
      reason: found.error.code,
    })
    return null
  }
  return found.value
}

export interface SdMirrorInput {
  ticket: SdTicketWithRelations
  message: WhatsAppMessage
  authorKind: SdMessageAuthorKind
  authorUserId?: string | null
  authorContactId?: string | null
}

/**
 * Espelha uma mensagem do WhatsApp no histórico do chamado (público, canal
 * WHATSAPP, com a mídia como anexo que aponta para a mensagem), grava a
 * rastreabilidade e avisa o tempo real. Idempotente por mensagem.
 */
export async function mirrorSdWhatsappMessage(
  input: SdMirrorInput,
): Promise<Result<{ id: string } | null>> {
  const { ticket, message } = input
  const exists = await SdWhatsappRepository.hasMirror(ticket.id, message.id)
  if (!exists.ok) return exists
  if (exists.value) return ok(null)

  const media = message.mediaUrl ? sdWhatsappAttachmentMeta(message.type) : null
  const created = await SdWhatsappRepository.createTicketMessage({
    workspaceId: ticket.workspaceId,
    ticketId: ticket.id,
    authorKind: input.authorKind,
    authorUserId: input.authorUserId ?? null,
    authorContactId: input.authorContactId ?? null,
    channel: 'WHATSAPP',
    body: sdWhatsappMessageBody(message.type, message.text),
    whatsappMessageId: message.id,
    attachment: media
      ? {
          ...media,
          size: 0,
          storageKey: sdWhatsappAttachmentKey(message.id),
          uploadedById: input.authorUserId ?? null,
        }
      : null,
  })
  if (!created.ok) return created

  await recordSdTicketEvent({
    workspaceId: ticket.workspaceId,
    ticketId: ticket.id,
    actorKind: input.authorKind,
    actorUserId: input.authorUserId ?? null,
    action: 'message.posted',
    meta: {
      messageId: created.value.id,
      channel: 'WHATSAPP',
      visibility: 'PUBLIC',
      direction: message.direction,
      ...(media ? { attachment: media.kind } : {}),
    },
  })
  await publishSdTicketMessage(ticket, input.authorUserId ?? null)
  return ok(created.value)
}

/**
 * Envia texto pela conexão do ServiceDesk em nome do sistema/IA e grava a
 * mensagem de saída na conversa (a aba WhatsApp do chamado a mostra).
 */
export async function sendSdWhatsappText(input: {
  connection: WhatsAppConnection
  conversationId: string
  waId: string
  text: string
  sentByAi?: boolean
}): Promise<Result<WhatsAppMessage>> {
  const sent = await WhatsAppSend.text(input.connection, {
    to: input.waId,
    text: input.text,
  })
  if (!sent.ok) return sent
  const message = await WhatsAppMessageRepository.create({
    workspaceId: input.connection.workspaceId,
    conversationId: input.conversationId,
    direction: 'OUT',
    type: 'TEXT',
    text: input.text,
    providerMessageId: sent.value.providerMessageId,
    status: 'SENT',
    sentByAi: input.sentByAi ?? false,
  })
  if (!message.ok) return message
  await WhatsAppConversationRepository.update(input.conversationId, {
    lastMessageAt: new Date(),
  })
  return message
}

/** Tipo do chamado aberto pelo WhatsApp: o do rascunho, se permitido. */
function ticketTypeFor(
  config: SdEngineConfig,
  preferred?: SdTicketType | null,
): SdTicketType {
  const allowed = config.settings.portalTicketTypes
  if (preferred && allowed.includes(preferred)) return preferred
  if (allowed.includes('INCIDENT') || allowed.length === 0) return 'INCIDENT'
  return allowed[0]
}

const CATALOG_ERRORS = new Set([
  'SD_CATEGORY_NOT_FOUND',
  'SD_CATEGORY_LEVEL_INVALID',
  'SD_CONFIG_NOT_FOUND',
])

export interface SdOpenFromWhatsappInput {
  connection: WhatsAppConnection
  conversationId: string
  contact: Pick<WhatsAppContact, 'waId' | 'name'>
  config: SdEngineConfig
  /** Mensagem que originou o chamado (espelhada como 1ª mensagem). */
  message?: WhatsAppMessage | null
  /** Rascunho do pré-atendimento (título, descrição, tipo, catálogo). */
  draft?: Partial<SdAiTicketDraftDTO> | null
  /** Transcrição do pré-atendimento (1ª mensagem do chamado, autor IA). */
  transcript?: string | null
}

async function createTicket(
  input: SdOpenFromWhatsappInput,
  sdContact: SdContactDTO | null,
): Promise<Result<SdTicketWithRelations>> {
  const workspaceId = input.connection.workspaceId
  const draft = input.draft ?? {}
  const primary = sdContact?.customers[0]
  const text = input.message?.text ?? ''
  const title =
    draft.title && draft.title.trim().length >= 3
      ? draft.title.trim().slice(0, 200)
      : sdWhatsappTicketTitle(text)
  const description = draft.description?.trim() || text.trim()
  const base = {
    type: ticketTypeFor(input.config, draft.type),
    title,
    description: description ? sdPlainTextToHtml(description) : undefined,
    channel: 'WHATSAPP' as const,
    contactId: sdContact?.id,
    customerId: primary?.kind === 'CLIENT' ? primary.id : undefined,
    companyId: primary?.kind === 'COMPANY' ? primary.id : undefined,
    requesterId: sdContact?.userId ?? null,
  }
  const catalog = {
    categoryId: draft.categoryId ?? undefined,
    subcategoryId: draft.subcategoryId ?? undefined,
    serviceId: draft.serviceId ?? undefined,
    urgencyId: draft.urgencyId ?? undefined,
  }
  const actor = sdSystemActor(SOURCE)
  const hasCatalog = Object.values(catalog).some(Boolean)
  const created = await SdTicketEngine.create(
    workspaceId,
    { ...base, ...catalog },
    actor,
    input.config,
  )
  // A sugestão da IA pode apontar para um nó que não serve a este tipo:
  // abre sem catálogo (a triagem/o agente completa depois).
  if (!created.ok && hasCatalog && CATALOG_ERRORS.has(created.error.code)) {
    return SdTicketEngine.create(workspaceId, base, actor, input.config)
  }
  return created
}

/** Replies to the contact with the new ticket code; a failure only logs. */
async function sendTicketOpenedReply(
  input: SdOpenFromWhatsappInput,
  ticket: SdTicketWithRelations,
): Promise<void> {
  const code = sdTicketCode(ticket, input.config.prefixes)
  const reply = await sendSdWhatsappText({
    connection: input.connection,
    conversationId: input.conversationId,
    waId: input.contact.waId,
    text: sdWhatsappTicketOpenedText(code),
  })
  if (reply.ok) {
    await mirrorSdWhatsappMessage({
      ticket,
      message: reply.value,
      authorKind: 'SYSTEM',
    })
    return
  }
  logger.warn('servicedesk.whatsapp.ticket_reply_failed', {
    workspaceId: input.connection.workspaceId,
    ticketId: ticket.id,
    reason: reply.error.code,
  })
}

export const SdWhatsappInboundService = {
  /**
   * Abre o chamado a partir de uma conversa do WhatsApp do ServiceDesk:
   * contato/cliente pelo número, conversa vinculada, 1ª mensagem espelhada,
   * automações `TICKET_CREATED` e, se `whatsappSendAcknowledgement`, a
   * resposta com o código ao contato.
   */
  async openTicketFromWhatsapp(
    input: SdOpenFromWhatsappInput,
  ): Promise<Result<SdTicketWithRelations>> {
    const workspaceId = input.connection.workspaceId
    const sdContact = await findSdContact(workspaceId, input.contact.waId)
    const created = await createTicket(input, sdContact)
    if (!created.ok) {
      auditMutation({
        entity: 'sd_ticket',
        action: 'create',
        actorId: null,
        outcome: 'failure',
        reason: created.error.code,
        meta: { workspaceId, channel: 'WHATSAPP', actor: 'system' },
      })
      return created
    }
    const ticket = {
      ...created.value,
      whatsappConversationId: input.conversationId,
    }

    const linked = await SdWhatsappRepository.setTicketConversation(
      ticket.id,
      input.conversationId,
    )
    if (!linked.ok) return linked

    auditMutation({
      entity: 'sd_ticket',
      action: 'create',
      actorId: null,
      targetId: ticket.id,
      meta: {
        workspaceId,
        type: ticket.type,
        channel: 'WHATSAPP',
        actor: 'system',
        contactMatched: Boolean(sdContact),
      },
    })

    if (input.transcript) {
      await SdWhatsappRepository.createTicketMessage({
        workspaceId,
        ticketId: ticket.id,
        authorKind: 'AI',
        channel: 'WHATSAPP',
        body: `Pré-atendimento por IA (WhatsApp):\n\n${input.transcript}`,
      })
    }
    if (input.message) {
      await mirrorSdWhatsappMessage({
        ticket,
        message: input.message,
        authorKind: 'CONTACT',
        authorContactId: sdContact?.id ?? null,
      })
    }

    void fireSdAutomations('TICKET_CREATED', ticket.id)

    if (input.config.settings.whatsappSendAcknowledgement) {
      await sendTicketOpenedReply(input, ticket)
    }

    logger.info('servicedesk.whatsapp.ticket_opened', {
      workspaceId,
      ticketId: ticket.id,
      fromPreService: Boolean(input.transcript),
      acknowledged: input.config.settings.whatsappSendAcknowledgement,
    })
    return ok(ticket)
  },

  /** Mensagem recebida numa conversa do ServiceDesk (webhook). */
  async routeInbound(input: {
    connection: WhatsAppConnection
    conversationId: string
    contact: WhatsAppContact
    message: WhatsAppMessage
  }): Promise<void> {
    const workspaceId = input.connection.workspaceId
    const result = await SdWhatsappInboundService.route(input)
    if (!result.ok) {
      logger.error('servicedesk.whatsapp.route_failed', {
        workspaceId,
        conversationId: input.conversationId,
        reason: result.error.code,
      })
      return
    }
    logger.info('servicedesk.whatsapp.routed', {
      workspaceId,
      conversationId: input.conversationId,
      outcome: result.value,
    })
  },

  /** Decisão do roteamento (exposta para teste). */
  async route(input: {
    connection: WhatsAppConnection
    conversationId: string
    contact: WhatsAppContact
    message: WhatsAppMessage
  }): Promise<
    Result<'mirrored' | 'mirrored_ai' | 'pre_service' | 'ticket_opened'>
  > {
    const workspaceId = input.connection.workspaceId
    const config = await SdTicketEngine.loadConfig(workspaceId)
    if (!config.ok) return config
    const { settings } = config.value

    const open = await SdWhatsappRepository.findOpenTicket(
      workspaceId,
      input.conversationId,
    )
    if (!open.ok) return open

    if (open.value) {
      const ticket = await SdTicketRepository.findById(
        open.value.id,
        workspaceId,
      )
      if (!ticket.ok) return ticket
      const sdContact = await findSdContact(workspaceId, input.contact.waId)
      const mirrored = await mirrorSdWhatsappMessage({
        ticket: ticket.value,
        message: input.message,
        authorKind: 'CONTACT',
        authorContactId: sdContact?.id ?? ticket.value.contactId,
      })
      if (!mirrored.ok) return mirrored
      await SdTicketEngine.touchActivity(ticket.value.id)
      let reopenNotified = false
      if (
        ticket.value.phase.category === 'RESOLVED' &&
        settings.reopenOnRequesterReply
      ) {
        const reopened = await SdTicketEngine.reopen(
          ticket.value,
          sdSystemActor(SOURCE),
          config.value,
        )
        if (!reopened.ok) {
          logger.warn('servicedesk.whatsapp.reopen_failed', {
            workspaceId,
            ticketId: ticket.value.id,
            reason: reopened.error.code,
          })
        } else reopenNotified = true
      }
      // Only a newly mirrored message notifies (webhook retries are no-ops),
      // and never on top of the reopen notice.
      if (mirrored.value && !reopenNotified) {
        await notifySdTicketReply({
          workspaceId,
          ticket: ticket.value,
          channel: 'WHATSAPP',
          body: sdWhatsappMessageBody(input.message.type, input.message.text),
        })
      }
      void fireSdAutomations('MESSAGE_RECEIVED', ticket.value.id)

      // Resposta automática da IA enquanto ninguém assumiu o chamado.
      if (
        settings.aiEnabled &&
        settings.aiWhatsappAutoReply &&
        !ticket.value.assigneeId &&
        !ticket.value.firstRespondedAt
      ) {
        const conversation = await WhatsAppConversationRepository.findByIdRaw(
          input.conversationId,
        )
        if (
          conversation.ok &&
          conversation.value &&
          !conversation.value.aiHandoff
        ) {
          await enqueueSdAiWhatsappReply(input.conversationId, input.message.id)
          return ok('mirrored_ai')
        }
      }
      return ok('mirrored')
    }

    if (settings.aiEnabled && settings.aiPreServiceEnabled) {
      await enqueueSdAiWhatsappReply(input.conversationId, input.message.id)
      return ok('pre_service')
    }

    const opened = await SdWhatsappInboundService.openTicketFromWhatsapp({
      connection: input.connection,
      conversationId: input.conversationId,
      contact: input.contact,
      config: config.value,
      message: input.message,
    })
    if (!opened.ok) return opened
    return ok('ticket_opened')
  },

  /**
   * Mensagem que o atendente mandou direto do celular da conexão (Z-API
   * `fromMe`): entra no chamado aberto como resposta de agente.
   */
  async routeOutboundDevice(input: {
    conversationId: string
    message: WhatsAppMessage
  }): Promise<void> {
    const workspaceId = input.message.workspaceId
    const open = await SdWhatsappRepository.findOpenTicket(
      workspaceId,
      input.conversationId,
    )
    if (!open.ok || !open.value) return
    const ticket = await SdTicketRepository.findById(open.value.id, workspaceId)
    if (!ticket.ok) return
    const mirrored = await mirrorSdWhatsappMessage({
      ticket: ticket.value,
      message: input.message,
      authorKind: 'AGENT',
    })
    if (!mirrored.ok || !mirrored.value) return
    await SdTicketEngine.markFirstResponse(ticket.value.id)
    await SdTicketEngine.touchActivity(ticket.value.id)
  },

  /** Status/mídia/reação de uma mensagem mudou: avisa a aba do chamado. */
  async onMessageUpdated(message: WhatsAppMessage): Promise<void> {
    const ids = await SdWhatsappRepository.listLinkedTicketIds(
      message.conversationId,
    )
    if (!ids.ok || ids.value.length === 0) return
    const ticket = await SdTicketRepository.findByIdUnscoped(ids.value[0])
    if (!ticket.ok) return
    await publishSdTicketMessage(ticket.value)
  },
}
