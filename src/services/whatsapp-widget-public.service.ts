import { randomUUID } from 'node:crypto'
import type {
  WhatsAppConnection,
  WhatsAppWidgetSettings,
  WhatsAppWidgetVisitor,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { baseEmailUrl } from '@/lib/base-email-url'
import {
  validationError,
  widgetNotAvailable,
  widgetOriginNotAllowed,
  widgetVisitorInvalid,
} from '@/src/errors'
import { consume, widgetSendLimiter, widgetSessionLimiter } from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import {
  generateVisitorToken,
  hashVisitorToken,
  isOriginAllowed,
  WIDGET_OFFLINE_NOTICE_HOURS,
  WIDGET_POLL_LIMIT,
  widgetWaId,
} from '@/src/lib/whatsapp/widget'
import {
  toWidgetMessageDTO,
  toWidgetPublicConfigDTO,
  toWidgetSurveyDTO,
} from '@/src/mappers/whatsapp-widget.mapper'
import { SatisfactionSurveyRepository } from '@/src/repositories/satisfaction-survey.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  WhatsAppWidgetSettingsRepository,
  WhatsAppWidgetVisitorRepository,
} from '@/src/repositories/whatsapp-widget.repository'
import type {
  WidgetSendMessageDTO,
  WidgetSurveyAnswerDTO,
} from '@/src/schemas/whatsapp-widget.schema'
import type {
  WidgetConversationStateDTO,
  WidgetMessagesDTO,
  WidgetPublicConfigDTO,
  WidgetSendResultDTO,
} from '@/types/whatsapp-widget'
import { SatisfactionSurveyService } from './satisfaction-survey.service'
import { WhatsAppBusinessHoursService } from './whatsapp-business-hours.service'
import { WhatsAppWebhookService } from './whatsapp-webhook.service'

const HOUR_MS = 60 * 60 * 1000

/** Resolved by `authorize`: the widget of a public key, for an allowed origin. */
export interface WidgetContext {
  settings: WhatsAppWidgetSettings
  connection: WhatsAppConnection
  workspaceId: string
}

function describeVisitor(
  visitor: { name?: string | null; email?: string | null; phone?: string | null },
  origin: string | null,
  pageUrl: string | undefined,
): string {
  const parts = [
    visitor.email ? `E-mail: ${visitor.email}` : null,
    visitor.phone ? `Telefone: ${visitor.phone}` : null,
    pageUrl ? `Página: ${pageUrl}` : origin ? `Site: ${origin}` : null,
  ].filter(Boolean)
  return `Chat do site${parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}`.slice(
    0,
    500,
  )
}

async function loadVisitor(
  ctx: WidgetContext,
  token: string | null,
): Promise<Result<WhatsAppWidgetVisitor | null>> {
  if (!token) return ok(null)
  const found = await WhatsAppWidgetVisitorRepository.findByTokenHash(
    hashVisitorToken(token),
  )
  if (!found.ok) return found
  // A token of another workspace is just an unknown token.
  if (!found.value || found.value.workspaceId !== ctx.workspaceId) return ok(null)
  return ok(found.value)
}

/**
 * Public side of the site chat widget (E1): no session. Every call is tied
 * to a public key and to the `Origin` of the browser, which must be on the
 * workspace's allowed list. The visitor is identified by a random token kept
 * in the site's own cookie; only its hash is stored.
 */
export const WhatsAppWidgetPublicService = {
  /** Key + origin check. Failures never say which of the two was wrong. */
  async authorize(
    key: string,
    origin: string | null,
  ): Promise<Result<WidgetContext>> {
    const settings = await WhatsAppWidgetSettingsRepository.findByPublicKey(key)
    if (!settings.ok) return settings
    if (
      !settings.value ||
      !settings.value.enabled ||
      !settings.value.connectionId
    ) {
      return err(widgetNotAvailable())
    }
    if (!isOriginAllowed(origin, settings.value.allowedOrigins)) {
      return err(widgetOriginNotAllowed())
    }
    const connection = await WhatsAppWidgetSettingsRepository.findConnection(
      settings.value.connectionId,
      settings.value.workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(widgetNotAvailable())
    return ok({
      settings: settings.value,
      connection: connection.value,
      workspaceId: settings.value.workspaceId,
    })
  },

  async getConfig(ctx: WidgetContext): Promise<Result<WidgetPublicConfigDTO>> {
    const hours = await WhatsAppBusinessHoursService.check(ctx.workspaceId)
    // A failure reading the hours must not take the chat down: show it online.
    const online = hours.ok ? hours.value.open : true
    return ok(toWidgetPublicConfigDTO(ctx.settings, online, baseEmailUrl))
  },

  /** Conversation of the visitor: new messages since `after`, state and survey. */
  async listMessages(
    ctx: WidgetContext,
    token: string | null,
    after: Date | null,
  ): Promise<Result<WidgetMessagesDTO>> {
    const empty: WidgetMessagesDTO = {
      messages: [],
      conversation: 'NONE',
      survey: null,
    }
    const visitor = await loadVisitor(ctx, token)
    if (!visitor.ok) return visitor
    if (!visitor.value) return ok(empty)

    const conversation = await WhatsAppWidgetVisitorRepository.findConversation(
      ctx.workspaceId,
      visitor.value.contactId,
      ctx.connection.id,
    )
    if (!conversation.ok) return conversation
    if (!conversation.value) return ok(empty)

    const rows = await WhatsAppWidgetVisitorRepository.listMessages(
      conversation.value.id,
      after,
      WIDGET_POLL_LIMIT,
    )
    if (!rows.ok) return rows

    const state: WidgetConversationStateDTO =
      conversation.value.status === 'CLOSED' ? 'CLOSED' : 'OPEN'

    let survey: WidgetMessagesDTO['survey'] = null
    if (ctx.settings.showSurvey && state === 'CLOSED') {
      const contact = await WhatsAppContactRepository.findById(
        visitor.value.contactId,
        ctx.workspaceId,
      )
      if (contact.ok && contact.value) {
        const open = await SatisfactionSurveyRepository.findOpenByPhone(
          ctx.workspaceId,
          contact.value.waId,
          new Date(),
        )
        if (open.ok && open.value) survey = toWidgetSurveyDTO(open.value.kind)
      }
    }

    return ok({
      messages: rows.value.map(toWidgetMessageDTO),
      conversation: state,
      survey,
    })
  },

  /**
   * The visitor writes. The first message creates the visitor (and the zap
   * contact); from then on the message goes through the same inbound
   * pipeline as WhatsApp (queue, team, SLA, chatbot, AI auto-reply).
   */
  async sendMessage(
    ctx: WidgetContext,
    token: string | null,
    dto: WidgetSendMessageDTO,
    meta: { ip: string; origin: string | null },
  ): Promise<Result<WidgetSendResultDTO>> {
    // Honeypot: pretend it worked.
    if (dto.website) return ok({ token: null })

    const known = await loadVisitor(ctx, token)
    if (!known.ok) return known

    let visitor = known.value
    let issuedToken: string | null = null

    if (!visitor) {
      const limit = await consume(widgetSessionLimiter, `ip:${meta.ip}`)
      if (!limit.ok) return limit

      const { settings } = ctx
      if (
        settings.preChatEnabled &&
        (!dto.name ||
          (settings.preChatAskEmail && !dto.email) ||
          (settings.preChatAskPhone && !dto.phone))
      ) {
        return err(validationError('Preencha seus dados para iniciar o chat'))
      }

      const contact = await WhatsAppContactRepository.upsertByWaId({
        workspaceId: ctx.workspaceId,
        waId: widgetWaId(randomUUID()),
        name: dto.name ?? 'Visitante do site',
      })
      if (!contact.ok) return contact

      issuedToken = generateVisitorToken()
      const created = await WhatsAppWidgetVisitorRepository.create({
        workspaceId: ctx.workspaceId,
        contactId: contact.value.id,
        tokenHash: hashVisitorToken(issuedToken),
        name: dto.name ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        origin: meta.origin,
      })
      if (!created.ok) return created
      visitor = created.value

      const described = await WhatsAppWidgetVisitorRepository.setContactDescription(
        contact.value.id,
        describeVisitor(visitor, meta.origin, dto.pageUrl),
      )
      if (!described.ok) {
        logger.warn('whatsapp.widget.describe_failed', {
          workspaceId: ctx.workspaceId,
          reason: described.error.code,
        })
      }
    }

    const sendLimit = await consume(widgetSendLimiter, `visitor:${visitor.id}`)
    if (!sendLimit.ok) return sendLimit

    const contact = await WhatsAppContactRepository.findById(
      visitor.contactId,
      ctx.workspaceId,
    )
    if (!contact.ok) return contact
    if (!contact.value) return err(widgetVisitorInvalid())

    // A team deleted after the setting was saved falls back to the queue.
    let routeTeamId: string | undefined
    if (ctx.settings.teamId) {
      const team = await WhatsAppWidgetSettingsRepository.teamExists(
        ctx.workspaceId,
        ctx.settings.teamId,
      )
      if (team.ok && team.value) routeTeamId = ctx.settings.teamId
    }

    const ingested = await WhatsAppWebhookService.ingestInboundMessage({
      connection: ctx.connection,
      waId: contact.value.waId,
      contactName: contact.value.name ?? undefined,
      providerMessageId: `widget:in:${randomUUID()}`,
      type: 'TEXT',
      text: dto.text,
      routeTeamId,
    })
    if (!ingested.ok) return ingested

    void WhatsAppWidgetVisitorRepository.update(visitor.id, {
      lastSeenAt: new Date(),
    })

    await sendOfflineNotice(ctx, visitor)

    return ok({ token: issuedToken })
  },

  /** The visitor rates the attendance (the open survey of the zap). */
  async answerSurvey(
    ctx: WidgetContext,
    token: string | null,
    dto: WidgetSurveyAnswerDTO,
  ): Promise<Result<{ answered: true }>> {
    if (!ctx.settings.showSurvey) return err(widgetNotAvailable())
    const visitor = await loadVisitor(ctx, token)
    if (!visitor.ok) return visitor
    if (!visitor.value) return err(widgetVisitorInvalid())

    const contact = await WhatsAppContactRepository.findById(
      visitor.value.contactId,
      ctx.workspaceId,
    )
    if (!contact.ok) return contact
    if (!contact.value) return err(widgetVisitorInvalid())

    const scored = await SatisfactionSurveyService.handleInbound({
      workspaceId: ctx.workspaceId,
      waId: contact.value.waId,
      type: 'TEXT',
      text: String(dto.score),
    })
    if (!scored.ok) return scored
    if (!scored.value.handled) {
      return err(validationError('Esta pesquisa não está mais aberta'))
    }
    if (dto.comment) {
      await SatisfactionSurveyService.handleInbound({
        workspaceId: ctx.workspaceId,
        waId: contact.value.waId,
        type: 'TEXT',
        text: dto.comment,
      })
    }
    return ok({ answered: true })
  },
}

/**
 * Outside the business hours the visitor gets the configured notice on the
 * conversation (once per window), written as an outbound message so the
 * agents see it on the timeline too.
 */
async function sendOfflineNotice(
  ctx: WidgetContext,
  visitor: WhatsAppWidgetVisitor,
): Promise<void> {
  const { settings } = ctx
  if (!settings.offlineEnabled) return
  const hours = await WhatsAppBusinessHoursService.check(ctx.workspaceId)
  if (!hours.ok || hours.value.open) return

  const conversation = await WhatsAppWidgetVisitorRepository.findConversation(
    ctx.workspaceId,
    visitor.contactId,
    ctx.connection.id,
  )
  if (!conversation.ok || !conversation.value) return

  const already = await WhatsAppWidgetVisitorRepository.hasOutboundText(
    conversation.value.id,
    settings.offlineMessage,
    new Date(Date.now() - WIDGET_OFFLINE_NOTICE_HOURS * HOUR_MS),
  )
  if (!already.ok || already.value) return

  const created = await WhatsAppMessageRepository.create({
    workspaceId: ctx.workspaceId,
    conversationId: conversation.value.id,
    direction: 'OUT',
    type: 'TEXT',
    text: settings.offlineMessage,
    providerMessageId: `widget:out:${randomUUID()}`,
    status: 'SENT',
  })
  if (!created.ok) {
    logger.warn('whatsapp.widget.offline_notice_failed', {
      workspaceId: ctx.workspaceId,
      reason: created.error.code,
    })
  }
}
