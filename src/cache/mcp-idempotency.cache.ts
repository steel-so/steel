import { createHash } from 'node:crypto'
import { logger } from '@/lib/axiom/logger'
import { ensureRedisConnected } from '@/src/lib/redis'

/**
 * Idempotency of MCP writes (mcp-governance): an optional `idempotencyKey`
 * argument dedupes a write per grant + tool + key for 24 hours, so a client
 * that retries after a timeout does not create the ticket twice.
 *
 * Key `mcp:idem:<grantId>:<tool>:<sha256(key)>`, value
 * `{ state, argsHash, result? }`:
 * - `claim` sets a short-lived `pending` marker with `SET NX` (2 min — a
 *   crashed call does not block the key for a day);
 * - `complete` stores the final MCP result for 24 h, replayed as is to a
 *   later call with the same key and arguments;
 * - `release` drops the marker when the call failed and a retry is fair.
 *
 * Redis down does **not** block the write: the call runs without dedupe and
 * a warning is logged (same trade-off as the webhook locks).
 */

export const MCP_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60
export const MCP_IDEMPOTENCY_PENDING_TTL_SECONDS = 120

export interface McpIdempotencyScope {
  grantId: string
  toolName: string
  key: string
}

export type McpIdempotencyClaim =
  /** First call with this key: run it, then `complete` or `release`. */
  | { status: 'claimed' }
  /** Same key still running. */
  | { status: 'in_progress' }
  /** Same key and arguments already done: answer with `result`. */
  | { status: 'replay'; result: unknown }
  /** Same key, different arguments. */
  | { status: 'mismatch' }
  /** Redis unavailable: run without dedupe. */
  | { status: 'unavailable' }

interface StoredEntry {
  state: 'pending' | 'done'
  argsHash: string
  result?: unknown
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function redisKey(scope: McpIdempotencyScope): string {
  return `mcp:idem:${scope.grantId}:${scope.toolName}:${sha256(scope.key)}`
}

/** Key-order independent JSON, so `{a,b}` and `{b,a}` hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function hashMcpArgs(args: Record<string, unknown>): string {
  return sha256(canonical(args))
}

function parseEntry(raw: string): StoredEntry | null {
  try {
    const entry = JSON.parse(raw) as StoredEntry
    return entry && typeof entry.argsHash === 'string' ? entry : null
  } catch {
    return null
  }
}

function warn(event: string, scope: McpIdempotencyScope, cause: unknown) {
  logger.warn(event, {
    component: 'McpIdempotencyCache',
    toolName: scope.toolName,
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

export const McpIdempotencyCache = {
  async claim(
    scope: McpIdempotencyScope,
    argsHash: string,
  ): Promise<McpIdempotencyClaim> {
    try {
      const client = await ensureRedisConnected()
      const key = redisKey(scope)
      const pending: StoredEntry = { state: 'pending', argsHash }
      // Two rounds: the entry may expire between a failed SET and the GET.
      for (let round = 0; round < 2; round++) {
        const set = await client.set(key, JSON.stringify(pending), {
          NX: true,
          EX: MCP_IDEMPOTENCY_PENDING_TTL_SECONDS,
        })
        if (set === 'OK') return { status: 'claimed' }

        const raw = await client.get(key)
        if (raw === null) continue
        const entry = parseEntry(raw)
        // Unreadable entry: treat as running rather than run twice.
        if (!entry) return { status: 'in_progress' }
        if (entry.argsHash !== argsHash) return { status: 'mismatch' }
        if (entry.state === 'pending') return { status: 'in_progress' }
        return { status: 'replay', result: entry.result }
      }
      return { status: 'in_progress' }
    } catch (cause) {
      warn('mcp.idempotency_unavailable', scope, cause)
      return { status: 'unavailable' }
    }
  },

  async complete(
    scope: McpIdempotencyScope,
    argsHash: string,
    result: unknown,
  ): Promise<void> {
    try {
      const client = await ensureRedisConnected()
      const entry: StoredEntry = { state: 'done', argsHash, result }
      await client.set(redisKey(scope), JSON.stringify(entry), {
        EX: MCP_IDEMPOTENCY_TTL_SECONDS,
      })
    } catch (cause) {
      warn('mcp.idempotency_complete_failed', scope, cause)
    }
  },

  async release(scope: McpIdempotencyScope): Promise<void> {
    try {
      const client = await ensureRedisConnected()
      await client.del(redisKey(scope))
    } catch (cause) {
      warn('mcp.idempotency_release_failed', scope, cause)
    }
  },
}
