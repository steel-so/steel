import { logger } from '@/lib/axiom/logger'
import { clickedLink, isPermanentBounce } from '@/src/lib/crm-newsletter/email'
import { ok, type Result } from '@/src/lib/result'
import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import type { ResendWebhookEvent } from '@/src/schemas/crm-campaign.schema'
import { CrmNewsletterBridge } from './crm-newsletter-bridge.service'

/**
 * Resend webhook events of newsletter issues (ADR 0054). The webhook route
 * asks this service first; `false` means the message is not a newsletter
 * e-mail and the campaign tracking takes over.
 *
 * - delivered / opened / clicked: first time on the recipient; opens and
 *   clicks also stamp the subscriber's `lastOpenedAt` / `lastClickedAt`;
 *   every click is stored with its URL (per-link report). A click implies
 *   an open (images blocked).
 * - bounced: permanent → the address is BOUNCED in every newsletter of the
 *   workspace; temporary → only recorded on the recipient.
 * - complained: the subscriber leaves that newsletter (COMPLAINED).
 */
export const CrmNewsletterTrackingService = {
  async onEmailEvent(
    event: ResendWebhookEvent,
    now: Date,
  ): Promise<Result<boolean>> {
    const found = await CrmNewsletterDeliveryRepository.findByProviderMessageId(
      event.data.email_id,
    )
    if (!found.ok) return found
    if (!found.value) return ok(false)
    const recipient = found.value
    const R = CrmNewsletterDeliveryRepository
    const at = eventTime(event, now)

    switch (event.type) {
      case 'email.delivered': {
        const marked = await R.markFirst(recipient.id, 'deliveredAt', at)
        if (!marked.ok) return marked
        if (marked.value) {
          await CrmNewsletterBridge.emit({
            type: 'issue_received',
            subscriberId: recipient.subscriberId,
            issueId: recipient.issueId,
          })
        }
        break
      }
      case 'email.opened': {
        const marked = await R.markFirst(recipient.id, 'openedAt', at)
        if (!marked.ok) return marked
        const touched = await R.touchSubscriber(
          recipient.subscriberId,
          'lastOpenedAt',
          at,
        )
        if (!touched.ok) return touched
        if (marked.value) {
          await CrmNewsletterBridge.emit({
            type: 'issue_opened',
            subscriberId: recipient.subscriberId,
            issueId: recipient.issueId,
          })
        }
        break
      }
      case 'email.clicked': {
        const opened = await R.markFirst(recipient.id, 'openedAt', at)
        if (!opened.ok) return opened
        const clicked = await R.markFirst(recipient.id, 'clickedAt', at)
        if (!clicked.ok) return clicked
        const url = clickedLink(event.data)
        if (url) {
          const recorded = await R.recordClick({
            issueId: recipient.issueId,
            recipientId: recipient.id,
            url,
            clickedAt: at,
          })
          if (!recorded.ok) return recorded
        }
        const touched = await R.touchSubscriber(
          recipient.subscriberId,
          'lastClickedAt',
          at,
        )
        if (!touched.ok) return touched
        if (opened.value) {
          await CrmNewsletterBridge.emit({
            type: 'issue_opened',
            subscriberId: recipient.subscriberId,
            issueId: recipient.issueId,
          })
        }
        await CrmNewsletterBridge.emit({
          type: 'link_clicked',
          subscriberId: recipient.subscriberId,
          issueId: recipient.issueId,
          recipientId: recipient.id,
          url,
        })
        break
      }
      case 'email.bounced': {
        const marked = await R.markFirst(recipient.id, 'bouncedAt', at)
        if (!marked.ok) return marked
        if (isPermanentBounce(event.data)) {
          const bounced = await R.bounceEverywhere(
            recipient.issue.workspaceId,
            recipient.email,
            at,
          )
          if (!bounced.ok) return bounced
          logger.info('crm.newsletter.hard_bounce', {
            component: 'CrmNewsletterTrackingService',
            workspaceId: recipient.issue.workspaceId,
            issueId: recipient.issueId,
            subscriptions: bounced.value,
          })
        }
        break
      }
      case 'email.complained': {
        const marked = await R.markFirst(recipient.id, 'complainedAt', at)
        if (!marked.ok) return marked
        const complained = await R.complain(recipient.subscriberId, at)
        if (!complained.ok) return complained
        logger.info('crm.newsletter.complaint', {
          component: 'CrmNewsletterTrackingService',
          workspaceId: recipient.issue.workspaceId,
          issueId: recipient.issueId,
        })
        break
      }
      default:
        break
    }
    // A newsletter message: never fall through to the campaigns.
    return ok(true)
  },
}

/** The event's own timestamp when valid (webhooks may arrive late). */
function eventTime(event: ResendWebhookEvent, now: Date): Date {
  const raw = event.created_at ? new Date(event.created_at) : null
  return raw && !Number.isNaN(raw.getTime()) && raw <= now ? raw : now
}
