import type {
  AiActionSource,
  AiPendingAction,
  ModuleKind,
  Prisma,
} from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  type AppError,
  aiToolNotAllowed,
  appError,
} from '@/src/errors/app-error'
import { can, type PermissionMap } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { assertMember } from '@/src/services/authz'
import type { AiSimulatedActionDTO } from '@/types/steel-ai'
import { MEMORY_TOOL_LABELS } from '../context/memory-tool-names'
import type { AiToolSpec } from '../types'
import { STEEL_AI_TOOLS } from './index'
import {
  compactToolSpec,
  FIND_TOOLS_LABEL,
  FIND_TOOLS_TOOL_NAME,
} from './selection'
import { simulatedToolResult } from './simulation'
import {
  serializeToolResult,
  TOOL_OUTPUT_MAX_BYTES,
  type ToolResultPayload,
} from './tool-result'
import type { AiToolContext, AiToolOutput, AnySteelAiTool } from './types'

/**
 * Runtime of the Steel AI tools: what the model may see (mode × module ×
 * RBAC × agent-mode switch), running read tools and turning write tools
 * into AiPendingActions. Shared by the assistant and Steel Agents.
 */

/**
 * EXPLORE ("Ask") = READ only; AGENT ("Build") = writes become pending
 * actions; AUTOPILOT = writes run at once (still logged and audited);
 * TEST ("Teste") = writes are only simulated from their preview.
 */
export type SteelAiMode = 'EXPLORE' | 'AGENT' | 'AUTOPILOT' | 'TEST'

/** Modes in which the model is offered write tools. */
export function isWriteMode(mode: SteelAiMode): boolean {
  return mode === 'AGENT' || mode === 'AUTOPILOT' || mode === 'TEST'
}

/** A pending action stays confirmable for 30 minutes. */
export const PENDING_ACTION_TTL_MS = 30 * 60_000

/** Everything the filter needs about the caller and the workspace. */
export interface AiToolAccess {
  /** Modules enabled in the workspace. */
  modules: ModuleKind[]
  /** OWNER/ADMIN — bypass the RBAC matrix, like `assertMember`. */
  isPrivileged: boolean
  permissions: PermissionMap | null
  /** Workspace kill switch for write tools. */
  agentModeEnabled: boolean
  /** Master switch of every Steel AI feature (default on). */
  aiEnabled: boolean
  /** Steel Agents may run (default on). */
  agentsEnabled: boolean
  /** AUTOPILOT mode allowed (default off). */
  autopilotEnabled: boolean
  /** Steel AI memory tools offered (`resolveToolAccess` sets it; default on). */
  memoryEnabled?: boolean
  /**
   * MCP clients with `mcp:write` may be offered write tools
   * (`resolveToolAccess` sets it; default off). Read by the MCP server only —
   * `isToolAllowed` ignores it, so the in-app assistant is unaffected.
   */
  mcpWriteEnabled?: boolean
}

const TOOL_NAME = /^[a-z][a-z0-9_]{1,63}$/

/** Problems in a tool list (empty = valid). */
export function validateToolRegistry(
  tools: readonly AnySteelAiTool[],
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const tool of tools) {
    if (!TOOL_NAME.test(tool.name)) {
      problems.push(`Tool "${tool.name}" must be snake_case (≤ 64 chars)`)
    }
    if (seen.has(tool.name)) {
      problems.push(`Duplicate tool name "${tool.name}"`)
    }
    seen.add(tool.name)
    if (tool.kind !== 'READ' && typeof tool.preview !== 'function') {
      problems.push(`Write tool "${tool.name}" must implement preview()`)
    }
    if (tool.parameters.type !== 'object') {
      problems.push(`Tool "${tool.name}" parameters must be an object schema`)
    }
    problems.push(...hintProblems(tool))
  }
  return problems
}

const LABEL_MAX_LENGTH = 40

/**
 * Consistency of the MCP-facing metadata (`label`, `annotations`,
 * `customerFacing`). External clients trust these hints to decide what to
 * confirm, so a wrong one is a security bug, not a cosmetic one.
 */
function hintProblems(tool: AnySteelAiTool): string[] {
  const problems: string[] = []
  const hints = tool.annotations ?? {}
  const label = tool.label.trim()
  if (label === '' || label.length > LABEL_MAX_LENGTH) {
    problems.push(
      `Tool "${tool.name}" label must have 1–${LABEL_MAX_LENGTH} chars`,
    )
  }
  if (tool.kind === 'READ') {
    if (hints.destructiveHint) {
      problems.push(`Read tool "${tool.name}" cannot be destructive`)
    }
    if (tool.customerFacing) {
      problems.push(`Read tool "${tool.name}" cannot be customer-facing`)
    }
    return problems
  }
  if (typeof hints.destructiveHint !== 'boolean') {
    problems.push(`Write tool "${tool.name}" must declare destructiveHint`)
  }
  if (tool.kind === 'DELETE' && hints.destructiveHint === false) {
    problems.push(`Delete tool "${tool.name}" must be destructive`)
  }
  if (tool.kind === 'CREATE' && hints.destructiveHint === true) {
    problems.push(`Create tool "${tool.name}" must not be destructive`)
  }
  if (tool.customerFacing && hints.openWorldHint !== true) {
    problems.push(
      `Customer-facing tool "${tool.name}" must declare openWorldHint`,
    )
  }
  return problems
}

export function assertValidToolRegistry(
  tools: readonly AnySteelAiTool[],
): void {
  const problems = validateToolRegistry(tools)
  if (problems.length > 0) {
    throw new Error(`Invalid Steel AI tool registry: ${problems.join('; ')}`)
  }
}

// Fail fast at load time: a duplicated name or a write tool without
// preview would otherwise only show up when the model calls it.
assertValidToolRegistry(STEEL_AI_TOOLS)

/** AiActionLog source of a tool context (who drove the write). */
export function aiActionSource(
  ctx: Pick<AiToolContext, 'source'>,
): AiActionSource {
  if (ctx.source === 'agent') return 'AGENT'
  if (ctx.source === 'mcp') return 'MCP'
  return 'ASSISTANT'
}

/** Whether the model may be offered `tool` in `mode` for this caller. */
export function isToolAllowed(
  tool: AnySteelAiTool,
  access: AiToolAccess,
  mode: SteelAiMode,
): boolean {
  if (tool.kind !== 'READ') {
    if (!isWriteMode(mode)) return false
    // TEST never writes, so the agent-mode kill switch does not apply.
    if (mode !== 'TEST' && !access.agentModeEnabled) return false
    if (mode === 'AUTOPILOT' && !access.autopilotEnabled) return false
  }
  return hasToolAccess(tool, access)
}

/**
 * Module and RBAC gate of a tool, without the mode switches — for callers
 * with their own write gate (the MCP server: `mcp:write` + the admin
 * switch, independent of agent mode).
 */
export function hasToolAccess(
  tool: AnySteelAiTool,
  access: AiToolAccess,
): boolean {
  if (tool.module && !access.modules.includes(tool.module)) return false
  if (tool.permission && !access.isPrivileged) {
    if (
      !access.permissions ||
      !can(access.permissions, tool.permission.resource, tool.permission.action)
    ) {
      return false
    }
  }
  return true
}

/** Tools the model is shown: EXPLORE ⇒ READ only; the other modes add writes. */
export function availableTools(
  access: AiToolAccess,
  mode: SteelAiMode,
  tools: readonly AnySteelAiTool[] = STEEL_AI_TOOLS,
): AnySteelAiTool[] {
  return tools.filter((tool) => isToolAllowed(tool, access, mode))
}

export function findTool(
  name: string,
  tools: readonly AnySteelAiTool[] = STEEL_AI_TOOLS,
): AnySteelAiTool | undefined {
  return tools.find((tool) => tool.name === name)
}

/** Label/module for the transcript; unknown (removed) tools keep the name. */
export function toolMeta(
  name: string,
  tools: readonly AnySteelAiTool[] = STEEL_AI_TOOLS,
): { label: string; module: ModuleKind | null } {
  if (name === FIND_TOOLS_TOOL_NAME) {
    return { label: FIND_TOOLS_LABEL, module: null }
  }
  if (MEMORY_TOOL_LABELS[name]) {
    return { label: MEMORY_TOOL_LABELS[name], module: null }
  }
  const tool = findTool(name, tools)
  return tool
    ? { label: tool.label, module: tool.module }
    : { label: name, module: null }
}

/**
 * Provider-neutral specs (what the adapters send to the model), with the
 * JSON Schema compacted — see `compactToolSpec`. To send only the tools a
 * round needs, pick them first with `selectSteelAiTools`.
 */
export function toToolSpecs(tools: readonly AnySteelAiTool[]): AiToolSpec[] {
  return tools.map(compactToolSpec)
}

/**
 * Resolves the caller's access in one go: membership (403 for strangers and
 * suspended workspaces), enabled modules, RBAC matrix and the workspace
 * switches (AI, agent mode, Steel Agents, Autopilot, MCP writes).
 */
export async function resolveToolAccess(
  actorId: string,
  workspaceId: string,
): Promise<Result<AiToolAccess>> {
  const membership = await assertMember(actorId, workspaceId)
  if (!membership.ok) return membership

  const [modules, settings] = await Promise.all([
    WorkspaceModuleAccessRepository.listByWorkspace(workspaceId),
    WorkspaceAiSettingsRepository.findByWorkspace(workspaceId),
  ])
  if (!modules.ok) return modules
  if (!settings.ok) return settings

  return ok({
    modules: modules.value.filter((m) => m.enabled).map((m) => m.module),
    isPrivileged: membership.value.isPrivileged,
    permissions: membership.value.permissions,
    agentModeEnabled: settings.value?.agentModeEnabled ?? true,
    aiEnabled: settings.value?.aiEnabled ?? true,
    agentsEnabled: settings.value?.agentsEnabled ?? true,
    autopilotEnabled: settings.value?.autopilotEnabled ?? false,
    memoryEnabled: settings.value?.memoryEnabled ?? true,
    mcpWriteEnabled: settings.value?.mcpWriteEnabled ?? false,
  })
}

export type AiToolRunResult =
  | { ok: true; output: AiToolOutput; content: string }
  | { ok: false; error: AppError; content: string }

function failure(error: AppError): Extract<AiToolRunResult, { ok: false }> {
  return {
    ok: false,
    error,
    content: serializeToolResult({
      status: 'error',
      error: { code: error.code, message: error.message },
    }),
  }
}

function unexpected(tool: AnySteelAiTool, cause: unknown): AppError {
  logger.error(
    'steel_ai.tool_threw',
    logFields(
      {
        component: 'SteelAiToolRegistry',
        message: cause instanceof Error ? cause.message : String(cause),
      },
      { toolName: tool.name },
    ),
  )
  return appError(
    'INTERNAL_SERVER_ERROR',
    'Falha inesperada ao executar a ferramenta',
  )
}

/**
 * `parse` → `execute`, never throws. The `content` is the JSON returned to
 * the model, capped at ~20 KB. Callers decide whether the tool may run
 * (filter + confirmation); this only executes.
 */
export async function runTool(
  tool: AnySteelAiTool,
  ctx: AiToolContext,
  rawArgs: Record<string, unknown>,
): Promise<AiToolRunResult> {
  const parsed = tool.parse(rawArgs)
  if (!parsed.ok) return failure(parsed.error)

  try {
    const result = await tool.execute(ctx, parsed.value)
    if (!result.ok) return failure(result.error)
    const payload: ToolResultPayload = {
      status: 'done',
      summary: result.value.summary,
      data: result.value.data,
    }
    return {
      ok: true,
      output: result.value,
      content: serializeToolResult(payload, TOOL_OUTPUT_MAX_BYTES),
    }
  } catch (cause) {
    return failure(unexpected(tool, cause))
  }
}

/** Runs a READ tool; refuses any write tool (those need confirmation). */
export async function runReadTool(
  tool: AnySteelAiTool,
  ctx: AiToolContext,
  rawArgs: Record<string, unknown>,
): Promise<AiToolRunResult> {
  if (tool.kind !== 'READ') return failure(aiToolNotAllowed())
  return runTool(tool, ctx, rawArgs)
}

/**
 * Write tool proposed by the model: `parse` → `preview` (no mutation) →
 * AiPendingAction(PENDING, expires in 30 min, DELETE needs a double
 * confirmation). Nothing is executed here.
 */
export async function proposeWriteTool(
  tool: AnySteelAiTool,
  ctx: AiToolContext,
  rawArgs: Record<string, unknown>,
  origin: {
    conversationId?: string | null
    toolCallId?: string | null
    agentRunId?: string | null
    /** Overrides the 30 min validity (Steel Agents approve via the inbox). */
    ttlMs?: number
    /**
     * AUTOPILOT: the row is born claimed (`EXECUTED`, decided by this user,
     * `autoExecuted`) so the caller executes it right away; it is never
     * offered for confirmation.
     */
    claimedBy?: string
    /** MCP: grant of the external client that proposed it. */
    integrationGrantId?: string
  } = {},
  now: Date = new Date(),
): Promise<Result<AiPendingAction>> {
  if (tool.kind === 'READ' || !tool.preview) return err(aiToolNotAllowed())

  const parsed = tool.parse(rawArgs)
  if (!parsed.ok) return parsed

  let preview: Awaited<ReturnType<NonNullable<AnySteelAiTool['preview']>>>
  try {
    preview = await tool.preview(ctx, parsed.value)
  } catch (cause) {
    return err(unexpected(tool, cause))
  }
  if (!preview.ok) return preview

  return AiPendingActionRepository.create({
    workspaceId: ctx.workspaceId,
    // Assistant and MCP: the user who asked is the only one who confirms.
    requestedById: ctx.source === 'agent' ? null : ctx.actorId,
    conversationId: origin.conversationId ?? null,
    agentRunId: origin.agentRunId ?? null,
    toolName: tool.name,
    toolCallId: origin.toolCallId ?? null,
    kind: tool.kind,
    module: tool.module,
    args: parsed.value as Prisma.InputJsonValue,
    preview: preview.value as unknown as Prisma.InputJsonValue,
    requiresDoubleConfirm: tool.kind === 'DELETE',
    expiresAt: new Date(
      now.getTime() + (origin.ttlMs ?? PENDING_ACTION_TTL_MS),
    ),
    ...(origin.integrationGrantId && {
      integrationGrantId: origin.integrationGrantId,
    }),
    ...(origin.claimedBy && {
      status: 'EXECUTED' as const,
      decidedById: origin.claimedBy,
      decidedAt: now,
      autoExecuted: true,
    }),
  })
}

export type AiToolSimulationResult =
  | {
      ok: true
      simulation: AiSimulatedActionDTO
      /** Simulated success returned to the model (`status: simulated`). */
      content: string
    }
  | { ok: false; error: AppError; content: string }

/**
 * Teste mode / agent test run: `parse` → `preview` and stop. `execute` is
 * never called, no AiPendingAction is created and nothing is sent; the
 * model gets a simulated success built from the preview. The attempt goes
 * to AiActionLog with `outcome = simulated` (audit trail of what the AI
 * would have done). A failed parse/preview is returned as a tool error —
 * the real run would have failed too.
 */
export async function simulateWriteTool(
  tool: AnySteelAiTool,
  ctx: AiToolContext,
  rawArgs: Record<string, unknown>,
  log: { actorId: string | null },
): Promise<AiToolSimulationResult> {
  if (tool.kind === 'READ' || !tool.preview) return failure(aiToolNotAllowed())

  const parsed = tool.parse(rawArgs)
  if (!parsed.ok) return failure(parsed.error)

  let preview: Awaited<ReturnType<NonNullable<AnySteelAiTool['preview']>>>
  try {
    preview = await tool.preview(ctx, parsed.value)
  } catch (cause) {
    return failure(unexpected(tool, cause))
  }
  if (!preview.ok) return failure(preview.error)

  const simulation: AiSimulatedActionDTO = {
    kind: tool.kind,
    preview: preview.value,
  }
  const logged = await AiActionLogRepository.create({
    workspaceId: ctx.workspaceId,
    source: aiActionSource(ctx),
    actorId: log.actorId,
    agentId: ctx.agentId ?? null,
    toolName: tool.name,
    kind: tool.kind,
    module: tool.module,
    targetType: preview.value.target?.type ?? null,
    targetId: preview.value.target?.id ?? null,
    args: parsed.value as Prisma.InputJsonValue,
    outcome: 'simulated',
    summary: preview.value.title,
  })
  if (!logged.ok) {
    logger.error(
      'steel_ai.simulation_log_failed',
      logFields(
        {
          component: 'SteelAiToolRegistry',
          workspaceId: ctx.workspaceId,
          message: logged.error.message,
        },
        { toolName: tool.name },
      ),
    )
  }

  return {
    ok: true,
    simulation,
    content: serializeToolResult(
      simulatedToolResult(tool.kind, preview.value),
      TOOL_OUTPUT_MAX_BYTES,
    ),
  }
}
