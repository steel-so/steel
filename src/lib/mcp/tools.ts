import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { AppError } from '@/src/errors/app-error'
import {
  type AiToolAccess,
  isToolAllowed,
  runReadTool,
} from '@/src/lib/ai/tools/registry'
import { parseToolResult } from '@/src/lib/ai/tools/tool-result'
import type {
  AiToolContext,
  AiToolKind,
  AnySteelAiTool,
} from '@/src/lib/ai/tools/types'
import type { McpGrant } from './grant'
import { logMcpToolCall, reportMcpError } from './telemetry'
import { recordMcpToolUsage } from './tool-usage'

/**
 * Tools side of the MCP adapter (ADR 0032): which Steel AI tools a grant
 * sees and how a `tools/call` runs. The registry stays the authority — this
 * only narrows it to the grant (modules, scopes) and translates shapes.
 */

/**
 * Hints a tool may declare about itself (owned by the tool registry; read
 * with optional chaining so tools without them fall back to the defaults).
 */
interface ToolHints {
  idempotentHint?: boolean
  destructiveHint?: boolean
  openWorldHint?: boolean
}

/**
 * Kinds an MCP grant may run. Wave 1 never exposes writes, even with
 * `mcp:write`: the admin switch, confirmation of customer-facing actions
 * and AiActionLog for MCP writes arrive in wave 2 (mcp-governance), which
 * widens this function — and only this function — for `mcp:write`.
 */
export function mcpAllowedKinds(_grant: McpGrant): readonly AiToolKind[] {
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
  if (!mcpAllowedKinds(grant).includes(tool.kind)) return false
  if (tool.module && !grant.modules.includes(tool.module)) return false
  // EXPLORE = READ only; the module/RBAC checks are the registry's own.
  return isToolAllowed(tool, access, 'EXPLORE')
}

export function mcpTools(
  tools: readonly AnySteelAiTool[],
  grant: McpGrant,
  access: AiToolAccess,
): AnySteelAiTool[] {
  return tools.filter((tool) => isMcpToolExposed(tool, grant, access))
}

/** Steel AI tool → MCP tool definition (full JSON Schema, not compacted). */
export function toMcpTool(tool: AnySteelAiTool): Tool {
  const hints = (tool as AnySteelAiTool & { annotations?: ToolHints })
    .annotations
  const readOnly = tool.kind === 'READ'
  return {
    name: tool.name,
    title: tool.label,
    description: tool.description,
    inputSchema: tool.parameters as Tool['inputSchema'],
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

export interface McpToolCallOptions {
  /** Meta-tool the call came through (`steel_call_tool`), for the log. */
  via?: string
}

/**
 * The tool with `execute` watched for exceptions: the registry turns a
 * throw into a generic `INTERNAL_SERVER_ERROR`, which would hide the bug,
 * so the cause goes to Sentry (tags only) before the registry sees it.
 */
function watchedTool(
  tool: AnySteelAiTool,
  grant: McpGrant,
  onThrow: () => void,
): AnySteelAiTool {
  return {
    ...tool,
    execute: async (ctx, args) => {
      try {
        return await tool.execute(ctx, args)
      } catch (cause) {
        onThrow()
        await reportMcpError(cause, {
          method: 'tools/call',
          tool: tool.name,
          client: grant.clientId,
        })
        throw cause
      }
    },
  }
}

/**
 * `parse` → `execute` with the grant's identity (workspace and user never
 * come from the arguments). The result carries the summary as text and the
 * data — capped at `TOOL_OUTPUT_MAX_BYTES` — as `structuredContent` and as
 * serialized JSON for clients that only read text. Domain errors come back
 * as `isError` results (the model can read and react to them). Every call
 * is logged (`mcp.tool_call`, no arguments) and counted for the tool
 * ranking of `tools/list`.
 */
export async function callMcpTool(
  tool: AnySteelAiTool,
  grant: McpGrant,
  args: unknown,
  options: McpToolCallOptions = {},
): Promise<CallToolResult> {
  const startedAt = Date.now()
  let threw = false
  const run = await runReadTool(
    watchedTool(tool, grant, () => {
      threw = true
    }),
    mcpToolContext(grant),
    isRecord(args) ? args : {},
  )

  logMcpToolCall(grant, {
    tool,
    outcome: run.ok ? 'ok' : threw ? 'failed' : 'error',
    errorCode: run.ok ? undefined : run.error.code,
    durationMs: Date.now() - startedAt,
    via: options.via,
  })
  await recordMcpToolUsage(grant.workspaceId, tool.name)

  if (!run.ok) return mcpToolError(run.error)

  // `content` is already capped by the registry; reuse it so the size cap
  // applies to what the client receives.
  const payload = parseToolResult(run.content) as {
    summary?: string
    data?: unknown
    truncated?: boolean
    note?: string
  }
  const structured: Record<string, unknown> = {
    summary: run.output.summary,
    data: payload.data,
    ...(payload.truncated && { truncated: true, note: payload.note }),
  }
  return {
    content: [
      { type: 'text', text: run.output.summary },
      { type: 'text', text: JSON.stringify(structured) },
    ],
    structuredContent: structured,
  }
}
