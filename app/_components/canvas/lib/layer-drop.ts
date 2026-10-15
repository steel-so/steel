import { canDrop, getNode, parentOf } from '@/src/lib/canvas/ops'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type {
  CanvasDocument,
  CanvasLocation,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import type { LayerDropHint } from './drag-store'
import { type DragSource, sourceType } from './drop-target'

export type LayerDrop = LayerDropHint & { at: CanvasLocation | null }

function within(doc: CanvasDocument, id: CanvasNodeId, ancestor: CanvasNodeId) {
  for (let p: CanvasNodeId | null = id; p !== null; p = parentOf(doc, p)) {
    if (p === ancestor) return true
  }
  return false
}

/**
 * Drop over a row of the layers tree. `ratio` is the pointer's vertical
 * position inside the row (0 = top, 1 = bottom): the top quarter means
 * "before", the bottom quarter "after", the middle "inside" (falling back
 * to the nearest valid option).
 */
export function layerDrop(
  doc: CanvasDocument,
  catalog: CanvasCatalog,
  source: DragSource,
  rowId: CanvasNodeId,
  ratio: number,
): LayerDrop {
  const type = sourceType(doc, source)
  const node = getNode(doc, rowId)
  const movingId = source.kind === 'node' ? source.id : undefined
  const preferred: LayerDropHint['position'] =
    ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
  const invalid: LayerDrop = {
    id: rowId,
    position: preferred,
    valid: false,
    at: null,
  }
  if (!type || !node) return invalid
  if (movingId && within(doc, rowId, movingId)) return invalid

  const parentId = parentOf(doc, rowId)
  const canInside =
    !!node.children && canDrop(doc, catalog, type, rowId, movingId)
  const canBeside =
    parentId !== null && canDrop(doc, catalog, type, parentId, movingId)

  const inside = (): LayerDrop => ({
    id: rowId,
    position: 'inside',
    valid: true,
    at: { parentId: rowId, index: node.children?.length ?? 0 },
  })
  const beside = (after: boolean): LayerDrop => {
    const siblings = getNode(doc, parentId as CanvasNodeId)?.children ?? []
    return {
      id: rowId,
      position: after ? 'after' : 'before',
      valid: true,
      at: {
        parentId: parentId as CanvasNodeId,
        index: siblings.indexOf(rowId) + (after ? 1 : 0),
      },
    }
  }

  if (preferred === 'inside') {
    if (canInside) return inside()
    if (canBeside) return beside(ratio >= 0.5)
    return invalid
  }
  if (canBeside) return beside(preferred === 'after')
  if (canInside) return inside()
  return invalid
}
