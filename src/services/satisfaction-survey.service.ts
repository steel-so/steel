import { randomBytes } from 'node:crypto'
import type {
  SatisfactionSurvey,
  SatisfactionSurveyConfig,
  SatisfactionSurveyKind,
  SatisfactionSurveyTrigger,
  WhatsAppConnection,
  WhatsAppConversation,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { baseEmailUrl } from '@/lib/base-email-url'
import {
  surveyAlreadyAnswered,
  surveyExpired,
  surveyInvalidScore,
  surveyNoRecipient,
  surveyNotFound,
} from '@/src/errors'
import { SatisfactionSurveyJob } from '@/src/lib/queue/jobs'
import { getSatisfactionSurveyQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  buildSurveyPayload,
  DEFAULT_SURVEY_THANK_YOU,
  isDetractorScore,
  isScoreInScale,
  parseSurveyPayload,
  parseTypedScore,
  SURVEY_BUTTONS,
  SURVEY_COMMENT_MAX,
  SURVEY_COMMENT_WINDOW_MINUTES,
  SURVEY_SCALES,
  surveyEmailQuestion,
  surveyQuestion,
} from '@/src/lib/survey/scale'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  buildSurveyReport,
  toSurveyConfigDTO,
  toSurveyDTO,
} from '@/src/mappers/satisfaction-survey.mapper'
import { SatisfactionSurveyRepository } from '@/src/repositories/satisfaction-survey.repository'
import type { SdTicketWithRelations } from '@/src/repositories/sd-ticket.repository'
import { SdTicketCsatRepository } from '@/src/repositories/sd-ticket-csat.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type {
  AnswerSurveyDTO,
  SendSurveyDTO,
  SurveyListQueryDTO,
  SurveyReportQueryDTO,
  UpdateSurveyConfigDTO,
} from '@/src/schemas/satisfaction-survey.schema'
import type {
  PublicSurveyDTO,
  SurveyConfigDTO,
  SurveyDTO,
  SurveyListDTO,
  SurveyReportDTO,
} from '@/types/satisfaction-survey'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { notifyWhatsAppUsers, whatsAppAdminIds } from './whatsapp-notify'

const CONFIG_TRIGGERS: SurveyConfigDTO['trigger'][] = [
  'CONVERSATION_CLOSED',
  'TICKET_RESOLVED',
]
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

interface Recipient {
  phone?: string | null
  email?: string | null
  name?: string | null
  connectionId?: string | null
}

interface Subject {
  conversationId?: string | null
  ticketId?: string | null
  customerKey?: string | null
  customerName?: string | null
  assigneeUserId?: string | null
  assigneeName?: string | null
  teamId?: string | null
  teamName?: string | null
}

function newToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Schedules one invitation: applies the recipient cooldown, picks the channel
 * (WhatsApp when there is a connection and a phone, otherwise e-mail), stores
 * the survey and queues the delayed delivery. `null` = nothing to send.
 */
async function schedule(input: {
  workspaceId: string
  trigger: SatisfactionSurveyTrigger
  kind: SatisfactionSurveyKind
  config: SatisfactionSurveyConfig | null
  recipient: Recipient
  subject: Subject
  delayMinutes: number
  expiresInHours: number
  cooldownDays: number
}): Promise<Result<SatisfactionSurvey | null>> {
  const { recipient } = input
  const whatsapp = Boolean(recipient.phone && recipient.connectionId)
  if (!whatsapp && !recipient.email) return ok(null)

  if (input.cooldownDays > 0) {
    const since = new Date(Date.now() - input.cooldownDays * DAY_MS)
    const recent = await SatisfactionSurveyRepository.existsRecentForRecipient(
      input.workspaceId,
      recipient,
      since,
    )
    if (!recent.ok) return recent
    if (recent.value) return ok(null)
  }

  const scheduledFor = new Date(Date.now() + input.delayMinutes * MINUTE_MS)
  const created = await SatisfactionSurveyRepository.create({
    workspaceId: input.workspaceId,
    configId: input.config?.id ?? null,
    kind: input.kind,
    trigger: input.trigger,
    channel: whatsapp ? 'WHATSAPP' : 'EMAIL',
    status: 'SCHEDULED',
    token: newToken(),
    conversationId: input.subject.conversationId ?? null,
    ticketId: input.subject.ticketId ?? null,
    connectionId: recipient.connectionId ?? null,
    recipientPhone: recipient.phone ?? null,
    recipientEmail: recipient.email ?? null,
    recipientName: recipient.name ?? null,
    customerKey: input.subject.customerKey ?? null,
    customerName: input.subject.customerName ?? null,
    assigneeUserId: input.subject.assigneeUserId ?? null,
    assigneeName: input.subject.assigneeName ?? null,
    teamId: input.subject.teamId ?? null,
    teamName: input.subject.teamName ?? null,
    scheduledFor,
    expiresAt: new Date(
      scheduledFor.getTime() + input.expiresInHours * HOUR_MS,
    ),
  })
  if (!created.ok) return created

  try {
    await getSatisfactionSurveyQueue().add(
      SatisfactionSurveyJob.DeliverSurvey,
      { surveyId: created.value.id },
      {
        delay: Math.max(0, scheduledFor.getTime() - Date.now()),
        // One delivery per survey, even if scheduled twice.
        jobId: `survey-${created.value.id}`,
      },
    )
  } catch (error) {
    logger.error('satisfaction_survey.enqueue_failed', {
      workspaceId: input.workspaceId,
      surveyId: created.value.id,
      cause: error instanceof Error ? error.message : String(error),
    })
    await SatisfactionSurveyRepository.update(created.value.id, {
      status: 'FAILED',
      failureReason: 'queue_unavailable',
    })
    return ok(null)
  }
  return created
}

async function userName(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const user = await UserRepository.findById(userId)
  return user.ok ? user.value.name : null
}

async function teamName(
  workspaceId: string,
  teamId: string | null,
): Promise<string | null> {
  if (!teamId) return null
  const team = await WhatsAppTeamRepository.findById(teamId, workspaceId)
  return team.ok && team.value ? team.value.name : null
}

async function loadConnection(
  survey: SatisfactionSurvey,
): Promise<WhatsAppConnection | null> {
  if (!survey.connectionId) return null
  const found = await WhatsAppConnectionRepository.findById(
    survey.connectionId,
    survey.workspaceId,
  )
  return found.ok ? found.value : null
}

async function sendWhatsApp(
  survey: SatisfactionSurvey,
  connection: WhatsAppConnection,
  question: string,
): Promise<Result<string>> {
  const to = survey.recipientPhone as string
  const buttons = SURVEY_BUTTONS[survey.kind]
  const sent =
    buttons.length > 0
      ? await WhatsAppSend.buttons(connection, {
          to,
          text: question,
          buttons: buttons.map((b) => ({
            type: 'REPLY' as const,
            id: buildSurveyPayload(survey.id, b.score),
            label: b.label,
          })),
        })
      : await WhatsAppSend.text(connection, { to, text: question })
  if (!sent.ok) return sent
  return ok(sent.value.providerMessageId)
}

function emailOptions(survey: SatisfactionSurvey) {
  const page = `${baseEmailUrl}/pesquisa/${survey.token}`
  const scale = SURVEY_SCALES[survey.kind]
  const options = []
  for (let n = scale.min; n <= scale.max; n++) {
    options.push({ label: String(n), url: `${page}?nota=${n}` })
  }
  return { page, options }
}

async function sendEmail(
  survey: SatisfactionSurvey,
  workspaceName: string,
  question: string,
): Promise<Result<void>> {
  if (!survey.recipientEmail) return err(surveyNoRecipient())
  const { page, options } = emailOptions(survey)
  try {
    // Loaded on demand: the ticket engine imports this service, and the mail
    // stack (env, Resend) must not ride along on every engine import.
    const { sendSurveyInvitationEmail } = await import(
      '@/src/lib/mail/survey/send-survey-invitation'
    )
    await sendSurveyInvitationEmail({
      email: survey.recipientEmail,
      recipientName: survey.recipientName,
      workspaceName,
      question,
      surveyUrl: page,
      options,
    })
    return ok(undefined)
  } catch (error) {
    logger.warn('satisfaction_survey.email_failed', {
      workspaceId: survey.workspaceId,
      surveyId: survey.id,
      cause: error instanceof Error ? error.message : String(error),
    })
    return err(surveyNoRecipient('Falha ao enviar o e-mail da pesquisa'))
  }
}

export const SatisfactionSurveyService = {
  // ── Admin (settings, list, report, manual send) ─────────────────────────

  async listConfigs(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SurveyConfigDTO[]>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) return access
    const rows = await SatisfactionSurveyRepository.listConfigs(workspaceId)
    if (!rows.ok) return rows
    return ok(
      CONFIG_TRIGGERS.map((trigger) =>
        toSurveyConfigDTO(
          trigger,
          rows.value.find((r) => r.trigger === trigger) ?? null,
        ),
      ),
    )
  },

  async updateConfig(
    actorId: string,
    workspaceId: string,
    trigger: SurveyConfigDTO['trigger'],
    dto: UpdateSurveyConfigDTO,
  ): Promise<Result<SurveyConfigDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const data = {
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.delayMinutes !== undefined
        ? { delayMinutes: dto.delayMinutes }
        : {}),
      ...(dto.expiresInHours !== undefined
        ? { expiresInHours: dto.expiresInHours }
        : {}),
      ...(dto.cooldownDays !== undefined
        ? { cooldownDays: dto.cooldownDays }
        : {}),
      ...(dto.emailFallback !== undefined
        ? { emailFallback: dto.emailFallback }
        : {}),
      ...(dto.alertDetractors !== undefined
        ? { alertDetractors: dto.alertDetractors }
        : {}),
      ...(dto.detractorMaxScore !== undefined
        ? { detractorMaxScore: dto.detractorMaxScore }
        : {}),
      ...(dto.questionText !== undefined
        ? { questionText: dto.questionText || null }
        : {}),
      ...(dto.thankYouText !== undefined
        ? { thankYouText: dto.thankYouText || null }
        : {}),
    }
    const saved = await SatisfactionSurveyRepository.upsertConfig(
      workspaceId,
      trigger,
      data,
    )
    if (!saved.ok) {
      auditMutation({
        entity: 'satisfaction_survey_config',
        action: 'update',
        actorId,
        outcome: 'failure',
        reason: saved.error.code,
        meta: { workspaceId, trigger },
      })
      return saved
    }
    auditMutation({
      entity: 'satisfaction_survey_config',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        trigger,
        enabled: saved.value.enabled,
        kind: saved.value.kind,
        alertDetractors: saved.value.alertDetractors,
        detractorMaxScore: saved.value.detractorMaxScore,
      },
    })
    return ok(toSurveyConfigDTO(trigger, saved.value))
  },

  async list(
    actorId: string,
    workspaceId: string,
    query: SurveyListQueryDTO,
  ): Promise<Result<SurveyListDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) return access
    const page = await SatisfactionSurveyRepository.list(
      workspaceId,
      { kind: query.kind, status: query.status },
      query.page,
      query.pageSize,
    )
    if (!page.ok) return page
    return ok({
      items: page.value.items.map(toSurveyDTO),
      total: page.value.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  },

  async report(
    actorId: string,
    workspaceId: string,
    query: SurveyReportQueryDTO,
  ): Promise<Result<SurveyReportDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) return access
    const rows = await SatisfactionSurveyRepository.reportRows(
      workspaceId,
      query.kind,
      query.from ?? null,
      query.to ?? null,
    )
    if (!rows.ok) return rows
    return ok(
      buildSurveyReport({
        kind: query.kind,
        groupBy: query.groupBy,
        rows: rows.value,
        from: query.from ?? null,
        to: query.to ?? null,
      }),
    )
  },

  /** Post-sale / ad-hoc send to a WhatsApp contact or an e-mail address. */
  async sendManual(
    actorId: string,
    workspaceId: string,
    dto: SendSurveyDTO,
  ): Promise<Result<SurveyDTO>> {
    const access = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'EDIT' },
    )
    if (!access.ok) return access

    const recipient: Recipient = {
      email: dto.email ?? null,
      name: dto.recipientName ?? null,
    }
    if (dto.whatsappContactId) {
      const contact = await WhatsAppContactRepository.findById(
        dto.whatsappContactId,
        workspaceId,
      )
      if (!contact.ok) return contact
      if (!contact.value) return err(surveyNotFound())
      const connections =
        await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
      if (!connections.ok) return connections
      const connection = connections.value.find((c) => c.status === 'CONNECTED')
      if (connection && !contact.value.broadcastOptedOutAt) {
        recipient.phone = contact.value.waId
        recipient.connectionId = connection.id
      }
      recipient.name = recipient.name ?? contact.value.name
    }

    const [config, actorName] = await Promise.all([
      SatisfactionSurveyRepository.findConfig(workspaceId, 'MANUAL'),
      userName(actorId),
    ])
    const created = await schedule({
      workspaceId,
      trigger: 'MANUAL',
      kind: dto.kind,
      config: config.ok ? config.value : null,
      recipient,
      subject: {
        customerKey: dto.whatsappContactId
          ? `contact:${dto.whatsappContactId}`
          : dto.email
            ? `email:${dto.email}`
            : null,
        customerName: dto.customerName ?? recipient.name ?? null,
        assigneeUserId: actorId,
        assigneeName: actorName,
      },
      delayMinutes: 0,
      expiresInHours: 72,
      cooldownDays: 0,
    })
    if (!created.ok) return created
    if (!created.value) return err(surveyNoRecipient())

    auditMutation({
      entity: 'satisfaction_survey',
      action: 'send',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, kind: dto.kind, channel: created.value.channel },
    })
    return ok(toSurveyDTO(created.value))
  },

  // ── Triggers (system) ───────────────────────────────────────────────────

  /**
   * A zap conversation was closed: invites the contact when the rule is on.
   * Never throws; a failure is logged and the close goes on.
   */
  async onConversationClosed(
    conversation: Pick<
      WhatsAppConversation,
      | 'id'
      | 'workspaceId'
      | 'connectionId'
      | 'contactId'
      | 'assignedUserId'
      | 'teamId'
      | 'firstInboundAt'
    >,
  ): Promise<Result<SatisfactionSurvey | null>> {
    const { workspaceId } = conversation
    const config = await SatisfactionSurveyRepository.findConfig(
      workspaceId,
      'CONVERSATION_CLOSED',
    )
    if (!config.ok) return config
    if (!config.value?.enabled) return ok(null)
    // The contact never wrote (broadcast only): nothing was attended.
    if (!conversation.firstInboundAt) return ok(null)

    const connection = await WhatsAppConnectionRepository.findById(
      conversation.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    // ServiceDesk chats are surveyed through their ticket.
    if (connection.value?.module !== 'COMMUNICATION') {
      return ok(null)
    }
    const contact = await WhatsAppContactRepository.findById(
      conversation.contactId,
      workspaceId,
    )
    if (!contact.ok) return contact
    if (!contact.value || contact.value.broadcastOptedOutAt) return ok(null)

    const [assigneeName, team] = await Promise.all([
      userName(conversation.assignedUserId),
      teamName(workspaceId, conversation.teamId),
    ])
    return schedule({
      workspaceId,
      trigger: 'CONVERSATION_CLOSED',
      kind: config.value.kind,
      config: config.value,
      recipient: {
        phone: contact.value.waId,
        name: contact.value.name,
        connectionId: connection.value.id,
      },
      subject: {
        conversationId: conversation.id,
        customerKey: `contact:${contact.value.id}`,
        customerName: contact.value.name ?? contact.value.waId,
        assigneeUserId: conversation.assignedUserId,
        assigneeName,
        teamId: conversation.teamId,
        teamName: team,
      },
      delayMinutes: config.value.delayMinutes,
      expiresInHours: config.value.expiresInHours,
      cooldownDays: config.value.cooldownDays,
    })
  },

  /**
   * A ServiceDesk ticket reached RESOLVED/CLOSED: invites the requester over
   * the ticket's WhatsApp chat when it has one, else by e-mail. Tickets that
   * already carry a CSAT (portal) are left alone.
   */
  async onTicketResolved(
    ticket: SdTicketWithRelations,
  ): Promise<Result<SatisfactionSurvey | null>> {
    const { workspaceId } = ticket
    const config = await SatisfactionSurveyRepository.findConfig(
      workspaceId,
      'TICKET_RESOLVED',
    )
    if (!config.ok) return config
    if (!config.value?.enabled) return ok(null)
    if (ticket.csatScore !== null) return ok(null)

    const existing = await SatisfactionSurveyRepository.existsForTicket(
      ticket.id,
    )
    if (!existing.ok) return existing
    if (existing.value) return ok(null)

    const recipient: Recipient = {
      email: ticket.contact?.email ?? ticket.requester?.email ?? null,
      name: ticket.contact?.name ?? ticket.requester?.name ?? null,
    }
    if (ticket.whatsappConversationId) {
      const conversation =
        await WhatsAppConversationRepository.findByIdWithConnection(
          ticket.whatsappConversationId,
        )
      if (!conversation.ok) return conversation
      if (
        conversation.value &&
        conversation.value.workspaceId === workspaceId
      ) {
        const contact = await WhatsAppContactRepository.findById(
          conversation.value.contactId,
          workspaceId,
        )
        if (!contact.ok) return contact
        if (contact.value && !contact.value.broadcastOptedOutAt) {
          recipient.phone = contact.value.waId
          recipient.connectionId = conversation.value.connectionId
          recipient.name = recipient.name ?? contact.value.name
        }
      }
    }
    // E-mail is only a fallback of WhatsApp unless it is the sole channel.
    const customer = ticket.company ?? ticket.customer
    return schedule({
      workspaceId,
      trigger: 'TICKET_RESOLVED',
      kind: config.value.kind,
      config: config.value,
      recipient: config.value.emailFallback
        ? recipient
        : { ...recipient, email: recipient.phone ? null : recipient.email },
      subject: {
        ticketId: ticket.id,
        conversationId: ticket.whatsappConversationId,
        customerKey: customer
          ? `customer:${customer.id}`
          : ticket.contact
            ? `contact:${ticket.contact.id}`
            : null,
        customerName: customer?.tradeName ?? customer?.name ?? recipient.name,
        assigneeUserId: ticket.assignee?.id ?? null,
        assigneeName: ticket.assignee?.name ?? null,
        teamId: ticket.department?.id ?? null,
        teamName: ticket.department?.name ?? null,
      },
      delayMinutes: config.value.delayMinutes,
      expiresInHours: config.value.expiresInHours,
      cooldownDays: config.value.cooldownDays,
    })
  },

  // ── Delivery (worker) ───────────────────────────────────────────────────

  /**
   * Sends a scheduled invitation. WhatsApp failures fall back to e-mail when
   * the rule allows and an address is known; anything else marks the survey
   * FAILED (kept for the report of what was sent). A database failure is the
   * only error (the job retries).
   */
  async deliver(
    surveyId: string,
  ): Promise<Result<'sent' | 'fallback_email' | 'skipped' | 'failed'>> {
    const found = await SatisfactionSurveyRepository.findById(surveyId)
    if (!found.ok) return found
    const survey = found.value
    if (survey?.status !== 'SCHEDULED') return ok('skipped')

    const skip = async (reason: string) => {
      const updated = await SatisfactionSurveyRepository.update(survey.id, {
        status: 'SKIPPED',
        failureReason: reason,
      })
      return updated.ok ? ok('skipped' as const) : updated
    }

    if (survey.expiresAt.getTime() <= Date.now()) return skip('expired')
    if (survey.ticketId) {
      const score = await SdTicketCsatRepository.findScore(
        survey.ticketId,
        survey.workspaceId,
      )
      if (!score.ok) return score
      if (score.value !== null) return skip('already_rated')
    }

    const config = await SatisfactionSurveyRepository.findConfig(
      survey.workspaceId,
      survey.trigger,
    )
    if (!config.ok) return config
    const custom = config.value?.questionText
    const fallback = config.value?.emailFallback ?? true

    const fail = async (reason: string) => {
      const updated = await SatisfactionSurveyRepository.update(survey.id, {
        status: 'FAILED',
        failureReason: reason,
      })
      if (!updated.ok) return updated
      logger.warn('satisfaction_survey.delivery_failed', {
        workspaceId: survey.workspaceId,
        surveyId: survey.id,
        reason,
      })
      return ok('failed' as const)
    }

    const workspaceName = await workspaceNameOf(survey.workspaceId)
    const viaEmail = async (outcome: 'sent' | 'fallback_email') => {
      const sent = await sendEmail(
        survey,
        workspaceName,
        surveyEmailQuestion(survey.kind, custom),
      )
      if (!sent.ok) return fail(sent.error.code)
      const updated = await SatisfactionSurveyRepository.update(survey.id, {
        channel: 'EMAIL',
        status: 'SENT',
        sentAt: new Date(),
      })
      return updated.ok ? ok(outcome) : updated
    }

    if (survey.channel === 'EMAIL') return viaEmail('sent')

    const connection = await loadConnection(survey)
    let reason = 'connection_unavailable'
    if (connection && connection.status === 'CONNECTED') {
      const sent = await sendWhatsApp(
        survey,
        connection,
        surveyQuestion(survey.kind, custom),
      )
      if (sent.ok) {
        const updated = await SatisfactionSurveyRepository.update(survey.id, {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: sent.value,
        })
        return updated.ok ? ok('sent') : updated
      }
      reason = sent.error.code
    }
    if (fallback && survey.recipientEmail) return viaEmail('fallback_email')
    return fail(reason)
  },

  // ── Answers ─────────────────────────────────────────────────────────────

  /**
   * Inbound WhatsApp message of a contact. Returns `handled: true` when it was
   * a survey answer (button click, typed score, or the comment that follows),
   * so the webhook does not open or reopen a conversation for it.
   */
  async handleInbound(input: {
    workspaceId: string
    waId: string
    type: string
    text?: string | null
    buttonPayload?: string | null
  }): Promise<Result<{ handled: boolean }>> {
    const now = new Date()
    const clicked = parseSurveyPayload(input.buttonPayload)
    if (input.type === 'BUTTON' && clicked) {
      const survey = await SatisfactionSurveyRepository.findById(
        clicked.surveyId,
        input.workspaceId,
      )
      if (!survey.ok) return survey
      // A payload that is not ours / not this contact's is just a message.
      if (!survey.value || survey.value.recipientPhone !== input.waId) {
        return ok({ handled: false })
      }
      const recorded = await recordAnswer(survey.value, clicked.score, now)
      if (!recorded.ok) return recorded
      return ok({ handled: true })
    }

    if (input.type !== 'TEXT' || !input.text?.trim()) {
      return ok({ handled: false })
    }

    const open = await SatisfactionSurveyRepository.findOpenByPhone(
      input.workspaceId,
      input.waId,
      now,
    )
    if (!open.ok) return open
    if (open.value) {
      const score = parseTypedScore(input.text)
      if (score === null || !isScoreInScale(open.value.kind, score)) {
        return ok({ handled: false })
      }
      const recorded = await recordAnswer(open.value, score, now)
      if (!recorded.ok) return recorded
      return ok({ handled: true })
    }

    const awaiting = await SatisfactionSurveyRepository.findAwaitingComment(
      input.workspaceId,
      input.waId,
      new Date(now.getTime() - SURVEY_COMMENT_WINDOW_MINUTES * MINUTE_MS),
    )
    if (!awaiting.ok) return awaiting
    if (!awaiting.value) return ok({ handled: false })

    const comment = input.text.trim().slice(0, SURVEY_COMMENT_MAX)
    const saved = await SatisfactionSurveyRepository.setComment(
      awaiting.value.id,
      comment,
    )
    if (!saved.ok) return saved
    if (saved.value && awaiting.value.ticketId) {
      await SdTicketCsatRepository.setComment(
        awaiting.value.ticketId,
        awaiting.value.workspaceId,
        comment,
      )
    }
    return ok({ handled: saved.value })
  },

  /** What the public page shows for an e-mail token. */
  async getPublic(token: string): Promise<Result<PublicSurveyDTO>> {
    const found = await SatisfactionSurveyRepository.findByToken(token)
    if (!found.ok) return found
    const survey = found.value
    if (survey?.channel !== 'EMAIL' || survey.status === 'SCHEDULED') {
      return err(surveyNotFound())
    }
    const config = await SatisfactionSurveyRepository.findConfig(
      survey.workspaceId,
      survey.trigger,
    )
    if (!config.ok) return config
    const scale = SURVEY_SCALES[survey.kind]
    const state =
      survey.status === 'ANSWERED'
        ? 'ANSWERED'
        : survey.status !== 'SENT' || survey.expiresAt.getTime() <= Date.now()
          ? 'EXPIRED'
          : 'OPEN'
    return ok({
      kind: survey.kind,
      question: surveyEmailQuestion(survey.kind, config.value?.questionText),
      scaleMin: scale.min,
      scaleMax: scale.max,
      workspaceName: survey.workspaceName,
      state,
    })
  },

  async answerPublic(
    token: string,
    dto: AnswerSurveyDTO,
  ): Promise<Result<{ answered: true }>> {
    const found = await SatisfactionSurveyRepository.findByToken(token)
    if (!found.ok) return found
    const survey = found.value
    if (survey?.channel !== 'EMAIL' || survey.status === 'SCHEDULED') {
      return err(surveyNotFound())
    }
    if (survey.status === 'ANSWERED') return err(surveyAlreadyAnswered())
    if (survey.status !== 'SENT' || survey.expiresAt.getTime() <= Date.now()) {
      return err(surveyExpired())
    }
    if (!isScoreInScale(survey.kind, dto.score))
      return err(surveyInvalidScore())

    const recorded = await recordAnswer(
      survey,
      dto.score,
      new Date(),
      dto.comment,
    )
    if (!recorded.ok) return recorded
    if (!recorded.value) return err(surveyAlreadyAnswered())
    return ok({ answered: true })
  },
}

async function workspaceNameOf(workspaceId: string): Promise<string> {
  const workspace = await WorkspaceRepository.findById(workspaceId)
  return workspace.ok ? workspace.value.name : 'Steel'
}

/**
 * Stores an answer (once), mirrors a CSAT into the ticket's own CSAT, thanks
 * the contact on WhatsApp and audits. `false` = the survey was not open.
 */
async function recordAnswer(
  survey: SatisfactionSurvey,
  score: number,
  at: Date,
  comment?: string,
): Promise<Result<boolean>> {
  if (
    survey.status !== 'SENT' ||
    survey.expiresAt.getTime() <= at.getTime() ||
    !isScoreInScale(survey.kind, score)
  ) {
    return ok(false)
  }
  const written = await SatisfactionSurveyRepository.answer(
    survey.id,
    score,
    at,
    comment,
  )
  if (!written.ok) return written
  if (!written.value) return ok(false)

  if (survey.kind === 'CSAT' && survey.ticketId) {
    const mirrored = await SdTicketCsatRepository.submit(
      survey.ticketId,
      survey.workspaceId,
      score,
      comment ?? null,
    )
    if (!mirrored.ok) {
      logger.warn('satisfaction_survey.csat_mirror_failed', {
        surveyId: survey.id,
        reason: mirrored.error.code,
      })
    }
  }

  const config = await SatisfactionSurveyRepository.findConfig(
    survey.workspaceId,
    survey.trigger,
  )

  if (survey.channel === 'WHATSAPP') {
    const connection = await loadConnection(survey)
    if (connection && survey.recipientPhone) {
      const thanks =
        (config.ok && config.value?.thankYouText?.trim()) ||
        DEFAULT_SURVEY_THANK_YOU
      const sent = await WhatsAppSend.text(
        connection,
        { to: survey.recipientPhone, text: thanks },
        { unmetered: true },
      )
      if (!sent.ok) {
        logger.warn('satisfaction_survey.thanks_failed', {
          surveyId: survey.id,
          reason: sent.error.code,
        })
      }
    }
  }

  auditMutation({
    entity: 'satisfaction_survey',
    action: 'create',
    actorId: null,
    targetId: survey.id,
    meta: {
      workspaceId: survey.workspaceId,
      kind: survey.kind,
      channel: survey.channel,
      score,
      hasComment: Boolean(comment),
    },
  })
  logger.info('satisfaction_survey.answered', {
    workspaceId: survey.workspaceId,
    surveyId: survey.id,
    kind: survey.kind,
    score,
  })

  await alertDetractor(survey, score, comment, config.ok ? config.value : null)
  return ok(true)
}

/**
 * Tells the workspace admins/owner about a detractor answer. The rule is the
 * trigger's config (alert on by default, ceiling per kind unless overridden);
 * manual sends have no config and use the defaults. It never fails the answer:
 * a notice must not lose the customer's rating.
 */
async function alertDetractor(
  survey: SatisfactionSurvey,
  score: number,
  comment: string | undefined,
  config: SatisfactionSurveyConfig | null,
): Promise<void> {
  try {
    if (config && !config.alertDetractors) return
    if (!isDetractorScore(survey.kind, score, config?.detractorMaxScore)) return

    const who = survey.customerName ?? survey.recipientName ?? 'Um cliente'
    const scale = SURVEY_SCALES[survey.kind]
    const path = survey.conversationId
      ? `/zap?conversa=${survey.conversationId}`
      : '/zap/pesquisas'
    const admins = await whatsAppAdminIds(survey.workspaceId)
    const notified = await notifyWhatsAppUsers({
      workspaceId: survey.workspaceId,
      kind: 'WHATSAPP_SURVEY_DETRACTOR',
      userIds: admins,
      title: `Cliente insatisfeito: ${who}`,
      body: `${who} deu nota ${score} (${survey.kind}, escala de ${scale.min} a ${scale.max})${
        survey.assigneeName ? ` no atendimento de ${survey.assigneeName}` : ''
      }.${comment ? ` Comentário: "${comment.slice(0, 200)}"` : ''}`,
      path,
      dedupeKey: `survey-detractor:${survey.id}`,
      meta: { surveyId: survey.id, kind: survey.kind, score },
    })
    auditMutation({
      entity: 'satisfaction_survey',
      action: 'alert',
      actorId: null,
      targetId: survey.id,
      meta: {
        workspaceId: survey.workspaceId,
        kind: survey.kind,
        score,
        notified,
      },
    })
  } catch (error) {
    logger.warn('satisfaction_survey.detractor_alert_failed', {
      workspaceId: survey.workspaceId,
      surveyId: survey.id,
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}
