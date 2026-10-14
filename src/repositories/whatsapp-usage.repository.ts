import type { WhatsAppUsageMonthly } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { WhatsAppUsageMetric } from '@/src/schemas/whatsapp-usage.schema'
import { dbError } from './db-error'

const COLUMN: Record<
  WhatsAppUsageMetric,
  'conversations' | 'outboundMessages'
> = {
  conversations: 'conversations',
  messages: 'outboundMessages',
}

export const WhatsAppUsageRepository = {
  async find(
    workspaceId: string,
    period: string,
  ): Promise<Result<WhatsAppUsageMonthly | null>> {
    try {
      const row = await prisma.whatsAppUsageMonthly.findUnique({
        where: { workspaceId_period: { workspaceId, period } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp usage', error))
    }
  },

  /** Atomic +1 on the month counter (creates the row on first use). */
  async increment(
    workspaceId: string,
    period: string,
    metric: WhatsAppUsageMetric,
  ): Promise<Result<WhatsAppUsageMonthly>> {
    const column = COLUMN[metric]
    try {
      const row = await prisma.whatsAppUsageMonthly.upsert({
        where: { workspaceId_period: { workspaceId, period } },
        create: { workspaceId, period, [column]: 1 },
        update: { [column]: { increment: 1 } },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to increment whatsapp usage', error))
    }
  },
}
