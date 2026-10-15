/**
 * Steel Canvas — the drag-and-drop editing engine shared by the e-mail
 * builder (React Email catalog) and the site builder (web catalog). The
 * engine knows nothing about e-mail or HTML: a catalog registers component
 * types and renders them. See docs/canvas/README.md and ADR 0026.
 */

/** Stable node id (cuid2). The root node id is always `ROOT_ID`. */
export type CanvasNodeId = string

export const ROOT_ID = 'root'

/** Breakpoints a catalog may use. E-mail uses `base` + `mobile`; sites use
 * all three. `base` is desktop and the cascade goes base → tablet → mobile. */
export const CANVAS_BREAKPOINTS = ['base', 'tablet', 'mobile'] as const
export type CanvasBreakpoint = (typeof CANVAS_BREAKPOINTS)[number]

/** A value that can differ per breakpoint. Missing breakpoints inherit from
 * the previous one in the cascade. Plain (non-responsive) props store `T`. */
export type Responsive<T> = { base: T; tablet?: T; mobile?: T }

export type CanvasProps = Record<string, unknown>

export interface CanvasNode<P extends CanvasProps = CanvasProps> {
  id: CanvasNodeId
  /** Component type registered in the catalog (`email.button`, `site.section`). */
  type: string
  props: P
  /** Ordered child ids; absent when the component cannot have children. */
  children?: CanvasNodeId[]
  /** Editor-only metadata — never read by renderers. */
  meta?: {
    /** Custom name shown in the layers tree. */
    name?: string
    /** Hidden in the editor canvas and in the output. */
    hidden?: boolean
    /** Cannot be selected/moved/deleted from the canvas (layers still show it). */
    locked?: boolean
    /** Instance of a saved/global component (site "símbolo", e-mail saved block). */
    symbolId?: string
  }
}

/**
 * Normalized document: a flat map of nodes plus the root id. Normalized (not
 * nested) so operations, history and a future Yjs binding touch one node at a
 * time. `catalog` + `version` identify the schema that validates it.
 */
export interface CanvasDocument {
  catalog: string
  version: number
  rootId: CanvasNodeId
  nodes: Record<CanvasNodeId, CanvasNode>
}

/** Where a node goes: `index` within `parentId`'s children (clamped). */
export interface CanvasLocation {
  parentId: CanvasNodeId
  index: number
}

/** A detached subtree (clipboard, saved block, template section, palette
 * item). Ids inside are rewritten on paste/insert. */
export interface CanvasFragment {
  rootId: CanvasNodeId
  nodes: Record<CanvasNodeId, CanvasNode>
  /** Several top-level nodes (a multi-selection copy), in order; `rootId` is
   * the first. Absent for a single-root fragment. An `insert` op only places
   * `rootId`; the store's `paste`/`insertFragment` insert every root. */
  roots?: CanvasNodeId[]
}
