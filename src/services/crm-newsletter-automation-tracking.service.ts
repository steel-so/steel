import { logger } from '@/lib/axiom/logger'
import { isPermanentBounce } from '@/src/lib/crm-newsletter/email'
import { ok, type Result } from '@/src/lib/result'
import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import { CrmNewsletterReengagementRepository } from '@/src/repositories/crm-newsletter-reengagement.repository'
import { CrmNewsletterWelcomeRepository } from '@/src/repositories/crm-newsletter-welcome.repository'
import type { ResendWebhookEvent } from '@/src/schemas/crm-campaign.schema'

/**
 * Resend webhook events of the newsletter automation e-mails (slice
 * nl2-automation) — the route asks this service after the issue tracking
 * and before the campaigns; `false` means the message is not a welcome or
 * re-engagement e-mail.
 *
 * Same rules as an issue: opens and clicks are stamped once on the row and
 * refresh the subscriber's `lastOpenedAt` / `lastClickedAt` (which is what
 * the re-engagement rule reads); a permanent bounce makes the address
 * BOUNCED in every newsletter of the workspace; a complaint takes the
 * subscriber out of that newsletter.
 */

type Kind = 'welcome' | 'reengagement'
type Row = {
  id: string
  subscriberId: string
  workspaceId: string
  email: string
}

async function subscriberSideEffects(
  kind: Kind,
  row: Row,
  event: ResendWebhookEvent,
  at: Date,
): Promise<Result<void>> {
  const D = CrmNewsletterDeliveryRepository
  switch (event.type) {
    case 'email.opened':
      return D.touchSubscriber(row.subscriberId, 'lastOpenedAt', at)
    case 'email.clicked': {
      const opened = await D.touchSubscriber(
        row.subscriberId,
        'lastOpenedAt',
        at,
      )
      if (!opened.ok) return opened
      return D.touchSubscriber(row.subscriberId, 'lastClickedAt', at)
    }
    case 'email.bounced': {
      if (!isPermanentBounce(event.data)) return ok(undefined)
      const bounced = await D.bounceEverywhere(row.workspaceId, row.email, at)
      if (!bounced.ok) return bounced
      logger.info('crm.newsletter.automation_hard_bounce', {
        component: 'CrmNewsletterAutomationTrackingService',
        kind,
        workspaceId: row.workspaceId,
        subscriptions: bounced.value,
      })
      return ok(undefined)
    }
    case 'email.complained': {
      const complained = await D.complain(row.subscriberId, at)
      if (!complained.ok) return complained
      logger.info('crm.newsletter.automation_complaint', {
        component: 'CrmNewsletterAutomationTrackingService',
        kind,
        workspaceId: row.workspaceId,
      })
      return ok(undefined)
    }
    default:
      return ok(undefined)
  }
}

async function onWelcome(
  event: ResendWebhookEvent,
  at: Date,
): Promise<Result<boolean>> {
  const R = CrmNewsletterWelcomeRepository
  const found = await R.findByProviderMessageId(event.data.email_id)
  if (!found.ok) return found
  if (!found.value) return ok(false)
  const row = found.value
  const marks: Partial<
    Record<
      ResendWebhookEvent['type'],
      Array<
        'deliveredAt' | 'openedAt' | 'clickedAt' | 'bouncedAt' | 'complainedAt'
      >
    >
  > = {
    'email.delivered': ['deliveredAt'],
    'email.opened': ['openedAt'],
    // A click implies an open (images blocked).
    'email.clicked': ['openedAt', 'clickedAt'],
    'email.bounced': ['bouncedAt'],
    'email.complained': ['complainedAt'],
  }
  for (const field of marks[event.type] ?? []) {
    const marked = await R.markFirst(row.id, field, at)
    if (!marked.ok) return marked
  }
  const effects = await subscriberSideEffects('welcome', row, event, at)
  if (!effects.ok) return effects
  return ok(true)
}

async function onReengagement(
  event: ResendWebhookEvent,
  at: Date,
): Promise<Result<boolean>> {
  const R = CrmNewsletterReengagementRepository
  const found = await R.findByProviderMessageId(event.data.email_id)
  if (!found.ok) return found
  if (!found.value) return ok(false)
  const row = found.value
  if (event.type === 'email.opened' || event.type === 'email.clicked') {
    const opened = await R.markFirst(row.id, 'openedAt', at)
    if (!opened.ok) return opened
  }
  if (event.type === 'email.clicked') {
    const clicked = await R.markFirst(row.id, 'clickedAt', at)
    if (!clicked.ok) return clicked
  }
  const effects = await subscriberSideEffects('reengagement', row, event, at)
  if (!effects.ok) return effects
  return ok(true)
}

export const CrmNewsletterAutomationTrackingService = {
  async onEmailEvent(
    event: ResendWebhookEvent,
    now: Date,
  ): Promise<Result<boolean>> {
    const at = eventTime(event, now)
    const welcome = await onWelcome(event, at)
    if (!welcome.ok || welcome.value) return welcome
    return onReengagement(event, at)
  },
}

/** The event's own timestamp when valid (webhooks may arrive late). */
function eventTime(event: ResendWebhookEvent, now: Date): Date {
  const raw = event.created_at ? new Date(event.created_at) : null
  return raw && !Number.isNaN(raw.getTime()) && raw <= now ? raw : now
}
