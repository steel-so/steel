import type { CrmNewsletterSubscriber } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { sendCrmNewsletterConfirmationEmail } from '@/src/lib/mail/crm/send-newsletter-confirmation'
import { mailAddresses } from '@/src/lib/mail/senders'
import { createConfirmToken } from '@/src/lib/newsletter/tokens'
import { newsletterConfirmUrl } from '@/src/lib/newsletter/urls'
import { ok, type Result } from '@/src/lib/result'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmNewsletterSubscriberRepository } from '@/src/repositories/crm-newsletter-subscriber.repository'
import { CRM_NEWSLETTER_CONFIRM_TTL_DAYS } from '@/src/schemas/crm-newsletter.schema'

/** A new confirmation e-mail goes out at most once per 10 minutes. */
export const CONFIRM_RESEND_INTERVAL_MS = 10 * 60 * 1000

/** Seconds left until the next confirmation e-mail may go out (0 = now). */
export function confirmResendWaitSeconds(
  subscriber: Pick<CrmNewsletterSubscriber, 'confirmSentAt'>,
  now: Date,
): number {
  if (!subscriber.confirmSentAt) return 0
  const elapsed = now.getTime() - subscriber.confirmSentAt.getTime()
  return elapsed >= CONFIRM_RESEND_INTERVAL_MS
    ? 0
    : Math.ceil((CONFIRM_RESEND_INTERVAL_MS - elapsed) / 1000)
}

/** `"Display Name" <address>` with the quote characters stripped. */
export function formatSender(name: string, email: string): string {
  const safe = name.replace(/["\\\r\n<>]/g, '').trim()
  return safe ? `"${safe}" <${email}>` : email
}

export type ConfirmationNewsletter = {
  workspaceId: string
  name: string
  fromName: string
  fromEmail: string
  replyTo: string | null
}

/**
 * Sends the double opt-in e-mail and stamps `confirmSentAt`. From the
 * newsletter's own address when its domain is VERIFIED; otherwise from the
 * Steel notifications address with Reply-To on the newsletter sender, so an
 * unverified domain never appears in From. A delivery failure is logged and
 * answered with `ok(false)`: subscribing must not fail because of it.
 */
export async function sendNewsletterConfirmation(input: {
  subscriber: Pick<CrmNewsletterSubscriber, 'id' | 'email' | 'name'>
  newsletter: ConfirmationNewsletter
  publisherName: string
  now: Date
}): Promise<Result<boolean>> {
  const { subscriber, newsletter, now } = input

  const verified = await resolveVerifiedSender(
    newsletter.workspaceId,
    newsletter.fromEmail,
  )
  if (!verified.ok && verified.error.code !== 'SENDING_DOMAIN_NOT_VERIFIED') {
    return verified
  }
  const from = verified.ok
    ? formatSender(newsletter.fromName, newsletter.fromEmail)
    : formatSender(newsletter.fromName, mailAddresses.notifications)
  const replyTo = verified.ok
    ? (newsletter.replyTo ?? undefined)
    : (newsletter.replyTo ?? newsletter.fromEmail)

  const token = createConfirmToken(subscriber.id, now)
  try {
    await sendCrmNewsletterConfirmationEmail({
      to: subscriber.email,
      from,
      replyTo,
      newsletterName: newsletter.name,
      publisherName: input.publisherName,
      name: subscriber.name,
      confirmUrl: newsletterConfirmUrl(BETTER_AUTH_URL, token),
      expiresInDays: CRM_NEWSLETTER_CONFIRM_TTL_DAYS,
    })
  } catch (error) {
    logger.warn('crm_newsletter.confirmation_send_failed', {
      subscriberId: subscriber.id,
      workspaceId: newsletter.workspaceId,
      cause: error instanceof Error ? error.message : String(error),
    })
    return ok(false)
  }

  const stamped = await CrmNewsletterSubscriberRepository.update(
    subscriber.id,
    { confirmSentAt: now },
  )
  if (!stamped.ok) return stamped
  return ok(true)
}
