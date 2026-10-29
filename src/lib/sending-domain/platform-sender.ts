import { mailAddresses } from '@/src/lib/mail/senders'

/**
 * Platform address a CRM campaign may send from without a verified domain of
 * its own (ADR 0055): the Steel notifications address, the same fallback the
 * newsletter confirmation e-mail uses. Any other From must be on a VERIFIED
 * sending domain of the workspace. Client-safe (the wizards show it).
 */
export const PLATFORM_CAMPAIGN_SENDER = mailAddresses.notifications

export function isPlatformCampaignSender(fromEmail: string): boolean {
  return fromEmail.trim().toLowerCase() === PLATFORM_CAMPAIGN_SENDER
}
