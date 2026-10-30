import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { steelMcpServerUnreachable } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { checkWebhookUrl, webhookUrlError } from '@/src/lib/webhooks/url-guard'
import { MAX_MCP_TOOLS_PER_SERVER, type McpRemoteTool } from './mcp-tools'

/**
 * Steel as an MCP **client** (A8): Streamable HTTP only, to servers the
 * workspace admin registered. Same SSRF stance as the webhooks (ADR 0036):
 * HTTPS, no credentials in the URL, public hosts only, checked before the
 * connection and again on every request; redirects are never followed. A
 * short-lived connection per operation — nothing is kept between calls.
 */

export const MCP_CONNECT_TIMEOUT_MS = 15_000
export const MCP_CALL_TIMEOUT_MS = 30_000
/** Text returned to the model from one external call. */
export const MCP_RESULT_MAX_CHARS = 16_000

export interface McpConnection {
  url: string
  headerName: string
  /** Decrypted header value (e.g. `Bearer …`); null = no auth. */
  headerValue: string | null
}

function guardedFetch(): typeof fetch {
  return async (input, init) => {
    const target =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const checked = await checkWebhookUrl(target)
    if (!checked.ok) throw new Error(webhookUrlError(checked.reason).message)
    return fetch(input, { ...init, redirect: 'error' })
  }
}

async function withClient<T>(
  conn: McpConnection,
  fn: (client: Client) => Promise<T>,
): Promise<Result<T>> {
  const checked = await checkWebhookUrl(conn.url)
  if (!checked.ok) {
    return err(
      steelMcpServerUnreachable(webhookUrlError(checked.reason).message),
    )
  }
  const transport = new StreamableHTTPClientTransport(checked.url, {
    fetch: guardedFetch(),
    requestInit: {
      redirect: 'error',
      ...(conn.headerValue && {
        headers: { [conn.headerName]: conn.headerValue },
      }),
    },
  })
  const client = new Client({ name: 'steel-agents', version: '1.0.0' })
  try {
    await client.connect(transport, { timeout: MCP_CONNECT_TIMEOUT_MS })
    const value = await fn(client)
    return ok(value)
  } catch (cause) {
    return err(
      steelMcpServerUnreachable(
        `Não foi possível falar com o servidor MCP${
          cause instanceof Error && cause.message
            ? `: ${cause.message.slice(0, 200)}`
            : ''
        }`,
      ),
    )
  } finally {
    await client.close().catch(() => undefined)
  }
}

/** `tools/list` of the server, trimmed to what the agents need. */
export function discoverMcpTools(
  conn: McpConnection,
): Promise<Result<McpRemoteTool[]>> {
  return withClient(conn, async (client) => {
    const listed = await client.listTools(undefined, {
      timeout: MCP_CONNECT_TIMEOUT_MS,
    })
    return listed.tools.slice(0, MAX_MCP_TOOLS_PER_SERVER).map((tool) => ({
      name: tool.name,
      description: (tool.description ?? '').slice(0, 1_000),
      inputSchema: (tool.inputSchema ?? {
        type: 'object',
        properties: {},
      }) as Record<string, unknown>,
      readOnly: tool.annotations?.readOnlyHint === true,
    }))
  })
}

export interface McpCallOutput {
  text: string
  isError: boolean
}

/** `tools/call`; the text blocks are joined and capped. */
export function callMcpTool(
  conn: McpConnection,
  remoteName: string,
  args: Record<string, unknown>,
): Promise<Result<McpCallOutput>> {
  return withClient(conn, async (client) => {
    const result = await client.callTool(
      { name: remoteName, arguments: args },
      undefined,
      { timeout: MCP_CALL_TIMEOUT_MS },
    )
    const content = Array.isArray(result.content) ? result.content : []
    const text = content
      .map((block) =>
        block && typeof block === 'object' && block.type === 'text'
          ? String((block as { text?: unknown }).text ?? '')
          : `[${(block as { type?: string })?.type ?? 'conteúdo'} omitido]`,
      )
      .join('\n')
      .slice(0, MCP_RESULT_MAX_CHARS)
    return { text, isError: result.isError === true }
  })
}
