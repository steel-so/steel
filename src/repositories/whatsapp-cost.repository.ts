import type {
  Prisma,
  WhatsAppCostEntry,
  WhatsAppPrice,
  WhatsAppProvider,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type WhatsAppCostEntryInput = Omit<
  Prisma.WhatsAppCostEntryUncheckedCreateInput,
  'id'
>

export interface CostRangeFilter {
  workspaceId: string
  start: Date
  endExclusive: Date
  connectionId?: string
}

export type CostGroupField =
  | 'connectionId'
  | 'category'
  | 'broadcastId'
  | 'aiCampaignId'
  | 'userId'
  | 'source'

export interface CostGroupRow {
  key: string | null
  messages: number
  cost: number
}

function where(filter: CostRangeFilter): Prisma.WhatsAppCostEntryWhereInput {
  return {
    workspaceId: filter.workspaceId,
    occurredAt: { gte: filter.start, lt: filter.endExclusive },
    ...(filter.connectionId ? { connectionId: filter.connectionId } : {}),
  }
}

export const WhatsAppCostRepository = {
  async listPrices(workspaceId: string): Promise<Result<WhatsAppPrice[]>> {
    try {
      const rows = await prisma.whatsAppPrice.findMany({
        where: { workspaceId },
        orderBy: [
          { category: 'asc' },
          { country: 'asc' },
          { validFrom: 'desc' },
        ],
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list whatsapp prices', error))
    }
  },

  /** Idempotent: rows that already exist (same key) are skipped. */
  async seedPrices(
    rows: Prisma.WhatsAppPriceCreateManyInput[],
  ): Promise<Result<number>> {
    try {
      const created = await prisma.whatsAppPrice.createMany({
        data: rows,
        skipDuplicates: true,
      })
      return ok(created.count)
    } catch (error) {
      return err(dbError('Failed to seed whatsapp prices', error))
    }
  },

  async upsertPrice(
    data: Prisma.WhatsAppPriceUncheckedCreateInput,
  ): Promise<Result<WhatsAppPrice>> {
    try {
      const row = await prisma.whatsAppPrice.upsert({
        where: {
          workspaceId_category_country_validFrom: {
            workspaceId: data.workspaceId,
            category: data.category,
            country: data.country ?? 'BR',
            validFrom: data.validFrom as Date,
          },
        },
        create: data,
        update: {
          unitPrice: data.unitPrice,
          liteUnitPrice: data.liteUnitPrice ?? null,
          reference: false,
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save whatsapp price', error))
    }
  },

  /** Returns false when the row does not belong to the workspace. */
  async deletePrice(
    workspaceId: string,
    priceId: string,
  ): Promise<Result<boolean>> {
    try {
      const removed = await prisma.whatsAppPrice.deleteMany({
        where: { id: priceId, workspaceId },
      })
      return ok(removed.count > 0)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp price', error))
    }
  },

  async createEntry(
    data: WhatsAppCostEntryInput,
  ): Promise<Result<WhatsAppCostEntry>> {
    try {
      const row = await prisma.whatsAppCostEntry.create({ data })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to record whatsapp cost entry', error))
    }
  },

  /** Variable (Meta) cost of the range. */
  async sumCost(filter: CostRangeFilter): Promise<Result<number>> {
    try {
      const sum = await prisma.whatsAppCostEntry.aggregate({
        where: where(filter),
        _sum: { estimatedCost: true },
      })
      return ok(Number(sum._sum.estimatedCost ?? 0))
    } catch (error) {
      return err(dbError('Failed to sum whatsapp cost', error))
    }
  },

  async totals(
    filter: CostRangeFilter,
  ): Promise<
    Result<{ messages: number; templateMessages: number; cost: number }>
  > {
    try {
      const [all, template] = await Promise.all([
        prisma.whatsAppCostEntry.aggregate({
          where: where(filter),
          _sum: { quantity: true, estimatedCost: true },
        }),
        prisma.whatsAppCostEntry.aggregate({
          where: { ...where(filter), kind: 'TEMPLATE' },
          _sum: { quantity: true },
        }),
      ])
      return ok({
        messages: all._sum.quantity ?? 0,
        templateMessages: template._sum.quantity ?? 0,
        cost: Number(all._sum.estimatedCost ?? 0),
      })
    } catch (error) {
      return err(dbError('Failed to total whatsapp cost', error))
    }
  },

  async groupBy(
    filter: CostRangeFilter,
    field: CostGroupField,
  ): Promise<Result<CostGroupRow[]>> {
    try {
      // `by` takes a runtime field; Prisma's generics cannot follow a union.
      const rows = (await prisma.whatsAppCostEntry.groupBy({
        by: [field],
        where: where(filter),
        _sum: { quantity: true, estimatedCost: true },
      } as never)) as unknown as {
        _sum: {
          quantity: number | null
          estimatedCost: Prisma.Decimal | null
        }
        [key: string]: unknown
      }[]
      return ok(
        rows.map((row) => ({
          key: (row[field] as string | null) ?? null,
          messages: row._sum.quantity ?? 0,
          cost: Number(row._sum.estimatedCost ?? 0),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to group whatsapp cost', error))
    }
  },

  /** Daily series in the São Paulo calendar. */
  async trend(
    filter: CostRangeFilter,
  ): Promise<Result<{ date: string; cost: number; messages: number }[]>> {
    try {
      const rows = await prisma.$queryRaw<
        { day: string; cost: Prisma.Decimal; messages: bigint }[]
      >`
        SELECT to_char((occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
               COALESCE(SUM(estimated_cost), 0) AS cost,
               COALESCE(SUM(quantity), 0) AS messages
        FROM whatsapp_cost_entries
        WHERE workspace_id = ${filter.workspaceId}
          AND occurred_at >= ${filter.start}
          AND occurred_at < ${filter.endExclusive}
          AND (${filter.connectionId ?? null}::text IS NULL OR connection_id = ${filter.connectionId ?? null})
        GROUP BY 1
        ORDER BY 1`
      return ok(
        rows.map((row) => ({
          date: row.day,
          cost: Number(row.cost),
          messages: Number(row.messages),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read whatsapp cost trend', error))
    }
  },

  /**
   * Distinct conversations that generated entries, per connection, and how
   * many of them ended resolved (closed and not marked as FAILURE).
   */
  async conversationCounts(
    filter: CostRangeFilter,
  ): Promise<
    Result<{ connectionId: string; conversations: number; resolved: number }[]>
  > {
    try {
      const rows = await prisma.$queryRaw<
        { connection_id: string; conversations: bigint; resolved: bigint }[]
      >`
        SELECT e.connection_id,
               COUNT(DISTINCT e.conversation_id) AS conversations,
               COUNT(DISTINCT e.conversation_id) FILTER (
                 WHERE c.status = 'CLOSED' AND c.close_outcome IS DISTINCT FROM 'FAILURE'
               ) AS resolved
        FROM whatsapp_cost_entries e
        LEFT JOIN whatsapp_conversations c ON c.id = e.conversation_id
        WHERE e.workspace_id = ${filter.workspaceId}
          AND e.conversation_id IS NOT NULL
          AND e.occurred_at >= ${filter.start}
          AND e.occurred_at < ${filter.endExclusive}
          AND (${filter.connectionId ?? null}::text IS NULL OR e.connection_id = ${filter.connectionId ?? null})
        GROUP BY e.connection_id`
      return ok(
        rows.map((row) => ({
          connectionId: row.connection_id,
          conversations: Number(row.conversations),
          resolved: Number(row.resolved),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count whatsapp cost conversations', error))
    }
  },

  /** Comunicação connections with their flat fee. */
  async listConnections(workspaceId: string): Promise<
    Result<
      {
        id: string
        label: string
        provider: WhatsAppProvider
        monthlyFee: number | null
      }[]
    >
  > {
    try {
      const rows = await prisma.whatsAppConnection.findMany({
        where: { workspaceId, module: 'COMMUNICATION' },
        select: { id: true, label: true, provider: true, monthlyFee: true },
        orderBy: { createdAt: 'asc' },
      })
      return ok(
        rows.map((row) => ({
          ...row,
          monthlyFee: row.monthlyFee === null ? null : Number(row.monthlyFee),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp connection fees', error))
    }
  },

  async setConnectionFee(
    workspaceId: string,
    connectionId: string,
    monthlyFee: number | null,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.whatsAppConnection.updateMany({
        where: { id: connectionId, workspaceId, module: 'COMMUNICATION' },
        data: { monthlyFee },
      })
      return ok(updated.count > 0)
    } catch (error) {
      return err(dbError('Failed to set whatsapp connection fee', error))
    }
  },

  async broadcastNames(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<Map<string, string>>> {
    try {
      const rows = await prisma.whatsAppBroadcastList.findMany({
        where: { workspaceId, id: { in: ids } },
        select: { id: true, name: true },
      })
      return ok(new Map(rows.map((row) => [row.id, row.name])))
    } catch (error) {
      return err(dbError('Failed to read broadcast names', error))
    }
  },

  async aiCampaignNames(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<Map<string, string>>> {
    try {
      const rows = await prisma.whatsAppAiCampaign.findMany({
        where: { workspaceId, id: { in: ids } },
        select: { id: true, name: true },
      })
      return ok(new Map(rows.map((row) => [row.id, row.name])))
    } catch (error) {
      return err(dbError('Failed to read AI campaign names', error))
    }
  },

  async userNames(ids: string[]): Promise<Result<Map<string, string>>> {
    try {
      const rows = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      })
      return ok(new Map(rows.map((row) => [row.id, row.name || row.email])))
    } catch (error) {
      return err(dbError('Failed to read user names', error))
    }
  },
}
