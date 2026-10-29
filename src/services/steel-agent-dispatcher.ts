import type { Prisma } from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { enqueueSteelAgentRun } from '@/src/lib/steel-agents/enqueue'
import type { SteelAgentEventKey } from '@/src/lib/steel-agents/events'
import { currentSteelAgentContext } from '@/src/lib/steel-agents/run-context'
import { nextCronRun, previousCronRun } from '@/src/lib/steel-agents/schedule'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import {
  SteelAgentRepository,
  SteelAgentRunRepository,
  SteelAgentRunStepRepository,
} from '@/src/repositories/steel-agent.repository'

/**
 * Triggers of Steel Agents: the schedule tick (worker, every minute) and
 * domain events. Both only create a QUEUED run and enqueue `run`; the runner
 * does the rest. Never throws.
 */

/** A cron occurrence older than this is not dispatched (worker was down). */
export const STEEL_AGENT_TICK_TOLERANCE_MS = 5 * 60_000

export interface SteelAgentTickResult {
  considered: number
  dispatched: number
  expired: number
  errors: number
}

/** Expires overdue agent approvals and resumes their runs. */
async function expireOverdueApprovals(
  now: Date,
): Promise<{ expired: number; errors: number }> {
  const overdue = await SteelAgentRunRepository.listOverdueActions(now)
  if (!overdue.ok) return { expired: 0, errors: 1 }
  let expired = 0
  let errors = 0
  const runs = new Set<string>()
  for (const action of overdue.value) {
    const flipped = await AiPendingActionRepository.transitionFromPending(
      action.id,
      { status: 'EXPIRED' },
    )
    if (!flipped.ok) {
      errors++
      continue
    }
    if (!flipped.value) continue
    expired++
    await SteelAgentRunStepRepository.updateByPendingAction(action.id, {
      status: 'EXPIRED',
    })
    if (action.agentRunId) runs.add(action.agentRunId)
  }
  for (const runId of runs) {
    const queued = await enqueueSteelAgentRun(runId)
    if (!queued.ok) errors++
  }
  return { expired, errors }
}

export async function runSteelAgentTick(
  now: Date = new Date(),
): Promise<SteelAgentTickResult> {
  const result: SteelAgentTickResult = {
    considered: 0,
    dispatched: 0,
    expired: 0,
    errors: 0,
  }

  const approvals = await expireOverdueApprovals(now)
  result.expired = approvals.expired
  result.errors += approvals.errors

  const agents = await SteelAgentRepository.listScheduled()
  if (!agents.ok) {
    result.errors++
    return result
  }

  for (const agent of agents.value) {
    result.considered++
    const occurrence = previousCronRun(
      agent.cron as string,
      agent.timezone,
      now,
    )
    if (!occurrence) continue
    if (now.getTime() - occurrence.getTime() > STEEL_AGENT_TICK_TOLERANCE_MS) {
      continue
    }
    if (agent.lastRunAt && occurrence <= agent.lastRunAt) continue

    // Claim first: two concurrent ticks never dispatch the same occurrence.
    const claimed = await SteelAgentRepository.claimOccurrence(
      agent.id,
      occurrence,
      nextCronRun(agent.cron as string, agent.timezone, now),
    )
    if (!claimed.ok) {
      result.errors++
      continue
    }
    if (!claimed.value) continue

    const run = await SteelAgentRunRepository.create({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      triggerType: 'SCHEDULE',
      triggerPayload: { scheduledFor: occurrence.toISOString() },
    })
    if (!run.ok) {
      result.errors++
      continue
    }
    const queued = await enqueueSteelAgentRun(run.value.id)
    if (!queued.ok) {
      result.errors++
      continue
    }
    result.dispatched++
  }
  return result
}

/**
 * Fire-and-forget hook for domain events (ticket created, lead created...).
 * Call it with `void` after the business write: it never throws and never
 * fails the caller. Writes made by an agent do not trigger agents (loop
 * guard, see `run-context.ts`).
 */
export async function dispatchSteelAgentEvent(
  workspaceId: string,
  eventKey: SteelAgentEventKey,
  payload: Record<string, unknown>,
): Promise<number> {
  try {
    const origin = currentSteelAgentContext()
    if (origin) {
      logger.info(
        'steel_agents.event_ignored_from_agent',
        logFields(
          { component: 'SteelAgentDispatcher', workspaceId },
          { eventKey, agentId: origin.agentId },
        ),
      )
      return 0
    }
    const agents = await SteelAgentRepository.listByEvent(workspaceId, eventKey)
    if (!agents.ok) return 0
    let dispatched = 0
    for (const agent of agents.value) {
      const run = await SteelAgentRunRepository.create({
        workspaceId,
        agentId: agent.id,
        triggerType: 'EVENT',
        triggerPayload: {
          event: eventKey,
          ...payload,
        } as Prisma.InputJsonValue,
      })
      if (!run.ok) continue
      const queued = await enqueueSteelAgentRun(run.value.id)
      if (queued.ok) dispatched++
    }
    return dispatched
  } catch (cause) {
    logger.warn(
      'steel_agents.event_dispatch_failed',
      logFields(
        {
          component: 'SteelAgentDispatcher',
          workspaceId,
          message: cause instanceof Error ? cause.message : String(cause),
        },
        { eventKey },
      ),
    )
    return 0
  }
}

/**
 * Explicit hand-off to one agent: the record was assigned to it or it was
 * cited with `@` in a comment. Works for any trigger type (a MANUAL agent can
 * be mentioned), but paused agents are skipped and the loop guard applies
 * (an agent's own writes never wake another agent). Never throws; returns
 * whether a run was queued.
 */
export type SteelAgentDirectEvent =
  | 'sd.ticket.agent_assigned'
  | 'sd.ticket.agent_mentioned'
  | 'crm.lead.agent_assigned'
  | 'crm.note.agent_mentioned'

export async function dispatchSteelAgentDirect(
  workspaceId: string,
  agentId: string,
  event: SteelAgentDirectEvent,
  payload: Record<string, unknown>,
  startedById: string | null = null,
): Promise<boolean> {
  try {
    if (currentSteelAgentContext()) return false
    const agents = await SteelAgentRepository.listEnabledByIds(workspaceId, [
      agentId,
    ])
    if (!agents.ok || agents.value.length === 0) return false
    const run = await SteelAgentRunRepository.create({
      workspaceId,
      agentId,
      triggerType: 'EVENT',
      startedById,
      triggerPayload: { event, ...payload } as Prisma.InputJsonValue,
    })
    if (!run.ok) return false
    const queued = await enqueueSteelAgentRun(run.value.id)
    return queued.ok
  } catch (cause) {
    logger.warn(
      'steel_agents.direct_dispatch_failed',
      logFields(
        {
          component: 'SteelAgentDispatcher',
          workspaceId,
          message: cause instanceof Error ? cause.message : String(cause),
        },
        { event, agentId },
      ),
    )
    return false
  }
}
