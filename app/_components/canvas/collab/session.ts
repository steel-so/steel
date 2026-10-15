import * as Y from 'yjs'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { bindCanvasStore } from '@/src/lib/canvas-collab/binding'
import {
  CANVAS_FLUSH,
  CANVAS_FLUSHED,
  parseCanvasStateless,
} from '@/src/lib/canvas-collab/names'
import {
  type CanvasPeer,
  type CanvasPresenceState,
  type CanvasPresenceUser,
  PRESENCE_FIELD,
  peersFrom,
  presenceColor,
  textLocks,
} from '@/src/lib/canvas-collab/presence'

/**
 * - `connecting`: the socket is opening; the editor works on its own.
 * - `live`: synced with the room; the realtime server saves.
 * - `offline`: no realtime (server down, no upgrade on a proxy, network
 *   lost, no permission): the editor saves through REST, as without
 *   co-editing. A reconnect goes back to `live` and Yjs merges what was
 *   edited meanwhile.
 */
export type CollabStatus = 'connecting' | 'live' | 'offline'

export interface CollabSnapshot {
  status: CollabStatus
  /** The room let this user in as a viewer only. */
  readOnly: boolean
  /** Other tabs in the room. */
  peers: CanvasPeer[]
  /** Node id → the peer editing its inline text. */
  locks: Map<CanvasNodeId, CanvasPeer>
  /** Local changes not yet acknowledged by the server. */
  syncing: boolean
}

/** Minimal Yjs awareness (y-protocols) the session needs. */
export interface CollabAwareness {
  clientID: number
  getStates(): Map<number, unknown>
  setLocalStateField(field: string, value: unknown): void
  on(event: 'change', listener: () => void): void
  off(event: 'change', listener: () => void): void
}

export interface CollabTransport {
  awareness: CollabAwareness
  sendStateless(payload: string): void
  destroy(): void
}

export interface CollabTransportEvents {
  synced(): void
  disconnected(): void
  authenticated(readOnly: boolean): void
  authenticationFailed(): void
  stateless(payload: string): void
  unsyncedChanges(count: number): void
}

/** Opens the realtime connection of a room (Hocuspocus in the app). */
export type CollabConnect = (args: {
  documentName: string
  ydoc: Y.Doc
  events: CollabTransportEvents
}) => CollabTransport

export interface CollabSession {
  readonly user: CanvasPresenceUser
  getSnapshot(): CollabSnapshot
  subscribe(listener: () => void): () => void
  isLive(): boolean
  /** Asks the server to save now (before a version, publish, test send).
   * Resolves `false` when not live or the server did not confirm — the
   * caller then saves through REST. */
  flush(): Promise<boolean>
  destroy(): void
}

/** Without a sync by then, the editor shows "Sem colaboração em tempo real". */
export const OFFLINE_AFTER_MS = 5000
export const FLUSH_TIMEOUT_MS = 8000

function sameState(a: CanvasPresenceState | null, b: CanvasPresenceState) {
  return (
    !!a &&
    a.editingText === b.editingText &&
    a.breakpoint === b.breakpoint &&
    a.selection.length === b.selection.length &&
    a.selection.every((id, i) => id === b.selection[i])
  )
}

/**
 * Real-time co-editing of one open canvas document: binds the store to a
 * Y document (`bindCanvasStore`), connects it to the room, publishes this
 * tab's presence (selection, inline text being edited) and keeps the list
 * of the other people in the room. Framework-free; React reads it through
 * `useCollab*` in collab-context.tsx.
 */
export function createCollabSession(options: {
  store: CanvasStore
  documentName: string
  user: { id: string; name: string; image?: string | null }
  connect: CollabConnect
  offlineAfterMs?: number
}): CollabSession {
  const { store } = options
  const user: CanvasPresenceUser = {
    id: options.user.id,
    name: options.user.name,
    image: options.user.image ?? null,
    color: presenceColor(options.user.id),
  }
  const ydoc = new Y.Doc()
  const binding = bindCanvasStore(store, ydoc, {
    onRejected: (ids) => {
      console.warn('[canvas-collab] remote changes refused', ids)
    },
  })
  const listeners = new Set<() => void>()
  const flushes = new Map<string, (ok: boolean) => void>()
  const drained = new Set<() => void>()
  let unsynced = 0
  let destroyed = false
  let snapshot: CollabSnapshot = {
    status: 'connecting',
    readOnly: false,
    peers: [],
    locks: new Map(),
    syncing: false,
  }

  function set(patch: Partial<CollabSnapshot>): void {
    const next = { ...snapshot, ...patch }
    const keys = Object.keys(patch) as Array<keyof CollabSnapshot>
    if (keys.every((key) => Object.is(next[key], snapshot[key]))) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const timer = setTimeout(() => {
    if (snapshot.status === 'connecting') set({ status: 'offline' })
  }, options.offlineAfterMs ?? OFFLINE_AFTER_MS)

  const transport = options.connect({
    documentName: options.documentName,
    ydoc,
    events: {
      synced() {
        if (destroyed) return
        clearTimeout(timer)
        binding.start()
        set({ status: 'live' })
        publish()
      },
      disconnected() {
        if (destroyed || snapshot.status === 'connecting') return
        set({ status: 'offline' })
      },
      authenticated(readOnly) {
        binding.setReadOnly(readOnly)
        set({ readOnly })
      },
      authenticationFailed() {
        clearTimeout(timer)
        set({ status: 'offline' })
      },
      stateless(payload) {
        const message = parseCanvasStateless(payload)
        if (message?.type !== CANVAS_FLUSHED) return
        flushes.get(message.requestId)?.(message.ok)
      },
      unsyncedChanges(count) {
        unsynced = count
        set({ syncing: count > 0 })
        if (count === 0) for (const resolve of [...drained]) resolve()
      },
    },
  })
  const { awareness } = transport

  // ── presence ────────────────────────────────────────────────────────────
  let published: CanvasPresenceState | null = null
  function publish(): void {
    const { selection, editingText, breakpoint } = store.getState()
    const state: CanvasPresenceState = {
      user,
      selection,
      editingText,
      breakpoint,
    }
    if (sameState(published, state)) return
    published = state
    awareness.setLocalStateField(PRESENCE_FIELD, state)
  }
  const unsubscribeStore = store.subscribe(publish)
  publish()

  const onAwareness = () => {
    const peers = peersFrom(awareness.getStates(), awareness.clientID)
    set({ peers, locks: textLocks(peers) })
    // Someone else started editing the text this tab is editing: leave it.
    const editing = store.getState().editingText
    const lock = editing ? snapshot.locks.get(editing) : undefined
    if (lock && lock.clientId < awareness.clientID) store.setEditingText(null)
  }
  awareness.on('change', onAwareness)
  store.setTextGuard((id) => !snapshot.locks.has(id))

  function waitDrained(ms: number): Promise<boolean> {
    if (unsynced === 0) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timeout)
        drained.delete(done)
        resolve(true)
      }
      const timeout = setTimeout(() => {
        drained.delete(done)
        resolve(false)
      }, ms)
      drained.add(done)
    })
  }

  return {
    user,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isLive: () => snapshot.status === 'live' && !snapshot.readOnly,
    async flush() {
      if (snapshot.status !== 'live' || snapshot.readOnly) return false
      if (!(await waitDrained(FLUSH_TIMEOUT_MS / 2))) return false
      const requestId = Math.random().toString(36).slice(2)
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => finish(false), FLUSH_TIMEOUT_MS)
        function finish(ok: boolean) {
          clearTimeout(timeout)
          flushes.delete(requestId)
          resolve(ok)
        }
        flushes.set(requestId, finish)
        transport.sendStateless(
          JSON.stringify({ type: CANVAS_FLUSH, requestId }),
        )
      })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearTimeout(timer)
      for (const finish of [...flushes.values()]) finish(false)
      awareness.off('change', onAwareness)
      unsubscribeStore()
      store.setTextGuard(null)
      binding.dispose()
      transport.destroy()
      ydoc.destroy()
      listeners.clear()
    },
  }
}
