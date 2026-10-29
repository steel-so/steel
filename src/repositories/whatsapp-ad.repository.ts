import type {
  Prisma,
  WhatsAppAdReferral,
  WhatsAppAdSettings,
  WhatsAppAdSpend,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type WhatsAppAdReferralInput = Omit<
  Prisma.WhatsAppAdReferralUncheckedCreateInput,
  'id' | 'leadId'
>

export interface AdLeadOutcome {
  id: string
  closeResult: string | null
  closedAmount: number | null
}

export const WhatsAppAdRepository = {
  async findSettings(
    workspaceId: string,
  ): Promise<Result<WhatsAppAdSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppAdSettings.findUnique({ where: { workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp ad settings', error))
    }
  },

  async upsertSettings(
    workspaceId: string,
    data: Omit<Prisma.WhatsAppAdSettingsUncheckedCreateInput, 'workspaceId'>,
  ): Promise<Result<WhatsAppAdSettings>> {
    try {
      return ok(
        await prisma.whatsAppAdSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to upsert whatsapp ad settings', error))
    }
  },

  /** Idempotent on the provider message id: a webhook retry returns null. */
  async createReferral(
    data: WhatsAppAdReferralInput,
  ): Promise<Result<WhatsAppAdReferral | null>> {
    try {
      const existing = await prisma.whatsAppAdReferral.findUnique({
        where: { providerMessageId: data.providerMessageId },
        select: { id: true },
      })
      if (existing) return ok(null)
      return ok(await prisma.whatsAppAdReferral.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp ad referral', error))
    }
  },

  /** Newest referral of the conversation (the ad that opened it). */
  async findLatestByConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppAdReferral | null>> {
    try {
      return ok(
        await prisma.whatsAppAdReferral.findFirst({
          where: { workspaceId, conversationId },
          orderBy: { receivedAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp ad referral', error))
    }
  },

  /** First-touch: true when some referral already owns this lead. */
  async leadHasReferral(
    workspaceId: string,
    leadId: string,
  ): Promise<Result<boolean>> {
    try {
      const count = await prisma.whatsAppAdReferral.count({
        where: { workspaceId, leadId },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check whatsapp ad referral lead', error))
    }
  },

  async linkLead(
    referralId: string,
    leadId: string,
  ): Promise<Result<WhatsAppAdReferral>> {
    try {
      return ok(
        await prisma.whatsAppAdReferral.update({
          where: { id: referralId },
          data: { leadId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to link whatsapp ad referral lead', error))
    }
  },

  async listReferralsInRange(
    workspaceId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<Result<WhatsAppAdReferral[]>> {
    try {
      return ok(
        await prisma.whatsAppAdReferral.findMany({
          where: {
            workspaceId,
            receivedAt: { gte: start, lt: endExclusive },
          },
          orderBy: { receivedAt: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp ad referrals', error))
    }
  },

  /** Outcome of the CRM leads the referrals point to (deleted ones drop out). */
  async listLeadOutcomes(
    workspaceId: string,
    leadIds: string[],
  ): Promise<Result<AdLeadOutcome[]>> {
    if (leadIds.length === 0) return ok([])
    try {
      const rows = await prisma.crmLead.findMany({
        where: { workspaceId, id: { in: leadIds }, deletedAt: null },
        select: { id: true, closeResult: true, closedAmount: true },
      })
      return ok(
        rows.map((row) => ({
          id: row.id,
          closeResult: row.closeResult,
          closedAmount:
            row.closedAmount === null ? null : Number(row.closedAmount),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list crm lead outcomes', error))
    }
  },

  async listSpends(workspaceId: string): Promise<Result<WhatsAppAdSpend[]>> {
    try {
      return ok(
        await prisma.whatsAppAdSpend.findMany({
          where: { workspaceId },
          orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp ad spends', error))
    }
  },

  /** Spend rows whose period touches `[from, to]` (calendar days). */
  async listSpendsOverlapping(
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<Result<WhatsAppAdSpend[]>> {
    try {
      return ok(
        await prisma.whatsAppAdSpend.findMany({
          where: {
            workspaceId,
            periodStart: { lte: to },
            periodEnd: { gte: from },
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp ad spends', error))
    }
  },

  async createSpend(
    data: Omit<Prisma.WhatsAppAdSpendUncheckedCreateInput, 'id'>,
  ): Promise<Result<WhatsAppAdSpend>> {
    try {
      return ok(await prisma.whatsAppAdSpend.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp ad spend', error))
    }
  },

  /** Deletes inside the workspace; ok(false) when there was nothing. */
  async deleteSpend(workspaceId: string, id: string): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.whatsAppAdSpend.deleteMany({
        where: { id, workspaceId },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp ad spend', error))
    }
  },
}
