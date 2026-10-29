import z from 'zod'
import type {
  CrmNewsletterSubscriberSourceValue,
  CrmNewsletterSubscriberStatusValue,
} from './crm-newsletter.schema'

/**
 * Newsletter ↔ CRM bridge (ADR 0054 phase 2): the "Newsletters" card of the
 * CRM person page. Timeline, scoring and workflow pieces live in their own
 * schemas (crm-lead / crm-workflow).
 */

/** Member subscribes the person (the member vouches for the consent). */
export const SubscribeCrmPersonNewsletterSchema = z.object({
  newsletterId: z.string().trim().min(1, 'Escolha uma newsletter'),
  /** One of the person's e-mails; omitted → the first one. */
  email: z.email('E-mail inválido').max(254).optional(),
  /** Double opt-in e-mail instead of ACTIVE right away. */
  sendConfirmation: z.boolean().default(false),
})

export type SubscribeCrmPersonNewsletterDTO = z.infer<
  typeof SubscribeCrmPersonNewsletterSchema
>

export type CrmPersonNewsletterSubscriptionDTO = {
  subscriberId: string
  newsletterId: string
  newsletterName: string
  newsletterArchived: boolean
  email: string
  status: CrmNewsletterSubscriberStatusValue
  source: CrmNewsletterSubscriberSourceValue
  consentAt: string | null
  confirmedAt: string | null
  unsubscribedAt: string | null
  lastOpenedAt: string | null
  lastClickedAt: string | null
  /** ACTIVE or PENDING: the card offers "Descadastrar". */
  canUnsubscribe: boolean
  /** Welcome series e-mails sent / opened / clicked (slice
   * nl3-welcome-bridge); null when none was sent. */
  welcome: { sent: number; opened: number; clicked: number } | null
}

export type CrmPersonNewslettersDTO = {
  personId: string
  /** The person's e-mails, lower-case (subscribe picks one). */
  emails: string[]
  subscriptions: CrmPersonNewsletterSubscriptionDTO[]
  /** Active newsletters the person can join (no subscription, or one that
   * ended with UNSUBSCRIBED — rejoining then asks for confirmation). */
  available: { id: string; name: string }[]
}
