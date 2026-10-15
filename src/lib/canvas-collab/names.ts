/**
 * Realtime rooms of the Steel Canvas documents. The Wiki uses the bare page
 * id as its room; canvas rooms are prefixed (`canvas.<kind>.<id>`), so the
 * two never collide on the shared `/realtime` server.
 */
export const CANVAS_COLLAB_KINDS = [
  'site-page',
  'site-global',
  'email-template',
] as const

export type CanvasCollabKind = (typeof CANVAS_COLLAB_KINDS)[number]

export interface CanvasCollabTarget {
  kind: CanvasCollabKind
  id: string
}

const PREFIX = 'canvas.'
const ID = /^[A-Za-z0-9_-]{1,64}$/

export function canvasDocumentName(kind: CanvasCollabKind, id: string): string {
  return `${PREFIX}${kind}.${id}`
}

export function isCanvasDocumentName(name: string): boolean {
  return name.startsWith(PREFIX)
}

/** `{ kind, id }` of a canvas room, or `null` for anything else. */
export function parseCanvasDocumentName(
  name: string,
): CanvasCollabTarget | null {
  if (!isCanvasDocumentName(name)) return null
  const rest = name.slice(PREFIX.length)
  const dot = rest.indexOf('.')
  if (dot < 0) return null
  const kind = rest.slice(0, dot) as CanvasCollabKind
  const id = rest.slice(dot + 1)
  if (!CANVAS_COLLAB_KINDS.includes(kind) || !ID.test(id)) return null
  return { kind, id }
}

/** Stateless messages between the editor and the realtime server. */
export const CANVAS_FLUSH = 'canvas.flush'
export const CANVAS_FLUSHED = 'canvas.flushed'

export type CanvasStatelessMessage =
  | { type: typeof CANVAS_FLUSH; requestId: string }
  | { type: typeof CANVAS_FLUSHED; requestId: string; ok: boolean }

export function parseCanvasStateless(
  payload: string,
): CanvasStatelessMessage | null {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const message = value as Record<string, unknown>
  if (typeof message.requestId !== 'string') return null
  if (message.type === CANVAS_FLUSH) {
    return { type: CANVAS_FLUSH, requestId: message.requestId }
  }
  if (message.type === CANVAS_FLUSHED && typeof message.ok === 'boolean') {
    return {
      type: CANVAS_FLUSHED,
      requestId: message.requestId,
      ok: message.ok,
    }
  }
  return null
}
