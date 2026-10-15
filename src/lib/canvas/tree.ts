import type { CanvasDocument, CanvasNode, CanvasNodeId } from './types'

/**
 * Parent index: child id → parent id (`null` for the root). Documents do not
 * store parent pointers, so the index is cached per document object in a
 * WeakMap. Building it is O(n) once; every document produced by `applyOp`
 * gets a *derived* index — a small overlay with only the ids the op moved —
 * so structural ops stay O(depth). Overlays are flattened every
 * `MAX_OVERLAYS` levels to keep lookups short.
 */

/** Marks an id removed in an overlay (`undefined` cannot be stored apart
 * from "not in this layer"). */
export const GONE = Symbol('canvas.gone')

export type ParentPatch = Map<CanvasNodeId, CanvasNodeId | null | typeof GONE>

const MAX_OVERLAYS = 16

class ParentIndex {
  constructor(
    private readonly own: ParentPatch,
    private readonly base: ParentIndex | null,
    readonly depth: number,
  ) {}

  get(id: CanvasNodeId): CanvasNodeId | null | undefined {
    let layer: ParentIndex | null = this
    while (layer) {
      if (layer.own.has(id)) {
        const value = layer.own.get(id)
        return value === GONE ? undefined : value
      }
      layer = layer.base
    }
    return undefined
  }

  /** One flat layer with the same answers. */
  flatten(): ParentIndex {
    const layers: ParentIndex[] = []
    for (let layer: ParentIndex | null = this; layer; layer = layer.base) {
      layers.push(layer)
    }
    const flat: ParentPatch = new Map()
    for (let i = layers.length - 1; i >= 0; i--) {
      for (const [id, parent] of layers[i].own) {
        if (parent === GONE) flat.delete(id)
        else flat.set(id, parent)
      }
    }
    return new ParentIndex(flat, null, 0)
  }
}

const indexes = new WeakMap<CanvasDocument, ParentIndex>()

function buildIndex(doc: CanvasDocument): ParentIndex {
  const own: ParentPatch = new Map([[doc.rootId, null]])
  for (const [id, node] of Object.entries(doc.nodes)) {
    for (const child of node.children ?? []) own.set(child, id)
  }
  return new ParentIndex(own, null, 0)
}

function indexOf(doc: CanvasDocument): ParentIndex {
  let index = indexes.get(doc)
  if (!index) {
    index = buildIndex(doc)
    indexes.set(doc, index)
  }
  return index
}

/** Parent id of a node: `null` for the root, `undefined` for an id that is
 * not in the document. O(1) after the first call on a document lineage. */
export function lookupParent(
  doc: CanvasDocument,
  id: CanvasNodeId,
): CanvasNodeId | null | undefined {
  return indexOf(doc).get(id)
}

/** Parent id of a node (`null` for the root and for unknown ids). */
export function parentOf(
  doc: CanvasDocument,
  id: CanvasNodeId,
): CanvasNodeId | null {
  return indexOf(doc).get(id) ?? null
}

/**
 * Registers the index of `next` (produced from `prev`) without rebuilding:
 * reuses `prev`'s index when the tree shape did not change, or layers the
 * patch on top of it. When `prev` was never indexed nothing is cached and
 * `next` builds lazily on first use.
 */
export function deriveIndex(
  prev: CanvasDocument,
  next: CanvasDocument,
  patch: ParentPatch,
): void {
  const base = indexes.get(prev)
  if (!base) return
  if (patch.size === 0) {
    indexes.set(next, base)
    return
  }
  const derived = new ParentIndex(patch, base, base.depth + 1)
  indexes.set(next, derived.depth >= MAX_OVERLAYS ? derived.flatten() : derived)
}

/** Ids of `id` and every descendant, depth-first pre-order. Ids that do
 * not resolve through `lookup` are skipped. */
export function collectSubtree(
  lookup: (id: CanvasNodeId) => CanvasNode | undefined,
  id: CanvasNodeId,
): CanvasNodeId[] {
  const out: CanvasNodeId[] = []
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop() as CanvasNodeId
    const node = lookup(current)
    if (!node) continue
    out.push(current)
    const children = node.children ?? []
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return out
}

/** The child of `ancestorId` whose subtree holds `id` (`id` itself when it
 * is a direct child); `null` when `id` is not below `ancestorId`. */
export function childOnPath(
  doc: CanvasDocument,
  ancestorId: CanvasNodeId,
  id: CanvasNodeId | null | undefined,
): CanvasNodeId | null {
  for (let current = id ?? null; current !== null; ) {
    const parent = parentOf(doc, current)
    if (parent === ancestorId) return current
    current = parent
  }
  return null
}
