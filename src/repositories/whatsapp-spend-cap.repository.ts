import type {
  Prisma,
  WhatsAppConnection,
  WhatsAppMetaSpendSnapshot,
  WhatsAppMetaSpendSource,
  WhatsAppSpendCap,
  WhatsAppSpendCapMode,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface SpendSnapshotInput {
  workspaceId: string
  connectionId: string
  month: string
  cost: number
  currency: string
  source: WhatsAppMetaSpendSource
  byCategory: Prisma.InputJsonValue
  periodStart: Date
  periodEnd: Date
  fetchedAt: Date
}

export interface SpendCapInput {
  workspaceId: string
  connectionId: string
  monthlyCapAmount: number
  capMode: WhatsAppSpendCapMode
  updatedById: string | null
}

/** Comunicação lines billed by Meta: the only ones a cap applies to. */
const META_LINE = {
  provider: 'META',
  module: 'COMMUNICATION',
} as const satisfies Prisma.WhatsAppConnectionWhereInput

/**
 * Monthly spending cap per WhatsApp number and the Meta spend snapshots
 * (ADR 0064). Pure Prisma: the cap math lives in the service.
 */
export const WhatsAppSpendCapRepository = {
  async findCap(
    connectionId: string,
  ): Promise<Result<WhatsAppSpendCap | null>> {
    try {
      const row = await prisma.whatsAppSpendCap.findUnique({
        where: { connectionId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp spend cap', error))
    }
  },

  async listCaps(workspaceId: string): Promise<Result<WhatsAppSpendCap[]>> {
    try {
      const rows = await prisma.whatsAppSpendCap.findMany({
        where: { workspaceId },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list whatsapp spend caps', error))
    }
  },

  async upsertCap(input: SpendCapInput): Promise<Result<WhatsAppSpendCap>> {
    try {
      const data = {
        monthlyCapAmount: input.monthlyCapAmount,
        capMode: input.capMode,
        updatedById: input.updatedById,
      }
      const row = await prisma.whatsAppSpendCap.upsert({
        where: { connectionId: input.connectionId },
        create: {
          ...data,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
        },
        update: data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save whatsapp spend cap', error))
    }
  },

  /** Removes the cap; false when the number had none. */
  async deleteCap(
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<boolean>> {
    try {
      const removed = await prisma.whatsAppSpendCap.deleteMany({
        where: { workspaceId, connectionId },
      })
      return ok(removed.count > 0)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp spend cap', error))
    }
  },

  async findSnapshot(
    connectionId: string,
    month: string,
  ): Promise<Result<WhatsAppMetaSpendSnapshot | null>> {
    try {
      const row = await prisma.whatsAppMetaSpendSnapshot.findUnique({
        where: { connectionId_month: { connectionId, month } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find meta spend snapshot', error))
    }
  },

  /** Most recent snapshot of any month (keeps the source on day one). */
  async findLatestSnapshot(
    connectionId: string,
  ): Promise<Result<WhatsAppMetaSpendSnapshot | null>> {
    try {
      const row = await prisma.whatsAppMetaSpendSnapshot.findFirst({
        where: { connectionId },
        orderBy: { fetchedAt: 'desc' },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find latest meta spend snapshot', error))
    }
  },

  async upsertSnapshot(
    input: SpendSnapshotInput,
  ): Promise<Result<WhatsAppMetaSpendSnapshot>> {
    try {
      const data = {
        cost: input.cost,
        currency: input.currency,
        source: input.source,
        byCategory: input.byCategory,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        fetchedAt: input.fetchedAt,
      }
      const row = await prisma.whatsAppMetaSpendSnapshot.upsert({
        where: {
          connectionId_month: {
            connectionId: input.connectionId,
            month: input.month,
          },
        },
        create: {
          ...data,
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          month: input.month,
        },
        update: data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save meta spend snapshot', error))
    }
  },

  /**
   * Paid cost the Steel ledger recorded for the number since `since` (the
   * part of the month Meta has not reported yet). Reversed entries are 0.
   */
  async sumLedgerSince(
    connectionId: string,
    since: Date,
  ): Promise<Result<number>> {
    try {
      const sum = await prisma.whatsAppCostEntry.aggregate({
        where: {
          connectionId,
          kind: 'TEMPLATE',
          reversedAt: null,
          occurredAt: { gte: since },
        },
        _sum: { estimatedCost: true },
      })
      return ok(Number(sum._sum.estimatedCost ?? 0))
    } catch (error) {
      return err(dbError('Failed to sum whatsapp ledger', error))
    }
  },

  /**
   * The provider reported the message as failed: Meta does not bill it, so
   * the ledger entry is zeroed (once). Returns how many entries changed.
   */
  async reverseFailedEntries(
    providerMessageId: string,
    at: Date,
  ): Promise<Result<number>> {
    try {
      const updated = await prisma.whatsAppCostEntry.updateMany({
        where: { providerMessageId, reversedAt: null },
        data: { estimatedCost: 0, reversedAt: at },
      })
      return ok(updated.count)
    } catch (error) {
      return err(dbError('Failed to reverse whatsapp cost entry', error))
    }
  },

  /** Comunicação Meta numbers of a workspace, oldest first. */
  async listMetaConnections(
    workspaceId: string,
  ): Promise<Result<WhatsAppConnection[]>> {
    try {
      const rows = await prisma.whatsAppConnection.findMany({
        where: { workspaceId, ...META_LINE },
        orderBy: { createdAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list meta connections', error))
    }
  },

  /** Every Meta number with a cap, across workspaces (worker tick). */
  async listCappedConnections(): Promise<Result<WhatsAppConnection[]>> {
    try {
      const rows = await prisma.whatsAppConnection.findMany({
        where: { ...META_LINE, spendCap: { isNot: null } },
        orderBy: { createdAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list capped connections', error))
    }
  },
}
