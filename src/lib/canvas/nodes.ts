import type { CanvasDocument, CanvasNode, CanvasNodeId } from './types'

/**
 * Node storage without O(n) copies.
 *
 * A document's `nodes` is a plain record, but copying a 2,000-key record on
 * every edit costs ~0.6 ms — more than everything else an op does. So the
 * documents `applyOp` produces are *overlays*: they keep a reference to the
 * document they came from plus a small map of the nodes the op changed.
 *
 * - `getNode(doc, id)` reads through the overlay in O(overlay depth) — use it
 *   in hot paths (renderers, overlays, hooks).
 * - `doc.nodes` still works everywhere (JSON, spread, `Object.values`): it is
 *   an enumerable getter that materializes the full record on first access and
 *   caches it — O(n) once per document, never per read.
 *
 * Chains are capped at `MAX_DEPTH` layers: the next document materializes,
 * so the amortized cost stays O(n / MAX_DEPTH) per op in the worst case.
 */

/** Marks a node removed in an overlay layer. */
export const REMOVED = Symbol('canvas.removed')

export type NodeChanges = Map<CanvasNodeId, CanvasNode | typeof REMOVED>

interface Overlay {
  /** Released (`null`) once `cache` exists, so old documents can be freed. */
  base: CanvasDocument | null
  own: NodeChanges | null
  depth: number
  cache: Record<CanvasNodeId, CanvasNode> | null
}

const MAX_DEPTH = 32

const overlays = new WeakMap<CanvasDocument, Overlay>()

/** The node with `id`, or `undefined`. Never materializes the record. */
export function getNode(
  doc: CanvasDocument,
  id: CanvasNodeId,
): CanvasNode | undefined {
  let current = doc
  for (;;) {
    const overlay = overlays.get(current)
    const nodes = overlay ? overlay.cache : current.nodes
    if (nodes) return Object.hasOwn(nodes, id) ? nodes[id] : undefined
    const layer = overlay as Overlay
    const own = (layer.own as NodeChanges).get(id)
    if (own !== undefined) return own === REMOVED ? undefined : own
    current = layer.base as CanvasDocument
  }
}

/** Builds the full record of an overlay document, caches it and releases
 * the chain below. */
function materialize(top: Overlay): Record<CanvasNodeId, CanvasNode> {
  const layers: NodeChanges[] = []
  let overlay: Overlay | undefined = top
  let current: CanvasDocument | null = null
  while (overlay && !overlay.cache) {
    layers.push(overlay.own as NodeChanges)
    current = overlay.base as CanvasDocument
    overlay = overlays.get(current)
  }
  const nodes = {
    ...(overlay ? overlay.cache : (current as CanvasDocument).nodes),
  }
  for (let i = layers.length - 1; i >= 0; i--) {
    for (const [id, node] of layers[i]) {
      if (node === REMOVED) delete nodes[id]
      else nodes[id] = node
    }
  }
  top.cache = nodes
  top.base = null
  top.own = null
  return nodes
}

/** Depth of the uncached chain under `doc` (0 for a plain/cached document). */
function chainDepth(doc: CanvasDocument): number {
  const overlay = overlays.get(doc)
  return overlay && !overlay.cache ? overlay.depth : 0
}

/** New document = `base` with `changes` applied; `base` is untouched. */
export function deriveDocument(
  base: CanvasDocument,
  changes: NodeChanges,
): CanvasDocument {
  const doc = {} as CanvasDocument
  // Copy the header fields without touching `base.nodes` (a getter).
  for (const key of Object.keys(base) as Array<keyof CanvasDocument>) {
    if (key !== 'nodes')
      (doc as unknown as Record<string, unknown>)[key] = base[key]
  }
  const overlay: Overlay = {
    base,
    own: changes,
    depth: chainDepth(base) + 1,
    cache: null,
  }
  overlays.set(doc, overlay)
  if (overlay.depth >= MAX_DEPTH) materialize(overlay)
  Object.defineProperty(doc, 'nodes', {
    enumerable: true,
    configurable: true,
    get: () => overlay.cache ?? materialize(overlay),
  })
  return doc
}
