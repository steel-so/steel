import { phoneCallNotFound, phoneCallRecordingNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type PhoneCallWithNames,
  toPhoneCallRecordDTO,
} from '@/src/mappers/whatsapp-phone-call.mapper'
import {
  type PhoneCallSource,
  WhatsAppPhoneCallRepository,
} from '@/src/repositories/whatsapp-phone-call.repository'
import type { PhoneCallRecordDTO } from '@/types/whatsapp-phone-call'
import { assertModuleMember } from './authz'
import { SdAccess } from './sd-access'
import { SdTicketEngine } from './sd-ticket-engine'
import { loadConversationForViewer } from './whatsapp-conversation-scope.service'

async function list(
  workspaceId: string,
  source: PhoneCallSource,
): Promise<Result<PhoneCallRecordDTO[]>> {
  const rows = await WhatsAppPhoneCallRepository.listBySource(
    workspaceId,
    source,
  )
  if (!rows.ok) return rows
  return ok(rows.value.map(toPhoneCallRecordDTO))
}

async function canSeeConversation(
  actorId: string,
  workspaceId: string,
  conversationId: string,
): Promise<boolean> {
  const membership = await assertModuleMember(
    actorId,
    workspaceId,
    'COMMUNICATION',
    { resource: 'conversations', action: 'VIEW' },
  )
  if (!membership.ok) return false
  const visible = await loadConversationForViewer(
    { userId: actorId, role: membership.value.role },
    workspaceId,
    conversationId,
  )
  return visible.ok
}

/** Whoever sees any record the call is attached to may hear it. */
async function canSeeCall(
  actorId: string,
  workspaceId: string,
  call: PhoneCallWithNames,
): Promise<boolean> {
  if (await canSeeConversation(actorId, workspaceId, call.conversationId))
    return true
  if (call.sdTicketId) {
    const agent = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
    if (agent.ok) return true
  }
  if (call.crmOpportunityId) {
    const crm = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (crm.ok) return true
  }
  if (call.crmPersonId) {
    const crm = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'people',
      action: 'VIEW',
    })
    if (crm.ok) return true
  }
  return false
}

/**
 * The calls of a record, for its timeline (ADR 0043). Each list follows the
 * visibility of the record it hangs on: the conversation (team/assignee
 * scope), the ticket (ServiceDesk agents only — requesters never hear a
 * recording) and the CRM person/opportunity (RBAC of that resource).
 */
export const PhoneCallService = {
  async listForConversation(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<PhoneCallRecordDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership
    const visible = await loadConversationForViewer(
      { userId: actorId, role: membership.value.role },
      workspaceId,
      conversationId,
    )
    if (!visible.ok) return visible
    return list(workspaceId, { conversationId })
  },

  async listForTicket(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<PhoneCallRecordDTO[]>> {
    const agent = await SdAccess.requireAgent(actorId, workspaceId, {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
    if (!agent.ok) return agent
    const config = await SdTicketEngine.loadConfig(workspaceId)
    if (!config.ok) return config
    const ticket = await SdTicketEngine.resolveRef(
      workspaceId,
      ticketRef,
      config.value.prefixes,
    )
    if (!ticket.ok) return ticket
    return list(workspaceId, { sdTicketId: ticket.value.id })
  },

  async listForCrmPerson(
    actorId: string,
    workspaceId: string,
    personId: string,
  ): Promise<Result<PhoneCallRecordDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'people',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    return list(workspaceId, { crmPersonId: personId })
  },

  async listForCrmOpportunity(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
  ): Promise<Result<PhoneCallRecordDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    return list(workspaceId, { crmOpportunityId: opportunityId })
  },

  /**
   * Object of the recording, after the visibility check. A call the actor
   * cannot see answers "not found" (its existence is not revealed).
   */
  async recordingFor(
    actorId: string,
    workspaceId: string,
    callId: string,
  ): Promise<Result<{ key: string; mimeType: string; sizeBytes: number }>> {
    const found = await WhatsAppPhoneCallRepository.findWithNames(
      callId,
      workspaceId,
    )
    if (!found.ok) return found
    const call = found.value
    if (!call || !(await canSeeCall(actorId, workspaceId, call)))
      return err(phoneCallNotFound())
    if (!call.recordingKey || !call.recordingMimeType)
      return err(phoneCallRecordingNotFound())
    return ok({
      key: call.recordingKey,
      mimeType: call.recordingMimeType,
      sizeBytes: call.recordingSizeBytes ?? 0,
    })
  },
}
