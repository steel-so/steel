import { createId } from '@paralleldrive/cuid2'
import {
  type CrmLead,
  type CrmLeadContactAttempt,
  type CrmLeadMeeting,
  type CrmLeadProposalPresentation,
  type CrmLeadQualification,
  type CrmLeadReopening,
  type CrmLeadRoutingRule,
  type CrmLeadScoringRule,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  CrmLeadDTO,
  CrmLeadReopeningDTO,
  CrmLeadRoutingRuleDTO,
  CrmLeadScoringRuleDTO,
} from '@/types/crm-lead'

export function createFakeCrmLead(overrides?: Partial<CrmLead>): CrmLead {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Jane Doe',
    emails: [],
    phones: [],
    company: null,
    jobTitle: null,
    city: null,
    linkedin: null,
    source: null,
    channel: null,
    stage: 'RECEIVED',
    score: 0,
    ownerId: null,
    convertedPersonId: null,
    closeResult: null,
    closedAt: null,
    contractSignedAt: null,
    billingType: null,
    closedAmount: null,
    lostReason: null,
    lostNote: null,
    retryAt: null,
    externalSource: null,
    externalId: null,
    createdById: createId(),
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeCrmLeadDTO(
  overrides?: Partial<CrmLeadDTO>,
): CrmLeadDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Jane Doe',
    emails: [],
    phones: [],
    company: null,
    jobTitle: null,
    city: null,
    linkedin: null,
    source: null,
    channel: null,
    stage: 'RECEIVED',
    score: 0,
    ownerId: null,
    convertedPersonId: null,
    closeResult: null,
    closedAt: null,
    contractSignedAt: null,
    billingType: null,
    closedAmount: null,
    lostReason: null,
    lostNote: null,
    retryAt: null,
    createdById: createId(),
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmLead(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmLead,
      | 'name'
      | 'emails'
      | 'phones'
      | 'company'
      | 'source'
      | 'stage'
      | 'score'
      | 'ownerId'
      | 'position'
      | 'deletedAt'
      | 'closeResult'
      | 'closedAt'
      | 'lostReason'
      | 'lostNote'
      | 'retryAt'
      | 'externalSource'
      | 'externalId'
    >
  >,
) {
  return prisma.crmLead.create({
    data: { name: 'Seed Lead', workspaceId, createdById, ...overrides },
  })
}

export function createFakeCrmLeadScoringRule(
  overrides?: Partial<CrmLeadScoringRule>,
): CrmLeadScoringRule {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    field: 'email',
    operator: 'is_not_empty',
    value: null,
    points: 10,
    active: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmLeadScoringRuleDTO(
  overrides?: Partial<CrmLeadScoringRuleDTO>,
): CrmLeadScoringRuleDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    workspaceId: createId(),
    field: 'email',
    operator: 'is_not_empty',
    value: null,
    points: 10,
    active: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmLeadScoringRule(
  workspaceId: string,
  overrides?: Partial<
    Pick<
      CrmLeadScoringRule,
      'field' | 'operator' | 'value' | 'points' | 'active' | 'position'
    >
  >,
) {
  return prisma.crmLeadScoringRule.create({
    data: {
      workspaceId,
      field: 'email',
      operator: 'is_not_empty',
      points: 10,
      ...overrides,
    },
  })
}

export function createFakeCrmLeadRoutingRule(
  overrides?: Partial<CrmLeadRoutingRule>,
): CrmLeadRoutingRule {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    field: 'source',
    operator: 'equals',
    value: 'ads',
    ownerId: createId(),
    active: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmLeadRoutingRuleDTO(
  overrides?: Partial<CrmLeadRoutingRuleDTO>,
): CrmLeadRoutingRuleDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    workspaceId: createId(),
    field: 'source',
    operator: 'equals',
    value: 'ads',
    ownerId: createId(),
    active: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmLeadRoutingRule(
  workspaceId: string,
  ownerId: string,
  overrides?: Partial<
    Pick<
      CrmLeadRoutingRule,
      'field' | 'operator' | 'value' | 'active' | 'position'
    >
  >,
) {
  return prisma.crmLeadRoutingRule.create({
    data: {
      workspaceId,
      ownerId,
      field: 'source',
      operator: 'equals',
      value: 'ads',
      ...overrides,
    },
  })
}

export function createFakeCrmLeadContactAttempt(
  overrides?: Partial<CrmLeadContactAttempt>,
): CrmLeadContactAttempt {
  const now = new Date()
  return {
    id: createId(),
    leadId: createId(),
    workspaceId: createId(),
    contactedWith: 'Maria Silva',
    channel: 'WHATSAPP',
    outcome: 'ATTEMPTED',
    occurredAt: now,
    note: null,
    createdById: createId(),
    createdAt: now,
    ...overrides,
  }
}

export async function seedCrmLeadContactAttempt(
  leadId: string,
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmLeadContactAttempt,
      'contactedWith' | 'channel' | 'outcome' | 'occurredAt' | 'note'
    >
  >,
) {
  return prisma.crmLeadContactAttempt.create({
    data: {
      leadId,
      workspaceId,
      createdById,
      contactedWith: 'Maria Silva',
      channel: 'WHATSAPP',
      occurredAt: new Date(),
      ...overrides,
    },
  })
}

export function createFakeCrmLeadQualification(
  overrides?: Partial<CrmLeadQualification>,
): CrmLeadQualification {
  const now = new Date()
  return {
    id: createId(),
    leadId: createId(),
    expectedCloseAt: null,
    decisionMakerName: 'Carlos Souza',
    decisionMakerRole: 'CTO',
    qualifiedById: createId(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmLeadQualification(
  leadId: string,
  qualifiedById: string,
  overrides?: Partial<
    Pick<
      CrmLeadQualification,
      'expectedCloseAt' | 'decisionMakerName' | 'decisionMakerRole'
    >
  >,
) {
  return prisma.crmLeadQualification.create({
    data: {
      leadId,
      qualifiedById,
      decisionMakerName: 'Carlos Souza',
      decisionMakerRole: 'CTO',
      ...overrides,
    },
  })
}

export function createFakeCrmLeadMeeting(
  overrides?: Partial<CrmLeadMeeting>,
): CrmLeadMeeting {
  const now = new Date()
  return {
    id: createId(),
    leadId: createId(),
    workspaceId: createId(),
    scheduledAt: now,
    format: 'ONLINE',
    contactPersonId: null,
    contactPersonName: 'Carlos Souza',
    interestDetails: 'Quer automatizar o funil de vendas',
    identifiedNeed: 'Falta de visibilidade do pipeline',
    createdById: createId(),
    createdAt: now,
    ...overrides,
  }
}

export async function seedCrmLeadMeeting(
  leadId: string,
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmLeadMeeting,
      | 'scheduledAt'
      | 'format'
      | 'contactPersonId'
      | 'contactPersonName'
      | 'interestDetails'
      | 'identifiedNeed'
    >
  >,
) {
  return prisma.crmLeadMeeting.create({
    data: {
      leadId,
      workspaceId,
      createdById,
      scheduledAt: new Date(),
      format: 'ONLINE',
      interestDetails: 'Quer automatizar o funil de vendas',
      identifiedNeed: 'Falta de visibilidade do pipeline',
      ...overrides,
    },
  })
}

export function createFakeCrmLeadProposalPresentation(
  overrides?: Partial<CrmLeadProposalPresentation>,
): CrmLeadProposalPresentation {
  const now = new Date()
  return {
    id: createId(),
    leadId: createId(),
    proposalId: createId(),
    presentedAt: now,
    format: 'ONLINE',
    amount: new Prisma.Decimal(1500),
    interestLevel: 'HIGH',
    interactionsCount: 3,
    createdById: createId(),
    createdAt: now,
    ...overrides,
  }
}

export async function seedCrmLeadProposalPresentation(
  leadId: string,
  proposalId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmLeadProposalPresentation,
      | 'presentedAt'
      | 'format'
      | 'amount'
      | 'interestLevel'
      | 'interactionsCount'
    >
  >,
) {
  return prisma.crmLeadProposalPresentation.create({
    data: {
      leadId,
      proposalId,
      createdById,
      presentedAt: new Date(),
      format: 'ONLINE',
      amount: 1500,
      interestLevel: 'HIGH',
      ...overrides,
    },
  })
}

/** Lead fechado como perdido — ponto de partida da reabertura. */
export function createFakeLostCrmLead(overrides?: Partial<CrmLead>): CrmLead {
  return createFakeCrmLead({
    stage: 'CLOSED',
    closeResult: 'LOST',
    closedAt: new Date(),
    lostReason: 'Preço',
    lostNote: 'Achou caro',
    ...overrides,
  })
}

export function createFakeCrmLeadReopening(
  overrides?: Partial<CrmLeadReopening>,
): CrmLeadReopening {
  return {
    id: createId(),
    leadId: createId(),
    workspaceId: createId(),
    toStage: 'RECEIVED',
    reason: 'Cliente voltou a responder',
    previousLostReason: 'Preço',
    previousLostNote: null,
    previousClosedAt: new Date(),
    previousRetryAt: null,
    reopenedById: createId(),
    createdAt: new Date(),
    ...overrides,
  }
}

export function createFakeCrmLeadReopeningDTO(
  overrides?: Partial<CrmLeadReopeningDTO>,
): CrmLeadReopeningDTO {
  return {
    id: createId(),
    leadId: createId(),
    toStage: 'RECEIVED',
    reason: 'Cliente voltou a responder',
    previousLostReason: 'Preço',
    previousLostNote: null,
    previousClosedAt: new Date().toISOString(),
    previousRetryAt: null,
    reopenedById: createId(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}
