import type { CrmNewsletterWelcomeStep } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  isTransientSendError,
  newsletterFromHeader,
} from '@/src/lib/crm-newsletter/email'
import { type BatchEmail, sendEmailBatch } from '@/src/lib/mail/send-batch'
import { newsletterUnsubscribeHeaders } from '@/src/lib/newsletter/urls'
import { ok, type Result } from '@/src/lib/result'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import type { NewsletterWithWorkspace } from '@/src/repositories/crm-newsletter-issue.repository'
import {
  type ClaimedWelcomeDelivery,
  CrmNewsletterWelcomeRepository,
} from '@/src/repositories/crm-newsletter-welcome.repository'
import {
  AUTOMATION_BATCH,
  automationSkipReason,
  automationTags,
  chunk,
  errorMessage,
  subscriberLinks,
} from './crm-newsletter-automation-shared'
import {
  loadRecipientFacts,
  personalizeIssue,
  renderIssueBase,
} from './crm-newsletter-render'
import { CrmNewsletterUsageService } from './crm-newsletter-usage.service'

/**
 * Sending of the welcome series (slice nl2-automation), run by the
 * `crm-newsletter-automation` worker tick. Per newsletter: verified sender
 * and the month's quota first (nothing is claimed otherwise, so the e-mails
 * go out once it is fixed — within the stale window), then the due
 * (step × subscriber) pairs are claimed as SENDING progress rows (unique,
 * so never twice), the ones that left or opted out are skipped, and each
 * step is rendered once and sent through the Resend batch API with the
 * same From, Reply-To, footer, List-Unsubscribe headers and tags as an
 * issue. Opens and clicks come back through the Resend webhook.
 */

/** Sends per newsletter per tick. */
export const WELCOME_TICK_LIMIT = 500
/** Rows left in SENDING longer than this are claimed again. */
export const WELCOME_STUCK_AFTER_MS = 15 * 60 * 1000

export type WelcomeNewsletterOutcome = {
  status: 'sent' | 'idle' | 'sender_not_verified' | 'limit_reached'
  sent: number
  skipped: number
  failed: number
  deferred: number
}

export type WelcomeTickOutcome = {
  newsletters: number
  /** Newsletters whose processing failed (logged; the next tick retries). */
  errors: number
  sent: number
  skipped: number
  failed: number
  deferred: number
}

const idle = (
  status: WelcomeNewsletterOutcome['status'],
): WelcomeNewsletterOutcome => ({
  status,
  sent: 0,
  skipped: 0,
  failed: 0,
  deferred: 0,
})

type StepOutcome = { sent: number; failed: number; deferred: number }

/** Renders one step and sends it to `rows` (≤ 100 per Resend call). */
async function sendStep(
  newsletter: NewsletterWithWorkspace,
  step: CrmNewsletterWelcomeStep,
  rows: ClaimedWelcomeDelivery[],
  now: Date,
): Promise<Result<StepOutcome>> {
  const R = CrmNewsletterWelcomeRepository
  const ids = rows.map((row) => row.id)
  const base = await renderIssueBase(
    newsletter.workspaceId,
    step.builderDocument,
    step.subject,
    newsletter.name,
  )
  if (!base.ok) {
    if (base.error.code === 'DATABASE_ERROR') {
      await R.release(ids)
      return base
    }
    const failed = await R.markFailed(ids, base.error.message)
    if (!failed.ok) return failed
    return ok({ sent: 0, failed: rows.length, deferred: 0 })
  }
  const facts = await loadRecipientFacts(
    newsletter.workspaceId,
    base.value,
    rows,
  )
  if (!facts.ok) {
    await R.release(ids)
    return facts
  }

  const from = newsletterFromHeader(newsletter.fromName, newsletter.fromEmail)
  const outcome: StepOutcome = { sent: 0, failed: 0, deferred: 0 }
  for (const part of chunk(rows, AUTOMATION_BATCH)) {
    const emails: BatchEmail[] = part.map((row) => {
      const links = subscriberLinks(newsletter.workspaceId, row)
      const person = row.personId ? facts.value.people.get(row.personId) : null
      const email = personalizeIssue(base.value, {
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
        tags: automationTags('welcome', step.id),
        ...(newsletter.replyTo ? { replyTo: newsletter.replyTo } : {}),
      }
    })

    let providerIds: string[]
    try {
      providerIds = await sendEmailBatch(emails, {
        idempotencyKey: `crm-newsletter-welcome-${part[0].id}-${part.length}`,
      })
    } catch (error) {
      const message = errorMessage(error, 'Falha ao enviar o lote')
      logger.warn('crm.newsletter.welcome_batch_failed', {
        component: 'CrmNewsletterWelcomeSendService',
        newsletterId: newsletter.id,
        stepId: step.id,
        count: part.length,
        message,
      })
      const partIds = part.map((row) => row.id)
      if (isTransientSendError(message)) {
        await R.release(partIds)
        outcome.deferred += part.length
      } else {
        const failed = await R.markFailed(partIds, message)
        if (!failed.ok) return failed
        outcome.failed += part.length
      }
      continue
    }

    // Already sent: bookkeeping errors are logged, never retried.
    const recorded = await R.markSent(
      part.map((row, index) => ({
        id: row.id,
        subscriberId: row.subscriberId,
        providerMessageId: providerIds[index],
      })),
      now,
    )
    if (!recorded.ok) {
      logger.error('crm.newsletter.welcome_record_failed', {
        component: 'CrmNewsletterWelcomeSendService',
        stepId: step.id,
        reason: recorded.error.code,
      })
    }
    const usage = await CrmNewsletterUsageService.record(
      newsletter.workspaceId,
      part.length,
      now,
    )
    if (!usage.ok) {
      logger.error('crm.newsletter.welcome_usage_failed', {
        component: 'CrmNewsletterWelcomeSendService',
        stepId: step.id,
        reason: usage.error.code,
      })
    }
    outcome.sent += part.length
  }
  return ok(outcome)
}

export const CrmNewsletterWelcomeSendService = {
  /** One newsletter's due welcome e-mails (up to WELCOME_TICK_LIMIT). */
  async processNewsletter(
    newsletter: NewsletterWithWorkspace,
    now: Date,
  ): Promise<Result<WelcomeNewsletterOutcome>> {
    const sender = await resolveVerifiedSender(
      newsletter.workspaceId,
      newsletter.fromEmail,
    )
    if (!sender.ok) {
      if (sender.error.code === 'DATABASE_ERROR') return sender
      return ok(idle('sender_not_verified'))
    }
    const usage = await CrmNewsletterUsageService.getUsage(
      newsletter.workspaceId,
      now,
    )
    if (!usage.ok) return usage
    const remaining = CrmNewsletterUsageService.remaining(usage.value)
    if (remaining === 0) return ok(idle('limit_reached'))

    const claimed = await CrmNewsletterWelcomeRepository.claimDue(
      newsletter.id,
      now,
      new Date(now.getTime() - WELCOME_STUCK_AFTER_MS),
      Math.min(remaining ?? WELCOME_TICK_LIMIT, WELCOME_TICK_LIMIT),
    )
    if (!claimed.ok) return claimed
    if (claimed.value.length === 0) return ok(idle('idle'))
    const rows = claimed.value
    const R = CrmNewsletterWelcomeRepository

    const optedOut = await CrmNewsletterDeliveryRepository.optedOut(
      newsletter.workspaceId,
      rows.map((row) => row.email),
    )
    if (!optedOut.ok) {
      await R.release(rows.map((row) => row.id))
      return optedOut
    }
    const steps = await R.findStepsByIds([
      ...new Set(rows.map((row) => row.stepId)),
    ])
    if (!steps.ok) {
      await R.release(rows.map((row) => row.id))
      return steps
    }
    const stepById = new Map(steps.value.map((step) => [step.id, step]))

    const skips = new Map<string, string[]>()
    const byStep = new Map<string, ClaimedWelcomeDelivery[]>()
    for (const row of rows) {
      const step = stepById.get(row.stepId)
      const reason = step?.enabled
        ? automationSkipReason(row, optedOut.value)
        : 'STEP_DISABLED'
      if (reason) {
        skips.set(reason, [...(skips.get(reason) ?? []), row.id])
      } else {
        byStep.set(row.stepId, [...(byStep.get(row.stepId) ?? []), row])
      }
    }
    let skipped = 0
    for (const [reason, ids] of skips) {
      const marked = await R.markSkipped(ids, reason)
      if (!marked.ok) return marked
      skipped += ids.length
    }

    const outcome: WelcomeNewsletterOutcome = {
      ...idle('sent'),
      skipped,
    }
    for (const [stepId, stepRows] of byStep) {
      const sent = await sendStep(
        newsletter,
        stepById.get(stepId) as CrmNewsletterWelcomeStep,
        stepRows,
        now,
      )
      if (!sent.ok) return sent
      outcome.sent += sent.value.sent
      outcome.failed += sent.value.failed
      outcome.deferred += sent.value.deferred
    }
    if (outcome.sent > 0 || outcome.failed > 0) {
      logger.info('crm.newsletter.welcome_sent', {
        component: 'CrmNewsletterWelcomeSendService',
        workspaceId: newsletter.workspaceId,
        newsletterId: newsletter.id,
        ...outcome,
      })
    }
    return ok(outcome)
  },

  /** Worker tick: every newsletter with an enabled step. */
  async tick(now: Date): Promise<Result<WelcomeTickOutcome>> {
    const newsletters =
      await CrmNewsletterWelcomeRepository.listNewslettersWithSeries()
    if (!newsletters.ok) return newsletters
    const total: WelcomeTickOutcome = {
      newsletters: newsletters.value.length,
      errors: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
    }
    for (const newsletter of newsletters.value) {
      const result = await CrmNewsletterWelcomeSendService.processNewsletter(
        newsletter,
        now,
      )
      if (!result.ok) {
        logger.error('crm.newsletter.welcome_newsletter_failed', {
          component: 'CrmNewsletterWelcomeSendService',
          newsletterId: newsletter.id,
          reason: result.error.code,
        })
        total.errors++
        continue
      }
      total.sent += result.value.sent
      total.skipped += result.value.skipped
      total.failed += result.value.failed
      total.deferred += result.value.deferred
    }
    // One broken newsletter never blocks the others.
    return ok(total)
  },
}
