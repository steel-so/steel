import type { AiPendingAction, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { forbidden } from '@/src/errors'
import {
  aiAgentModeDisabled,
  aiDoubleConfirmationRequired,
  aiPendingActionExpired,
  aiPendingActionNotFound,
  aiPendingActionNotPending,
  aiToolNotAllowed,
  steelAgentRunNotFound,
  steelAgentsPaused,
} from '@/src/errors/app-error'
import { isToolAllowed, resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { err, ok, type Result } from '@/src/lib/result'
import { enqueueSteelAgentRun } from '@/src/lib/steel-agents/enqueue'
import { runInSteelAgentContext } from '@/src/lib/steel-agents/run-context'
import { toAiPendingActionDTO } from '@/src/mappers/ai-pending-action.mapper'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import {
  SteelAgentRunRepository,
  SteelAgentRunStepRepository,
  type SteelAgentRunWithAgent,
} from '@/src/repositories/steel-agent.repository'
import { SteelAgentPolicyRepository } from '@/src/repositories/steel-agent-governance.repository'
import type { ApproveSteelAgentActionDTO } from '@/src/schemas/steel-agent.schema'
import type { AiPendingActionDTO } from '@/types/steel-ai'
import {
  assertPreviewUnchanged,
  executeClaimedAction,
} from './ai-pending-action.service'
import { assertMember } from './authz'
import { canManageSteelAgents } from './steel-agent.service'
import { resolveAgentTool } from './steel-mcp-tools'

/**
 * Inbox approvals of Steel Agent writes. The user route
 * `/ai/actions/{id}/confirm` refuses them (it checks `requestedById`), so
 * agents have their own: the agent owner or a `steel-agents` manager
 * decides; the tool still runs **as the owner** (owner's RBAC, owner's
 * module access, agent-mode switch, tool still allowed for the agent).
 * The claim is the same conditional `PENDING → …` update as the assistant,
 * so two clicks never execute twice. After every decision the run is
 * re-enqueued; the runner resumes it once nothing is pending.
 */

interface Loaded {
  run: SteelAgentRunWithAgent
  action: AiPendingAction
}

async function load(
  actorId: string,
  workspaceId: string,
  runId: string,
  actionId: string,
): Promise<Result<Loaded>> {
  const membership = await assertMember(actorId, workspaceId)
  if (!membership.ok) return membership

  const run = await SteelAgentRunRepository.findForExecution(runId)
  if (!run.ok) return run
  if (run.value.workspaceId !== workspaceId) return err(steelAgentRunNotFound())

  if (
    run.value.agent.ownerId !== actorId &&
    !canManageSteelAgents(membership.value)
  ) {
    return err(forbidden())
  }

  const action = await AiPendingActionRepository.findById(actionId, workspaceId)
  if (!action.ok) return action
  if (action.value.agentRunId !== runId) return err(aiPendingActionNotFound())
  return ok({ run: run.value, action: action.value })
}

function alreadyDecided(action: AiPendingAction): Result<AiPendingActionDTO> {
  if (action.status === 'EXECUTED' || action.status === 'FAILED') {
    return ok(toAiPendingActionDTO(action))
  }
  if (action.status === 'EXPIRED') return err(aiPendingActionExpired())
  return err(aiPendingActionNotPending())
}

async function resume(runId: string): Promise<void> {
  const queued = await enqueueSteelAgentRun(runId)
  if (!queued.ok) {
    logger.warn(
      'steel_agents.resume_enqueue_failed',
      logFields({ component: 'SteelAgentApprovalService' }, { runId }),
    )
  }
}

async function reloadDecided(
  actionId: string,
  workspaceId: string,
): Promise<Result<AiPendingActionDTO>> {
  const current = await AiPendingActionRepository.findById(
    actionId,
    workspaceId,
  )
  if (!current.ok) return current
  return alreadyDecided(current.value)
}

export const SteelAgentApprovalService = {
  async approve(
    actorId: string,
    workspaceId: string,
    runId: string,
    actionId: string,
    dto: ApproveSteelAgentActionDTO,
    now: Date = new Date(),
  ): Promise<Result<AiPendingActionDTO>> {
    const loaded = await load(actorId, workspaceId, runId, actionId)
    if (!loaded.ok) return loaded
    const { run, action } = loaded.value
    if (action.status !== 'PENDING') return alreadyDecided(action)

    if (action.expiresAt.getTime() <= now.getTime()) {
      const expired = await AiPendingActionRepository.transitionFromPending(
        actionId,
        { status: 'EXPIRED' },
      )
      if (!expired.ok) return expired
      await SteelAgentRunStepRepository.updateByPendingAction(actionId, {
        status: 'EXPIRED',
      })
      await resume(runId)
      return err(aiPendingActionExpired())
    }

    if (action.requiresDoubleConfirm && dto.doubleConfirmed !== true) {
      return err(aiDoubleConfirmationRequired())
    }

    // A6: nothing an agent proposed executes while the emergency switch is on.
    const policy = await SteelAgentPolicyRepository.find(workspaceId)
    if (!policy.ok) return policy
    if (policy.value?.killedAt) return err(steelAgentsPaused())

    const ownerId = run.agent.ownerId
    if (!ownerId) {
      return err(aiToolNotAllowed('O agente está sem responsável'))
    }
    const access = await resolveToolAccess(ownerId, workspaceId)
    if (!access.ok) {
      return err(
        aiToolNotAllowed(
          'O responsável pelo agente não tem mais acesso a este workspace',
        ),
      )
    }
    if (!access.value.agentModeEnabled) return err(aiAgentModeDisabled())
    const resolved = await resolveAgentTool(workspaceId, action.toolName)
    if (!resolved.ok) return resolved
    const tool = resolved.value
    const stillAllowed = run.agent.tools.some(
      (t) => t.toolName === action.toolName,
    )
    if (!tool || !stillAllowed || !isToolAllowed(tool, access.value, 'AGENT')) {
      return err(aiToolNotAllowed())
    }

    const ctx = {
      workspaceId,
      actorId: ownerId,
      source: 'agent' as const,
      agentId: run.agentId,
    }
    // The approver must approve what will actually run.
    const unchanged = await assertPreviewUnchanged(action, tool, ctx, actorId)
    if (!unchanged.ok) return unchanged
    if (unchanged.value === 'decided') {
      return reloadDecided(actionId, workspaceId)
    }

    const claimed = await AiPendingActionRepository.transitionFromPending(
      actionId,
      { status: 'EXECUTED', decidedById: actorId, decidedAt: now },
    )
    if (!claimed.ok) return claimed
    if (!claimed.value) return reloadDecided(actionId, workspaceId)

    const claimedAction = claimed.value
    const executed = await runInSteelAgentContext(
      { agentId: run.agentId, runId },
      () =>
        executeClaimedAction(claimedAction, tool, {
          ctx,
          deciderId: actorId,
        }),
    )
    if (!executed.ok) return executed

    const dto2 = toAiPendingActionDTO(executed.value)
    await SteelAgentRunStepRepository.updateByPendingAction(actionId, {
      status: 'APPROVED',
      output: {
        title: dto2.preview.title,
        outcome: executed.value.status,
        ...(dto2.resultSummary && { summary: dto2.resultSummary }),
      } as Prisma.InputJsonValue,
      ...(executed.value.error && { error: executed.value.error }),
    })
    auditMutation({
      entity: 'steel_agent_run',
      action: 'approve',
      actorId,
      targetId: runId,
      meta: {
        workspaceId,
        agentId: run.agentId,
        actionId,
        toolName: action.toolName,
        status: executed.value.status,
      },
    })
    await resume(runId)
    return ok(dto2)
  },

  async reject(
    actorId: string,
    workspaceId: string,
    runId: string,
    actionId: string,
    now: Date = new Date(),
  ): Promise<Result<AiPendingActionDTO>> {
    const loaded = await load(actorId, workspaceId, runId, actionId)
    if (!loaded.ok) return loaded
    const { run, action } = loaded.value

    const canceled = await AiPendingActionRepository.transitionFromPending(
      actionId,
      { status: 'CANCELED', decidedById: actorId, decidedAt: now },
    )
    if (!canceled.ok) return canceled
    if (!canceled.value) return err(aiPendingActionNotPending())

    await SteelAgentRunStepRepository.updateByPendingAction(actionId, {
      status: 'REJECTED',
    })
    auditMutation({
      entity: 'steel_agent_run',
      action: 'reject',
      actorId,
      targetId: runId,
      meta: {
        workspaceId,
        agentId: run.agentId,
        actionId,
        toolName: action.toolName,
      },
    })
    await resume(runId)
    return ok(toAiPendingActionDTO(canceled.value))
  },
}
