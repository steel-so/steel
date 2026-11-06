import { Prisma, type WhatsAppAgentReportSettings } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type {
  AgentClosedAggregate,
  AgentOpenAggregate,
  AgentStatusAggregate,
} from '@/src/lib/whatsapp/agent-report'
import { dbError } from './db-error'

/**
 * Agent performance report (ADR 0062): the per-workspace opt-in and the
 * aggregations behind the report. Everything is counted in the database
 * (`COUNT ... FILTER`, `unnest` of the close status labels); no conversation
 * is loaded in memory. No business rules here.
 */

/** Who the viewer may see; `undefined` on the filter = everybody. */
export interface AgentReportRestriction {
  /** Conversations assigned to any of these users. */
  agentIds: string[]
  /** Unassigned conversations of any of these teams. */
  unassignedTeamIds: string[]
}

export interface AgentReportFilter {
  workspaceId: string
  /** Inclusive lower bound of `closedAt`. */
  start: Date
  /** Exclusive upper bound of `closedAt`. */
  endExclusive: Date
  teamId?: string
  connectionId?: string
  restriction?: AgentReportRestriction
}

/** Soft-deleted conversations never count; the rest follows the filter. */
function conversationScope(
  filter: Omit<AgentReportFilter, 'start' | 'endExclusive'>,
): Prisma.Sql {
  const parts = [
    Prisma.sql`c.workspace_id = ${filter.workspaceId}`,
    Prisma.sql`c.deleted_at IS NULL`,
  ]
  if (filter.teamId) parts.push(Prisma.sql`c.team_id = ${filter.teamId}`)
  if (filter.connectionId) {
    parts.push(Prisma.sql`c.connection_id = ${filter.connectionId}`)
  }
  if (filter.restriction) {
    parts.push(
      Prisma.sql`(c.assigned_user_id = ANY(${filter.restriction.agentIds}::text[]) OR (c.assigned_user_id IS NULL AND c.team_id = ANY(${filter.restriction.unassignedTeamIds}::text[])))`,
    )
  }
  return Prisma.join(parts, ' AND ')
}

function closedInRange(filter: AgentReportFilter): Prisma.Sql {
  return Prisma.sql`c.closed_at >= ${filter.start} AND c.closed_at < ${filter.endExclusive}`
}

export const WhatsAppAgentReportRepository = {
  async getSettings(
    workspaceId: string,
  ): Promise<Result<WhatsAppAgentReportSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppAgentReportSettings.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to read WhatsApp agent report settings', error),
      )
    }
  },

  async upsertSettings(
    workspaceId: string,
    data: { enabled: boolean; updatedById: string },
  ): Promise<Result<WhatsAppAgentReportSettings>> {
    try {
      return ok(
        await prisma.whatsAppAgentReportSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to save WhatsApp agent report settings', error),
      )
    }
  },

  /**
   * Conversations closed in the range, per assignee: how many, how they were
   * tabulated and the summed `closedAt - createdAt` (for the average).
   */
  async closedByAgent(
    filter: AgentReportFilter,
  ): Promise<Result<AgentClosedAggregate[]>> {
    try {
      const rows = await prisma.$queryRaw<
        {
          agent_id: string | null
          closed: bigint
          success: bigint
          failure: bigint
          untabulated: bigint
          handling_seconds: Prisma.Decimal
        }[]
      >`
        SELECT c.assigned_user_id AS agent_id,
               COUNT(*) AS closed,
               COUNT(*) FILTER (WHERE c.close_outcome = 'SUCCESS') AS success,
               COUNT(*) FILTER (WHERE c.close_outcome = 'FAILURE') AS failure,
               COUNT(*) FILTER (WHERE c.close_outcome IS NULL) AS untabulated,
               COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (c.closed_at - c.created_at)), 0)), 0) AS handling_seconds
        FROM whatsapp_conversations c
        WHERE ${conversationScope(filter)} AND ${closedInRange(filter)}
        GROUP BY c.assigned_user_id`
      return ok(
        rows.map((row) => ({
          agentId: row.agent_id,
          closed: Number(row.closed),
          success: Number(row.success),
          failure: Number(row.failure),
          untabulated: Number(row.untabulated),
          handlingSeconds: Number(row.handling_seconds),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to aggregate closed conversations', error))
    }
  },

  /** Conversations not closed right now, per assignee (not period based). */
  async openByAgent(
    filter: Omit<AgentReportFilter, 'start' | 'endExclusive'>,
  ): Promise<Result<AgentOpenAggregate[]>> {
    try {
      const rows = await prisma.$queryRaw<
        { agent_id: string | null; open: bigint }[]
      >`
        SELECT c.assigned_user_id AS agent_id, COUNT(*) AS open
        FROM whatsapp_conversations c
        WHERE ${conversationScope(filter)} AND c.status <> 'CLOSED'
        GROUP BY c.assigned_user_id`
      return ok(
        rows.map((row) => ({ agentId: row.agent_id, open: Number(row.open) })),
      )
    } catch (error) {
      return err(dbError('Failed to aggregate open conversations', error))
    }
  },

  /**
   * Tabulated conversations per assignee and close status label. A
   * conversation with several labels is counted once in each; the outcome
   * comes from the status row (null when it no longer exists).
   */
  async statusesByAgent(
    filter: AgentReportFilter,
  ): Promise<Result<AgentStatusAggregate[]>> {
    try {
      const rows = await prisma.$queryRaw<
        {
          agent_id: string | null
          label: string
          outcome: 'SUCCESS' | 'FAILURE' | null
          total: bigint
        }[]
      >`
        SELECT c.assigned_user_id AS agent_id,
               t.label AS label,
               s.outcome::text AS outcome,
               COUNT(*) AS total
        FROM whatsapp_conversations c
        CROSS JOIN LATERAL unnest(c.close_status_ids, c.close_status_labels) AS t(status_id, label)
        LEFT JOIN whatsapp_close_statuses s
          ON s.id = t.status_id AND s.workspace_id = c.workspace_id
        WHERE ${conversationScope(filter)} AND ${closedInRange(filter)}
          AND t.label IS NOT NULL
        GROUP BY c.assigned_user_id, t.label, s.outcome`
      return ok(
        rows.map((row) => ({
          agentId: row.agent_id,
          label: row.label,
          outcome: row.outcome,
          count: Number(row.total),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to aggregate close status labels', error))
    }
  },
}
