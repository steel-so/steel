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
  source: 'assistant' | 'agent' | 'mcp' | 'voice' | 'whatsapp'
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

/**
 * Behavior hints, in the MCP sense (`ToolAnnotations`). The Steel AI runtime
 * does not read them; the MCP adapter forwards them to external clients,
 * which use them to decide what to confirm with the user. `readOnlyHint`
 * and `title` are derived from `kind` and `label`, so they are not here.
 *
 * Steel defaults when a hint is absent (the adapter applies them, they are
 * NOT the MCP defaults): `idempotentHint` false, `openWorldHint` false.
 * `destructiveHint` is mandatory on every write tool (`validateToolRegistry`).
 */
export interface SteelAiToolAnnotations {
  /**
   * Calling again with the same arguments has no further effect (setting a
   * field, assigning, moving to a stage). Only meaningful for write tools.
   */
  idempotentHint?: boolean
  /**
   * The tool removes data, overwrites it so the previous value is lost
   * (field and text replacements) or makes a change that cannot be undone
   * (DELETE, canceling a ticket, closing a lead as won). False for additive
   * changes (creating, linking, adding a note) and for state changes that
   * another tool reverts (assigning, moving a stage, closing a conversation).
   */
  destructiveHint?: boolean
  /**
   * The tool reaches people or systems outside the workspace (sends a
   * WhatsApp message, an e-mail, an approval link).
   */
  openWorldHint?: boolean
}

export interface SteelAiTool<Args = Record<string, unknown>> {
  /** snake_case, unique across modules, prefixed by area (`sd_`, `crm_`, `zap_`). */
  name: string
  /**
   * Short pt-BR label (≤ 40 chars): the transcript line ("Consultando
   * chamados") and the MCP `title`.
   */
  label: string
  /** Module that must be enabled (null = platform-level tool). */
  module: ModuleKind | null
  kind: AiToolKind
  /**
   * Instructions for the model, in pt-BR. Also read by external MCP clients,
   * so keep it neutral: no references to "o chat", "o assistente" or to
   * screens the client cannot see; be precise about fields and side effects.
   */
  description: string
  /** MCP behavior hints; see `SteelAiToolAnnotations`. */
  annotations?: SteelAiToolAnnotations
  /**
   * The tool delivers something to an end customer or another person outside
   * the team: a WhatsApp message, an e-mail, a public ticket reply, an
   * approval link, a notification carrying text the caller wrote. External
   * writes of these always need an explicit human confirmation (wave 2 of
   * the MCP server). Implies `annotations.openWorldHint`.
   */
  customerFacing?: boolean
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
