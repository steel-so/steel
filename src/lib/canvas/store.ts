import type { CanvasOp, CanvasOpError } from './ops'
import type { CanvasCatalog } from './registry'
import type {
  CanvasBreakpoint,
  CanvasDocument,
  CanvasFragment,
  CanvasLocation,
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

export interface CanvasStore {
  getState(): CanvasEditorState
  subscribe(listener: () => void): () => void

  /** Applies an op and records one undo step. Consecutive `update`s on the
   * same node+path within 500 ms coalesce into one step (typing, sliders). */
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

  /** Helpers built on dispatch. */
  insertType(type: string, at: CanvasLocation): CanvasNodeId | null
  insertFragment(
    fragment: CanvasFragment,
    at: CanvasLocation,
  ): CanvasNodeId | null
  duplicate(ids: CanvasNodeId[]): void
  remove(ids: CanvasNodeId[]): void
  copy(ids: CanvasNodeId[]): CanvasFragment | null
  paste(fragment: CanvasFragment, after?: CanvasNodeId): void

  /** Replaces the document (load, restore version) and clears history. */
  reset(doc: CanvasDocument): void
  markSaved(): void
}

export function createCanvasStore(
  _catalog: CanvasCatalog,
  _doc: CanvasDocument,
): CanvasStore {
  throw new Error('canvas core: implemented by the canvas-core slice')
}
