import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ModuleKind } from '@prisma/client'
import { stringifyLogValue } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_SENTRY_DSN } from '@/lib/env/env'
import type { AiToolKind } from '@/src/lib/ai/tools/types'
import type { McpGrant } from './grant'

/**
 * Observability of the MCP server (ADR 0032), split like the rest of the
 * app (`lib/sentry/options.ts`):
 *
 * - **Axiom** gets one structured line per `tools/call` (`mcp.tool_call`)
 *   and per refused request (`mcp.rejected`): who (workspace, user, OAuth
 *   client), what (tool, kind, module), how it went (outcome, error code,
 *   duration). Never the arguments nor the tool output — they carry
 *   customer data (LGPD). The dashboard in `docs/mcp/axiom-dashboard.json`
 *   reads these columns.
 * - **Sentry** gets only what broke: an exception thrown by a tool or by an
 *   MCP handler, which the registry and the SDK would otherwise turn into a
 *   quiet error result. Tagged with tool, client and method; no payload.
 */

export const MCP_LOG_COMPONENT = 'McpServer'

/**
 * - `ok`: the tool returned data;
 * - `error`: a domain error (`AppError`) the client sees as `isError`;
 * - `failed`: the tool threw — a bug, also reported to Sentry.
 */
export type McpCallOutcome = 'ok' | 'error' | 'failed'

export interface McpToolCallLog {
  tool: { name: string; kind: AiToolKind; module: ModuleKind | null }
  outcome: McpCallOutcome
  errorCode?: string
  durationMs: number
  /** `steel_call_tool` when the call came through the discovery meta-tool. */
  via?: string
}

export function logMcpToolCall(grant: McpGrant, entry: McpToolCallLog): void {
  const fields = {
    component: MCP_LOG_COMPONENT,
    event: 'tool_call',
    source: 'mcp',
    workspaceId: grant.workspaceId,
    userId: grant.userId,
    clientId: grant.clientId,
    toolName: entry.tool.name,
    kind: entry.tool.kind,
    module: entry.tool.module ?? 'PLATFORM',
    outcome: entry.outcome,
    errorCode: entry.errorCode,
    durationMs: entry.durationMs,
    detail: stringifyLogValue({
      grantId: grant.grantId,
      clientName: grant.clientName,
      ...(entry.via && { via: entry.via }),
    }),
  }
  const level = entry.outcome === 'failed' ? 'error' : 'info'
  logger[level]('mcp.tool_call', dropUndefined(fields))
}

export interface McpToolsListLog {
  listed: number
  hidden: number
}

/** One line per `tools/list`: how many tools went out and how many hid. */
export function logMcpToolsList(grant: McpGrant, entry: McpToolsListLog) {
  logger.info('mcp.tools_list', {
    component: MCP_LOG_COMPONENT,
    event: 'tools_list',
    source: 'mcp',
    workspaceId: grant.workspaceId,
    userId: grant.userId,
    clientId: grant.clientId,
    count: entry.listed,
    detail: stringifyLogValue({ hidden: entry.hidden }),
  })
}

/** Why `/api/mcp` refused a request before reaching the MCP server. */
export type McpRejectReason =
  | 'invalid_token'
  | 'stale_grant'
  | 'rate_limited_user'
  | 'rate_limited_client'
  | 'access_failed'

export interface McpRejectLog {
  reason: McpRejectReason
  grant?: McpGrant
  errorCode?: string
}

export function logMcpRejected(entry: McpRejectLog): void {
  const { grant } = entry
  logger.warn(
    'mcp.rejected',
    dropUndefined({
      component: MCP_LOG_COMPONENT,
      event: 'rejected',
      source: 'mcp',
      reason: entry.reason,
      errorCode: entry.errorCode,
      workspaceId: grant?.workspaceId,
      userId: grant?.userId,
      clientId: grant?.clientId,
    }),
  )
}

function dropUndefined<T extends Record<string, unknown>>(fields: T) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

/* --------------------------------- sentry --------------------------------- */

export interface McpErrorTags {
  /** JSON-RPC method (`tools/call`, `resources/read`…). */
  method: string
  tool?: string
  /** OAuth client id of the grant. */
  client: string
}

/**
 * Sends an unexpected adapter error to Sentry with tags only — never the
 * arguments, the output or the request. Inert without a DSN (the SDK is not
 * even imported, like `instrumentation.ts`) and never throws.
 */
export async function reportMcpError(
  cause: unknown,
  tags: McpErrorTags,
): Promise<void> {
  if (!NEXT_PUBLIC_SENTRY_DSN) return
  try {
    const Sentry = await import('@sentry/nextjs')
    Sentry.captureException(cause, {
      tags: {
        component: 'mcp',
        'mcp.method': tags.method,
        'mcp.client': tags.client,
        ...(tags.tool && { 'mcp.tool': tags.tool }),
      },
    })
  } catch (failure) {
    logger.warn('mcp.sentry_report_failed', {
      component: MCP_LOG_COMPONENT,
      message: failure instanceof Error ? failure.message : String(failure),
    })
  }
}

/** Message the client gets instead of the internal one. */
export const MCP_INTERNAL_ERROR_MESSAGE =
  'Falha inesperada no servidor MCP do Steel. Tente de novo em instantes.'

/**
 * Runs one MCP request handler: protocol errors (`McpError`) pass through;
 * anything else is reported to Sentry and answered as a generic JSON-RPC
 * internal error, so internal messages never reach the client.
 */
export async function withMcpErrorReport<T>(
  grant: McpGrant,
  method: string,
  request: unknown,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof McpError) throw cause
    const tool = method === 'tools/call' ? toolNameOf(request) : undefined
    await reportMcpError(cause, { method, client: grant.clientId, tool })
    logger.error('mcp.handler_failed', {
      component: MCP_LOG_COMPONENT,
      event: 'handler_failed',
      source: 'mcp',
      workspaceId: grant.workspaceId,
      clientId: grant.clientId,
      toolName: tool,
      message: cause instanceof Error ? cause.message : String(cause),
      detail: stringifyLogValue({ method }),
    })
    throw new McpError(ErrorCode.InternalError, MCP_INTERNAL_ERROR_MESSAGE)
  }
}

function toolNameOf(request: unknown): string | undefined {
  const params = (request as { params?: { name?: unknown } } | null)?.params
  return typeof params?.name === 'string' ? params.name : undefined
}
