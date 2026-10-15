import type { CanvasBreakpoint, CanvasNodeId } from '@/src/lib/canvas/types'

/**
 * Presence of the people editing a canvas document, carried by the Yjs
 * awareness under the `canvas` field (one state per open tab).
 */
export const PRESENCE_FIELD = 'canvas'

export interface CanvasPresenceUser {
  id: string
  name: string
  image: string | null
  color: string
}

export interface CanvasPresenceState {
  user: CanvasPresenceUser
  /** Selected node ids. */
  selection: CanvasNodeId[]
  /** Node whose inline text this tab is editing. */
  editingText: CanvasNodeId | null
  breakpoint: CanvasBreakpoint | null
}

export interface CanvasPeer extends CanvasPresenceState {
  /** Yjs client id of the tab. */
  clientId: number
}

/** Distinct, readable on light and dark canvases. */
export const PRESENCE_COLORS = [
  '#e5484d',
  '#0090ff',
  '#30a46c',
  '#f76b15',
  '#8e4ec6',
  '#d6409f',
  '#12a594',
  '#ad7f58',
] as const

/** Deterministic color per user: the same person, the same color. */
export function presenceColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]
}

const MAX_SELECTION = 200
const COLOR = /^#[0-9a-f]{6}$/i
const BREAKPOINTS: CanvasBreakpoint[] = ['base', 'tablet', 'mobile']

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? value
    : null
}

/**
 * A remote awareness state as a peer, or `null` when it carries no (valid)
 * canvas presence. Awareness comes from other browsers: every field is
 * checked, nothing is trusted as-is.
 */
export function parsePresence(
  clientId: number,
  raw: unknown,
): CanvasPeer | null {
  if (typeof raw !== 'object' || raw === null) return null
  const state = (raw as Record<string, unknown>)[PRESENCE_FIELD]
  if (typeof state !== 'object' || state === null) return null
  const value = state as Record<string, unknown>
  const user = value.user as Record<string, unknown> | undefined
  if (typeof user !== 'object' || user === null) return null
  const id = text(user.id, 64)
  const name = text(user.name, 120)
  if (!id || !name) return null
  const color =
    typeof user.color === 'string' && COLOR.test(user.color)
      ? user.color
      : presenceColor(id)
  const image = text(user.image, 2048)
  const selection = Array.isArray(value.selection)
    ? value.selection
        .filter((item): item is string => typeof text(item, 64) === 'string')
        .slice(0, MAX_SELECTION)
    : []
  const breakpoint = BREAKPOINTS.includes(value.breakpoint as CanvasBreakpoint)
    ? (value.breakpoint as CanvasBreakpoint)
    : null
  return {
    clientId,
    user: { id, name, image, color },
    selection,
    editingText: text(value.editingText, 64),
    breakpoint,
  }
}

/** Every other tab with a valid presence, in a stable order. */
export function peersFrom(
  states: Map<number, unknown>,
  selfClientId: number,
): CanvasPeer[] {
  const peers: CanvasPeer[] = []
  for (const [clientId, raw] of states) {
    if (clientId === selfClientId) continue
    const peer = parsePresence(clientId, raw)
    if (peer) peers.push(peer)
  }
  return peers.sort((a, b) => a.clientId - b.clientId)
}

/** One entry per person (a person may have several tabs open). */
export function peopleFrom(peers: CanvasPeer[]): CanvasPresenceUser[] {
  const people = new Map<string, CanvasPresenceUser>()
  for (const peer of peers) {
    if (!people.has(peer.user.id)) people.set(peer.user.id, peer.user)
  }
  return [...people.values()]
}

/** Node id → the peer editing its inline text. */
export function textLocks(peers: CanvasPeer[]): Map<CanvasNodeId, CanvasPeer> {
  const locks = new Map<CanvasNodeId, CanvasPeer>()
  for (const peer of peers) {
    if (peer.editingText && !locks.has(peer.editingText)) {
      locks.set(peer.editingText, peer)
    }
  }
  return locks
}

/** First name for compact labels ("Ana está editando este texto"). */
export function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}
