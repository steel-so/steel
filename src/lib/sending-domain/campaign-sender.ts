import { sendingDomainNotVerified } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  isPlatformCampaignSender,
  PLATFORM_CAMPAIGN_DOMAIN,
} from './platform-sender'
import { resolveVerifiedSender } from './resolve-sender'

/** pt-BR reason shown in the checklists and on failed recipients. */
export function campaignSenderBlockedMessage(fromEmail: string): string {
  return `O remetente ${fromEmail} não é de um domínio verificado deste workspace. Verifique o domínio em Ajustes › Domínios de e-mail ou use um endereço @${PLATFORM_CAMPAIGN_DOMAIN}.`
}

/**
 * Whether a CRM campaign (multichannel or legacy e-mail) may send from
 * `fromEmail` (ADR 0055): an address on the platform domain, or an address on a VERIFIED
 * sending domain of the workspace. Refusal is `SENDING_DOMAIN_NOT_VERIFIED`
 * with `campaignSenderBlockedMessage`; a lookup failure propagates.
 */
export async function checkCampaignSender(
  workspaceId: string,
  fromEmail: string,
): Promise<Result<{ platform: boolean }>> {
  if (isPlatformCampaignSender(fromEmail)) return ok({ platform: true })
  const verified = await resolveVerifiedSender(workspaceId, fromEmail)
  if (verified.ok) return ok({ platform: false })
  if (verified.error.code !== 'SENDING_DOMAIN_NOT_VERIFIED') return verified
  return err(sendingDomainNotVerified(campaignSenderBlockedMessage(fromEmail)))
}
