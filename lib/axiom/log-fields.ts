/**
 * Keeps Axiom's dataset under its column limit (257 fields). Every distinct
 * key under `fields` becomes a column, and nested objects flatten into one
 * column per leaf (`fields.preview.items.0.label`…), so variable payloads
 * must not travel as structured keys:
 *
 * - `logFields()` builds the fields of a log from a small fixed set of
 *   top-level keys plus ONE `detail` string with the variable payload
 *   (Steel AI, Steel Agents and notifications use it);
 * - `flattenNestedFields` is a logger formatter that turns any nested
 *   object/array left under `fields` into a JSON string, so a stray object
 *   adds at most one column instead of one per leaf.
 */

/** Cap of a serialized value (detail or flattened nested field). */
export const LOG_DETAIL_MAX_CHARS = 2_000

/** The only top-level keys `logFields` emits (besides `detail`). */
export interface LogBaseFields {
  component: string
  workspaceId?: string | null
  conversationId?: string | null
  actionId?: string | null
  /** Error/cause message. */
  message?: string | null
}

type LogScalar = string | number | boolean | null

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, inner) =>
      inner instanceof Error
        ? { name: inner.name, message: inner.message }
        : typeof inner === 'bigint'
          ? inner.toString()
          : inner,
    )
  } catch {
    // Circular structure: keep something readable instead of failing the log.
    return '[unserializable]'
  }
}

/** JSON of `value`, cut to `maxChars`. */
export function stringifyLogValue(
  value: unknown,
  maxChars: number = LOG_DETAIL_MAX_CHARS,
): string {
  const text = typeof value === 'string' ? value : safeStringify(value)
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/**
 * Fixed keys + `detail` (JSON string of the variable payload). Undefined
 * keys are dropped so they don't show up as empty columns.
 */
export function logFields(
  base: LogBaseFields,
  detail?: Record<string, unknown>,
): Record<string, LogScalar> {
  const out: Record<string, LogScalar> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) out[key] = value as LogScalar
  }
  if (detail && Object.keys(detail).length > 0) {
    out.detail = stringifyLogValue(detail)
  }
  return out
}

/**
 * Logger formatter (`@axiomhq/logging`): nested objects/arrays under
 * `fields` become JSON strings. Root-level keys (e.g. the `request` object
 * of the request log, which the analytics panel queries) are untouched.
 */
export function flattenNestedFields<T extends { fields?: unknown }>(
  event: T,
): T {
  const fields = event.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return event
  }
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && typeof value === 'object') {
      next[key] = stringifyLogValue(value)
      changed = true
    } else {
      next[key] = value
    }
  }
  return changed ? { ...event, fields: next } : event
}

/**
 * The only keys a log may carry at the top of `fields` (each is one Axiom
 * column). Anything else is folded into the single `detail` string by
 * `capFieldKeys`, so the dataset stays at a fixed size no matter what new
 * code logs. Keep this list short; it already covers audit
 * (`category`/`actorId` are read by the LGPD export), the worker and the AI
 * logs.
 */
export const ALLOWED_LOG_FIELD_KEYS: ReadonlySet<string> = new Set([
  // identity / scope
  'component',
  'workspaceId',
  'userId',
  'actorId',
  'targetId',
  'conversationId',
  'actionId',
  'ticketId',
  // audit trail
  'category',
  'auditType',
  'entity',
  'action',
  'event',
  'outcome',
  'reason',
  'timestamp',
  // errors
  'message',
  'error',
  'errorCode',
  'code',
  'cause',
  'stack',
  'statusCode',
  'status',
  // worker
  'queue',
  'jobName',
  'jobId',
  'attemptsMade',
  'durationMs',
  'count',
  // ai / modules
  'module',
  'provider',
  'model',
  'mode',
  'kind',
  'scope',
  'source',
  'costUsd',
  'inputTokens',
  'outputTokens',
  // mcp server (one column each: the MCP dashboard groups by them)
  'toolName',
  'clientId',
  // the overflow bucket
  'detail',
])

/**
 * Logger formatter (runs after `flattenNestedFields`): keys outside
 * `ALLOWED_LOG_FIELD_KEYS` move into `detail` as JSON, merged with any
 * `detail` the caller already set (kept under `detail.detail`).
 */
export function capFieldKeys<T extends { fields?: unknown }>(event: T): T {
  const fields = event.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return event
  }
  const kept: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'detail') continue
    if (ALLOWED_LOG_FIELD_KEYS.has(key)) kept[key] = value
    else extra[key] = value
  }
  if (Object.keys(extra).length === 0) return event
  const previous = (fields as Record<string, unknown>).detail
  if (previous !== undefined) extra.detail = previous
  kept.detail = stringifyLogValue(extra)
  return { ...event, fields: kept }
}
