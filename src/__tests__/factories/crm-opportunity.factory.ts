import { createId } from '@paralleldrive/cuid2'
import {
  type CrmOpportunity,
  type CrmOpportunityLineItem,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  CrmOpportunityDTO,
  CrmOpportunityLineItemDTO,
} from '@/types/crm-opportunity'

export function createFakeCrmOpportunity(
  overrides?: Partial<CrmOpportunity>,
): CrmOpportunity {
  const now = new Date()
  return {
    id: createId(),
    name: 'Negócio X',
    amount: null,
    probability: null,
    closeDate: null,
    pipelineId: createId(),
    stageId: createId(),
    companyId: null,
    pointOfContactId: null,
    ownerId: null,
    source: null,
    workspaceId: createId(),
    createdById: createId(),
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    wonAt: null,
    ...overrides,
  }
}

export function createFakeCrmOpportunityDTO(
  overrides?: Partial<CrmOpportunityDTO>,
): CrmOpportunityDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    name: 'Negócio X',
    amount: null,
    probability: null,
    closeDate: null,
    pipelineId: createId(),
    stageId: createId(),
    companyId: null,
    pointOfContactId: null,
    ownerId: null,
    source: null,
    workspaceId: createId(),
    createdById: createId(),
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmOpportunity(
  workspaceId: string,
  createdById: string,
  pipelineId: string,
  stageId: string,
  overrides?: Partial<
    Pick<
      CrmOpportunity,
      'name' | 'amount' | 'companyId' | 'position' | 'deletedAt'
    >
  >,
) {
  return prisma.crmOpportunity.create({
    data: {
      name: 'Seed Opportunity',
      workspaceId,
      createdById,
      pipelineId,
      stageId,
      ...overrides,
    },
  })
}

export function createFakeCrmOpportunityLineItem(
  overrides?: Partial<CrmOpportunityLineItem>,
): CrmOpportunityLineItem {
  const now = new Date()
  return {
    id: createId(),
    opportunityId: createId(),
    productId: null,
    name: 'Licença Pro',
    quantity: 1,
    unitPrice: new Prisma.Decimal(0),
    discountPct: new Prisma.Decimal(0),
    billingType: 'ONE_TIME',
    total: new Prisma.Decimal(0),
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmOpportunityLineItemDTO(
  overrides?: Partial<CrmOpportunityLineItemDTO>,
): CrmOpportunityLineItemDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    opportunityId: createId(),
    productId: null,
    name: 'Licença Pro',
    quantity: 1,
    unitPrice: 0,
    discountPct: 0,
    billingType: 'ONE_TIME',
    total: 0,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmOpportunityLineItem(
  opportunityId: string,
  overrides?: Partial<{
    name: string
    quantity: number
    unitPrice: number
    total: number
    position: number
  }>,
) {
  return prisma.crmOpportunityLineItem.create({
    data: { name: 'Seed Line Item', opportunityId, ...overrides },
  })
}
