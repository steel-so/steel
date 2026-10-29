import { mailDomain } from '@/src/lib/mail/senders'

/**
 * Platform domain a CRM campaign may send from without a verified domain of
 * its own (ADR 0055): Steel's own mail domain, verified on the Stratus
 * Resend account. Any address on it is accepted (exact domain match: a
 * subdomain is not); any other From must be on a VERIFIED sending domain of
 * the workspace. Client-safe (the wizards show it).
 */
export const PLATFORM_CAMPAIGN_DOMAIN = mailDomain

export function isPlatformCampaignSender(fromEmail: string): boolean {
  const value = fromEmail.trim().toLowerCase()
  const at = value.lastIndexOf('@')
  return at > 0 && value.slice(at + 1) === PLATFORM_CAMPAIGN_DOMAIN
}
