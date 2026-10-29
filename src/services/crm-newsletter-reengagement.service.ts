import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { crmNewsletterTokenInvalid } from '@/src/errors'
import { resolveEmailBrand } from '@/src/lib/crm-email-builder/brand'
import {
  isTransientSendError,
  newsletterFromHeader,
} from '@/src/lib/crm-newsletter/email'
import { renderReengagementEmail } from '@/src/lib/crm-newsletter/reengagement-email'
import { type BatchEmail, sendEmailBatch } from '@/src/lib/mail/send-batch'
import {
  createReengageToken,
  newsletterReengageUrl,
  verifyReengageToken,
} from '@/src/lib/newsletter/reengage-token'
import { newsletterUnsubscribeHeaders } from '@/src/lib/newsletter/urls'
import { err, ok, type Result } from '@/src/lib/result'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { toCrmNewsletterReengagementDTO } from '@/src/mappers/crm-newsletter-automation.mapper'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { CrmNewsletterIssueRepository } from '@/src/repositories/crm-newsletter-issue.repository'
import {
  CrmNewsletterReengagementRepository,
  type DueReengagement,
  type ReengagementSettingsWithNewsletter,
  type ReengagementWithContext,
} from '@/src/repositories/crm-newsletter-reengagement.repository'
import {
  CRM_NEWSLETTER_INACTIVE_REASON,
  CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
  type CrmNewsletterReengagementDTO,
  type CrmNewsletterReengagementPreviewDTO,
  type CrmNewsletterReengagementPreviewQuery,
  type NewsletterReengagePreviewDTO,
  type NewsletterReengageResultDTO,
  type UpdateCrmNewsletterReengagementDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'
import { notifyNewsletterReengagementSummary } from './crm-newsletter-automation-notifications'
import {
  AUTOMATION_BATCH,
  automationTags,
  chunk,
  errorMessage,
  subscriberLinks,
} from './crm-newsletter-automation-shared'
import { loadNewsletterScope } from './crm-newsletter-issue.service'
import {
  CrmNewsletterUsageService,
  newsletterUsageMonth,
} from './crm-newsletter-usage.service'

/**
 * Re-engagement of inactive subscribers (slice nl2-automation), off by
 * default per newsletter:
 *
 * - Monthly run (1st of the month, São Paulo): ACTIVE subscribers that
 *   received ≥ `minIssues` issues in the last `inactiveDays` days and
 *   opened/clicked nothing in that window (nor got a re-engagement e-mail
 *   in it) get the re-engagement e-mail — counted in the monthly quota.
 * - Daily: attempts whose `graceDays` ended are closed. Any open, click or
 *   the "Quero continuar recebendo" button since the e-mail → REENGAGED;
 *   otherwise the subscriber leaves the newsletter with reason "inativo"
 *   (UNSUBSCRIBE) or is only flagged (FLAG). The creator gets an inbox
 *   summary of each phase.
 * - The button (signed link, no session) marks the attempt REENGAGED,
 *   refreshes `lastClickedAt` and brings back a subscriber that the rule
 *   had removed.
 */

/** Attempts left in SENDING longer than this are given up (FAILED). */
export const REENGAGEMENT_STUCK_AFTER_MS = 60 * 60 * 1000
/** Attempts closed per daily run page. */
export const REENGAGEMENT_RESOLVE_PAGE = 500
/** Safety cap of pages per daily run. */
export const REENGAGEMENT_RESOLVE_MAX_PAGES = 40
/** E-mails per newsletter per monthly run (also bounded by the quota). */
export const REENGAGEMENT_SEND_LIMIT = 20_000

export type ReengagementSendOutcome = {
  status: 'sent' | 'idle' | 'sender_not_verified' | 'limit_reached'
  sent: number
  failed: number
}

export type ReengagementResolveOutcome = {
  reengaged: number
  unsubscribed: number
  flagged: number
  skipped: number
}

/** `YYYY-MM-DD` in America/Sao_Paulo (dedupe key of a daily summary). */
function saoPauloDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Engaged since the e-mail went out (any open, click or the button). */
export function engagedSince(row: DueReengagement): boolean {
  return Boolean(
    row.reengagedAt ||
      row.openedAt ||
      row.clickedAt ||
      (row.lastOpenedAt && row.lastOpenedAt > row.sentAt) ||
      (row.lastClickedAt && row.lastClickedAt > row.sentAt),
  )
}

async function previewOf(
  newsletterId: string,
  criteria: { minIssues: number; inactiveDays: number; graceDays: number },
  now: Date,
): Promise<Result<CrmNewsletterReengagementPreviewDTO>> {
  const [candidates, waiting] = await Promise.all([
    CrmNewsletterReengagementRepository.countCandidates({
      newsletterId,
      minIssues: criteria.minIssues,
      inactiveDays: criteria.inactiveDays,
      now,
    }),
    CrmNewsletterReengagementRepository.countWaiting(
      newsletterId,
      now,
      criteria.graceDays,
    ),
  ])
  if (!candidates.ok) return candidates
  if (!waiting.ok) return waiting
  return ok({ candidates: candidates.value, ...waiting.value })
}

async function sendChunk(
  settings: ReengagementSettingsWithNewsletter,
  brand: ReturnType<typeof resolveEmailBrand>,
  rows: { id: string; subscriberId: string; email: string }[],
  now: Date,
): Promise<Result<{ sent: number; failed: number }>> {
  const { newsletter } = settings
  const R = CrmNewsletterReengagementRepository
  const from = newsletterFromHeader(newsletter.fromName, newsletter.fromEmail)
  const emails: BatchEmail[] = rows.map((row) => {
    const links = subscriberLinks(newsletter.workspaceId, row)
    const email = renderReengagementEmail({
      copy: settings,
      brand,
      newsletterName: newsletter.name,
      buttonUrl: newsletterReengageUrl(
        BETTER_AUTH_URL,
        createReengageToken(row.id),
      ),
      unsubscribeUrl: links.pageUrl,
      preferencesUrl: links.preferencesUrl,
    })
    return {
      from,
      to: row.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: newsletterUnsubscribeHeaders(links),
      tags: automationTags('reengagement', newsletter.id),
      ...(newsletter.replyTo ? { replyTo: newsletter.replyTo } : {}),
    }
  })

  let providerIds: string[]
  try {
    providerIds = await sendEmailBatch(emails, {
      idempotencyKey: `crm-newsletter-reengagement-${rows[0].id}-${rows.length}`,
    })
  } catch (error) {
    const message = errorMessage(error, 'Falha ao enviar o lote')
    logger.warn('crm.newsletter.reengagement_batch_failed', {
      component: 'CrmNewsletterReengagementService',
      newsletterId: newsletter.id,
      count: rows.length,
      transient: isTransientSendError(message),
      message,
    })
    // Monthly: no retry of a single batch — next month tries again.
    const failed = await R.markFailed(
      rows.map((row) => row.id),
      message,
    )
    if (!failed.ok) return failed
    return ok({ sent: 0, failed: rows.length })
  }

  const recorded = await R.markSent(
    rows.map((row, index) => ({
      id: row.id,
      subscriberId: row.subscriberId,
      providerMessageId: providerIds[index],
    })),
    now,
  )
  if (!recorded.ok) {
    logger.error('crm.newsletter.reengagement_record_failed', {
      component: 'CrmNewsletterReengagementService',
      newsletterId: newsletter.id,
      reason: recorded.error.code,
    })
  }
  const usage = await CrmNewsletterUsageService.record(
    newsletter.workspaceId,
    rows.length,
    now,
  )
  if (!usage.ok) {
    logger.error('crm.newsletter.reengagement_usage_failed', {
      component: 'CrmNewsletterReengagementService',
      newsletterId: newsletter.id,
      reason: usage.error.code,
    })
  }
  return ok({ sent: rows.length, failed: 0 })
}

async function attemptOfToken(
  token: string,
): Promise<Result<ReengagementWithContext>> {
  const verified = verifyReengageToken(token)
  if (!verified.ok) return err(crmNewsletterTokenInvalid())
  const row = await CrmNewsletterReengagementRepository.findWithContext(
    verified.value.reengagementId,
  )
  if (!row.ok) return row
  if (!row.value) return err(crmNewsletterTokenInvalid())
  return ok(row.value)
}

export const CrmNewsletterReengagementService = {
  /** The section in Configurações: settings, preview and totals. */
  async get(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterReengagementDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const settings =
      await CrmNewsletterReengagementRepository.findSettings(newsletterId)
    if (!settings.ok) return settings
    const values = settings.value ?? CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS
    const [preview, totals] = await Promise.all([
      previewOf(newsletterId, values, now),
      CrmNewsletterReengagementRepository.totals(newsletterId),
    ])
    if (!preview.ok) return preview
    if (!totals.ok) return totals
    return ok(
      toCrmNewsletterReengagementDTO(newsletterId, settings.value, {
        preview: preview.value,
        totals: totals.value,
      }),
    )
  },

  /** How many would be affected now, with the values being edited. */
  async preview(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    query: CrmNewsletterReengagementPreviewQuery,
    now: Date,
  ): Promise<Result<CrmNewsletterReengagementPreviewDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const settings =
      await CrmNewsletterReengagementRepository.findSettings(newsletterId)
    if (!settings.ok) return settings
    const values = settings.value ?? CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS
    return previewOf(
      newsletterId,
      {
        minIssues: query.minIssues ?? values.minIssues,
        inactiveDays: query.inactiveDays ?? values.inactiveDays,
        graceDays: values.graceDays,
      },
      now,
    )
  },

  async update(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: UpdateCrmNewsletterReengagementDTO,
    now: Date,
  ): Promise<Result<CrmNewsletterReengagementDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const saved = await CrmNewsletterReengagementRepository.upsertSettings(
      newsletterId,
      workspaceId,
      { ...dto, updatedById: actorId },
    )
    if (!saved.ok) return saved
    // LGPD: the rule can remove subscribers — who turned it on is audited.
    auditMutation({
      entity: 'crm_newsletter',
      action: 'update',
      actorId,
      targetId: newsletterId,
      meta: {
        workspaceId,
        reengagement: {
          enabled: dto.enabled,
          action: dto.action,
          minIssues: dto.minIssues,
          inactiveDays: dto.inactiveDays,
          graceDays: dto.graceDays,
        },
      },
    })
    return CrmNewsletterReengagementService.get(
      actorId,
      workspaceId,
      newsletterId,
      now,
    )
  },

  // ─── Worker ───────────────────────────────────────────────────────────────

  /** One newsletter of the monthly run. */
  async sendForNewsletter(
    settings: ReengagementSettingsWithNewsletter,
    now: Date,
  ): Promise<Result<ReengagementSendOutcome>> {
    const { newsletter } = settings
    const sender = await resolveVerifiedSender(
      newsletter.workspaceId,
      newsletter.fromEmail,
    )
    if (!sender.ok) {
      if (sender.error.code === 'DATABASE_ERROR') return sender
      return ok({ status: 'sender_not_verified', sent: 0, failed: 0 })
    }
    const usage = await CrmNewsletterUsageService.getUsage(
      newsletter.workspaceId,
      now,
    )
    if (!usage.ok) return usage
    const remaining = CrmNewsletterUsageService.remaining(usage.value)
    if (remaining === 0) {
      return ok({ status: 'limit_reached', sent: 0, failed: 0 })
    }

    const cycle = newsletterUsageMonth(now)
    const claimed = await CrmNewsletterReengagementRepository.claimCandidates({
      newsletterId: newsletter.id,
      minIssues: settings.minIssues,
      inactiveDays: settings.inactiveDays,
      now,
      cycle,
      limit: Math.min(
        remaining ?? REENGAGEMENT_SEND_LIMIT,
        REENGAGEMENT_SEND_LIMIT,
      ),
    })
    if (!claimed.ok) return claimed
    if (claimed.value.length === 0) {
      return ok({ status: 'idle', sent: 0, failed: 0 })
    }

    const [savedBrand, identity] = await Promise.all([
      CrmEmailBuilderRepository.findBrand(newsletter.workspaceId),
      CrmEmailBuilderRepository.findWorkspaceIdentity(newsletter.workspaceId),
    ])
    const rowIds = claimed.value.map((row) => row.id)
    if (!savedBrand.ok || !identity.ok) {
      await CrmNewsletterReengagementRepository.markFailed(
        rowIds,
        'Falha ao carregar a marca',
      )
      return savedBrand.ok ? (identity as Result<never>) : savedBrand
    }
    const brand = resolveEmailBrand(savedBrand.value, identity.value)

    const outcome: ReengagementSendOutcome = {
      status: 'sent',
      sent: 0,
      failed: 0,
    }
    for (const part of chunk(claimed.value, AUTOMATION_BATCH)) {
      const sent = await sendChunk(settings, brand, part, now)
      if (!sent.ok) return sent
      outcome.sent += sent.value.sent
      outcome.failed += sent.value.failed
    }

    logger.info('crm.newsletter.reengagement_sent', {
      component: 'CrmNewsletterReengagementService',
      workspaceId: newsletter.workspaceId,
      newsletterId: newsletter.id,
      cycle,
      ...outcome,
    })
    if (outcome.sent > 0) {
      await notifyNewsletterReengagementSummary({
        workspaceId: newsletter.workspaceId,
        newsletterId: newsletter.id,
        newsletterName: newsletter.name,
        createdById: newsletter.createdById,
        runKey: cycle,
        phase: 'sent',
        sent: outcome.sent,
      })
    }
    return ok(outcome)
  },

  /** Monthly run: every enabled newsletter (one failure never blocks the rest). */
  async runMonthly(
    now: Date,
  ): Promise<Result<{ newsletters: number; sent: number; errors: number }>> {
    const stuck = await CrmNewsletterReengagementRepository.failStuck(
      new Date(now.getTime() - REENGAGEMENT_STUCK_AFTER_MS),
    )
    if (!stuck.ok) return stuck
    const enabled = await CrmNewsletterReengagementRepository.listEnabled()
    if (!enabled.ok) return enabled
    let sent = 0
    let errors = 0
    for (const settings of enabled.value) {
      const result = await CrmNewsletterReengagementService.sendForNewsletter(
        settings,
        now,
      )
      if (!result.ok) {
        errors++
        logger.error('crm.newsletter.reengagement_newsletter_failed', {
          component: 'CrmNewsletterReengagementService',
          newsletterId: settings.newsletterId,
          reason: result.error.code,
        })
        continue
      }
      sent += result.value.sent
    }
    return ok({ newsletters: enabled.value.length, sent, errors })
  },

  /** Daily: closes the attempts whose grace period ended. */
  async resolveDue(now: Date): Promise<Result<ReengagementResolveOutcome>> {
    const R = CrmNewsletterReengagementRepository
    const total: ReengagementResolveOutcome = {
      reengaged: 0,
      unsubscribed: 0,
      flagged: 0,
      skipped: 0,
    }
    const perNewsletter = new Map<
      string,
      ReengagementResolveOutcome & { workspaceId: string }
    >()

    for (let page = 0; page < REENGAGEMENT_RESOLVE_MAX_PAGES; page++) {
      const due = await R.listDue(now, REENGAGEMENT_RESOLVE_PAGE)
      if (!due.ok) return due
      if (due.value.length === 0) break

      const groups = {
        reengaged: [] as DueReengagement[],
        unsubscribed: [] as DueReengagement[],
        flagged: [] as DueReengagement[],
        skipped: [] as DueReengagement[],
      }
      for (const row of due.value) {
        if (row.subscriberStatus !== 'ACTIVE') groups.skipped.push(row)
        else if (engagedSince(row)) groups.reengaged.push(row)
        else if (row.action === 'FLAG') groups.flagged.push(row)
        else groups.unsubscribed.push(row)
      }

      const removed = await R.unsubscribeInactive(
        groups.unsubscribed.map((row) => row.subscriberId),
        now,
      )
      if (!removed.ok) return removed
      const statuses = {
        reengaged: 'REENGAGED',
        unsubscribed: 'UNSUBSCRIBED',
        flagged: 'FLAGGED',
        skipped: 'SKIPPED',
      } as const
      for (const key of Object.keys(groups) as Array<keyof typeof groups>) {
        const rows = groups[key]
        const resolved = await R.resolve(
          rows.map((row) => row.id),
          statuses[key],
          now,
        )
        if (!resolved.ok) return resolved
        total[key] += rows.length
        for (const row of rows) {
          const entry = perNewsletter.get(row.newsletterId) ?? {
            workspaceId: row.workspaceId,
            reengaged: 0,
            unsubscribed: 0,
            flagged: 0,
            skipped: 0,
          }
          entry[key]++
          perNewsletter.set(row.newsletterId, entry)
        }
      }
      for (const row of groups.unsubscribed) {
        auditMutation({
          entity: 'crm_newsletter_subscriber',
          action: 'opt_out',
          actorId: null,
          targetId: row.subscriberId,
          meta: {
            workspaceId: row.workspaceId,
            newsletterId: row.newsletterId,
            reengagementId: row.id,
            reason: CRM_NEWSLETTER_INACTIVE_REASON,
            source: 'REENGAGEMENT',
            actor: 'system',
          },
        })
      }
      if (due.value.length < REENGAGEMENT_RESOLVE_PAGE) break
    }

    const day = saoPauloDay(now)
    for (const [newsletterId, counts] of perNewsletter) {
      logger.info('crm.newsletter.reengagement_resolved', {
        component: 'CrmNewsletterReengagementService',
        newsletterId,
        ...counts,
      })
      const decided = counts.reengaged + counts.unsubscribed + counts.flagged
      if (decided === 0) continue
      const newsletter = await CrmNewsletterIssueRepository.findNewsletter(
        counts.workspaceId,
        newsletterId,
      )
      if (!newsletter.ok || !newsletter.value) continue
      await notifyNewsletterReengagementSummary({
        workspaceId: counts.workspaceId,
        newsletterId,
        newsletterName: newsletter.value.name,
        createdById: newsletter.value.createdById,
        runKey: day,
        phase: 'resolved',
        reengaged: counts.reengaged,
        unsubscribed: counts.unsubscribed,
        flagged: counts.flagged,
      })
    }
    return ok(total)
  },

  // ─── Public button ──────────────────────────────────────────────────────

  /** Page data of `/newsletter/continuar/<token>`. Writes nothing. */
  async reengagePreview(
    token: string,
  ): Promise<Result<NewsletterReengagePreviewDTO>> {
    const row = await attemptOfToken(token)
    if (!row.ok) return row
    return ok({
      email: row.value.email,
      newsletterName: row.value.newsletter.name,
      publisherName: row.value.newsletter.workspace.name,
      alreadyConfirmed: row.value.reengagedAt !== null,
    })
  },

  /** "Quero continuar recebendo" (idempotent). */
  async reengage(
    token: string,
    now: Date,
  ): Promise<Result<NewsletterReengageResultDTO>> {
    const row = await attemptOfToken(token)
    if (!row.ok) return row
    const { subscriber } = row.value
    // Left on purpose (or bounced) since: the button never overrides that.
    const blocked =
      subscriber.status !== 'ACTIVE' &&
      !(
        subscriber.status === 'UNSUBSCRIBED' &&
        subscriber.unsubscribeReason === CRM_NEWSLETTER_INACTIVE_REASON
      )
    if (blocked) {
      return ok({
        newsletterName: row.value.newsletter.name,
        resubscribed: false,
      })
    }
    const done = await CrmNewsletterReengagementRepository.reengage(
      row.value,
      now,
    )
    if (!done.ok) return done
    auditMutation({
      entity: 'crm_newsletter_subscriber',
      action: done.value ? 'opt_in' : 'update',
      actorId: null,
      targetId: subscriber.id,
      meta: {
        workspaceId: row.value.workspaceId,
        newsletterId: row.value.newsletterId,
        reengagementId: row.value.id,
        source: 'REENGAGEMENT_BUTTON',
      },
    })
    return ok({
      newsletterName: row.value.newsletter.name,
      resubscribed: done.value,
    })
  },
}
