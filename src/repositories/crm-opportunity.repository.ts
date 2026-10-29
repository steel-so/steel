import type {
  CrmBillingType,
  CrmOpportunity,
  CrmOpportunityLineItem,
  Prisma,
} from '@prisma/client'
import { notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

function computeLineItemTotal(
  quantity: number,
  unitPrice: number,
  discountPct: number,
): number {
  return quantity * unitPrice * (1 - discountPct / 100)
}

export const CrmOpportunityRepository = {
  async listByWorkspace(
    workspaceId: string,
    filters?: { pipelineId?: string; stageId?: string },
  ): Promise<Result<CrmOpportunity[]>> {
    try {
      const opportunities = await prisma.crmOpportunity.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(filters?.pipelineId ? { pipelineId: filters.pipelineId } : {}),
          ...(filters?.stageId ? { stageId: filters.stageId } : {}),
        },
        orderBy: { position: 'asc' },
      })
      return ok(opportunities)
    } catch (error) {
      return err(dbError('Failed to list CRM opportunities', error))
    }
  },

  /** Natural-language search (C10): a prebuilt `where`/`orderBy`, capped. */
  async search(
    where: Prisma.CrmOpportunityWhereInput,
    orderBy: Prisma.CrmOpportunityOrderByWithRelationInput[],
    take: number,
  ): Promise<Result<CrmOpportunity[]>> {
    try {
      const opportunities = await prisma.crmOpportunity.findMany({
        where,
        orderBy,
        take,
      })
      return ok(opportunities)
    } catch (error) {
      return err(dbError('Failed to search CRM opportunities', error))
    }
  },

  /** Oportunidades vivas com etapa incluída, para o forecast. */
  async listOpenAndWonWithStage(
    workspaceId: string,
  ): Promise<
    Result<
      (CrmOpportunity & { stage: { probability: number; category: string } })[]
    >
  > {
    try {
      const opportunities = await prisma.crmOpportunity.findMany({
        where: { workspaceId, deletedAt: null, closeDate: { not: null } },
        include: { stage: { select: { probability: true, category: true } } },
      })
      return ok(opportunities)
    } catch (error) {
      return err(dbError('Failed to list CRM opportunities with stage', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmOpportunity>> {
    try {
      const opportunity = await prisma.crmOpportunity.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!opportunity) return err(notFound('CrmOpportunity'))
      return ok(opportunity)
    } catch (error) {
      return err(dbError('Failed to find CRM opportunity by id', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    amount?: number
    probability?: number
    closeDate?: Date
    pipelineId: string
    stageId: string
    companyId?: string
    pointOfContactId?: string
    ownerId?: string
    source?: string
    wonAt?: Date
  }): Promise<Result<CrmOpportunity>> {
    try {
      const position = await prisma.crmOpportunity.count({
        where: { stageId: data.stageId, deletedAt: null },
      })
      const opportunity = await prisma.crmOpportunity.create({
        data: { ...data, position },
      })
      return ok(opportunity)
    } catch (error) {
      return err(dbError('Failed to create CRM opportunity', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      amount?: number | null
      probability?: number | null
      closeDate?: Date | null
      pipelineId?: string
      stageId?: string
      companyId?: string | null
      pointOfContactId?: string | null
      ownerId?: string | null
      source?: string | null
      updatedById?: string
      wonAt?: Date | null
    },
  ): Promise<Result<CrmOpportunity>> {
    try {
      const opportunity = await prisma.crmOpportunity.update({
        where: { id },
        data,
      })
      return ok(opportunity)
    } catch (error) {
      return err(dbError('Failed to update CRM opportunity', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmOpportunity.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM opportunity', error))
    }
  },

  async reorderInStage(
    stageId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmOpportunity.update({
            where: { id, stageId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder CRM opportunities', error))
    }
  },

  /** Reordena globalmente (independente da etapa) — usado pela grade genérica. */
  async reorder(
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmOpportunity.update({
            where: { id, workspaceId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder CRM opportunities', error))
    }
  },
}

export const CrmOpportunityLineItemRepository = {
  async listByOpportunity(
    opportunityId: string,
  ): Promise<Result<CrmOpportunityLineItem[]>> {
    try {
      const items = await prisma.crmOpportunityLineItem.findMany({
        where: { opportunityId },
        orderBy: { position: 'asc' },
      })
      return ok(items)
    } catch (error) {
      return err(dbError('Failed to list CRM opportunity line items', error))
    }
  },

  async findById(
    id: string,
    opportunityId: string,
  ): Promise<Result<CrmOpportunityLineItem>> {
    try {
      const item = await prisma.crmOpportunityLineItem.findFirst({
        where: { id, opportunityId },
      })
      if (!item) return err(notFound('CrmOpportunityLineItem'))
      return ok(item)
    } catch (error) {
      return err(
        dbError('Failed to find CRM opportunity line item by id', error),
      )
    }
  },

  async create(data: {
    opportunityId: string
    productId?: string
    name: string
    quantity: number
    unitPrice: number
    discountPct: number
    billingType: CrmBillingType
  }): Promise<Result<CrmOpportunityLineItem>> {
    try {
      const position = await prisma.crmOpportunityLineItem.count({
        where: { opportunityId: data.opportunityId },
      })
      const item = await prisma.crmOpportunityLineItem.create({
        data: {
          ...data,
          total: computeLineItemTotal(
            data.quantity,
            data.unitPrice,
            data.discountPct,
          ),
          position,
        },
      })
      return ok(item)
    } catch (error) {
      return err(dbError('Failed to create CRM opportunity line item', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      quantity?: number
      unitPrice?: number
      discountPct?: number
      billingType?: CrmBillingType
      productId?: string | null
    },
  ): Promise<Result<CrmOpportunityLineItem>> {
    try {
      const existing = await prisma.crmOpportunityLineItem.findUnique({
        where: { id },
      })
      if (!existing) return err(notFound('CrmOpportunityLineItem'))

      const quantity = data.quantity ?? existing.quantity
      const unitPrice = data.unitPrice ?? Number(existing.unitPrice)
      const discountPct = data.discountPct ?? Number(existing.discountPct)

      const item = await prisma.crmOpportunityLineItem.update({
        where: { id },
        data: {
          ...data,
          total: computeLineItemTotal(quantity, unitPrice, discountPct),
        },
      })
      return ok(item)
    } catch (error) {
      return err(dbError('Failed to update CRM opportunity line item', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmOpportunityLineItem.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM opportunity line item', error))
    }
  },
}
