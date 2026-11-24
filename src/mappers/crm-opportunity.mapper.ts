import type { CrmOpportunity, CrmOpportunityLineItem } from '@prisma/client'
import type {
  CrmOpportunityDTO,
  CrmOpportunityLineItemDTO,
} from '@/types/crm-opportunity'

export function toCrmOpportunityDTO(
  opportunity: CrmOpportunity,
): CrmOpportunityDTO {
  return {
    id: opportunity.id,
    name: opportunity.name,
    amount: opportunity.amount ? Number(opportunity.amount) : null,
    probability: opportunity.probability ?? null,
    closeDate: opportunity.closeDate
      ? opportunity.closeDate.toISOString()
      : null,
    pipelineId: opportunity.pipelineId,
    stageId: opportunity.stageId,
    companyId: opportunity.companyId,
    pointOfContactId: opportunity.pointOfContactId,
    ownerId: opportunity.ownerId,
    source: opportunity.source,
    workspaceId: opportunity.workspaceId,
    createdById: opportunity.createdById,
    updatedById: opportunity.updatedById,
    position: opportunity.position,
    createdAt: opportunity.createdAt.toISOString(),
    updatedAt: opportunity.updatedAt.toISOString(),
    wonAt: opportunity.wonAt ? opportunity.wonAt.toISOString() : null,
    stageChangedAt: opportunity.stageChangedAt
      ? opportunity.stageChangedAt.toISOString()
      : null,
  }
}

export function toCrmOpportunityLineItemDTO(
  item: CrmOpportunityLineItem,
): CrmOpportunityLineItemDTO {
  return {
    id: item.id,
    opportunityId: item.opportunityId,
    productId: item.productId,
    name: item.name,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    discountPct: Number(item.discountPct),
    billingType: item.billingType,
    total: Number(item.total),
    position: item.position,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
