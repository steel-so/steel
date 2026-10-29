import type {
  CrmLead,
  CrmLeadContactAttempt,
  CrmLeadMeeting,
  CrmLeadProposalPresentation,
  CrmLeadQualification,
  CrmLeadReopening,
  CrmLeadRoutingRule,
  CrmLeadScoringRule,
} from '@prisma/client'
import type {
  CrmLeadContactAttemptDTO,
  CrmLeadDTO,
  CrmLeadMeetingDTO,
  CrmLeadProposalPresentationDTO,
  CrmLeadQualificationDTO,
  CrmLeadReopeningDTO,
  CrmLeadRoutingRuleDTO,
  CrmLeadScoringRuleDTO,
} from '@/types/crm-lead'

export function toCrmLeadDTO(lead: CrmLead): CrmLeadDTO {
  return {
    id: lead.id,
    workspaceId: lead.workspaceId,
    name: lead.name,
    emails: lead.emails,
    phones: lead.phones,
    company: lead.company,
    jobTitle: lead.jobTitle,
    city: lead.city,
    linkedin: lead.linkedin,
    source: lead.source,
    channel: lead.channel,
    stage: lead.stage,
    score: lead.score,
    ownerId: lead.ownerId,
    convertedPersonId: lead.convertedPersonId,
    closeResult: lead.closeResult,
    closedAt: lead.closedAt?.toISOString() ?? null,
    contractSignedAt: lead.contractSignedAt?.toISOString() ?? null,
    billingType: lead.billingType,
    closedAmount: lead.closedAmount ? Number(lead.closedAmount) : null,
    lostReason: lead.lostReason,
    lostNote: lead.lostNote,
    retryAt: lead.retryAt?.toISOString() ?? null,
    createdById: lead.createdById,
    updatedById: lead.updatedById,
    position: lead.position,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  }
}

export function toCrmLeadScoringRuleDTO(
  rule: CrmLeadScoringRule,
): CrmLeadScoringRuleDTO {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
    points: rule.points,
    active: rule.active,
    includeWelcome: rule.includeWelcome,
    position: rule.position,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

export function toCrmLeadRoutingRuleDTO(
  rule: CrmLeadRoutingRule,
): CrmLeadRoutingRuleDTO {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
    ownerId: rule.ownerId,
    active: rule.active,
    position: rule.position,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

export function toCrmLeadContactAttemptDTO(
  attempt: CrmLeadContactAttempt,
): CrmLeadContactAttemptDTO {
  return {
    id: attempt.id,
    leadId: attempt.leadId,
    workspaceId: attempt.workspaceId,
    contactedWith: attempt.contactedWith,
    channel: attempt.channel,
    outcome: attempt.outcome,
    occurredAt: attempt.occurredAt.toISOString(),
    note: attempt.note,
    createdById: attempt.createdById,
    createdAt: attempt.createdAt.toISOString(),
  }
}

export function toCrmLeadQualificationDTO(
  qualification: CrmLeadQualification,
): CrmLeadQualificationDTO {
  return {
    id: qualification.id,
    leadId: qualification.leadId,
    expectedCloseAt: qualification.expectedCloseAt?.toISOString() ?? null,
    decisionMakerName: qualification.decisionMakerName,
    decisionMakerRole: qualification.decisionMakerRole,
    qualifiedById: qualification.qualifiedById,
    createdAt: qualification.createdAt.toISOString(),
    updatedAt: qualification.updatedAt.toISOString(),
  }
}

export function toCrmLeadMeetingDTO(
  meeting: CrmLeadMeeting,
): CrmLeadMeetingDTO {
  return {
    id: meeting.id,
    leadId: meeting.leadId,
    workspaceId: meeting.workspaceId,
    scheduledAt: meeting.scheduledAt.toISOString(),
    format: meeting.format,
    contactPersonId: meeting.contactPersonId,
    contactPersonName: meeting.contactPersonName,
    interestDetails: meeting.interestDetails,
    identifiedNeed: meeting.identifiedNeed,
    createdById: meeting.createdById,
    createdAt: meeting.createdAt.toISOString(),
  }
}

export function toCrmLeadProposalPresentationDTO(
  presentation: CrmLeadProposalPresentation,
): CrmLeadProposalPresentationDTO {
  return {
    id: presentation.id,
    leadId: presentation.leadId,
    proposalId: presentation.proposalId,
    presentedAt: presentation.presentedAt.toISOString(),
    format: presentation.format,
    amount: Number(presentation.amount),
    interestLevel: presentation.interestLevel,
    interactionsCount: presentation.interactionsCount,
    createdById: presentation.createdById,
    createdAt: presentation.createdAt.toISOString(),
  }
}

export function toCrmLeadReopeningDTO(
  reopening: CrmLeadReopening,
): CrmLeadReopeningDTO {
  return {
    id: reopening.id,
    leadId: reopening.leadId,
    toStage: reopening.toStage,
    reason: reopening.reason,
    previousLostReason: reopening.previousLostReason,
    previousLostNote: reopening.previousLostNote,
    previousClosedAt: reopening.previousClosedAt?.toISOString() ?? null,
    previousRetryAt: reopening.previousRetryAt?.toISOString() ?? null,
    reopenedById: reopening.reopenedById,
    createdAt: reopening.createdAt.toISOString(),
  }
}
