import { Prisma, type Role, type SteelAgentPolicy } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Governance policy (kill switch, creators, AUTO rules) and its metrics. */

export interface SteelAgentPolicyWrite {
  restrictCreators: boolean
  creatorRoles: Role[]
  restrictAuto: boolean
  autoRules: Prisma.InputJsonValue | null
}

export const SteelAgentPolicyRepository = {
  async find(workspaceId: string): Promise<Result<SteelAgentPolicy | null>> {
    try {
      return ok(
        await prisma.steelAgentPolicy.findUnique({ where: { workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to load steel agent policy', error))
    }
  },

  async saveRules(
    workspaceId: string,
    updatedById: string,
    data: SteelAgentPolicyWrite,
  ): Promise<Result<SteelAgentPolicy>> {
    const fields = {
      restrictCreators: data.restrictCreators,
      creatorRoles: data.creatorRoles,
      restrictAuto: data.restrictAuto,
      autoRules: data.autoRules ?? Prisma.DbNull,
      updatedById,
    }
    try {
      return ok(
        await prisma.steelAgentPolicy.upsert({
          where: { workspaceId },
          create: { workspaceId, ...fields },
          update: fields,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save steel agent policy', error))
    }
  },

  /** Emergency stop: idempotent (a second call keeps the first reason). */
  async kill(
    workspaceId: string,
    killedById: string,
    reason: string | null,
    now: Date,
  ): Promise<Result<SteelAgentPolicy>> {
    try {
      const current = await prisma.steelAgentPolicy.findUnique({
        where: { workspaceId },
      })
      if (current?.killedAt) return ok(current)
      return ok(
        await prisma.steelAgentPolicy.upsert({
          where: { workspaceId },
          create: {
            workspaceId,
            killedAt: now,
            killedById,
            killReason: reason,
          },
          update: { killedAt: now, killedById, killReason: reason },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to pause steel agents', error))
    }
  },

  async resume(
    workspaceId: string,
    updatedById: string,
  ): Promise<Result<SteelAgentPolicy | null>> {
    try {
      const { count } = await prisma.steelAgentPolicy.updateMany({
        where: { workspaceId, killedAt: { not: null } },
        data: {
          killedAt: null,
          killedById: null,
          killReason: null,
          updatedById,
        },
      })
      if (count === 0) return ok(null)
      return ok(
        await prisma.steelAgentPolicy.findUnique({ where: { workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to resume steel agents', error))
    }
  },

  /**
   * After the stop: queued and approval-waiting runs end as SKIPPED and
   * their pending actions are canceled, so nothing executes later. Returns
   * the counts.
   */
  async cancelInFlight(
    workspaceId: string,
    now: Date,
    message: string,
  ): Promise<Result<{ runs: number; actions: number }>> {
    try {
      const [actions, runs] = await prisma.$transaction([
        prisma.aiPendingAction.updateMany({
          where: {
            workspaceId,
            status: 'PENDING',
            agentRunId: { not: null },
          },
          data: { status: 'CANCELED', decidedAt: now },
        }),
        prisma.steelAgentRun.updateMany({
          where: {
            workspaceId,
            status: { in: ['QUEUED', 'WAITING_APPROVAL'] },
          },
          data: {
            status: 'SKIPPED',
            finishedAt: now,
            summary: message,
            state: Prisma.DbNull,
          },
        }),
      ])
      return ok({ runs: runs.count, actions: actions.count })
    } catch (error) {
      return err(dbError('Failed to cancel in-flight steel agent work', error))
    }
  },
}

export interface AgentRunAggregate {
  agentId: string
  runs: number
  succeeded: number
  failed: number
  skipped: number
  /** Own cost, without the delegated runs (those belong to the child agent). */
  costUsd: number
  delegatedCostUsd: number
  lastRunAt: Date | null
}

export interface AgentDecisionAggregate {
  agentId: string
  executed: number
  failed: number
  rejected: number
  expired: number
  pending: number
}

export interface AgentImpactAggregate {
  agentId: string
  applied: number
}

/** Read-only metrics of the governance panel (real runs only, tests out). */
export const SteelAgentGovernanceMetricsRepository = {
  async runs(
    workspaceId: string,
    since: Date,
  ): Promise<Result<AgentRunAggregate[]>> {
    try {
      const rows = await prisma.steelAgentRun.groupBy({
        by: ['agentId', 'status'],
        where: { workspaceId, isTest: false, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { costUsd: true, delegatedCostUsd: true },
        _max: { createdAt: true },
      })
      const byAgent = new Map<string, AgentRunAggregate>()
      for (const row of rows) {
        const entry = byAgent.get(row.agentId) ?? {
          agentId: row.agentId,
          runs: 0,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          costUsd: 0,
          delegatedCostUsd: 0,
          lastRunAt: null,
        }
        const count = row._count._all
        entry.runs += count
        if (row.status === 'SUCCEEDED') entry.succeeded += count
        if (row.status === 'FAILED') entry.failed += count
        if (row.status === 'SKIPPED') entry.skipped += count
        const delegated = Number(row._sum.delegatedCostUsd ?? 0)
        entry.costUsd += Number(row._sum.costUsd ?? 0) - delegated
        entry.delegatedCostUsd += delegated
        const last = row._max.createdAt
        if (last && (!entry.lastRunAt || last > entry.lastRunAt)) {
          entry.lastRunAt = last
        }
        byAgent.set(row.agentId, entry)
      }
      return ok([...byAgent.values()])
    } catch (error) {
      return err(dbError('Failed to aggregate steel agent runs', error))
    }
  },

  async decisions(
    workspaceId: string,
    since: Date,
  ): Promise<Result<AgentDecisionAggregate[]>> {
    try {
      const rows = await prisma.$queryRaw<
        { agentId: string; status: string; count: number }[]
      >(Prisma.sql`
        SELECT r.agent_id AS "agentId", a.status::text AS status, COUNT(*)::int AS count
        FROM ai_pending_actions a
        JOIN steel_agent_runs r ON r.id = a.agent_run_id
        WHERE a.workspace_id = ${workspaceId}
          AND a.created_at >= ${since}
          AND r.is_test = false
        GROUP BY r.agent_id, a.status
      `)
      const byAgent = new Map<string, AgentDecisionAggregate>()
      for (const row of rows) {
        const entry = byAgent.get(row.agentId) ?? {
          agentId: row.agentId,
          executed: 0,
          failed: 0,
          rejected: 0,
          expired: 0,
          pending: 0,
        }
        if (row.status === 'EXECUTED') entry.executed += row.count
        else if (row.status === 'FAILED') entry.failed += row.count
        else if (row.status === 'CANCELED') entry.rejected += row.count
        else if (row.status === 'EXPIRED') entry.expired += row.count
        else entry.pending += row.count
        byAgent.set(row.agentId, entry)
      }
      return ok([...byAgent.values()])
    } catch (error) {
      return err(dbError('Failed to aggregate steel agent decisions', error))
    }
  },

  /** Writes that went through (automatic or approved): the "impact". */
  async impact(
    workspaceId: string,
    since: Date,
  ): Promise<Result<AgentImpactAggregate[]>> {
    try {
      const rows = await prisma.aiActionLog.groupBy({
        by: ['agentId'],
        where: {
          workspaceId,
          source: 'AGENT',
          outcome: 'success',
          agentId: { not: null },
          createdAt: { gte: since },
        },
        _count: { _all: true },
      })
      return ok(
        rows
          .filter((row) => row.agentId !== null)
          .map((row) => ({
            agentId: row.agentId as string,
            applied: row._count._all,
          })),
      )
    } catch (error) {
      return err(dbError('Failed to aggregate steel agent impact', error))
    }
  },
}
