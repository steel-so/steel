import {
  createSteelClient,
  type SteelClient,
  type SteelError,
  type SteelResult,
} from '@steel-so/sdk'
import {
  type IExecuteFunctions,
  type IHookFunctions,
  type ILoadOptionsFunctions,
  type IWebhookFunctions,
  type JsonObject,
  NodeApiError,
  NodeOperationError,
} from 'n8n-workflow'

export const CREDENTIAL_NAME = 'steelApi'

export type SteelContext =
  | IExecuteFunctions
  | ILoadOptionsFunctions
  | IHookFunctions
  | IWebhookFunctions

/** The API v1 caps `limit` at 100 per page. */
export const MAX_PAGE_SIZE = 100

export function normalizeBaseUrl(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/, '')
}

/** Builds the SDK client from the node credentials. */
export async function getSteelClient(ctx: SteelContext): Promise<SteelClient> {
  const credentials = await ctx.getCredentials(CREDENTIAL_NAME)
  const baseUrl = normalizeBaseUrl(credentials.baseUrl)
  const token = String(credentials.token ?? '').trim()
  if (!baseUrl) {
    throw new NodeOperationError(ctx.getNode(), 'The Steel URL is empty')
  }
  if (!token) {
    throw new NodeOperationError(ctx.getNode(), 'The Steel API token is empty')
  }
  return createSteelClient({
    baseUrl,
    token,
    userAgent: 'n8n-nodes-steel',
  })
}

/** Plain-English explanation per error code, shown under the message. */
const ERROR_HINTS: Record<string, string> = {
  UNAUTHORIZED:
    'The token is invalid, expired or revoked. Create a new one in Steel and update the credential.',
  FORBIDDEN:
    'The token lacks the scope (api:write) or the module this operation needs.',
  API_TOKEN_MODULE_NOT_ALLOWED:
    'The token was created without the module this operation belongs to. Create a token that includes it.',
  RATE_LIMITED:
    'Steel rate limit reached (300 requests per 60 seconds per token). Retry later or add a Wait node.',
  VALIDATION_ERROR: 'Steel rejected a field. See the details of the error.',
  NETWORK_ERROR:
    'Could not reach Steel. Check the Steel URL in the credential.',
  TIMEOUT: 'Steel did not answer in time.',
}

export function describeSteelError(error: SteelError): string | undefined {
  const hint = ERROR_HINTS[error.code]
  const details =
    error.details === undefined ? undefined : JSON.stringify(error.details)
  if (hint && details) return `${hint} ${details}`
  return hint ?? details
}

/** Throws a `NodeApiError` for a failed SDK call; returns `data` otherwise. */
export function unwrap<T>(
  ctx: SteelContext,
  result: SteelResult<T>,
  itemIndex?: number,
): T {
  if (result.ok) return result.data
  const { error } = result
  const message = error.message ?? error.code
  throw new NodeApiError(
    ctx.getNode(),
    { message, code: error.code, httpCode: String(error.status) } as JsonObject,
    {
      message,
      description: describeSteelError(error),
      httpCode: String(error.status),
      itemIndex,
    },
  )
}

interface PageLike<T> {
  items: T[]
  nextCursor?: string | null
}

/**
 * Reads a cursor list: everything (`returnAll`) or the first `limit` items.
 * Each request asks for the page size that still fits (max 100).
 */
export async function collectPages<T>(
  ctx: SteelContext,
  fetchPage: (
    cursor: string | undefined,
    limit: number,
  ) => Promise<SteelResult<PageLike<T>>>,
  options: { returnAll: boolean; limit: number },
  itemIndex?: number,
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const want = options.returnAll
      ? MAX_PAGE_SIZE
      : Math.min(MAX_PAGE_SIZE, options.limit - items.length)
    const page = unwrap(ctx, await fetchPage(cursor, want), itemIndex)
    items.push(...page.items)
    const next = page.nextCursor ?? undefined
    // A server that hands back the same cursor would loop forever.
    cursor = next === cursor ? undefined : next
  } while (cursor && (options.returnAll || items.length < options.limit))
  return options.returnAll ? items : items.slice(0, options.limit)
}

/** CSV / list helper: `a, b ,,c` -> `['a','b','c']`. */
export function splitList(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}
