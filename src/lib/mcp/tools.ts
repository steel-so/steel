import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  hashMcpArgs,
  McpIdempotencyCache,
  type McpIdempotencyScope,
} from '@/src/cache/mcp-idempotency.cache'
import {
  type AppError,
  mcpIdempotencyInProgress,
  mcpIdempotencyKeyReused,
  validationError,
} from '@/src/errors/app-error'
import {
  type AiToolAccess,
  hasToolAccess,
  runReadTool,
} from '@/src/lib/ai/tools/registry'
import { parseToolResult } from '@/src/lib/ai/tools/tool-result'
import type {
  AiToolContext,
  AiToolKind,
  AnySteelAiTool,
} from '@/src/lib/ai/tools/types'
import {
  executeMcpWrite,
  proposeMcpWrite,
} from '@/src/services/ai-pending-action.service'
import type { McpGrant } from './grant'

/**
 * Tools side of the MCP adapter (ADR 0032): which Steel AI tools a grant
 * sees and how a `tools/call` runs. The registry stays the authority — this
 * only narrows it to the grant (modules, scopes, the admin write switch)
 * and translates shapes.
 *
 * Writes (mcp-governance): tools that are not `customerFacing` run at once
 * and are logged (AiActionLog source MCP + audit); `customerFacing` ones
 * become an AiPendingAction that the user confirms in the Steel inbox —
 * the result carries the absolute `confirmUrl`. MCP elicitation is not
 * used: it needs a server→client request inside the call, which the
 * stateless transport (a fresh server per POST, JSON responses) cannot
 * answer, so the confirm link is the only path.
 */

/** Write kinds `mcp:write` may unlock. DELETE is never exposed over MCP. */
const MCP_WRITE_KINDS: readonly AiToolKind[] = ['CREATE', 'UPDATE', 'ACTION']

/**
 * Kinds an MCP grant may run: READ, plus CREATE/UPDATE/ACTION when the token
 * carries `mcp:write` AND an admin turned on "Permitir escrita via MCP"
 * (`AiToolAccess.mcpWriteEnabled`). Independent of the in-app agent mode
 * and Autopilot switches. DELETE never.
 */
export function mcpAllowedKinds(
  grant: McpGrant,
  access: Pick<AiToolAccess, 'mcpWriteEnabled'>,
): readonly AiToolKind[] {
  if (grant.scopes.includes('mcp:write') && access.mcpWriteEnabled === true) {
    return ['READ', ...MCP_WRITE_KINDS]
  }
  return ['READ']
}

/** Whether the grant's token may see and call `tool`. */
export function isMcpToolExposed(
  tool: AnySteelAiTool,
  grant: McpGrant,
  access: AiToolAccess,
): boolean {
  if (!access.aiEnabled) return false
  // DELETE is never exposed over MCP, whatever the scopes.
  if (tool.kind === 'DELETE') return false
  if (!mcpAllowedKinds(grant, access).includes(tool.kind)) return false
  if (tool.module && !grant.modules.includes(tool.module)) return false
  // Module + RBAC are the registry's own checks; the write gate is ours.
  return hasToolAccess(tool, access)
}

export function mcpTools(
  tools: readonly AnySteelAiTool[],
  grant: McpGrant,
  access: AiToolAccess,
): AnySteelAiTool[] {
  return tools.filter((tool) => isMcpToolExposed(tool, grant, access))
}

/** Optional argument every write accepts to make retries safe. */
export const IDEMPOTENCY_KEY_ARG = 'idempotencyKey'
const IDEMPOTENCY_KEY_MAX = 200

const IDEMPOTENCY_KEY_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: IDEMPOTENCY_KEY_MAX,
  description:
    'Opcional. Chave única desta ação (até 200 caracteres, por exemplo um UUID). Repetir a chamada com a mesma chave e os mesmos argumentos em até 24 horas não executa de novo: devolve o primeiro resultado.',
}

const CONFIRMATION_NOTE =
  'Confirmação humana: esta ação não é executada na hora. A chamada cria uma pendência e devolve `confirmUrl`, o link em que a pessoa que autorizou o app confirma no Steel em até 30 minutos.'

/** Steel AI tool → MCP tool definition (full JSON Schema, not compacted). */
export function toMcpTool(tool: AnySteelAiTool): Tool {
  const hints = tool.annotations
  const readOnly = tool.kind === 'READ'
  const inputSchema = readOnly
    ? tool.parameters
    : {
        ...tool.parameters,
        properties: {
          ...((tool.parameters.properties as Record<string, unknown>) ?? {}),
          [IDEMPOTENCY_KEY_ARG]: IDEMPOTENCY_KEY_SCHEMA,
        },
      }
  return {
    name: tool.name,
    title: tool.label,
    description: tool.customerFacing
      ? `${tool.description}\n\n${CONFIRMATION_NOTE}`
      : tool.description,
    inputSchema: inputSchema as Tool['inputSchema'],
    annotations: {
      title: tool.label,
      readOnlyHint: readOnly,
      destructiveHint: hints?.destructiveHint ?? tool.kind === 'DELETE',
      idempotentHint: hints?.idempotentHint ?? readOnly,
      // Every tool reads or writes the workspace's own data.
      openWorldHint: hints?.openWorldHint ?? false,
    },
  }
}

export function mcpToolContext(grant: McpGrant): AiToolContext {
  return {
    workspaceId: grant.workspaceId,
    actorId: grant.userId,
    source: 'mcp',
    oauthClientId: grant.clientId,
  }
}

export function mcpToolError(error: Pick<AppError, 'code' | 'message'>) {
  return {
    isError: true,
    content: [{ type: 'text', text: error.message }],
    structuredContent: { error: { code: error.code, message: error.message } },
  } satisfies CallToolResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const MAX_HREF_DEPTH = 12

/**
 * Tool outputs link to app screens with relative paths (`/demo/servicedesk/
 * tickets/42`); external clients can't resolve them, so every `href` string
 * that starts with a single `/` becomes `<origin><path>`.
 */
export function absolutizeHrefs(value: unknown, origin: string): unknown {
  const base = new URL(origin).origin
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > MAX_HREF_DEPTH) return node
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1))
    if (!isRecord(node)) return node
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(node)) {
      out[key] =
        key === 'href' &&
        typeof item === 'string' &&
        item.startsWith('/') &&
        !item.startsWith('//')
          ? `${base}${item}`
          : walk(item, depth + 1)
    }
    return out
  }
  return walk(value, 0)
}

/** Summary + JSON text for clients that only read `content`. */
function toolResult(
  summary: string,
  structured: Record<string, unknown>,
): CallToolResult {
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(structured) },
    ],
    structuredContent: structured,
  }
}

/** Data part of a capped registry `content` (+ truncation flag). */
function cappedData(content: string): Record<string, unknown> {
  const payload = parseToolResult(content) as {
    data?: unknown
    truncated?: boolean
    note?: string
  }
  return {
    data: payload.data,
    ...(payload.truncated && { truncated: true, note: payload.note }),
  }
}

export interface McpCallOptions {
  /** Public origin of the app (`BETTER_AUTH_URL`), for absolute links. */
  origin: string
}

type CallOutcome = 'done' | 'pending_confirmation' | 'replayed' | 'error'

function logCall(
  tool: AnySteelAiTool,
  grant: McpGrant,
  startedAt: number,
  outcome: CallOutcome,
  errorCode?: string,
) {
  logger.info(
    'mcp.tool_call',
    logFields(
      { component: 'McpServer', workspaceId: grant.workspaceId },
      {
        toolName: tool.name,
        kind: tool.kind,
        userId: grant.userId,
        clientId: grant.clientId,
        outcome,
        errorCode,
        durationMs: Date.now() - startedAt,
      },
    ),
  )
}

/**
 * `parse` → `execute` with the grant's identity (workspace and user never
 * come from the arguments). The result carries the summary as text and the
 * data — capped at `TOOL_OUTPUT_MAX_BYTES` — as `structuredContent` and as
 * serialized JSON for clients that only read text. Domain errors come back
 * as `isError` results (the model can read and react to them). Writes go
 * through `callMcpWrite`; the caller already checked `isMcpToolExposed`.
 */
export async function callMcpTool(
  tool: AnySteelAiTool,
  grant: McpGrant,
  args: unknown,
  options: McpCallOptions,
): Promise<CallToolResult> {
  const rawArgs = isRecord(args) ? args : {}
  if (tool.kind !== 'READ') {
    return callMcpWrite(tool, grant, rawArgs, options)
  }

  const startedAt = Date.now()
  const run = await runReadTool(tool, mcpToolContext(grant), rawArgs)
  logCall(
    tool,
    grant,
    startedAt,
    run.ok ? 'done' : 'error',
    run.ok ? undefined : run.error.code,
  )
  if (!run.ok) return mcpToolError(run.error)

  // `content` is already capped by the registry; reuse it so the size cap
  // applies to what the client receives.
  return toolResult(
    run.output.summary,
    absolutizeHrefs(
      { summary: run.output.summary, ...cappedData(run.content) },
      options.origin,
    ) as Record<string, unknown>,
  )
}

/** `idempotencyKey` out of the arguments (the tools never see it). */
function splitIdempotencyKey(
  rawArgs: Record<string, unknown>,
):
  | { ok: true; key: string | null; args: Record<string, unknown> }
  | { ok: false; error: AppError } {
  const { [IDEMPOTENCY_KEY_ARG]: key, ...args } = rawArgs
  if (key === undefined || key === null) return { ok: true, key: null, args }
  if (
    typeof key !== 'string' ||
    key.trim() === '' ||
    key.length > IDEMPOTENCY_KEY_MAX
  ) {
    return {
      ok: false,
      error: validationError(
        `idempotencyKey deve ser um texto de 1 a ${IDEMPOTENCY_KEY_MAX} caracteres`,
      ),
    }
  }
  return { ok: true, key, args }
}

/**
 * A write over MCP: optional idempotency claim → customer-facing tools
 * become a pending action with an absolute confirm link; the others run at
 * once (AiActionLog source MCP + audit). Successful and pending results are
 * stored for the idempotency key; failures release it so a retry runs.
 */
async function callMcpWrite(
  tool: AnySteelAiTool,
  grant: McpGrant,
  rawArgs: Record<string, unknown>,
  options: McpCallOptions,
): Promise<CallToolResult> {
  const startedAt = Date.now()
  const split = splitIdempotencyKey(rawArgs)
  if (!split.ok) {
    logCall(tool, grant, startedAt, 'error', split.error.code)
    return mcpToolError(split.error)
  }

  const scope: McpIdempotencyScope | null = split.key
    ? { grantId: grant.grantId, toolName: tool.name, key: split.key }
    : null
  const argsHash = hashMcpArgs(split.args)
  if (scope) {
    const claim = await McpIdempotencyCache.claim(scope, argsHash)
    if (claim.status === 'replay') {
      logCall(tool, grant, startedAt, 'replayed')
      return claim.result as CallToolResult
    }
    if (claim.status === 'in_progress' || claim.status === 'mismatch') {
      const error =
        claim.status === 'in_progress'
          ? mcpIdempotencyInProgress()
          : mcpIdempotencyKeyReused()
      logCall(tool, grant, startedAt, 'error', error.code)
      return mcpToolError(error)
    }
  }

  const result = tool.customerFacing
    ? await proposeWrite(tool, grant, split.args, options)
    : await executeWrite(tool, grant, split.args, options)

  logCall(
    tool,
    grant,
    startedAt,
    result.isError
      ? 'error'
      : tool.customerFacing
        ? 'pending_confirmation'
        : 'done',
    result.isError ? errorCodeOf(result) : undefined,
  )

  if (scope) {
    if (result.isError) await McpIdempotencyCache.release(scope)
    else await McpIdempotencyCache.complete(scope, argsHash, result)
  }
  return result
}

function errorCodeOf(result: CallToolResult): string | undefined {
  const error = (result.structuredContent as { error?: { code?: string } })
    ?.error
  return error?.code
}

async function executeWrite(
  tool: AnySteelAiTool,
  grant: McpGrant,
  args: Record<string, unknown>,
  options: McpCallOptions,
): Promise<CallToolResult> {
  const executed = await executeMcpWrite(tool, mcpToolContext(grant), args, {
    integrationGrantId: grant.grantId,
  })
  if (!executed.ok) return mcpToolError(executed.error)
  const { action, run } = executed.value
  if (!run.ok) return mcpToolError(run.error)

  return toolResult(
    run.output.summary,
    absolutizeHrefs(
      {
        status: 'executed',
        summary: run.output.summary,
        actionId: action.id,
        ...(run.output.target && { target: run.output.target }),
        ...cappedData(run.content),
      },
      options.origin,
    ) as Record<string, unknown>,
  )
}

async function proposeWrite(
  tool: AnySteelAiTool,
  grant: McpGrant,
  args: Record<string, unknown>,
  options: McpCallOptions,
): Promise<CallToolResult> {
  const proposed = await proposeMcpWrite(tool, mcpToolContext(grant), args, {
    integrationGrantId: grant.grantId,
  })
  if (!proposed.ok) return mcpToolError(proposed.error)
  const { action, confirmPath } = proposed.value
  const confirmUrl = `${new URL(options.origin).origin}${confirmPath}`
  const preview = action.preview as { title?: string }
  const title = preview.title ?? tool.label
  const summary = `Aguardando confirmação no Steel: ${title}. Nada foi feito ainda. A pessoa que autorizou o app precisa confirmar em ${confirmUrl} até ${action.expiresAt.toISOString()}; depois disso a pendência expira.`

  return toolResult(
    summary,
    absolutizeHrefs(
      {
        status: 'pending_confirmation',
        summary,
        actionId: action.id,
        confirmUrl,
        expiresAt: action.expiresAt.toISOString(),
        preview: action.preview,
      },
      options.origin,
    ) as Record<string, unknown>,
  )
}
