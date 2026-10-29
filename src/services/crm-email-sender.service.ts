import { ok, type Result } from '@/src/lib/result'
import { PLATFORM_CAMPAIGN_SENDER } from '@/src/lib/sending-domain/platform-sender'
import { SendingDomainRepository } from '@/src/repositories/sending-domain.repository'
import type { CrmEmailSenderOptionsDTO } from '@/types/crm-email-sender'
import { assertModuleMember } from './authz'

/**
 * Sender picker of the campaign wizards (ADR 0055). Readable by anyone who
 * can see CRM e-mail (the domain list itself is OWNER/ADMIN in Ajustes):
 * only the names of VERIFIED domains leave, never records or ids.
 */
export const CrmEmailSenderService = {
  async options(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailSenderOptionsDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const domains = await SendingDomainRepository.listByWorkspace(workspaceId)
    if (!domains.ok) return domains

    return ok({
      platformAddress: PLATFORM_CAMPAIGN_SENDER,
      verifiedDomains: domains.value
        .filter((domain) => domain.status === 'VERIFIED')
        .map((domain) => domain.name)
        .sort((a, b) => a.localeCompare(b)),
    })
  },
}
