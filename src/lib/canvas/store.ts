import {
  applyOp,
  type CanvasOp,
  type CanvasOpError,
  canDrop,
  cloneFragment,
  fragmentForType,
  getNode,
  parentOf,
} from './ops'
import type { CanvasCatalog } from './registry'
import type {
  CanvasBreakpoint,
  CanvasDocument,
  CanvasFragment,
  CanvasLocation,
  CanvasNode,
  CanvasNodeId,
} from './types'

/**
 * Editor state container (framework-free; React binds through
 * `useSyncExternalStore` in app/_components/canvas/use-canvas.ts). One store
 * per open editor.
 */
export interface CanvasEditorState {
  doc: CanvasDocument
  selection: CanvasNodeId[]
  hovered: CanvasNodeId | null
  /** Node whose inline text is being edited on the canvas. */
  editingText: CanvasNodeId | null
  breakpoint: CanvasBreakpoint
  zoom: number
  canUndo: boolean
  canRedo: boolean
  /** Changed since the last `markSaved()`. */
  dirty: boolean
  /** Last refused op, for the shell's toast. Cleared on the next success. */
  lastError: CanvasOpError | null
}

/**
 * A document change, for bindings that mirror the document elsewhere (the
 * real-time co-editing in `src/lib/canvas-collab`). `op` is the op that
 * produced `next` — for undo/redo, the op actually replayed. `reset` and
 * `remote` changes have no op.
 */
export interface CanvasStoreChange {
  prev: CanvasDocument
  next: CanvasDocument
  op?: CanvasOp
  source: 'local' | 'undo' | 'redo' | 'reset' | 'remote'
}

export interface CanvasStore {
  /** The catalog this editor validates against (for `canDrop`, palette…). */
  readonly catalog: CanvasCatalog
  getState(): CanvasEditorState
  subscribe(listener: () => void): () => void

  /** Applies an op and records one undo step. Consecutive `update`s on the
   * same node+paths within 500 ms coalesce into one step (typing, sliders);
   * pass `coalesce: false` to force a new step. An op that changes nothing
   * records no step. Returns false (and sets `lastError`) when refused. */
  dispatch(
    op: CanvasOp,
    options?: { label?: string; coalesce?: boolean },
  ): boolean
  undo(): void
  redo(): void

  select(ids: CanvasNodeId[] | CanvasNodeId | null): void
  hover(id: CanvasNodeId | null): void
  setEditingText(id: CanvasNodeId | null): void
  setBreakpoint(breakpoint: CanvasBreakpoint): void
  setZoom(zoom: number): void

  /** Helpers built on dispatch. Inserted/pasted/duplicated nodes become the
   * selection. */
  insertType(type: string, at: CanvasLocation): CanvasNodeId | null
  insertFragment(
    fragment: CanvasFragment,
    at: CanvasLocation,
  ): CanvasNodeId | null
  duplicate(ids: CanvasNodeId[]): void
  remove(ids: CanvasNodeId[]): void
  /** Detached copy (fresh ids) of the given nodes; several top-level nodes
   * give a fragment with `roots`. `null` when nothing copyable. */
  copy(ids: CanvasNodeId[]): CanvasFragment | null
  /** Pastes inside `after` (or the selection) when it accepts the content,
   * otherwise right after it; with nothing selected, at the end of the root. */
  paste(fragment: CanvasFragment, after?: CanvasNodeId): void

  /** Replaces the document (load, restore version) and clears history. */
  reset(doc: CanvasDocument): void
  /** Marks the current document as saved — or `doc`, the snapshot that was
   * actually sent to the server, so edits made while saving stay dirty. */
  markSaved(doc?: CanvasDocument): void

  /** Every document change, after the state listeners ran. */
  onChange(listener: (change: CanvasStoreChange) => void): () => void
  /**
   * Replaces the document with one changed by someone else (co-editing):
   * no history step, selection repaired. The local history keeps its own
   * ops, so undo still only reverts this user's changes; a step that no
   * longer applies (its node was removed remotely) is dropped.
   */
  applyRemote(doc: CanvasDocument): void
  /** Refuses inline text editing on nodes the guard rejects (someone else
   * is editing that text). `null` removes the guard. */
  setTextGuard(guard: ((id: CanvasNodeId) => boolean) | null): void
}

export const HISTORY_LIMIT = 200
export const COALESCE_MS = 500
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4

interface HistoryEntry {
  /** Identifies the document state this entry leads to (dirty tracking). */
  token: number
  forward: CanvasOp
  inverse: CanvasOp
  label?: string
  coalesceKey: string | null
  at: number
  selectionBefore: CanvasNodeId[]
  selectionAfter: CanvasNodeId[]
}

function coalesceKeyOf(
  op: CanvasOp,
  options?: { coalesce?: boolean },
): string | null {
  if (op.kind !== 'update' || options?.coalesce === false) return null
  return [op.id, ...Object.keys(op.set).sort()].join('\u0000')
}

function sameIds(a: CanvasNodeId[], b: CanvasNodeId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export function createCanvasStore(
  catalog: CanvasCatalog,
  initialDoc: CanvasDocument,
): CanvasStore {
  let state: CanvasEditorState = {
    doc: initialDoc,
    selection: [],
    hovered: null,
    editingText: null,
    breakpoint: catalog.breakpoints[0] ?? 'base',
    zoom: 1,
    canUndo: false,
    canRedo: false,
    dirty: false,
    lastError: null,
  }
  let past: HistoryEntry[] = []
  let future: HistoryEntry[] = []
  /** Token of the state below the oldest kept entry. */
  let baseToken = 0
  let savedToken = 0
  let nextToken = 1
  /** The entry the next compatible `update` may merge into. */
  let coalesceTarget: HistoryEntry | null = null
  /** Token of each document produced here, for `markSaved(doc)`. */
  let docTokens = new WeakMap<CanvasDocument, number>([[initialDoc, 0]])
  const listeners = new Set<() => void>()
  const changeListeners = new Set<(change: CanvasStoreChange) => void>()
  /** A remote change arrived: history steps may no longer apply. */
  let remoteSeen = false
  let textGuard: ((id: CanvasNodeId) => boolean) | null = null

  function emitChange(change: CanvasStoreChange): void {
    for (const listener of [...changeListeners]) listener(change)
  }

  const currentToken = () => past.at(-1)?.token ?? baseToken

  function commit(patch: Partial<CanvasEditorState>): void {
    const next: CanvasEditorState = {
      ...state,
      ...patch,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      dirty: currentToken() !== savedToken,
    }
    const keys = Object.keys(next) as Array<keyof CanvasEditorState>
    if (keys.every((key) => Object.is(next[key], state[key]))) return
    state = next
    for (const listener of [...listeners]) listener()
  }

  /** Keeps ids that exist in `doc`, preserving the array when unchanged. */
  function existing(doc: CanvasDocument, ids: CanvasNodeId[]): CanvasNodeId[] {
    const kept = ids.filter((id) => getNode(doc, id) !== undefined)
    return kept.length === ids.length ? ids : kept
  }

  /** Selection/hover/inline editing repaired for a new document. */
  function withDoc(
    doc: CanvasDocument,
    selection: CanvasNodeId[] = state.selection,
  ): Partial<CanvasEditorState> {
    const alive = (id: CanvasNodeId | null) =>
      id !== null && getNode(doc, id) ? id : null
    const kept = existing(doc, selection)
    return {
      doc,
      selection: sameIds(kept, state.selection) ? state.selection : kept,
      hovered: alive(state.hovered),
      editingText: alive(state.editingText),
    }
  }

  function dispatch(
    op: CanvasOp,
    options?: { label?: string; coalesce?: boolean },
  ): boolean {
    const result = applyOp(state.doc, op, catalog)
    if (!result.ok) {
      commit({ lastError: result.error })
      return false
    }
    const { doc, inverse } = result.value
    if (doc === state.doc) {
      commit({ lastError: null })
      return true
    }
    const now = Date.now()
    const key = coalesceKeyOf(op, options)
    const top = past.at(-1)
    if (
      key !== null &&
      top !== undefined &&
      top === coalesceTarget &&
      top.coalesceKey === key &&
      now - top.at <= COALESCE_MS
    ) {
      // Same paths: the latest op alone describes the change; the first
      // inverse still restores the values from before the burst.
      top.forward = op
      top.at = now
      top.token = nextToken++
    } else {
      const entry: HistoryEntry = {
        token: nextToken++,
        forward: op,
        inverse,
        label: options?.label ?? (op.kind === 'batch' ? op.label : undefined),
        coalesceKey: key,
        at: now,
        selectionBefore: state.selection,
        selectionAfter: state.selection,
      }
      past.push(entry)
      if (past.length > HISTORY_LIMIT) {
        baseToken = (past.shift() as HistoryEntry).token
      }
      coalesceTarget = key === null ? null : entry
    }
    future = []
    docTokens.set(doc, currentToken())
    const prev = state.doc
    commit({ ...withDoc(doc), lastError: null })
    emitChange({ prev, next: doc, op, source: 'local' })
    return true
  }

  /** Applies a history entry's op in replay mode; on success the entry's
   * ops are swapped so it can travel back the other way. */
  function travel(
    entry: HistoryEntry,
    direction: 'undo' | 'redo',
  ): { doc: CanvasDocument; op: CanvasOp } | null {
    const op = direction === 'undo' ? entry.inverse : entry.forward
    const result = applyOp(state.doc, op, catalog, { replay: true })
    if (!result.ok) {
      commit({ lastError: result.error })
      return null
    }
    if (direction === 'undo') entry.forward = result.value.inverse
    else entry.inverse = result.value.inverse
    return { doc: result.value.doc, op }
  }

  function undo(): void {
    const entry = past.at(-1)
    if (!entry) return
    const travelled = travel(entry, 'undo')
    if (!travelled) {
      // Co-editing: someone else removed what this step touched — drop it
      // so the steps below stay reachable.
      if (remoteSeen) {
        past.pop()
        coalesceTarget = null
        commit({})
      }
      return
    }
    const { doc, op } = travelled
    past.pop()
    future.push(entry)
    coalesceTarget = null
    entry.selectionAfter = state.selection
    docTokens.set(doc, currentToken())
    const prev = state.doc
    commit({ ...withDoc(doc, entry.selectionBefore), lastError: null })
    emitChange({ prev, next: doc, op, source: 'undo' })
  }

  function redo(): void {
    const entry = future.at(-1)
    if (!entry) return
    const travelled = travel(entry, 'redo')
    if (!travelled) {
      if (remoteSeen) {
        future.pop()
        commit({})
      }
      return
    }
    const { doc, op } = travelled
    future.pop()
    past.push(entry)
    coalesceTarget = null
    docTokens.set(doc, currentToken())
    const prev = state.doc
    commit({ ...withDoc(doc, entry.selectionAfter), lastError: null })
    emitChange({ prev, next: doc, op, source: 'redo' })
  }

  function select(ids: CanvasNodeId[] | CanvasNodeId | null): void {
    const list = ids === null ? [] : typeof ids === 'string' ? [ids] : ids
    const unique = existing(state.doc, [...new Set(list)])
    commit({
      selection: sameIds(unique, state.selection) ? state.selection : unique,
    })
  }

  /** Top-level ids among `ids`: existing, not the root, and without an
   * ancestor also in the list (removing/copying a parent covers its
   * children). */
  function topLevel(ids: CanvasNodeId[]): CanvasNodeId[] {
    const { doc } = state
    const set = new Set(
      ids.filter((id) => id !== doc.rootId && getNode(doc, id) !== undefined),
    )
    return [...set].filter((id) => {
      for (let p = parentOf(doc, id); p !== null; p = parentOf(doc, p)) {
        if (set.has(p)) return false
      }
      return true
    })
  }

  function childIndex(parentId: CanvasNodeId, id: CanvasNodeId): number {
    const parent = getNode(state.doc, parentId) as CanvasNode
    return (parent.children as CanvasNodeId[]).indexOf(id)
  }

  function insertRoots(
    fragment: CanvasFragment,
    at: CanvasLocation,
    label: string,
  ): CanvasNodeId | null {
    const roots = fragment.roots ?? [fragment.rootId]
    const ops: CanvasOp[] = roots.map((rootId, i) => ({
      kind: 'insert',
      fragment: { rootId, nodes: fragment.nodes },
      at: { parentId: at.parentId, index: at.index + i },
    }))
    const op: CanvasOp =
      ops.length === 1 ? ops[0] : { kind: 'batch', ops, label }
    if (!dispatch(op, { label })) return null
    select(roots)
    return roots[0]
  }

  function insertType(type: string, at: CanvasLocation): CanvasNodeId | null {
    const fragment = fragmentForType(catalog, type)
    if (!fragment) {
      commit({ lastError: { code: 'UNKNOWN_TYPE', type } })
      return null
    }
    return insertRoots(fragment, at, 'insert')
  }

  function insertFragment(
    fragment: CanvasFragment,
    at: CanvasLocation,
  ): CanvasNodeId | null {
    return insertRoots(cloneFragment(fragment), at, 'insert')
  }

  function duplicate(ids: CanvasNodeId[]): void {
    const { doc } = state
    const items = topLevel(ids).map((id) => {
      const parentId = parentOf(doc, id) as CanvasNodeId
      return {
        id,
        parentId,
        index: childIndex(parentId, id),
        fragment: cloneFragment({ doc, id }),
      }
    })
    if (items.length === 0) return
    // Highest index first, so earlier inserts never shift later targets.
    const ordered = [...items].sort((a, b) => b.index - a.index)
    const ok = dispatch(
      {
        kind: 'batch',
        label: 'duplicate',
        ops: ordered.map((item) => ({
          kind: 'insert',
          fragment: item.fragment,
          at: { parentId: item.parentId, index: item.index + 1 },
        })),
      },
      { label: 'duplicate' },
    )
    if (ok) select(items.map((item) => item.fragment.rootId))
  }

  function remove(ids: CanvasNodeId[]): void {
    const tops = topLevel(ids)
    if (tops.length === 0) return
    dispatch(
      {
        kind: 'batch',
        label: 'remove',
        ops: tops.map((id) => ({ kind: 'remove', id })),
      },
      { label: 'remove' },
    )
  }

  function copy(ids: CanvasNodeId[]): CanvasFragment | null {
    const tops = topLevel(ids)
    if (tops.length === 0) return null
    const parts = tops.map((id) => cloneFragment({ doc: state.doc, id }))
    if (parts.length === 1) return parts[0]
    return {
      rootId: parts[0].rootId,
      roots: parts.map((part) => part.rootId),
      nodes: Object.assign({}, ...parts.map((part) => part.nodes)),
    }
  }

  function paste(fragment: CanvasFragment, after?: CanvasNodeId): void {
    const { doc } = state
    const clone = cloneFragment(fragment)
    const roots = clone.roots ?? [clone.rootId]
    const anchor = after ?? state.selection[0]
    const target =
      anchor !== undefined && getNode(doc, anchor) ? anchor : doc.rootId
    const fits = roots.every((id) =>
      canDrop(doc, catalog, (clone.nodes[id] as CanvasNode).type, target),
    )
    const parentId = parentOf(doc, target)
    const at: CanvasLocation =
      fits || parentId === null
        ? {
            parentId: target,
            index: ((getNode(doc, target) as CanvasNode).children ?? []).length,
          }
        : { parentId, index: childIndex(parentId, target) + 1 }
    insertRoots(clone, at, 'paste')
  }

  function reset(doc: CanvasDocument): void {
    past = []
    future = []
    coalesceTarget = null
    baseToken = nextToken++
    savedToken = baseToken
    docTokens = new WeakMap([[doc, baseToken]])
    const prev = state.doc
    commit({
      doc,
      selection: [],
      hovered: null,
      editingText: null,
      lastError: null,
    })
    if (prev !== doc) emitChange({ prev, next: doc, source: 'reset' })
  }

  function applyRemote(doc: CanvasDocument): void {
    if (doc === state.doc) return
    const prev = state.doc
    remoteSeen = true
    docTokens.set(doc, currentToken())
    commit(withDoc(doc))
    emitChange({ prev, next: doc, source: 'remote' })
  }

  function markSaved(doc?: CanvasDocument): void {
    savedToken = doc === undefined ? currentToken() : (docTokens.get(doc) ?? -1)
    // A burst of typing must not merge across a save point.
    coalesceTarget = null
    commit({})
  }

  return {
    catalog,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispatch,
    undo,
    redo,
    select,
    hover(id) {
      commit({
        hovered: id !== null && getNode(state.doc, id) ? id : null,
      })
    },
    setEditingText(id) {
      if (id !== null && textGuard && !textGuard(id)) return
      commit({
        editingText: id !== null && getNode(state.doc, id) ? id : null,
      })
    },
    setBreakpoint(breakpoint) {
      if (catalog.breakpoints.includes(breakpoint)) commit({ breakpoint })
    },
    setZoom(zoom) {
      if (!Number.isFinite(zoom)) return
      commit({ zoom: Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX) })
    },
    insertType,
    insertFragment,
    duplicate,
    remove,
    copy,
    paste,
    reset,
    markSaved,
    onChange(listener) {
      changeListeners.add(listener)
      return () => {
        changeListeners.delete(listener)
      }
    },
    applyRemote,
    setTextGuard(guard) {
      textGuard = guard
    },
  }
}
