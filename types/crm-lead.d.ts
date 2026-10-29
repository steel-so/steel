export type CrmLeadStageDTO =
  | 'RECEIVED'
  | 'IN_CONTACT'
  | 'QUALIFIED'
  | 'OPPORTUNITY'
  | 'PROPOSAL'
  | 'CLOSED'

export type CrmLeadCloseResultDTO = 'WON' | 'LOST'

export type CrmLeadBillingTypeDTO = 'ONE_TIME' | 'MONTHLY' | 'YEARLY'

export type CrmLeadContactChannelDTO =
  | 'PHONE'
  | 'WHATSAPP'
  | 'EMAIL'
  | 'MEETING'
  | 'OTHER'

export type CrmLeadContactOutcomeDTO = 'ATTEMPTED' | 'REACHED'

export type CrmLeadMeetingFormatDTO = 'IN_PERSON' | 'ONLINE'

export type CrmLeadProposalFormatDTO = 'IN_PERSON' | 'ONLINE' | 'EMAIL' | 'OTHER'

export type CrmLeadInterestLevelDTO =
  | 'VERY_LOW'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'VERY_HIGH'

export type CrmLeadRuleFieldDTO =
  | 'name'
  | 'email'
  | 'phone'
  | 'company'
  | 'jobTitle'
  | 'source'
  | 'city'
  | 'newsletter_subscribed'
  | 'newsletter_opened'
  | 'newsletter_clicked'

export type CrmLeadRuleOperatorDTO =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty'

export interface CrmLeadDTO {
  id: string
  workspaceId: string
  name: string
  emails: string[]
  phones: string[]
  company: string | null
  jobTitle: string | null
  city: string | null
  linkedin: string | null
  source: string | null
  channel: string | null
  stage: CrmLeadStageDTO
  score: number
  ownerId: string | null
  convertedPersonId: string | null
  closeResult: CrmLeadCloseResultDTO | null
  closedAt: string | null
  contractSignedAt: string | null
  billingType: CrmLeadBillingTypeDTO | null
  closedAmount: number | null
  lostReason: string | null
  lostNote: string | null
  retryAt: string | null
  createdById: string
  updatedById: string | null
  position: number
  createdAt: string
  updatedAt: string
}

export interface CrmLeadContactAttemptDTO {
  id: string
  leadId: string
  workspaceId: string
  contactedWith: string
  channel: CrmLeadContactChannelDTO
  outcome: CrmLeadContactOutcomeDTO
  occurredAt: string
  note: string | null
  createdById: string
  createdAt: string
}

export interface CrmLeadQualificationDTO {
  id: string
  leadId: string
  expectedCloseAt: string | null
  decisionMakerName: string
  decisionMakerRole: string
  qualifiedById: string
  createdAt: string
  updatedAt: string
}

export interface CrmLeadMeetingDTO {
  id: string
  leadId: string
  workspaceId: string
  scheduledAt: string
  format: CrmLeadMeetingFormatDTO
  contactPersonId: string | null
  contactPersonName: string | null
  interestDetails: string
  identifiedNeed: string
  createdById: string
  createdAt: string
}

export interface CrmLeadProposalPresentationDTO {
  id: string
  leadId: string
  proposalId: string
  presentedAt: string
  format: CrmLeadProposalFormatDTO
  amount: number
  interestLevel: CrmLeadInterestLevelDTO
  interactionsCount: number
  createdById: string
  createdAt: string
}

export interface CrmLeadScoringRuleDTO {
  id: string
  workspaceId: string
  field: CrmLeadRuleFieldDTO
  operator: CrmLeadRuleOperatorDTO
  value: string | null
  points: number
  active: boolean
  position: number
  createdAt: string
  updatedAt: string
}

export interface CrmLeadRoutingRuleDTO {
  id: string
  workspaceId: string
  field: CrmLeadRuleFieldDTO
  operator: CrmLeadRuleOperatorDTO
  value: string | null
  ownerId: string
  active: boolean
  position: number
  createdAt: string
  updatedAt: string
}

/** Reabertura de um lead perdido (com o snapshot da perda desfeita). */
export interface CrmLeadReopeningDTO {
  id: string
  leadId: string
  toStage: CrmLeadStageDTO
  reason: string
  previousLostReason: string | null
  previousLostNote: string | null
  previousClosedAt: string | null
  previousRetryAt: string | null
  reopenedById: string
  createdAt: string
}
