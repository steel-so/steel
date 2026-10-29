import type { CrmNewsletterIssue } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  crmNewsletterAbAudienceTooSmall,
  crmNewsletterArchived,
  crmNewsletterIssueIncomplete,
  crmNewsletterIssueLocked,
  crmNewsletterLimitReached,
  crmNewsletterNoSubscribers,
  validationError,
} from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { abShareSize } from '@/src/lib/crm-newsletter/ab-test'
import {
  issueExcerpt,
  isTransientSendError,
  newsletterFromHeader,
  newsletterTags,
} from '@/src/lib/crm-newsletter/email'
import { type BatchEmail, sendEmailBatch } from '@/src/lib/mail/send-batch'
import {
  createPreferencesToken,
  createUnsubscribeToken,
} from '@/src/lib/newsletter/tokens'
import {
  newsletterPreferencesUrl,
  newsletterUnsubscribeHeaders,
  newsletterUnsubscribeUrls,
} from '@/src/lib/newsletter/urls'
import { CrmNewsletterJob } from '@/src/lib/queue/jobs'
import { getCrmNewsletterQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { toCrmNewsletterIssueDTO } from '@/src/mappers/crm-newsletter-issue.mapper'
import {
  type ClaimedRecipient,
  CrmNewsletterDeliveryRepository,
} from '@/src/repositories/crm-newsletter-delivery.repository'
import {
  CrmNewsletterIssueRepository,
  EDITABLE_ISSUE_STATUSES,
  type NewsletterWithWorkspace,
} from '@/src/repositories/crm-newsletter-issue.repository'
import { CRM_NEWSLETTER_AB_MIN_AUDIENCE } from '@/src/schemas/crm-newsletter-ab.schema'
import {
  CRM_NEWSLETTER_MIN_SCHEDULE_MINUTES,
  type CrmNewsletterIssueDTO,
  type SendCrmNewsletterIssueDTO,
} from '@/src/schemas/crm-newsletter-issue.schema'
import {
  issueWebUrl,
  limitMessage,
  loadIssue,
  loadNewsletterScope,
} from './crm-newsletter-issue.service'
import { notifyNewsletterIssueFinished } from './crm-newsletter-notifications'
import {
  type IssueRenderBase,
  issueChecklist,
  loadRecipientFacts,
  personalizeIssue,
  renderIssueBase,
  webVersionOf,
} from './crm-newsletter-render'
import { CrmNewsletterUsageService } from './crm-newsletter-usage.service'

/**
 * Sending of newsletter issues (ADR 0054): send now, schedule, cancel and
 * stop (member actions), plus the `crm-newsletter` worker flows — the
 * minute tick and the batch dispatch. Idempotency comes from the database:
 * a batch only goes out after its rows were claimed (PENDING → SENDING),
 * and the Resend call carries an idempotency key of the claimed rows.
 */

/** Recipients per dispatch = one Resend batch call. */
export const DISPATCH_BATCH = 100
/** Pause between two batches of the same issue. */
export const BATCH_INTERVAL_MS = 1000
/** Rows left in SENDING longer than this are given back to PENDING. */
export const STUCK_AFTER_MS = 15 * 60 * 1000

export type IssueDispatchOutcome =
  | { status: 'missing' | 'inactive' | 'drained' }
  | {
      status: 'sent'
      sent: number
      skipped: number
      failed: number
      more: boolean
    }
  | { status: 'retry'; reason: string }

export type PreSendCheck = { audience: number }

/**
 * Checks of a send, in the contract's order: newsletter ACTIVE, verified
 * sender, content without checklist errors, audience > 0, audience within
 * the month's remaining quota.
 */
export async function preSendChecks(
  issue: CrmNewsletterIssue,
  newsletter: NewsletterWithWorkspace,
  now: Date,
): Promise<Result<PreSendCheck & { base: IssueRenderBase }>> {
  if (newsletter.status !== 'ACTIVE') return err(crmNewsletterArchived())

  const sender = await resolveVerifiedSender(
    issue.workspaceId,
    newsletter.fromEmail,
  )
  if (!sender.ok) return sender

  const base = await renderIssueBase(
    issue.workspaceId,
    issue.builderDocument,
    issue.subject,
  )
  if (!base.ok) return base
  const error = issueChecklist(base.value, issue.subject).find(
    (item) => item.level === 'error',
  )
  if (error) return err(crmNewsletterIssueIncomplete(error.message))

  const audience = await CrmNewsletterIssueRepository.countAudience(
    issue.workspaceId,
    issue.newsletterId,
  )
  if (!audience.ok) return audience
  if (audience.value === 0) return err(crmNewsletterNoSubscribers())
  if (issue.abSubjectB && audience.value < CRM_NEWSLETTER_AB_MIN_AUDIENCE) {
    return err(crmNewsletterAbAudienceTooSmall(CRM_NEWSLETTER_AB_MIN_AUDIENCE))
  }

  const usage = await CrmNewsletterUsageService.getUsage(issue.workspaceId, now)
  if (!usage.ok) return usage
  const remaining = CrmNewsletterUsageService.remaining(usage.value)
  if (remaining !== null && audience.value > remaining) {
    return err(
      crmNewsletterLimitReached(
        limitMessage(audience.value, remaining, usage.value.limit),
      ),
    )
  }
  return ok({ audience: audience.value, base: base.value })
}

async function enqueueDispatch(issueId: string, delay: number, now: Date) {
  await getCrmNewsletterQueue().add(
    CrmNewsletterJob.Dispatch,
    { issueId },
    {
      delay,
      // One pending dispatch per issue and moment (BullMQ drops duplicates).
      jobId: `crm-newsletter-dispatch-${issueId}-${now.getTime() + delay}`,
    },
  )
}

/** Snapshot + numbering + web version, then the first dispatch. */
async function startSending(
  issue: CrmNewsletterIssue,
  newsletter: NewsletterWithWorkspace,
  base: IssueRenderBase,
  now: Date,
): Promise<Result<CrmNewsletterIssue | null>> {
  const web = webVersionOf(base, newsletter.name)
  const percent = issue.abSubjectB ? issue.abTestPercent : null
  const started = await CrmNewsletterIssueRepository.startSending(issue.id, {
    webHtml: web.html,
    excerpt: issueExcerpt(web.text),
    now,
    ...(percent
      ? { abShare: (audience: number) => abShareSize(audience, percent) }
      : {}),
  })
  if (!started.ok) return started
  if (!started.value) return ok(null)
  logger.info('crm.newsletter.sending_started', {
    component: 'CrmNewsletterSendService',
    workspaceId: issue.workspaceId,
    issueId: issue.id,
    number: started.value.issue.number,
    recipients: started.value.recipients,
  })
  await enqueueDispatch(issue.id, 0, now)
  return ok(started.value.issue)
}

function unsubscribeLinks(
  workspaceId: string,
  recipient: ClaimedRecipient,
): { pageUrl: string; oneClickUrl: string; preferencesUrl: string } {
  const unsubscribe = newsletterUnsubscribeUrls(
    BETTER_AUTH_URL,
    createUnsubscribeToken({
      subscriberId: recipient.subscriberId,
      recipientId: recipient.id,
    }),
  )
  return {
    ...unsubscribe,
    preferencesUrl: newsletterPreferencesUrl(
      BETTER_AUTH_URL,
      createPreferencesToken({ workspaceId, email: recipient.email }),
    ),
  }
}

/** Why a claimed row must not be sent anymore (or `null`). */
function skipReasonOf(
  recipient: ClaimedRecipient,
  optedOut: Set<string>,
): string | null {
  if (optedOut.has(recipient.email.toLowerCase())) return 'OPTED_OUT'
  switch (recipient.subscriberStatus) {
    case 'ACTIVE':
      return null
    case 'BOUNCED':
      return 'BOUNCED'
    case 'COMPLAINED':
      return 'COMPLAINED'
    default:
      return 'UNSUBSCRIBED'
  }
}

export const CrmNewsletterSendService = {
  /**
   * "Enviar agora" (no `scheduledAt`) or "Agendar" (≥ 5 minutes ahead).
   * Every pre-send check runs now; a scheduled issue runs them again when
   * its time comes.
   */
  async send(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: SendCrmNewsletterIssueDTO,
    now: Date,
  ): Promise<Result<CrmNewsletterIssueDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    if (!EDITABLE_ISSUE_STATUSES.includes(issue.value.status)) {
      return err(crmNewsletterIssueLocked())
    }

    let scheduledAt: Date | null = null
    if (dto.scheduledAt) {
      scheduledAt = new Date(dto.scheduledAt)
      const earliest =
        now.getTime() + CRM_NEWSLETTER_MIN_SCHEDULE_MINUTES * 60_000
      if (scheduledAt.getTime() < earliest) {
        return err(
          validationError(
            `Agende para pelo menos ${CRM_NEWSLETTER_MIN_SCHEDULE_MINUTES} minutos à frente`,
          ),
        )
      }
    }

    const { newsletter } = scope.value
    const checked = await preSendChecks(issue.value, newsletter, now)
    if (!checked.ok) return checked

    let result: CrmNewsletterIssue | null
    if (scheduledAt) {
      const scheduled = await CrmNewsletterIssueRepository.transition(
        issueId,
        EDITABLE_ISSUE_STATUSES,
        {
          status: 'SCHEDULED',
          scheduledAt,
          canceledAt: null,
          failureReason: null,
          updatedById: actorId,
        },
      )
      if (!scheduled.ok) return scheduled
      result = scheduled.value
    } else {
      const started = await startSending(
        issue.value,
        newsletter,
        checked.value.base,
        now,
      )
      if (!started.ok) return started
      result = started.value
    }
    if (!result) return err(crmNewsletterIssueLocked())

    auditMutation({
      entity: 'crm_newsletter_issue',
      action: 'send',
      actorId,
      targetId: issueId,
      meta: {
        workspaceId,
        newsletterId,
        audience: checked.value.audience,
        scheduledAt: scheduledAt?.toISOString() ?? null,
      },
    })
    return ok(
      toCrmNewsletterIssueDTO(result, {
        webUrl: issueWebUrl(result, newsletter),
      }),
    )
  },

  /** Cancels a schedule: SCHEDULED → DRAFT. */
  async cancel(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterIssueDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    if (issue.value.status !== 'SCHEDULED') {
      return err(
        validationError(
          'Só uma edição agendada pode ter o agendamento cancelado',
        ),
      )
    }
    const canceled = await CrmNewsletterIssueRepository.transition(
      issueId,
      ['SCHEDULED'],
      {
        status: 'DRAFT',
        scheduledAt: null,
        canceledAt: now,
        updatedById: actorId,
      },
    )
    if (!canceled.ok) return canceled
    if (!canceled.value) return err(crmNewsletterIssueLocked())
    auditMutation({
      entity: 'crm_newsletter_issue',
      action: 'cancel',
      actorId,
      targetId: issueId,
      meta: { workspaceId, newsletterId },
    })
    return ok(toCrmNewsletterIssueDTO(canceled.value))
  },

  /** "Parar envio": pending rows become SKIPPED and the issue closes. */
  async stop(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterIssueDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    if (issue.value.status !== 'SENDING') {
      return err(validationError('Esta edição não está sendo enviada'))
    }
    const skipped = await CrmNewsletterDeliveryRepository.skipPending(
      issueId,
      'STOPPED',
    )
    if (!skipped.ok) return skipped
    auditMutation({
      entity: 'crm_newsletter_issue',
      action: 'stop',
      actorId,
      targetId: issueId,
      meta: { workspaceId, newsletterId, skipped: skipped.value },
    })
    await CrmNewsletterSendService.completeIfDrained(issueId, now, {
      stopped: true,
    })
    const current = await loadIssue(workspaceId, newsletterId, issueId)
    if (!current.ok) return current
    return ok(
      toCrmNewsletterIssueDTO(current.value, {
        webUrl: issueWebUrl(current.value, scope.value.newsletter),
      }),
    )
  },

  /**
   * One batch of an issue: claim ≤ 100 rows, drop the ones that opted out
   * or left the newsletter since the snapshot, cut at the month's quota,
   * personalize and send through the Resend batch API, record the outcome
   * and the usage, then queue the next batch (or close the issue).
   */
  async dispatch(
    issueId: string,
    now: Date,
  ): Promise<Result<IssueDispatchOutcome>> {
    const found = await CrmNewsletterIssueRepository.findByIdUnscoped(issueId)
    if (!found.ok) return found
    if (!found.value) return ok({ status: 'missing' })
    const { newsletter, ...issue } = found.value
    if (issue.status !== 'SENDING') return ok({ status: 'inactive' })

    const claimed = await CrmNewsletterDeliveryRepository.claimBatch(
      issueId,
      DISPATCH_BATCH,
    )
    if (!claimed.ok) return claimed
    if (claimed.value.length === 0) {
      await CrmNewsletterSendService.completeIfDrained(issueId, now)
      return ok({ status: 'drained' })
    }
    const rows = claimed.value
    const more = rows.length === DISPATCH_BATCH

    const giveBack = async (error: AppError) => {
      await CrmNewsletterDeliveryRepository.release(rows.map((row) => row.id))
      return err(error)
    }

    // Opt-outs and status changes since the snapshot.
    const optedOut = await CrmNewsletterDeliveryRepository.optedOut(
      issue.workspaceId,
      rows.map((row) => row.email),
    )
    if (!optedOut.ok) return giveBack(optedOut.error)
    const skips = new Map<string, string[]>()
    const eligible: ClaimedRecipient[] = []
    for (const row of rows) {
      const reason = skipReasonOf(row, optedOut.value)
      if (reason) skips.set(reason, [...(skips.get(reason) ?? []), row.id])
      else eligible.push(row)
    }

    // Quota: what does not fit this month is skipped, never sent.
    const usage = await CrmNewsletterUsageService.getUsage(
      issue.workspaceId,
      now,
    )
    if (!usage.ok) return giveBack(usage.error)
    const remaining = CrmNewsletterUsageService.remaining(usage.value)
    const toSend =
      remaining === null ? eligible : eligible.slice(0, Math.max(0, remaining))
    const overQuota = eligible.slice(toSend.length).map((row) => row.id)
    if (overQuota.length > 0) skips.set('LIMIT_REACHED', overQuota)

    for (const [reason, ids] of skips) {
      const skipped = await CrmNewsletterDeliveryRepository.markSkipped(
        ids,
        reason,
      )
      if (!skipped.ok) return giveBack(skipped.error)
    }
    const skippedCount = rows.length - eligible.length + overQuota.length

    let sent = 0
    let failed = 0
    if (toSend.length > 0) {
      const outcome = await CrmNewsletterSendService.sendBatch(
        issue,
        newsletter,
        toSend,
        now,
      )
      if (!outcome.ok) return giveBack(outcome.error)
      if (outcome.value.status === 'retry') {
        await CrmNewsletterDeliveryRepository.release(
          toSend.map((row) => row.id),
        )
        return ok(outcome.value)
      }
      sent = outcome.value.sent
      failed = outcome.value.failed
    }

    if (more) {
      await enqueueDispatch(issueId, BATCH_INTERVAL_MS, now)
    } else {
      await CrmNewsletterSendService.completeIfDrained(issueId, now)
    }
    return ok({ status: 'sent', sent, skipped: skippedCount, failed, more })
  },

  /** Renders and sends one batch; records SENT/FAILED rows and the usage. */
  async sendBatch(
    issue: CrmNewsletterIssue,
    newsletter: NewsletterWithWorkspace,
    rows: ClaimedRecipient[],
    now: Date,
  ): Promise<
    Result<
      | { status: 'done'; sent: number; failed: number }
      | { status: 'retry'; reason: string }
    >
  > {
    const fail = async (message: string) => {
      const marked = await CrmNewsletterDeliveryRepository.markFailed(
        rows.map((row) => row.id),
        message,
      )
      if (!marked.ok) return marked
      return ok({ status: 'done' as const, sent: 0, failed: rows.length })
    }

    const base = await renderIssueBase(
      issue.workspaceId,
      issue.builderDocument,
      issue.subject,
    )
    if (!base.ok) {
      if (base.error.code === 'DATABASE_ERROR') return base
      return fail(base.error.message)
    }
    const facts = await loadRecipientFacts(issue.workspaceId, base.value, rows)
    if (!facts.ok) return facts
    // Subject A/B test: the test share has its variant, the rest the winner.
    const subjectB = issue.abSubjectB
    const baseB = subjectB
      ? { ...base.value, email: { ...base.value.email, subject: subjectB } }
      : null
    const baseOf = (row: ClaimedRecipient) =>
      baseB && (row.abVariant ?? issue.abWinner) === 'B' ? baseB : base.value

    const from = newsletterFromHeader(newsletter.fromName, newsletter.fromEmail)
    const emails: BatchEmail[] = rows.map((row) => {
      const links = unsubscribeLinks(issue.workspaceId, row)
      const person = row.personId ? facts.value.people.get(row.personId) : null
      const email = personalizeIssue(baseOf(row), {
        newsletterName: newsletter.name,
        contact: {
          ...person,
          email: row.email,
          name: row.name ?? person?.name ?? '',
        },
        links: {
          unsubscribeUrl: links.pageUrl,
          preferencesUrl: links.preferencesUrl,
        },
        listIds: facts.value.lists.get(row.email.toLowerCase()) ?? [],
      })
      return {
        from,
        to: row.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: newsletterUnsubscribeHeaders(links),
        tags: newsletterTags(issue.id),
        ...(newsletter.replyTo ? { replyTo: newsletter.replyTo } : {}),
      }
    })

    let ids: string[]
    try {
      ids = await sendEmailBatch(emails, {
        idempotencyKey: `crm-newsletter-${issue.id}-${rows[0].id}-${rows.length}`,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha ao enviar o lote'
      logger.warn('crm.newsletter.batch_failed', {
        component: 'CrmNewsletterSendService',
        issueId: issue.id,
        count: rows.length,
        message,
      })
      if (isTransientSendError(message)) {
        return ok({ status: 'retry', reason: message })
      }
      return fail(message)
    }

    const recorded = await CrmNewsletterDeliveryRepository.markSent(
      rows.map((row, index) => ({
        id: row.id,
        subscriberId: row.subscriberId,
        providerMessageId: ids[index],
      })),
      now,
    )
    // Already sent: never report an error (a retry would send it again).
    if (!recorded.ok) {
      logger.error('crm.newsletter.send_record_failed', {
        component: 'CrmNewsletterSendService',
        issueId: issue.id,
        reason: recorded.error.code,
      })
    }
    const usage = await CrmNewsletterUsageService.record(
      issue.workspaceId,
      rows.length,
      now,
    )
    if (!usage.ok) {
      logger.error('crm.newsletter.usage_record_failed', {
        component: 'CrmNewsletterSendService',
        issueId: issue.id,
        reason: usage.error.code,
      })
    }
    return ok({ status: 'done', sent: rows.length, failed: 0 })
  },

  /**
   * Closes a SENDING issue without open rows: SENT, or FAILED when nothing
   * went out and something failed, or CANCELED when it was stopped before
   * anything went out. Only one concurrent caller wins the transition (and
   * notifies the creator).
   */
  async completeIfDrained(
    issueId: string,
    now: Date,
    options: { stopped?: boolean } = {},
  ): Promise<void> {
    const open = await CrmNewsletterDeliveryRepository.countOpen(issueId)
    if (!open.ok || open.value > 0) return
    const stats = await CrmNewsletterDeliveryRepository.statsFor([issueId])
    if (!stats.ok) return
    const counts = stats.value.get(issueId)
    const sent = counts?.sent ?? 0
    const failed = counts?.failed ?? 0

    let status: 'SENT' | 'FAILED' | 'CANCELED' = 'SENT'
    if (sent === 0 && failed > 0) status = 'FAILED'
    else if (sent === 0 && options.stopped) status = 'CANCELED'

    const closed = await CrmNewsletterIssueRepository.transition(
      issueId,
      ['SENDING'],
      {
        status,
        ...(status === 'SENT' ? { sentAt: now } : {}),
        ...(status === 'CANCELED' ? { canceledAt: now } : {}),
        ...(status === 'FAILED'
          ? { failureReason: 'Nenhum e-mail foi aceito pelo provedor' }
          : {}),
      },
    )
    if (!closed.ok || !closed.value) return

    logger.info('crm.newsletter.issue_finished', {
      component: 'CrmNewsletterSendService',
      issueId,
      status,
      sent,
      failed,
    })
    auditMutation({
      entity: 'crm_newsletter_issue',
      action: 'update',
      actorId: null,
      targetId: issueId,
      meta: { status, sent, failed, actor: 'system' },
    })
    await notifyNewsletterIssueFinished({
      workspaceId: closed.value.workspaceId,
      newsletterId: closed.value.newsletterId,
      issueId,
      createdById: closed.value.createdById,
      subject: closed.value.subject,
      status,
      sent,
      failed,
    })
  },

  /** Due schedule: re-checks and starts, or fails the issue with the reason. */
  async startScheduled(
    issue: CrmNewsletterIssue,
    now: Date,
  ): Promise<Result<'started' | 'failed' | 'lost'>> {
    const found = await CrmNewsletterIssueRepository.findByIdUnscoped(issue.id)
    if (!found.ok) return found
    if (found.value?.status !== 'SCHEDULED') return ok('lost')
    const { newsletter, ...current } = found.value

    const checked = await preSendChecks(current, newsletter, now)
    if (!checked.ok) {
      if (checked.error.code === 'DATABASE_ERROR') return checked
      const failed = await CrmNewsletterIssueRepository.transition(
        issue.id,
        ['SCHEDULED'],
        { status: 'FAILED', failureReason: checked.error.message },
      )
      if (!failed.ok) return failed
      if (!failed.value) return ok('lost')
      logger.warn('crm.newsletter.scheduled_send_refused', {
        component: 'CrmNewsletterSendService',
        issueId: issue.id,
        code: checked.error.code,
      })
      await notifyNewsletterIssueFinished({
        workspaceId: current.workspaceId,
        newsletterId: current.newsletterId,
        issueId: issue.id,
        createdById: current.createdById,
        subject: current.subject,
        status: 'FAILED',
        sent: 0,
        failed: 0,
      })
      return ok('failed')
    }
    const started = await startSending(
      current,
      newsletter,
      checked.value.base,
      now,
    )
    if (!started.ok) return started
    return ok(started.value ? 'started' : 'lost')
  },

  /**
   * Sends a DRAFT right away on behalf of the system (the digest in
   * AUTO_SEND mode, nl2-digest-ai): same pre-send checks as a member's
   * send. `refused` carries the pt-BR reason when a check fails.
   */
  async sendNowAsSystem(
    issueId: string,
    now: Date,
  ): Promise<Result<{ started: true } | { started: false; refused: string }>> {
    const found = await CrmNewsletterIssueRepository.findByIdUnscoped(issueId)
    if (!found.ok) return found
    if (found.value?.status !== 'DRAFT') {
      return ok({ started: false, refused: crmNewsletterIssueLocked().message })
    }
    const { newsletter, ...issue } = found.value
    const checked = await preSendChecks(issue, newsletter, now)
    if (!checked.ok) {
      if (checked.error.code === 'DATABASE_ERROR') return checked
      return ok({ started: false, refused: checked.error.message })
    }
    const started = await startSending(
      issue,
      newsletter,
      checked.value.base,
      now,
    )
    if (!started.ok) return started
    if (!started.value) {
      return ok({ started: false, refused: crmNewsletterIssueLocked().message })
    }
    auditMutation({
      entity: 'crm_newsletter_issue',
      action: 'send',
      actorId: null,
      targetId: issueId,
      meta: {
        workspaceId: issue.workspaceId,
        newsletterId: issue.newsletterId,
        audience: checked.value.audience,
        actor: 'system',
        reason: 'digest',
      },
    })
    return ok({ started: true })
  },

  /**
   * Every minute: gives stuck rows back, starts the due schedules and
   * re-dispatches the issues still sending (a lost job never strands one).
   */
  async tick(now: Date): Promise<
    Result<{
      released: number
      started: number
      failed: number
      dispatched: number
    }>
  > {
    const released = await CrmNewsletterDeliveryRepository.releaseStuck(
      new Date(now.getTime() - STUCK_AFTER_MS),
    )
    if (!released.ok) return released

    const due = await CrmNewsletterIssueRepository.listDue(now)
    if (!due.ok) return due
    let started = 0
    let failed = 0
    for (const issue of due.value) {
      const result = await CrmNewsletterSendService.startScheduled(issue, now)
      if (!result.ok) {
        logger.error('crm.newsletter.tick_start_failed', {
          component: 'CrmNewsletterSendService',
          issueId: issue.id,
          reason: result.error.code,
        })
        continue
      }
      if (result.value === 'started') started++
      if (result.value === 'failed') failed++
    }

    const sending = await CrmNewsletterIssueRepository.listSending()
    if (!sending.ok) return sending
    for (const issue of sending.value) {
      await enqueueDispatch(issue.id, 0, now)
    }
    return ok({
      released: released.value,
      started,
      failed,
      dispatched: sending.value.length,
    })
  },
}
