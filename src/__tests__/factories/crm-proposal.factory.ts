import { createId } from '@paralleldrive/cuid2'
import type {
  CrmProposal,
  CrmProposalSection,
  CrmProposalSectionType,
  CrmProposalView,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { CrmProposalSectionContent } from '@/src/schemas/crm-proposal.schema'
import type {
  CrmProposalDTO,
  CrmProposalSectionDTO,
} from '@/types/crm-proposal'

export function fakeCoverContent(
  overrides?: Partial<Extract<CrmProposalSectionContent, { type: 'COVER' }>>,
): CrmProposalSectionContent {
  return {
    type: 'COVER',
    title: 'Proposta Comercial',
    ...overrides,
  }
}

export function createFakeCrmProposal(
  overrides?: Partial<CrmProposal>,
): CrmProposal {
  const now = new Date()
  return {
    id: createId(),
    name: 'Proposta X',
    templateId: null,
    companyId: null,
    contactId: null,
    opportunityId: null,
    leadId: null,
    responsibleId: createId(),
    validUntil: null,
    status: 'DRAFT',
    sentAt: null,
    acceptedAt: null,
    acceptedByName: null,
    expiredAt: null,
    shareToken: createId(),
    workspaceId: createId(),
    createdById: createId(),
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeCrmProposalSection(
  overrides?: Partial<CrmProposalSection>,
): CrmProposalSection {
  const now = new Date()
  return {
    id: createId(),
    proposalId: createId(),
    type: 'COVER' as CrmProposalSectionType,
    order: 0,
    enabled: true,
    content: fakeCoverContent() as unknown as Prisma.JsonValue,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmProposalDTO(
  overrides?: Partial<CrmProposalDTO>,
): CrmProposalDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    name: 'Proposta X',
    templateId: null,
    companyId: null,
    contactId: null,
    opportunityId: null,
    leadId: null,
    responsibleId: createId(),
    validUntil: null,
    status: 'DRAFT',
    isExpired: false,
    acceptedAt: null,
    acceptedByName: null,
    expiredAt: null,
    shareToken: createId(),
    viewsCount: 0,
    sections: [],
    workspaceId: createId(),
    createdById: createId(),
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmProposalSectionDTO(
  overrides?: Partial<CrmProposalSectionDTO>,
): CrmProposalSectionDTO {
  return {
    id: createId(),
    type: 'COVER',
    order: 0,
    enabled: true,
    content: fakeCoverContent(),
    ...overrides,
  }
}

export async function seedCrmProposal(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmProposal,
      | 'name'
      | 'status'
      | 'companyId'
      | 'contactId'
      | 'opportunityId'
      | 'responsibleId'
      | 'validUntil'
      | 'templateId'
      | 'position'
      | 'deletedAt'
      | 'leadId'
      | 'acceptedAt'
      | 'acceptedByName'
      | 'expiredAt'
    >
  >,
) {
  return prisma.crmProposal.create({
    data: {
      name: 'Seed Proposal',
      shareToken: createId(),
      workspaceId,
      createdById,
      responsibleId: overrides?.responsibleId ?? createdById,
      ...overrides,
    },
  })
}

export async function seedCrmProposalSection(
  proposalId: string,
  overrides?: Partial<
    Pick<CrmProposalSection, 'type' | 'order' | 'enabled'>
  > & {
    content?: Prisma.InputJsonValue
  },
) {
  return prisma.crmProposalSection.create({
    data: {
      proposalId,
      type: 'COVER',
      order: 0,
      content: fakeCoverContent() as unknown as Prisma.InputJsonValue,
      ...overrides,
    },
  })
}

export async function seedCrmProposalView(
  proposalId: string,
  overrides?: Partial<
    Pick<
      CrmProposalView,
      'viewId' | 'durationMs' | 'reachedEnd' | 'scrolledPct'
    >
  >,
) {
  return prisma.crmProposalView.create({
    data: {
      proposalId,
      viewId: createId(),
      ipHash: 'hash',
      ...overrides,
    },
  })
}
