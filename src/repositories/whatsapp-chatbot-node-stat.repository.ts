import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface ChatbotNodeCount {
  nodeId: string
  entries: number
  exits: number
}

export const WhatsAppChatbotNodeStatRepository = {
  /**
   * Adds the counts of one run to the bot's per-block, per-day totals. One
   * upsert per block, in a single transaction, so a run is all or nothing.
   */
  async increment(
    input: { workspaceId: string; chatbotId: string; day: Date },
    counts: ChatbotNodeCount[],
  ): Promise<Result<number>> {
    if (counts.length === 0) return ok(0)
    try {
      await prisma.$transaction(
        counts.map((count) =>
          prisma.whatsAppChatbotNodeStat.upsert({
            where: {
              chatbotId_nodeId_day: {
                chatbotId: input.chatbotId,
                nodeId: count.nodeId,
                day: input.day,
              },
            },
            create: {
              workspaceId: input.workspaceId,
              chatbotId: input.chatbotId,
              nodeId: count.nodeId,
              day: input.day,
              entries: count.entries,
              exits: count.exits,
            },
            update: {
              entries: { increment: count.entries },
              exits: { increment: count.exits },
            },
          }),
        ),
      )
      return ok(counts.length)
    } catch (error) {
      return err(dbError('Failed to record chatbot block metrics', error))
    }
  },

  /** Totals per block from `since` (inclusive) on. */
  async totalsSince(
    workspaceId: string,
    chatbotId: string,
    since: Date,
  ): Promise<Result<ChatbotNodeCount[]>> {
    try {
      const rows = await prisma.whatsAppChatbotNodeStat.groupBy({
        by: ['nodeId'],
        where: { workspaceId, chatbotId, day: { gte: since } },
        _sum: { entries: true, exits: true },
      })
      return ok(
        rows.map((row) => ({
          nodeId: row.nodeId,
          entries: row._sum.entries ?? 0,
          exits: row._sum.exits ?? 0,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read chatbot block metrics', error))
    }
  },

  /** Retention: days older than the cutoff are of no use to the editor. */
  async deleteBefore(cutoff: Date): Promise<Result<number>> {
    try {
      const result = await prisma.whatsAppChatbotNodeStat.deleteMany({
        where: { day: { lt: cutoff } },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to prune chatbot block metrics', error))
    }
  },
}
