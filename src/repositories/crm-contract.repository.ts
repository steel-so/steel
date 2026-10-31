import type {
  CrmContract,
  CrmContractStatus,
  CrmHealthLevel,
  Prisma,
} from '@prisma/client'
import { crmContractNotFound } from '@/src/errors'
import { phoneVariants, type PeerItemRow } from '@/src/lib/crm-deals/upsell'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type CrmContractWithCompany = CrmContract & {
  company: { id: string; name: string; accountOwnerId: string | null }
}

const withCompany = {
  company: { select: { id: true, name: true, accountOwnerId: true } },
} satisfies Prisma.CrmContractInclude

export const CrmContractRepository = {
  async list(
    workspaceId: string,
    filters: {
      status?: CrmContractStatus
      companyId?: string
      endsBefore?: Date
    },
  ): Promise<Result<CrmContractWithCompany[]>> {
    try {
      return ok(
        await prisma.crmContract.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            ...(filters.status && { status: filters.status }),
            ...(filters.companyId && { companyId: filters.companyId }),
            ...(filters.endsBefore && { endDate: { lte: filters.endsBefore } }),
          },
          orderBy: { endDate: 'asc' },
          include: withCompany,
          take: 500,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM contracts', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmContractWithCompany>> {
    try {
      const row = await prisma.crmContract.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: withCompany,
      })
      return row ? ok(row) : err(crmContractNotFound())
    } catch (error) {
      return err(dbError('Failed to find CRM contract', error))
    }
  },

  async create(data: {
    workspaceId: string
    companyId: string
    opportunityId: string | null
    ownerId: string | null
    createdById: string
    name: string
    value: number | null
    startDate: Date
    endDate: Date
    autoRenews: boolean
    notes: string | null
  }): Promise<Result<CrmContractWithCompany>> {
    try {
      return ok(
        await prisma.crmContract.create({ data, include: withCompany }),
      )
    } catch (error) {
      return err(dbError('Failed to create CRM contract', error))
    }
  },

  async update(
    id: string,
    data: Prisma.CrmContractUncheckedUpdateInput,
  ): Promise<Result<CrmContractWithCompany>> {
    try {
      return ok(
        await prisma.crmContract.update({
          where: { id },
          data,
          include: withCompany,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update CRM contract', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmContract.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM contract', error))
    }
  },

  /** Active contracts ending by `windowEnd` that still need the owner alert. */
  async listToAlert(
    workspaceId: string,
    windowEnd: Date,
  ): Promise<Result<CrmContractWithCompany[]>> {
    try {
      return ok(
        await prisma.crmContract.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            status: 'ACTIVE',
            alertedAt: null,
            endDate: { lte: windowEnd },
          },
          orderBy: { endDate: 'asc' },
          include: withCompany,
          take: 200,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM contracts to alert', error))
    }
  },

  /** Active contracts ending by `windowEnd` without a renewal deal yet. */
  async listToRenew(
    workspaceId: string,
    windowEnd: Date,
  ): Promise<Result<CrmContractWithCompany[]>> {
    try {
      return ok(
        await prisma.crmContract.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            status: 'ACTIVE',
            renewalOpportunityId: null,
            endDate: { lte: windowEnd },
          },
          orderBy: { endDate: 'asc' },
          include: withCompany,
          take: 200,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM contracts to renew', error))
    }
  },

  /** Contracts past their end that were neither renewed nor auto-renewing. */
  async expireEnded(workspaceId: string, now: Date): Promise<Result<number>> {
    try {
      const { count } = await prisma.crmContract.updateMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: 'ACTIVE',
          autoRenews: false,
          endDate: { lt: now },
        },
        data: { status: 'EXPIRED' },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to expire CRM contracts', error))
    }
  },

  /** Auto-renewing contracts past their end, to roll one term forward. */
  async listAutoRenewDue(
    workspaceId: string,
    now: Date,
  ): Promise<Result<CrmContract[]>> {
    try {
      return ok(
        await prisma.crmContract.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            status: 'ACTIVE',
            autoRenews: true,
            endDate: { lt: now },
          },
          take: 200,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list auto-renewing CRM contracts', error))
    }
  },

  // ─── upsell signals (C9) ──────────────────────────────────────────────────

  /** Products of the line items of the WON deals of every customer. */
  async wonProductRows(
    workspaceId: string,
  ): Promise<Result<PeerItemRow[]>> {
    try {
      const items = await prisma.crmOpportunityLineItem.findMany({
        where: {
          productId: { not: null },
          opportunity: {
            workspaceId,
            deletedAt: null,
            companyId: { not: null },
            stage: { category: 'WON' },
          },
        },
        select: {
          productId: true,
          name: true,
          unitPrice: true,
          opportunity: { select: { companyId: true } },
        },
        take: 5000,
      })
      const rows: PeerItemRow[] = []
      for (const item of items) {
        if (!item.productId || !item.opportunity.companyId) continue
        rows.push({
          productId: item.productId,
          name: item.name,
          unitPrice: Number(item.unitPrice),
          companyId: item.opportunity.companyId,
        })
      }
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to read the products sold to customers', error))
    }
  },

  /** Latest answered survey of the people of a company (T1). */
  async latestSatisfaction(
    workspaceId: string,
    companyId: string,
  ): Promise<
    Result<{ kind: 'NPS' | 'CSAT' | 'CES'; score: number; answeredAt: Date } | null>
  > {
    try {
      const people = await prisma.crmPerson.findMany({
        where: { workspaceId, companyId, deletedAt: null },
        select: { emails: true, phones: true },
        take: 200,
      })
      const emails = people.flatMap((person) =>
        person.emails.map((email) => email.trim().toLowerCase()),
      )
      const phones = phoneVariants(people.flatMap((person) => person.phones))
      if (emails.length === 0 && phones.length === 0) return ok(null)

      const survey = await prisma.satisfactionSurvey.findFirst({
        where: {
          workspaceId,
          status: 'ANSWERED',
          score: { not: null },
          OR: [
            ...(emails.length > 0
              ? [{ recipientEmail: { in: emails, mode: 'insensitive' as const } }]
              : []),
            ...(phones.length > 0 ? [{ recipientPhone: { in: phones } }] : []),
          ],
        },
        orderBy: { answeredAt: 'desc' },
        select: { kind: true, score: true, answeredAt: true },
      })
      if (!survey || survey.score === null || !survey.answeredAt) return ok(null)
      return ok({
        kind: survey.kind,
        score: survey.score,
        answeredAt: survey.answeredAt,
      })
    } catch (error) {
      return err(dbError('Failed to read the latest satisfaction survey', error))
    }
  },

  /** Churn-risk level of a company (T4), when scored. */
  async customerHealthLevel(
    workspaceId: string,
    companyId: string,
  ): Promise<Result<CrmHealthLevel | null>> {
    try {
      const row = await prisma.crmCustomerHealth.findFirst({
        where: { workspaceId, companyId },
        select: { level: true },
      })
      return ok(row?.level ?? null)
    } catch (error) {
      return err(dbError('Failed to read the customer health level', error))
    }
  },
}
