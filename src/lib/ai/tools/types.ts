import type { ModuleKind } from '@prisma/client'
import type { AppError } from '@/src/errors/app-error'
import type {
  PermissionAction,
  PermissionResource,
} from '@/src/lib/permissions'
import type { Result } from '@/src/lib/result'
import type { AiToolPreviewDTO } from '@/types/steel-ai'

/**
 * Contract of a Steel AI tool, shared by the assistant (explore/agent modes)
 * and Steel Agents. Every tool wraps an existing domain service and runs
 * with the caller's own permissions — the service is still the authority;
 * `permission`/`module` only pre-filter what the model is shown.
 *
 * Write tools (kind !== 'READ') never execute straight from the model: the
 * runtime calls `preview`, stores an AiPendingAction and only calls
 * `execute` after a human confirms it (or, for agents, when the tool is
 * configured as automatic and is not a DELETE).
 */

export type AiToolKind = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTION'

export interface AiToolContext {
  workspaceId: string
  /** User whose permissions apply (the chat user, or the agent's owner). */
  actorId: string
  source: 'assistant' | 'agent' | 'mcp'
  agentId?: string
  /** OAuth client of an MCP call (Claude, ChatGPT, Cursor…), ADR 0032. */
  oauthClientId?: string
  /** Assistant chat the call belongs to (memory source links). */
  conversationId?: string
}

export interface AiToolOutput {
  /** JSON-serializable payload returned to the model. */
  data: unknown
  /** Short pt-BR summary shown in the transcript ("12 chamados encontrados"). */
  summary: string
  /** Record touched by a write, for AiActionLog and deep links. */
  target?: { type: string; id: string; label?: string; href?: string }
}

export interface SteelAiTool<Args = Record<string, unknown>> {
  /** snake_case, unique across modules, prefixed by area (`sd_`, `crm_`, `zap_`). */
  name: string
  /** pt-BR label for the transcript, e.g. "Consultando chamados". */
  label: string
  /** Module that must be enabled (null = platform-level tool). */
  module: ModuleKind | null
  kind: AiToolKind
  /** Instructions for the model (pt-BR is fine; be precise about fields). */
  description: string
  /** JSON Schema of an object — what the model sees. */
  parameters: Record<string, unknown>
  /** RBAC pre-filter; the domain service still enforces authorization. */
  permission?: { resource: PermissionResource; action: PermissionAction }
  /** Validates/normalizes model arguments (usually a Zod safeParse). */
  parse(args: Record<string, unknown>): Result<Args, AppError>
  /** Required for write tools: what the human confirms. Must not mutate. */
  preview?(
    ctx: AiToolContext,
    args: Args,
  ): Promise<Result<AiToolPreviewDTO, AppError>>
  execute(
    ctx: AiToolContext,
    args: Args,
  ): Promise<Result<AiToolOutput, AppError>>
}

export type AnySteelAiTool = SteelAiTool<any>
