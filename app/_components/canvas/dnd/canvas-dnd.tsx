'use client'

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { resolveIcon, useCanvasEditor, useDragState } from '../editor-context'
import { IDLE_DRAG, sameHint, sameTarget } from '../lib/drag-store'
import {
  computeDropTarget,
  type DragSource,
  type Point,
  sourceType,
} from '../lib/drop-target'
import { nodeIdAt, toFramePoint } from '../lib/frame-handle'
import { layerDrop } from '../lib/layer-drop'

/** Distance (px) from the scroller edge where auto-scroll starts. */
const SCROLL_EDGE = 56
const SCROLL_MAX_SPEED = 18

const instructions = {
  draggable:
    'Para pegar um item, pressione espaço. Use as setas para mover, espaço ou Enter para soltar e Esc para cancelar. Enter insere o item na seleção.',
}

function sourceOf(data: unknown): DragSource | null {
  const source = (data as { source?: DragSource } | undefined)?.source
  return source ?? null
}

/** Current pointer of a drag: the real pointer for mouse/touch, the center
 * of the moved overlay for keyboard drags. */
function pointerOf(event: DragMoveEvent | DragEndEvent): Point | null {
  const activator = event.activatorEvent as Partial<PointerEvent> | null
  if (activator && typeof activator.clientX === 'number') {
    return {
      x: (activator.clientX as number) + event.delta.x,
      y: (activator.clientY as number) + event.delta.y,
    }
  }
  const rect = event.active.rect.current.translated
  if (!rect) return null
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/** A palette item, preset, layer row or canvas handle that can be dragged. */
export function useCanvasDraggable(id: string, source: DragSource) {
  return useDraggable({ id, data: { source } })
}

/**
 * Drag and drop for the whole editor. Targets are not dnd-kit droppables:
 * on every move the pointer is hit-tested against the canvas iframe
 * (through `elementFromPoint` inside it) or the layers tree, and the
 * engine's `canDrop` decides. The iframe ignores pointer events while
 * dragging so the parent document keeps receiving them.
 */
export function CanvasDnd({ children }: { children: ReactNode }) {
  const { store, catalog, drag, frame } = useCanvasEditor()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Enter clicks (inserts at the selection); Space picks the item up.
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: ['Space'],
        cancel: ['Escape'],
        end: ['Space', 'Enter'],
      },
    }),
  )
  const lastPoint = useRef<Point | null>(null)
  const scrollFrame = useRef<number | null>(null)

  const updateTarget = useCallback(
    (point: Point) => {
      const source = drag.get().source
      if (!source) return
      const { doc } = store.getState()
      const row = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>('[data-layer-id]')
      if (row) {
        const box = row.getBoundingClientRect()
        const ratio = box.height > 0 ? (point.y - box.top) / box.height : 0.5
        const hint = layerDrop(
          doc,
          catalog,
          source,
          row.dataset.layerId as string,
          ratio,
        )
        const current = drag.get().layerHint
        drag.set({
          target: null,
          layerHint: sameHint(current, hint) ? current : hint,
        })
        return
      }
      const framePoint = toFramePoint(frame, point.x, point.y)
      if (!framePoint || !frame.document) {
        drag.set({ target: null, layerHint: null })
        return
      }
      const hit = frame.document.elementFromPoint(framePoint.x, framePoint.y)
      const target = computeDropTarget({
        doc,
        catalog,
        source,
        hitId: nodeIdAt(hit),
        point: framePoint,
        rectOf: (id) => {
          const element = frame.document?.querySelector(
            `[data-canvas-id="${id.replace(/["\\]/g, '\\$&')}"]`,
          )
          if (!element) return null
          const box = element.getBoundingClientRect()
          return {
            x: box.left,
            y: box.top,
            width: box.width,
            height: box.height,
          }
        },
      })
      const current = drag.get().target
      drag.set({
        target: sameTarget(current, target) ? current : target,
        layerHint: null,
      })
    },
    [catalog, drag, frame, store],
  )

  const stopScroll = useCallback(() => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = null
  }, [])

  // Scrolls the canvas while the pointer rests near its top/bottom edge.
  const autoScroll = useCallback(() => {
    const scroller = frame.scroller
    const point = lastPoint.current
    if (!scroller || !point || !drag.get().source) {
      stopScroll()
      return
    }
    const box = scroller.getBoundingClientRect()
    const inside = point.x >= box.left && point.x <= box.right
    let speed = 0
    if (inside && point.y < box.top + SCROLL_EDGE && point.y > box.top - 40) {
      speed = -SCROLL_MAX_SPEED * (1 - (point.y - box.top) / SCROLL_EDGE)
    } else if (
      inside &&
      point.y > box.bottom - SCROLL_EDGE &&
      point.y < box.bottom + 40
    ) {
      speed = SCROLL_MAX_SPEED * (1 - (box.bottom - point.y) / SCROLL_EDGE)
    }
    if (speed === 0) {
      stopScroll()
      return
    }
    scroller.scrollTop += Math.max(
      -SCROLL_MAX_SPEED,
      Math.min(SCROLL_MAX_SPEED, speed),
    )
    updateTarget(point)
    scrollFrame.current = requestAnimationFrame(autoScroll)
  }, [drag, frame, stopScroll, updateTarget])

  useEffect(() => stopScroll, [stopScroll])

  const onDragStart = (event: DragStartEvent) => {
    const source = sourceOf(event.active.data.current)
    if (!source) return
    store.hover(null)
    store.setEditingText(null)
    drag.set({ ...IDLE_DRAG, source })
  }

  const onDragMove = (event: DragMoveEvent) => {
    const point = pointerOf(event)
    if (!point) return
    lastPoint.current = point
    updateTarget(point)
    if (scrollFrame.current === null) autoScroll()
  }

  const finish = () => {
    stopScroll()
    lastPoint.current = null
    drag.set(IDLE_DRAG)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const point = pointerOf(event)
    if (point) updateTarget(point)
    const { source, target, layerHint } = drag.get()
    finish()
    if (!source) return
    const at = target?.valid
      ? target.at
      : layerHint?.valid
        ? layerHint.at
        : null
    if (!at) return
    if (source.kind === 'type') store.insertType(source.type, at)
    else if (source.kind === 'fragment')
      store.insertFragment(source.fragment, at)
    else if (
      store.dispatch({ kind: 'move', id: source.id, to: at }, { label: 'move' })
    ) {
      store.select(source.id)
    }
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Arrastando ${sourceOf(active.data.current)?.label ?? 'item'}.`,
    onDragMove: () => {
      const { target, layerHint } = drag.get()
      if (target?.valid || layerHint?.valid) return 'Posição válida.'
      return undefined
    },
    onDragOver: () => undefined,
    onDragEnd: ({ active }) =>
      `${sourceOf(active.data.current)?.label ?? 'Item'} solto.`,
    onDragCancel: () => 'Arraste cancelado.',
  }

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
      accessibility={{ announcements, screenReaderInstructions: instructions }}
    >
      {children}
      <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
        <DragPreview />
      </DragOverlay>
    </DndContext>
  )
}

/** The chip that follows the pointer. */
function DragPreview() {
  const { catalog, store } = useCanvasEditor()
  const source = useDragState((state) => state.source)
  const valid = useDragState((state) =>
    state.target === null && state.layerHint === null
      ? null
      : !!(state.target?.valid || state.layerHint?.valid),
  )
  if (!source) return null
  const type = sourceType(store.getState().doc, source)
  const icon = resolveIcon(
    catalog,
    type ? catalog.components[type]?.icon : undefined,
  )
  return (
    <div
      data-testid='canvas-drag-preview'
      className={cn(
        'inline-flex h-8 cursor-grabbing items-center gap-2 rounded-md border bg-popover px-2.5 text-xs font-medium text-popover-foreground shadow-lg ring-1 ring-foreground/5 transition-colors',
        valid === false && 'border-destructive/50 text-destructive',
      )}
    >
      <SteelIcon icon={icon} className='size-3.5' />
      {source.label}
    </div>
  )
}

/** Label of a node for drag chips and toasts. */
export function nodeLabel(
  catalog: ReturnType<typeof useCanvasEditor>['catalog'],
  store: ReturnType<typeof useCanvasEditor>['store'],
  id: CanvasNodeId,
): string {
  const node = getNode(store.getState().doc, id)
  if (!node) return 'Item'
  return node.meta?.name ?? catalog.components[node.type]?.label ?? node.type
}
