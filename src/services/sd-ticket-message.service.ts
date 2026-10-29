import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  sdAttachmentNotFound,
  sdMessageForbidden,
  sdMessageNotFound,
  sdTicketForbidden,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { sdNotifyTicketOf } from '@/src/lib/servicedesk/notify'
import {
  sdMessageEditableUntil,
  toSdTicketMessageDTO,
} from '@/src/mappers/sd-ticket-message.mapper'
import { SdNotificationRepository } from '@/src/repositories/sd-notification.repository'
import { SdTicketAttachmentRepository } from '@/src/repositories/sd-ticket-attachment.repository'
import {
  SdTicketMessageRepository,
  type SdTicketMessageWithRelations,
} from '@/src/repositories/sd-ticket-message.repository'
import type {
  CreateSdTicketMessageDTO,
  ListSdTicketMessagesDTO,
  UpdateSdTicketMessageDTO,
} from '@/src/schemas/sd-ticket-message.schema'
import type {
  SdTicketMessageDTO,
  SdTicketMessagePageDTO,
} from '@/types/sd-ticket-message'
import { fireSdAutomations } from './sd-automation-engine'
import { SdMailOutboundService } from './sd-mail-outbound.service'
import { notifySdEvent, type SdNotifyInput } from './sd-notification.service'
import { SdTicketEngine } from './sd-ticket-engine'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'
import {
  loadSdTicketTab,
  publishSdTicketTab,
  type SdTicketTabScope,
  sdTabAuthorKind,
} from './sd-ticket-tab-support'
import { dispatchSteelAgentMentions } from './steel-agent-assignment.service'

/** Prévia do texto na notificação. */
const PREVIEW_LENGTH = 140

function preview(body: string, attachments: number): string {
  const text = body.replace(/\s+/g, ' ').trim()
  if (!text) return `${attachments} anexo(s)`
  return text.length > PREVIEW_LENGTH
    ? `${text.slice(0, PREVIEW_LENGTH - 1)}…`
    : text
}

/**
 * Quem é avisado de uma mensagem sai do catálogo: `ticket.message`
 * (responsável, participantes, seguidores, solicitante e contato) ou
 * `ticket.internal_note` (`agentOnly` — nunca vai ao cliente). O autor
 * nunca. Quem foi citado recebe `ticket.mentioned` à parte.
 */
async function notifyMessage(
  scope: SdTicketTabScope,
  message: SdTicketMessageWithRelations,
): Promise<void> {
  const { ticket, ctx, code } = scope
  const internal = message.visibility === 'INTERNAL'
  const body = preview(message.body, message.attachments.length)
  const notifyTicket = sdNotifyTicketOf(ticket, code)

  await notifyMessageEvent({
    workspaceId: ticket.workspaceId,
    event: internal ? 'ticket.internal_note' : 'ticket.message',
    ticket: notifyTicket,
    actorId: ctx.userId,
    payload: {
      title: internal
        ? `Nova nota interna em ${code}`
        : `Nova mensagem em ${code}`,
      body,
    },
  })

  if (message.mentionedUserIds.length > 0) {
    await notifyMessageEvent({
      workspaceId: ticket.workspaceId,
      event: 'ticket.mentioned',
      ticket: notifyTicket,
      actorId: ctx.userId,
      payload: {
        title: `Você foi citado em ${code}`,
        body,
        userIds: message.mentionedUserIds,
      },
    })
  }
}

/** `notifySdEvent` com o log de falha — notificar nunca derruba o fluxo. */
async function notifyMessageEvent(input: SdNotifyInput): Promise<void> {
  const sent = await notifySdEvent(input)
  if (!sent.ok) {
    logger.warn('servicedesk.message.notify_failed', {
      workspaceId: input.workspaceId,
      ticketId: input.ticket.id,
      event: input.event,
      reason: sent.error.code,
    })
  }
}

/** Resposta do solicitante num chamado RESOLVED reabre (se configurado). */
async function maybeReopen(scope: SdTicketTabScope): Promise<void> {
  const { ctx, ticket, config, actor } = scope
  if (ctx.isAgent) return
  if (ticket.phase.category !== 'RESOLVED') return
  if (!config.settings.reopenOnRequesterReply) return
  const reopened = await SdTicketEngine.reopen(ticket, actor, config)
  if (!reopened.ok) {
    logger.warn('servicedesk.message.reopen_failed', {
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      reason: reopened.error.code,
    })
  }
}

async function loadOwnMessage(
  scope: SdTicketTabScope,
  messageId: string,
): Promise<Result<SdTicketMessageWithRelations>> {
  const message = await SdTicketMessageRepository.findById(
    messageId,
    scope.ticket.id,
  )
  if (!message.ok) return message
  if (!scope.ctx.isAgent && message.value.visibility === 'INTERNAL') {
    return err(sdMessageNotFound())
  }
  const until = sdMessageEditableUntil(message.value, scope.ctx.userId)
  if (!until || until.getTime() <= Date.now()) return err(sdMessageForbidden())
  return message
}

/**
 * Histórico (chat) do chamado. Agentes veem e escrevem notas internas;
 * solicitantes só o que é público. O autor edita/exclui a própria
 * mensagem em até 15 minutos.
 */
export const SdTicketMessageService = {
  async list(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    query: ListSdTicketMessagesDTO,
  ): Promise<Result<SdTicketMessagePageDTO>> {
    const scope = await loadSdTicketTab(actorId, workspaceId, ticketRef, 'VIEW')
    if (!scope.ok) return scope
    const page = await SdTicketMessageRepository.list({
      ticketId: scope.value.ticket.id,
      includeInternal: scope.value.ctx.isAgent,
      before: query.before,
      limit: query.limit,
    })
    if (!page.ok) return page
    const now = new Date()
    const oldest = page.value.items.at(-1)
    return ok({
      items: [...page.value.items]
        .reverse()
        .map((m) => toSdTicketMessageDTO(m, { userId: actorId, now })),
      nextBefore: page.value.hasMore && oldest ? oldest.id : null,
    })
  },

  async create(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    dto: CreateSdTicketMessageDTO,
  ): Promise<Result<SdTicketMessageDTO>> {
    const loaded = await loadSdTicketTab(
      actorId,
      workspaceId,
      ticketRef,
      'CREATE',
      { requireOpen: true },
    )
    if (!loaded.ok) return loaded
    const scope = loaded.value
    const { ctx, ticket } = scope

    if (!ctx.isAgent && dto.visibility === 'INTERNAL') {
      return err(
        sdTicketForbidden('Solicitantes não podem escrever notas internas'),
      )
    }

    const attachmentIds = Array.from(new Set(dto.attachmentIds))
    const pending = await SdTicketAttachmentRepository.findUnattached(
      attachmentIds,
      ticket.id,
    )
    if (!pending.ok) return pending
    if (
      pending.value.length !== attachmentIds.length ||
      pending.value.some((a) => a.uploadedById !== actorId)
    ) {
      return err(sdAttachmentNotFound())
    }

    // Menções: só agentes do workspace, e nunca o próprio autor.
    const mentions = Array.from(new Set(dto.mentionedUserIds ?? [])).filter(
      (id) => id !== actorId,
    )
    let mentionedUserIds: string[] = []
    if (mentions.length > 0) {
      const agents = await SdNotificationRepository.filterAgentIds(
        workspaceId,
        mentions,
      )
      if (!agents.ok) return agents
      mentionedUserIds = agents.value
    }

    const created = await SdTicketMessageRepository.create({
      workspaceId,
      ticketId: ticket.id,
      authorKind: sdTabAuthorKind(ctx),
      authorUserId: actorId,
      visibility: dto.visibility,
      body: dto.body,
      attachmentIds,
      mentionedUserIds,
    })
    if (!created.ok) return created
    const message = created.value
    const internal = message.visibility === 'INTERNAL'

    if (ctx.isAgent && !internal) {
      await SdTicketEngine.markFirstResponse(ticket.id, message.createdAt)
    }
    await SdTicketEngine.touchActivity(ticket.id, message.createdAt)
    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      actorKind: sdTabAuthorKind(ctx),
      actorUserId: actorId,
      action: 'message.posted',
      meta: {
        messageId: message.id,
        visibility: message.visibility,
        attachments: message.attachments.length,
        ...(mentionedUserIds.length > 0
          ? { mentions: mentionedUserIds.length }
          : {}),
      },
    })
    await maybeReopen(scope)
    await notifyMessage(scope, message)
    void dispatchSteelAgentMentions({
      workspaceId,
      actorId,
      event: 'sd.ticket.agent_mentioned',
      agentIds: dto.mentionedAgentIds,
      payload: {
        ticketId: ticket.id,
        code: scope.code,
        title: ticket.title,
        messageId: message.id,
        visibility: message.visibility,
        message: preview(message.body, message.attachments.length),
        authorId: actorId,
      },
    })
    await publishSdTicketTab(ticket, 'ticket.message', actorId, internal)
    if (!internal) {
      void fireSdAutomations('MESSAGE_RECEIVED', ticket.id, { actorId })
      // Chamado que veio por e-mail: a resposta pública do agente volta
      // para quem abriu, pela mesma caixa (fatia do canal de e-mail).
      if (ctx.isAgent) {
        void SdMailOutboundService.sendTicketReply({
          workspaceId,
          ticketId: ticket.id,
          ticketMessageId: message.id,
          body: message.body,
        }).then((sent) => {
          if (!sent.ok) {
            logger.warn('servicedesk.message.mail_reply_failed', {
              workspaceId,
              ticketId: ticket.id,
              reason: sent.error.code,
            })
          }
        })
      }
    }
    auditMutation({
      entity: 'sd_ticket_message',
      action: 'create',
      actorId,
      targetId: message.id,
      meta: {
        workspaceId,
        ticketId: ticket.id,
        visibility: message.visibility,
        attachments: message.attachments.length,
      },
    })
    return ok(toSdTicketMessageDTO(message, { userId: actorId }))
  },

  async update(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    messageId: string,
    dto: UpdateSdTicketMessageDTO,
  ): Promise<Result<SdTicketMessageDTO>> {
    const loaded = await loadSdTicketTab(
      actorId,
      workspaceId,
      ticketRef,
      'EDIT',
      { requireOpen: true },
    )
    if (!loaded.ok) return loaded
    const scope = loaded.value
    const own = await loadOwnMessage(scope, messageId)
    if (!own.ok) return own

    const updated = await SdTicketMessageRepository.updateBody(
      messageId,
      dto.body,
      new Date(),
    )
    if (!updated.ok) return updated
    const internal = updated.value.visibility === 'INTERNAL'
    await recordSdTicketEvent({
      workspaceId,
      ticketId: scope.ticket.id,
      actorKind: sdTabAuthorKind(scope.ctx),
      actorUserId: actorId,
      action: 'message.edited',
      meta: { messageId, visibility: updated.value.visibility },
    })
    await publishSdTicketTab(scope.ticket, 'ticket.message', actorId, internal)
    auditMutation({
      entity: 'sd_ticket_message',
      action: 'update',
      actorId,
      targetId: messageId,
      meta: { workspaceId, ticketId: scope.ticket.id },
    })
    return ok(toSdTicketMessageDTO(updated.value, { userId: actorId }))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    messageId: string,
  ): Promise<Result<void>> {
    const loaded = await loadSdTicketTab(
      actorId,
      workspaceId,
      ticketRef,
      'EDIT',
      { requireOpen: true },
    )
    if (!loaded.ok) return loaded
    const scope = loaded.value
    const own = await loadOwnMessage(scope, messageId)
    if (!own.ok) return own

    const removed = await SdTicketMessageRepository.softDelete(
      messageId,
      new Date(),
    )
    if (!removed.ok) return removed
    const internal = own.value.visibility === 'INTERNAL'
    await recordSdTicketEvent({
      workspaceId,
      ticketId: scope.ticket.id,
      actorKind: sdTabAuthorKind(scope.ctx),
      actorUserId: actorId,
      action: 'message.deleted',
      meta: { messageId, visibility: own.value.visibility },
    })
    await publishSdTicketTab(scope.ticket, 'ticket.message', actorId, internal)
    auditMutation({
      entity: 'sd_ticket_message',
      action: 'delete',
      actorId,
      targetId: messageId,
      meta: { workspaceId, ticketId: scope.ticket.id },
    })
    return ok(undefined)
  },
}
