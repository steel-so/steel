import { logger } from '@/lib/axiom/logger'
import { phoneMatchKey, waIdCandidates } from '@/src/lib/pabx/recording'
import type { Result } from '@/src/lib/result'
import { PhoneCallLinkRepository } from '@/src/repositories/phone-call-link.repository'

/** The call fields the links are derived from. */
export interface PhoneCallLinkInput {
  id: string
  workspaceId: string
  conversationId: string | null
  /** Remote number of the call, any format. */
  destination: string
}

export interface PhoneCallLinks {
  sdTicketId: string | null
  crmPersonId: string | null
  crmOpportunityId: string | null
}

/** A lookup that fails only loses that link; the call still lands. */
function linkOrNull(
  result: Result<string | null>,
  call: PhoneCallLinkInput,
  link: string,
): string | null {
  if (result.ok) return result.value
  logger.warn('phone_call.link_lookup_failed', {
    component: 'PhoneCallLinkService',
    workspaceId: call.workspaceId,
    callId: call.id,
    link,
  })
  return null
}

/**
 * Which records a call belongs to (ADR 0043): shared by the click-to-call
 * recording flow and the browser phone (ADR 0044), so both link by the same
 * rules — the ticket of the conversation, the CRM person with the same
 * phone and that person's open opportunity.
 */
export const PhoneCallLinkService = {
  /** Conversation of the contact with this number, for calls placed or received by number alone. */
  async findConversationId(
    workspaceId: string,
    phone: string,
  ): Promise<string | null> {
    const found = await PhoneCallLinkRepository.findConversationByWaIds(
      workspaceId,
      waIdCandidates(phone),
    )
    if (found.ok) return found.value
    logger.warn('phone_call.link_lookup_failed', {
      component: 'PhoneCallLinkService',
      workspaceId,
      link: 'conversation',
    })
    return null
  },

  async resolve(call: PhoneCallLinkInput): Promise<PhoneCallLinks> {
    const sdTicketId = call.conversationId
      ? linkOrNull(
          await PhoneCallLinkRepository.findTicketForConversation(
            call.workspaceId,
            call.conversationId,
          ),
          call,
          'sd_ticket',
        )
      : null
    const key = phoneMatchKey(call.destination)
    const crmPersonId = key
      ? linkOrNull(
          await PhoneCallLinkRepository.findPersonByPhoneKey(
            call.workspaceId,
            key,
          ),
          call,
          'crm_person',
        )
      : null
    const crmOpportunityId = crmPersonId
      ? linkOrNull(
          await PhoneCallLinkRepository.findOpenOpportunityForPerson(
            call.workspaceId,
            crmPersonId,
          ),
          call,
          'crm_opportunity',
        )
      : null
    return { sdTicketId, crmPersonId, crmOpportunityId }
  },
}
