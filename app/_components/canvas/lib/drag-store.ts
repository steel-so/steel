import type { CanvasNodeId } from '@/src/lib/canvas/types'
import type { DragSource, DropTarget } from './drop-target'

/** Where a layers-tree drop goes (rendered by the tree itself). */
export interface LayerDropHint {
  /** Where the item goes (`null` when invalid). */
  at?: import('@/src/lib/canvas/types').CanvasLocation | null
  id: CanvasNodeId
  position: 'before' | 'after' | 'inside'
  valid: boolean
}

export interface DragState {
  source: DragSource | null
  /** Target on the canvas (frame coordinates). */
  target: DropTarget | null
  /** Hint over the layers tree. */
  layerHint: LayerDropHint | null
}

/**
 * Tiny external store for the in-flight drag. Kept apart from the canvas
 * store so pointer moves (60/s) only re-render the drop indicator.
 */
export interface DragStore {
  get(): DragState
  set(patch: Partial<DragState>): void
  subscribe(listener: () => void): () => void
}

export const IDLE_DRAG: DragState = {
  source: null,
  target: null,
  layerHint: null,
}

export function createDragStore(): DragStore {
  let state = IDLE_DRAG
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch }
      if (
        next.source === state.source &&
        next.target === state.target &&
        next.layerHint === state.layerHint
      ) {
        return
      }
      state = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Same target (avoids re-rendering on every pointer move). */
export function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  if (a === b) return true
  if (!a || !b) return false
  if (!a.valid) return !b.valid && a.hoverId === b.hoverId
  if (!b.valid) return false
  return (
    a.at.parentId === b.at.parentId &&
    a.at.index === b.at.index &&
    JSON.stringify(a.indicator) === JSON.stringify(b.indicator)
  )
}

export function sameHint(a: LayerDropHint | null, b: LayerDropHint | null) {
  if (a === b) return true
  return (
    !!a &&
    !!b &&
    a.id === b.id &&
    a.position === b.position &&
    a.valid === b.valid
  )
}
