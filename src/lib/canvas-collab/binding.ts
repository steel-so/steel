import type * as Y from 'yjs'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore, CanvasStoreChange } from '@/src/lib/canvas/store'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { projectCanvas, sameNodes } from './project'
import {
  allIds,
  deepEqual,
  hasCanvas,
  mergeExternal,
  nodesOf,
  readHeader,
  readYNode,
  seedYDoc,
  touchedIds,
  writeChange,
} from './ydoc'

export interface CanvasBindingOptions {
  /** Ids refused from a remote update (logged/telemetry by the caller). */
  onRejected?: (ids: CanvasNodeId[]) => void
}

export interface CanvasBinding {
  /** Transaction origin of this binding's writes. */
  readonly origin: object
  /** Whether `start()` ran. */
  readonly started: boolean
  /**
   * Starts mirroring once the Y document holds the shared state (the
   * provider synced). An empty Y document is seeded from the store; edits
   * made before the sync are merged in (three-way, against the document the
   * binding was created with), then the shared state is loaded.
   */
  start(): void
  /** Read-only sessions keep receiving changes but send none. */
  setReadOnly(readOnly: boolean): void
  dispose(): void
}

/**
 * Two-way binding between a canvas store and a Y document (real-time
 * co-editing, ADR 0026 / docs/canvas/README.md):
 *
 * - every document change of the store (ops, undo/redo, reset) becomes one
 *   Yjs transaction touching only the nodes — and inside them, only the
 *   props paths — the op changed;
 * - remote transactions are projected back into a valid document
 *   (`projectCanvas`, with the store's catalog) and handed to
 *   `store.applyRemote`, which never records history: undo stays per user.
 *
 * Only nodes touched by a remote transaction are read back from Y; the rest
 * keep their object identity, so the canvas re-renders just what changed.
 */
export function bindCanvasStore(
  store: CanvasStore,
  ydoc: Y.Doc,
  options: CanvasBindingOptions = {},
): CanvasBinding {
  const origin = {}
  const { catalog } = store
  const ynodes = nodesOf(ydoc)
  const validity = new WeakMap<CanvasNode, boolean>()
  /** Raw nodes read from Y (`null` = malformed), invalidated per change. */
  const cache = new Map<CanvasNodeId, CanvasNode | null>()
  const base: CanvasDocument = store.getState().doc
  let started = false
  let readOnly = false

  const lookup = (id: CanvasNodeId): CanvasNode | null | undefined => {
    if (!ynodes.has(id)) return undefined
    if (cache.has(id)) return cache.get(id)
    const node = readYNode(id, ynodes.get(id))
    cache.set(id, node)
    return node
  }

  function project(): void {
    const header = readHeader(ydoc)
    if (!header) return
    const current = store.getState().doc
    const projection = projectCanvas(header, lookup, {
      catalog,
      previous: current,
      validity,
    })
    if (!projection) {
      options.onRejected?.([header.rootId])
      return
    }
    const { doc, rejected } = projection
    // Content equal to what the store has keeps the store's objects.
    for (const [id, node] of Object.entries(doc.nodes)) {
      const before = getNode(current, id)
      if (before && before !== node && deepEqual(before, node)) {
        doc.nodes[id] = before
      }
    }
    if (rejected.length > 0) options.onRejected?.(rejected)
    if (!sameNodes(current, doc)) store.applyRemote(doc)
  }

  const onDeep = (
    events: Y.YEvent<Y.AbstractType<unknown>>[],
    tr: Y.Transaction,
  ) => {
    for (const event of events) {
      if (event.target === ynodes) {
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) {
          cache.delete(key)
        }
      } else {
        // Nested change: the first path segment is the node id.
        cache.delete(event.path[0] as string)
      }
    }
    if (started && tr.origin !== origin) project()
  }
  ynodes.observeDeep(onDeep)

  const unsubscribe = store.onChange((change: CanvasStoreChange) => {
    if (!started || readOnly || change.source === 'remote') return
    const ids = change.op
      ? touchedIds(change.op, change.prev, change.next)
      : allIds(change.prev, change.next)
    writeChange(ydoc, change.prev, change.next, ids, origin)
  })

  return {
    origin,
    get started() {
      return started
    },
    start() {
      if (started) return
      started = true
      const current = store.getState().doc
      if (!hasCanvas(ydoc)) {
        if (!readOnly) seedYDoc(ydoc, current, origin)
        return
      }
      if (!readOnly && current !== base) {
        mergeExternal(ydoc, base, current, origin)
      }
      cache.clear()
      project()
    },
    setReadOnly(value) {
      readOnly = value
    },
    dispose() {
      ynodes.unobserveDeep(onDeep)
      unsubscribe()
    },
  }
}
