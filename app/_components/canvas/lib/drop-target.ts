import { canDrop, getNode, parentOf } from '@/src/lib/canvas/ops'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type {
  CanvasDocument,
  CanvasFragment,
  CanvasLocation,
  CanvasNodeId,
} from '@/src/lib/canvas/types'

/**
 * Where a dragged item would land, computed from the pointer and the
 * rendered geometry. Pure: geometry comes in through `rectOf`, so the same
 * code serves the iframe canvas and the tests.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** What is being dragged. */
export type DragSource =
  /** A palette item: inserts `fragmentForType(type)`. */
  | { kind: 'type'; type: string; label: string }
  /** A preset/saved block. */
  | { kind: 'fragment'; fragment: CanvasFragment; label: string }
  /** An existing node (canvas handle, layers). */
  | { kind: 'node'; id: CanvasNodeId; label: string }

export type Axis = 'vertical' | 'horizontal'

export type DropIndicator =
  /** A line between siblings, in frame coordinates. */
  | { kind: 'line'; axis: Axis; x: number; y: number; length: number }
  /** Highlight of an empty container receiving the item. */
  | { kind: 'inside'; rect: Rect }

export type DropTarget =
  | {
      valid: true
      at: CanvasLocation
      indicator: DropIndicator
    }
  | {
      valid: false
      /** Node under the pointer that refused the item (red outline). */
      hoverId: CanvasNodeId | null
    }

/** Type of the item's root node. */
export function sourceType(
  doc: CanvasDocument,
  source: DragSource,
): string | null {
  switch (source.kind) {
    case 'type':
      return source.type
    case 'fragment':
      return source.fragment.nodes[source.fragment.rootId]?.type ?? null
    case 'node':
      return getNode(doc, source.id)?.type ?? null
  }
}

export function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** Main axis of a container, guessed from where its children sit: side by
 * side is horizontal, anything else vertical. */
export function axisOf(childRects: Rect[]): Axis {
  if (childRects.length < 2) return 'vertical'
  const [a, b] = childRects
  const sideBySide = b.x >= a.x + a.width - 2 && b.y < a.y + a.height - 2
  return sideBySide ? 'horizontal' : 'vertical'
}

function isInside(
  doc: CanvasDocument,
  id: CanvasNodeId,
  ancestor: CanvasNodeId,
): boolean {
  for (let p: CanvasNodeId | null = id; p !== null; p = parentOf(doc, p)) {
    if (p === ancestor) return true
  }
  return false
}

interface ChildBox {
  id: CanvasNodeId
  index: number
  rect: Rect
}

function visibleChildren(
  doc: CanvasDocument,
  parentId: CanvasNodeId,
  rectOf: (id: CanvasNodeId) => Rect | null,
): ChildBox[] {
  const children = getNode(doc, parentId)?.children ?? []
  const boxes: ChildBox[] = []
  children.forEach((id, index) => {
    const rect = rectOf(id)
    if (rect && (rect.width > 0 || rect.height > 0)) {
      boxes.push({ id, index, rect })
    }
  })
  return boxes
}

const start = (rect: Rect, axis: Axis) =>
  axis === 'vertical' ? rect.y : rect.x
const end = (rect: Rect, axis: Axis) =>
  axis === 'vertical' ? rect.y + rect.height : rect.x + rect.width
const mid = (rect: Rect, axis: Axis) =>
  (start(rect, axis) + end(rect, axis)) / 2
const along = (point: Point, axis: Axis) =>
  axis === 'vertical' ? point.y : point.x

/** Line for an insertion point `index` among `boxes` (all children have
 * at least one visible box here). */
function lineFor(boxes: ChildBox[], index: number, axis: Axis): DropIndicator {
  const after = boxes.find((box) => box.index >= index)
  const before = [...boxes].reverse().find((box) => box.index < index)
  const ref = (after ?? before) as ChildBox
  let pos: number
  if (after && before)
    pos = (end(before.rect, axis) + start(after.rect, axis)) / 2
  else if (after) pos = start(after.rect, axis)
  else pos = end(ref.rect, axis)
  return axis === 'vertical'
    ? { kind: 'line', axis, x: ref.rect.x, y: pos, length: ref.rect.width }
    : { kind: 'line', axis, x: pos, y: ref.rect.y, length: ref.rect.height }
}

/** Insertion point inside `parentId` for the pointer. */
function placeInside(
  doc: CanvasDocument,
  parentId: CanvasNodeId,
  point: Point,
  rectOf: (id: CanvasNodeId) => Rect | null,
): { index: number; indicator: DropIndicator } | null {
  const boxes = visibleChildren(doc, parentId, rectOf)
  const total = getNode(doc, parentId)?.children?.length ?? 0
  if (boxes.length === 0) {
    const rect = rectOf(parentId)
    if (!rect) return null
    return { index: total, indicator: { kind: 'inside', rect } }
  }
  const axis = axisOf(boxes.map((box) => box.rect))
  const pos = along(point, axis)
  const next = boxes.find((box) => pos < mid(box.rect, axis))
  const index = next ? next.index : total
  return { index, indicator: lineFor(boxes, index, axis) }
}

/** Before/after `id` inside its parent. */
function placeBeside(
  doc: CanvasDocument,
  id: CanvasNodeId,
  parentId: CanvasNodeId,
  after: boolean,
  rectOf: (id: CanvasNodeId) => Rect | null,
): { index: number; indicator: DropIndicator } | null {
  const boxes = visibleChildren(doc, parentId, rectOf)
  const own = boxes.find((box) => box.id === id)
  if (!own) return null
  const axis = axisOf(boxes.map((box) => box.rect))
  const index = own.index + (after ? 1 : 0)
  return { index, indicator: lineFor(boxes, index, axis) }
}

/** How close (frame px) to an edge counts as "between", not "inside". */
export function edgeSize(rect: Rect, axis: Axis): number {
  const size = axis === 'vertical' ? rect.height : rect.width
  return Math.min(12, size / 4)
}

export interface DropQuery {
  doc: CanvasDocument
  catalog: CanvasCatalog
  source: DragSource
  /** Node under the pointer (`null` = empty canvas → root). */
  hitId: CanvasNodeId | null
  point: Point
  rectOf: (id: CanvasNodeId) => Rect | null
}

/**
 * Walks from the node under the pointer up to the root and returns the
 * first place that accepts the item:
 * - a container that accepts it gets it inside (between its children, by
 *   pointer position), unless the pointer is on its edge and its parent
 *   accepts the item too — then it goes before/after the container;
 * - otherwise the item goes before/after the node in its parent.
 */
export function computeDropTarget(query: DropQuery): DropTarget {
  const { doc, catalog, source, point, rectOf } = query
  const type = sourceType(doc, source)
  if (!type) return { valid: false, hoverId: null }
  const movingId = source.kind === 'node' ? source.id : undefined
  const accepts = (parentId: CanvasNodeId) =>
    canDrop(doc, catalog, type, parentId, movingId)

  let current: CanvasNodeId | null = query.hitId ?? doc.rootId
  if (!getNode(doc, current)) current = doc.rootId
  // Hovering the dragged node (or inside it): decide around it, in its parent.
  if (movingId && isInside(doc, current, movingId)) current = movingId

  const hoverId = current
  while (current !== null) {
    const node = getNode(doc, current)
    const parentId = parentOf(doc, current)
    const rect = rectOf(current)
    const isMoving = current === movingId

    if (node?.children && !isMoving && accepts(current)) {
      if (rect && parentId !== null && accepts(parentId)) {
        const siblings = visibleChildren(doc, parentId, rectOf)
        const axis = axisOf(siblings.map((box) => box.rect))
        const edge = edgeSize(rect, axis)
        const pos = along(point, axis)
        if (pos - start(rect, axis) < edge || end(rect, axis) - pos < edge) {
          const placed = placeBeside(
            doc,
            current,
            parentId,
            pos > mid(rect, axis),
            rectOf,
          )
          if (placed) {
            return {
              valid: true,
              at: { parentId, index: placed.index },
              indicator: placed.indicator,
            }
          }
        }
      }
      const placed = placeInside(doc, current, point, rectOf)
      if (placed) {
        return {
          valid: true,
          at: { parentId: current, index: placed.index },
          indicator: placed.indicator,
        }
      }
    }

    if (parentId !== null && rect && accepts(parentId)) {
      const siblings = visibleChildren(doc, parentId, rectOf)
      const axis = axisOf(siblings.map((box) => box.rect))
      const placed = placeBeside(
        doc,
        current,
        parentId,
        along(point, axis) > mid(rect, axis),
        rectOf,
      )
      if (placed) {
        return {
          valid: true,
          at: { parentId, index: placed.index },
          indicator: placed.indicator,
        }
      }
    }
    current = parentId
  }
  return { valid: false, hoverId }
}

/**
 * Where a click on a palette item inserts: inside the selection when it
 * accepts the type, else right after the closest ancestor whose parent
 * accepts it; without a selection, at the end of the shallowest (then
 * last) container that accepts it. `null` when nothing accepts it.
 */
export function findInsertLocation(
  doc: CanvasDocument,
  catalog: CanvasCatalog,
  type: string,
  selectedId: CanvasNodeId | null,
): CanvasLocation | null {
  const endOf = (id: CanvasNodeId): CanvasLocation => ({
    parentId: id,
    index: getNode(doc, id)?.children?.length ?? 0,
  })
  if (selectedId && getNode(doc, selectedId)) {
    if (canDrop(doc, catalog, type, selectedId)) return endOf(selectedId)
    let child = selectedId
    for (
      let parent = parentOf(doc, child);
      parent !== null;
      child = parent, parent = parentOf(doc, parent)
    ) {
      if (canDrop(doc, catalog, type, parent)) {
        const children = getNode(doc, parent)?.children ?? []
        return { parentId: parent, index: children.indexOf(child) + 1 }
      }
    }
  }
  let best: { id: CanvasNodeId; depth: number } | null = null
  const stack: Array<{ id: CanvasNodeId; depth: number }> = [
    { id: doc.rootId, depth: 0 },
  ]
  const visited: Array<{ id: CanvasNodeId; depth: number }> = []
  while (stack.length > 0) {
    const item = stack.pop() as { id: CanvasNodeId; depth: number }
    visited.push(item)
    const children = getNode(doc, item.id)?.children ?? []
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: children[i], depth: item.depth + 1 })
    }
  }
  for (const item of visited) {
    // Pre-order: on equal depth the later container wins.
    if (!canDrop(doc, catalog, type, item.id)) continue
    if (!best || item.depth <= best.depth) best = item
  }
  return best ? endOf(best.id) : null
}
