import { getNode, parentOf } from '@/src/lib/canvas/ops'
import { getIn } from '@/src/lib/canvas/path'
import type {
  CanvasCatalog,
  CanvasComponentDefinition,
} from '@/src/lib/canvas/registry'
import { resolveResponsive } from '@/src/lib/canvas/responsive'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { writeField } from './fields'
import { elementOf, type FrameHandle } from './frame-handle'

/** Whether the inspector edits `path` per breakpoint (`Responsive`). */
export function isResponsivePath(
  definition: Pick<CanvasComponentDefinition, 'inspector'> | undefined,
  path: string,
): boolean {
  return (
    definition?.inspector.some((section) =>
      section.fields.some((field) => field.path === path && field.responsive),
    ) ?? false
  )
}

/** `{ parentId, childPath }` when `id` sits in a container in free
 * positioning at the active breakpoint, else null. */
export function freeContext(
  store: CanvasStore,
  catalog: CanvasCatalog,
  id: CanvasNodeId,
): { parentId: CanvasNodeId; childPath: string } | null {
  const { doc, breakpoint } = store.getState()
  const parentId = parentOf(doc, id)
  const parent = parentId ? getNode(doc, parentId) : undefined
  const layout = parent && catalog.components[parent.type]?.freeLayout
  if (!parentId || !parent || !layout?.enabled(parent.props, breakpoint)) {
    return null
  }
  return { parentId, childPath: layout.childPath }
}

/** Writes `x`/`y` of a freely positioned child for the active breakpoint. */
export function writeFreePosition(
  store: CanvasStore,
  id: CanvasNodeId,
  childPath: string,
  position: { x?: number; y?: number },
  options?: { coalesce?: boolean },
): boolean {
  const { doc, breakpoint } = store.getState()
  const node = getNode(doc, id)
  if (!node) return false
  const set: Record<string, unknown> = {}
  for (const axis of ['x', 'y'] as const) {
    const value = position[axis]
    if (value === undefined) continue
    const path = `${childPath}.${axis}`
    set[path] = writeField(
      getIn(node.props, path),
      { path, label: '', control: { kind: 'number' }, responsive: true },
      breakpoint,
      value,
    )
  }
  if (Object.keys(set).length === 0) return false
  return store.dispatch(
    { kind: 'update', id, set },
    { label: 'move', ...options },
  )
}

/**
 * Moves a freely positioned child by (`dx`, `dy`) px (keyboard nudge).
 * Starts from the stored position, or from where the element is drawn when
 * it was never positioned. Returns false for a child in the flow.
 */
export function nudgeFreeChild(
  store: CanvasStore,
  catalog: CanvasCatalog,
  frame: FrameHandle,
  id: CanvasNodeId,
  dx: number,
  dy: number,
): boolean {
  const free = freeContext(store, catalog, id)
  if (!free) return false
  const { doc, breakpoint } = store.getState()
  const node = getNode(doc, id)
  if (!node) return false
  const element = elementOf(frame, id)
  const parent = elementOf(frame, free.parentId)
  const read = (axis: 'x' | 'y', measured: number) => {
    const stored = resolveResponsive(
      getIn(node.props, `${free.childPath}.${axis}`),
      breakpoint,
    )
    return typeof stored === 'number' ? stored : measured
  }
  const box = element?.getBoundingClientRect()
  const outer = parent?.getBoundingClientRect()
  const measuredX = box && outer ? box.left - outer.left : 0
  const measuredY = box && outer ? box.top - outer.top : 0
  return writeFreePosition(store, id, free.childPath, {
    x: Math.round(read('x', measuredX) + dx),
    y: Math.round(read('y', measuredY) + dy),
  })
}
