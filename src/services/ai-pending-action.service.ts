import type {
  AiPendingAction,
  AiPendingActionStatus,
  Prisma,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  aiAgentModeDisabled,
  aiDisabled,
  aiDoubleConfirmationRequired,
  aiPendingActionChanged,
  aiPendingActionExpired,
  aiPendingActionNotFound,
  aiPendingActionNotPending,
  aiToolNotAllowed,
  mcpWriteDisabled,
} from '@/src/errors/app-error'
import { samePreview } from '@/src/lib/ai/tools/preview-fingerprint'
import {
  type AiToolAccess,
  type AiToolRunResult,
  aiActionSource,
  findTool,
  hasToolAccess,
  isToolAllowed,
  proposeWriteTool,
  resolveToolAccess,
  runTool,
} from '@/src/lib/ai/tools/registry'
import {
  actionResultCallId,
  serializeToolResult,
  TOOL_OUTPUT_MAX_BYTES,
  type ToolResultPayload,
} from '@/src/lib/ai/tools/tool-result'
import type { AiToolContext, AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { err, ok, type Result } from '@/src/lib/result'
import { toAiPendingActionDTO } from '@/src/mappers/ai-pending-action.mapper'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { AiMessageRepository } from '@/src/repositories/ai-conversation.repository'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import { IntegrationGrantRepository } from '@/src/repositories/integration-grant.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type { ConfirmAiPendingActionDTO } from '@/src/schemas/steel-ai.schema'
import type { AiPendingActionDTO } from '@/types/steel-ai'
import { assertSteelAiEnabled } from './ai-conversation.service'
import { assertMember } from './authz'

/**
 * Appends the human decision to the conversation as a TOOL row (synthetic
 * call id `action:<id>`), so the model knows the outcome on the next turn.
 * Failure only logs — the action itself is already decided.
 */
async function appendDecision(
  action: AiPendingAction,
  payload: ToolResultPayload,
): Promise<void> {
  if (!action.conversationId) return
  const appended = await AiMessageRepository.createMany([
    {
      conversationId: action.conversationId,
      role: 'TOOL',
      toolCallId: actionResultCallId(action.id),
      toolName: action.toolName,
      content: serializeToolResult(payload),
    },
  ])
  if (!appended.ok) {
    logger.error(
      'steel_ai.decision_append_failed',
      logFields({
        component: 'AiPendingActionService',
        workspaceId: action.workspaceId,
        conversationId: action.conversationId,
        actionId: action.id,
        message: appended.error.message,
      }),
    )
  }
}

/** Outcome of running a claimed action, plus the raw tool run. */
export interface ClaimedRun {
  action: AiPendingAction
  run: AiToolRunResult
}

/**
 * Writes that ran without a per-action confirmation (audit action
 * `auto_execute`): Autopilot in the app, or an MCP client with `mcp:write`
 * on a tool that is not customer-facing.
 */
type AutoMode = 'AUTOPILOT' | 'MCP'

/**
 * Runs a claimed action and records it everywhere: outcome on the row
 * (EXECUTED or FAILED), AiActionLog and audit. `autoMode` marks writes
 * that ran without a confirmation (audit action `auto_execute`).
 */
async function runClaimed(
  action: AiPendingAction,
  tool: AnySteelAiTool,
  input: {
    ctx: AiToolContext
    deciderId: string | null
    autoMode?: AutoMode
  },
): Promise<Result<ClaimedRun>> {
  const run = await runTool(
    tool,
    input.ctx,
    action.args as Record<string, unknown>,
  )
  const target = run.ok ? run.output.target : undefined

  const completed = await AiPendingActionRepository.complete(
    action.id,
    run.ok
      ? {
          status: 'EXECUTED',
          result: {
            summary: run.output.summary,
            ...(target && { target }),
          } as Prisma.InputJsonValue,
          executedAt: new Date(),
        }
      : { status: 'FAILED', error: run.error.message },
  )
  if (!completed.ok) return completed

  const log = await AiActionLogRepository.create({
    workspaceId: action.workspaceId,
    source: aiActionSource(input.ctx),
    actorId: input.deciderId,
    agentId: input.ctx.agentId ?? null,
    pendingActionId: action.id,
    toolName: action.toolName,
    kind: action.kind,
    module: action.module,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    args: action.args as Prisma.InputJsonValue,
    outcome: run.ok ? 'success' : 'failure',
    summary: run.ok ? run.output.summary : null,
    error: run.ok ? null : run.error.message,
    oauthClientId: input.ctx.oauthClientId ?? null,
  })
  if (!log.ok) {
    logger.error(
      'steel_ai.action_log_failed',
      logFields({
        component: 'AiPendingActionService',
        workspaceId: action.workspaceId,
        actionId: action.id,
        message: log.error.message,
      }),
    )
  }

  auditMutation({
    entity: 'ai_pending_action',
    action: input.autoMode ? 'auto_execute' : 'confirm',
    actorId: input.deciderId,
    targetId: action.id,
    outcome: run.ok ? 'success' : 'failure',
    ...(!run.ok && { reason: run.error.code }),
    meta: {
      workspaceId: action.workspaceId,
      toolName: action.toolName,
      kind: action.kind,
      module: action.module,
      targetType: target?.type,
      targetRecordId: target?.id,
      ...(input.autoMode && { mode: input.autoMode }),
      ...(input.ctx.source === 'mcp' && {
        source: 'mcp',
        oauthClientId: input.ctx.oauthClientId,
      }),
    },
  })

  return ok({ action: completed.value, run })
}

/**
 * Stale-preview guard, run on confirm/approve before the claim. `execute`
 * re-plans from the current records, so a change made after the preview
 * (someone else edited the ticket, moved the opportunity, closed the
 * conversation…) would be applied — or mixed in — without anyone seeing it.
 * The preview is built again with the same `args` and compared with the one
 * stored on the row (`previewFingerprint`):
 * - same → `'unchanged'`, the caller claims and executes;
 * - different → the row keeps PENDING with the fresh preview and the call
 *   answers `AI_PENDING_ACTION_CHANGED` (`details.action` = the refreshed
 *   action) so the human reviews and confirms again;
 * - the row was decided meanwhile (double click) → `'decided'`, the caller
 *   answers with that outcome.
 * A preview that cannot be built now (bad args, record gone, window
 * closed) does not block: `execute` fails the same way and records FAILED,
 * as before. The guard narrows the window to the time between this check
 * and the execution; it is not a lock.
 */
export async function assertPreviewUnchanged(
  action: AiPendingAction,
  tool: AnySteelAiTool,
  ctx: AiToolContext,
  actorId: string,
): Promise<Result<'unchanged' | 'decided'>> {
  if (!tool.preview) return ok('unchanged')
  const parsed = tool.parse(action.args as Record<string, unknown>)
  if (!parsed.ok) return ok('unchanged')

  let fresh: Awaited<ReturnType<NonNullable<AnySteelAiTool['preview']>>>
  try {
    fresh = await tool.preview(ctx, parsed.value)
  } catch {
    return ok('unchanged')
  }
  if (!fresh?.ok || samePreview(action.preview, fresh.value)) {
    return ok('unchanged')
  }

  const refreshed = await AiPendingActionRepository.refreshPreview(
    action.id,
    fresh.value as unknown as Prisma.InputJsonValue,
  )
  if (!refreshed.ok) return refreshed
  if (!refreshed.value) return ok('decided')

  logger.info(
    'steel_ai.action_preview_changed',
    logFields(
      {
        component: 'AiPendingActionService',
        workspaceId: action.workspaceId,
        actionId: action.id,
      },
      { toolName: action.toolName, source: ctx.source },
    ),
  )
  auditMutation({
    entity: 'ai_pending_action',
    action: 'confirm',
    actorId,
    targetId: action.id,
    outcome: 'failure',
    reason: 'AI_PENDING_ACTION_CHANGED',
    meta: {
      workspaceId: action.workspaceId,
      toolName: action.toolName,
      kind: action.kind,
      module: action.module,
      source: ctx.source,
    },
  })
  return err(
    aiPendingActionChanged({ action: toAiPendingActionDTO(refreshed.value) }),
  )
}

/**
 * Executes an action that the caller already claimed (conditional
 * `PENDING → EXECUTED`): re-parses `args`, runs the tool, stores the
 * outcome (EXECUTED or FAILED), writes the AiActionLog + audit and appends
 * the result to the conversation. Shared with Steel Agents, whose approval
 * flow claims the action its own way.
 */
export async function executeClaimedAction(
  action: AiPendingAction,
  tool: AnySteelAiTool,
  input: {
    ctx: AiToolContext
    /** Human who confirmed/approved (null = automatic agent tool). */
    deciderId: string | null
  },
): Promise<Result<AiPendingAction>> {
  const claimed = await runClaimed(action, tool, input)
  if (!claimed.ok) return claimed
  const { run } = claimed.value

  await appendDecision(
    action,
    run.ok
      ? {
          status: 'executed',
          actionId: action.id,
          summary: run.output.summary,
          data: run.output.data,
          note: 'O usuário confirmou e a ação foi executada.',
        }
      : {
          status: 'failed',
          actionId: action.id,
          error: { code: run.error.code, message: run.error.message },
          note: 'O usuário confirmou, mas a execução falhou.',
        },
  )

  return ok(claimed.value.action)
}

const AUTOPILOT_DONE_NOTE =
  'Executada automaticamente (modo Autopilot), sem pedir confirmação. Informe o resultado ao usuário.'
const AUTOPILOT_FAILED_NOTE =
  'A execução automática (modo Autopilot) falhou; nada foi alterado por esta chamada.'

/**
 * AUTOPILOT write: `parse` → `preview` (shown as the result card) → row born
 * claimed by the user → execute now → AiActionLog (ASSISTANT, actor = user)
 * + audit `auto_execute`. Deletes and customer-facing actions included —
 * the workspace opted in (`autopilotEnabled`). `content` is the tool result
 * for the model (the turn persists it as the TOOL row, so no decision note
 * is appended). A failed `parse`/`preview` creates nothing.
 */
export async function executeAutopilotWrite(
  tool: AnySteelAiTool,
  ctx: AiToolContext,
  rawArgs: Record<string, unknown>,
  origin: { conversationId: string; toolCallId: string },
  now: Date = new Date(),
): Promise<Result<{ action: AiPendingAction; content: string }>> {
  const created = await proposeWriteTool(
    tool,
    ctx,
    rawArgs,
    { ...origin, claimedBy: ctx.actorId },
    now,
  )
  if (!created.ok) return created

  const claimed = await runClaimed(created.value, tool, {
    ctx,
    deciderId: ctx.actorId,
    autoMode: 'AUTOPILOT',
  })
  if (!claimed.ok) return claimed
  const { action, run } = claimed.value

  logger.info(
    'steel_ai.autopilot_executed',
    logFields(
      {
        component: 'AiPendingActionService',
        workspaceId: ctx.workspaceId,
        conversationId: origin.conversationId,
        actionId: action.id,
      },
      { toolName: tool.name, kind: tool.kind, status: action.status },
    ),
  )

  const payload: ToolResultPayload = run.ok
    ? {
        status: 'executed',
        actionId: action.id,
        summary: run.output.summary,
        data: run.output.data,
        note: AUTOPILOT_DONE_NOTE,
      }
    : {
        status: 'failed',
        actionId: action.id,
        error: { code: run.error.code, message: run.error.message },
        note: AUTOPILOT_FAILED_NOTE,
      }
  return ok({
    action,
    content: serializeToolResult(payload, TOOL_OUTPUT_MAX_BYTES),
  })
}

/** Inbox screen where the requester confirms an MCP action. */
export function mcpConfirmPath(slug: string, actionId: string): string {
  return `/${slug}/inbox?view=ai&action=${encodeURIComponent(actionId)}`
}

/**
 * MCP write of a tool that is NOT customer-facing (mcp-governance): runs at
 * once, like Autopilot (ADR 0021) — the user consented to `mcp:write` and
 * an admin turned on "Permitir escrita via MCP". The row is born claimed;
 * AiActionLog (source MCP + OAuth client) and audit `auto_execute` (mode
 * MCP). The MCP adapter already checked that the grant exposes the tool.
 */
export async function executeMcpWrite(
  tool: AnySteelAiTool,
  ctx: AiToolContext,
  rawArgs: Record<string, unknown>,
  origin: { integrationGrantId: string },
  now: Date = new Date(),
): Promise<Result<ClaimedRun>> {
  const created = await proposeWriteTool(
    tool,
    ctx,
    rawArgs,
    { claimedBy: ctx.actorId, integrationGrantId: origin.integrationGrantId },
    now,
  )
  if (!created.ok) return created

  const claimed = await runClaimed(created.value, tool, {
    ctx,
    deciderId: ctx.actorId,
    autoMode: 'MCP',
  })
  if (!claimed.ok) return claimed

  logger.info(
    'steel_ai.mcp_write_executed',
    logFields(
      {
        component: 'AiPendingActionService',
        workspaceId: ctx.workspaceId,
        actionId: claimed.value.action.id,
      },
      {
        toolName: tool.name,
        kind: tool.kind,
        status: claimed.value.action.status,
        clientId: ctx.oauthClientId,
      },
    ),
  )
  return claimed
}

/**
 * Customer-facing MCP write (WhatsApp message, public reply, approval
 * link…): only proposed. The AiPendingAction belongs to the grant's user,
 * lasts 30 minutes and is confirmed in the Steel inbox ("Pendências da
 * IA") exactly like a Build-mode action. Returns the path of that screen.
 */
export async function proposeMcpWrite(
  tool: AnySteelAiTool,
  ctx: AiToolContext,
  rawArgs: Record<string, unknown>,
  origin: { integrationGrantId: string },
  now: Date = new Date(),
): Promise<Result<{ action: AiPendingAction; confirmPath: string }>> {
  const workspace = await WorkspaceRepository.findById(ctx.workspaceId)
  if (!workspace.ok) return workspace

  const created = await proposeWriteTool(
    tool,
    ctx,
    rawArgs,
    { integrationGrantId: origin.integrationGrantId },
    now,
  )
  if (!created.ok) return created

  auditMutation({
    entity: 'ai_pending_action',
    action: 'request',
    actorId: ctx.actorId,
    targetId: created.value.id,
    meta: {
      workspaceId: ctx.workspaceId,
      toolName: tool.name,
      kind: tool.kind,
      module: tool.module,
      source: 'mcp',
      oauthClientId: ctx.oauthClientId,
    },
  })
  logger.info(
    'steel_ai.mcp_write_proposed',
    logFields(
      {
        component: 'AiPendingActionService',
        workspaceId: ctx.workspaceId,
        actionId: created.value.id,
      },
      { toolName: tool.name, kind: tool.kind, clientId: ctx.oauthClientId },
    ),
  )

  return ok({
    action: created.value,
    confirmPath: mcpConfirmPath(workspace.value.slug, created.value.id),
  })
}

/** Tool and execution context of a confirmed action. */
interface ConfirmTarget {
  tool: AnySteelAiTool
  ctx: AiToolContext
}

/**
 * Confirm gate of an action an MCP client proposed: the MCP rules apply
 * instead of agent mode — the admin switch is still on, the grant is still
 * active with `mcp:write` and the module, and the user can still use the
 * tool. The execution context carries the OAuth client.
 */
async function mcpConfirmGate(
  action: AiPendingAction,
  integrationGrantId: string,
  actorId: string,
  access: AiToolAccess,
): Promise<Result<ConfirmTarget>> {
  if (!access.mcpWriteEnabled) return err(mcpWriteDisabled())
  const tool = findTool(action.toolName)
  const grant = await IntegrationGrantRepository.findById(integrationGrantId)
  if (!grant.ok) return grant
  if (
    grant.value.revokedAt ||
    grant.value.userId !== actorId ||
    !grant.value.scopes.includes('mcp:write')
  ) {
    return err(
      aiToolNotAllowed(
        'O app conectado que pediu esta ação foi revogado ou perdeu a permissão de escrita.',
      ),
    )
  }
  if (
    !tool ||
    tool.kind === 'READ' ||
    tool.kind === 'DELETE' ||
    !hasToolAccess(tool, access) ||
    (action.module !== null && !grant.value.modules.includes(action.module))
  ) {
    return err(aiToolNotAllowed())
  }
  return ok({
    tool,
    ctx: {
      workspaceId: action.workspaceId,
      actorId,
      source: 'mcp',
      oauthClientId: grant.value.clientId,
    },
  })
}

/** Confirm gate of a Build-mode action: agent mode on and the tool allowed. */
function assistantConfirmGate(
  action: AiPendingAction,
  actorId: string,
  access: AiToolAccess,
): Result<ConfirmTarget> {
  if (!access.agentModeEnabled) return err(aiAgentModeDisabled())
  const tool = findTool(action.toolName)
  if (!tool || !isToolAllowed(tool, access, 'AGENT')) {
    return err(aiToolNotAllowed())
  }
  return ok({
    tool,
    ctx: { workspaceId: action.workspaceId, actorId, source: 'assistant' },
  })
}

/** Answer for an action that is no longer PENDING (double click etc.). */
function alreadyDecided(action: AiPendingAction): Result<AiPendingActionDTO> {
  if (action.status === 'EXECUTED' || action.status === 'FAILED') {
    // Idempotent confirm: the second click sees the first one's outcome.
    return ok(toAiPendingActionDTO(action))
  }
  if (action.status === 'EXPIRED') return err(aiPendingActionExpired())
  return err(aiPendingActionNotPending())
}

/** The outcome of an action another request decided first. */
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

/** Own action (assistant) — someone else's id answers 404. */
async function loadOwnAction(
  actorId: string,
  workspaceId: string,
  actionId: string,
): Promise<Result<AiPendingAction>> {
  const action = await AiPendingActionRepository.findById(actionId, workspaceId)
  if (!action.ok) return action
  if (action.value.requestedById !== actorId) {
    return err(aiPendingActionNotFound())
  }
  return action
}

export const AiPendingActionService = {
  /** The caller's own proposals (lazily expiring overdue ones first). */
  async list(
    actorId: string,
    workspaceId: string,
    filter: { status?: AiPendingActionStatus; conversationId?: string } = {},
  ): Promise<Result<AiPendingActionDTO[]>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const enabled = await assertSteelAiEnabled(workspaceId)
    if (!enabled.ok) return enabled

    const expired = await AiPendingActionRepository.expireOverdue(workspaceId)
    if (!expired.ok) return expired

    const actions = await AiPendingActionRepository.listByRequester({
      workspaceId,
      requestedById: actorId,
      ...filter,
    })
    if (!actions.ok) return actions
    return ok(actions.value.map(toAiPendingActionDTO))
  },

  /**
   * Runs a proposed write after the human clicked "Confirmar". Everything is
   * re-checked on the server (owner, status, expiry, double confirmation,
   * agent mode, module and permission) and `args` are parsed again. The
   * `PENDING → EXECUTED` claim is a conditional update, so two concurrent
   * confirms never execute twice — the loser gets the winner's outcome.
   */
  async confirm(
    actorId: string,
    workspaceId: string,
    actionId: string,
    dto: ConfirmAiPendingActionDTO,
    now: Date = new Date(),
  ): Promise<Result<AiPendingActionDTO>> {
    const access = await resolveToolAccess(actorId, workspaceId)
    if (!access.ok) return access
    if (!access.value.aiEnabled) return err(aiDisabled())

    const action = await loadOwnAction(actorId, workspaceId, actionId)
    if (!action.ok) return action
    if (action.value.status !== 'PENDING') return alreadyDecided(action.value)

    if (action.value.expiresAt.getTime() <= now.getTime()) {
      const expired = await AiPendingActionRepository.transitionFromPending(
        actionId,
        { status: 'EXPIRED' },
      )
      if (!expired.ok) return expired
      return err(aiPendingActionExpired())
    }

    if (action.value.requiresDoubleConfirm && dto.doubleConfirmed !== true) {
      return err(aiDoubleConfirmationRequired())
    }

    const gate = action.value.integrationGrantId
      ? // Proposed by an external AI client: MCP rules, not agent mode.
        await mcpConfirmGate(
          action.value,
          action.value.integrationGrantId,
          actorId,
          access.value,
        )
      : assistantConfirmGate(action.value, actorId, access.value)
    if (!gate.ok) return gate
    const { tool, ctx } = gate.value

    // What the human saw must still be what runs (assistant and MCP alike).
    const unchanged = await assertPreviewUnchanged(
      action.value,
      tool,
      ctx,
      actorId,
    )
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

    const executed = await executeClaimedAction(claimed.value, tool, {
      ctx,
      deciderId: actorId,
    })
    if (!executed.ok) return executed

    logger.info(
      'steel_ai.action_confirmed',
      logFields(
        { component: 'AiPendingActionService', workspaceId, actionId },
        { toolName: action.value.toolName, status: executed.value.status },
      ),
    )

    return ok(toAiPendingActionDTO(executed.value))
  },

  /** Discards a proposal; the model learns it on the next turn. */
  async cancel(
    actorId: string,
    workspaceId: string,
    actionId: string,
    now: Date = new Date(),
  ): Promise<Result<AiPendingActionDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const enabled = await assertSteelAiEnabled(workspaceId)
    if (!enabled.ok) return enabled

    const action = await loadOwnAction(actorId, workspaceId, actionId)
    if (!action.ok) return action

    const canceled = await AiPendingActionRepository.transitionFromPending(
      actionId,
      { status: 'CANCELED', decidedById: actorId, decidedAt: now },
    )
    if (!canceled.ok) return canceled
    if (!canceled.value) return err(aiPendingActionNotPending())

    auditMutation({
      entity: 'ai_pending_action',
      action: 'cancel',
      actorId,
      targetId: actionId,
      meta: { workspaceId, toolName: action.value.toolName },
    })

    await appendDecision(canceled.value, {
      status: 'canceled',
      actionId,
      note: 'O usuário cancelou esta ação; nada foi alterado.',
    })

    return ok(toAiPendingActionDTO(canceled.value))
  },
}
