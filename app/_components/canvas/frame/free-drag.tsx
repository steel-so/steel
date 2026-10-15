'use client'

import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react'
import { getNode } from '@/src/lib/canvas/ops'
import { getIn } from '@/src/lib/canvas/path'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { useCanvasEditor } from '../editor-context'
import type { Rect } from '../lib/drop-target'
import { writeField } from '../lib/fields'
import { elementOf } from '../lib/frame-handle'
import { type SnapBox, snapBox, snapLines } from '../lib/snap'

interface DragSession {
  pointerId: number
  start: { x: number; y: number }
  origin: { x: number; y: number }
  size: { width: number; height: number }
  lines: { x: number[]; y: number[] }
  moved: boolean
}

/** Box of `element` inside `parent`'s padding box, in frame px. */
function boxIn(element: Element, parent: Element): SnapBox {
  const outer = parent.getBoundingClientRect()
  const inner = element.getBoundingClientRect()
  return {
    x: inner.left - outer.left - parent.clientLeft,
    y: inner.top - outer.top - parent.clientTop,
    width: inner.width,
    height: inner.height,
  }
}

/**
 * Drag surface over the selected child of a container in free positioning
 * ("posição livre"): moving it writes `{ x, y }` for the active breakpoint
 * at the parent's `freeLayout.childPath`, snapping to the container's edges
 * and center and to the siblings (hold Alt to move without snapping).
 * Double-click still opens the inline text editor.
 */
export function FreeDrag({
  id,
  parentId,
  childPath,
  rect,
  scale,
}: {
  id: CanvasNodeId
  parentId: CanvasNodeId
  childPath: string
  /** Current box of the node, in frame coordinates. */
  rect: Rect
  scale: number
}) {
  const { frame, store, catalog } = useCanvasEditor()
  const session = useRef<DragSession | null>(null)
  const [guides, setGuides] = useState<{
    parent: Rect
    x: number[]
    y: number[]
  } | null>(null)

  const write = (x: number, y: number) => {
    const { doc, breakpoint } = store.getState()
    const node = getNode(doc, id)
    if (!node) return
    const set: Record<string, unknown> = {}
    for (const [axis, value] of [
      ['x', x],
      ['y', y],
    ] as const) {
      const path = `${childPath}.${axis}`
      set[path] = writeField(
        getIn(node.props, path),
        { path, label: '', control: { kind: 'number' }, responsive: true },
        breakpoint,
        value,
      )
    }
    store.dispatch({ kind: 'update', id, set }, { label: 'move' })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const element = elementOf(frame, id)
    const parent = elementOf(frame, parentId)
    if (!element || !parent) return
    event.preventDefault()
    event.stopPropagation()
    const siblings = (getNode(store.getState().doc, parentId)?.children ?? [])
      .filter((child) => child !== id)
      .map((child) => elementOf(frame, child))
      .filter((sibling): sibling is HTMLElement => sibling !== null)
      .map((sibling) => boxIn(sibling, parent))
    const own = boxIn(element, parent)
    session.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: { x: own.x, y: own.y },
      size: { width: own.width, height: own.height },
      lines: snapLines(
        { width: parent.clientWidth, height: parent.clientHeight },
        siblings,
      ),
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = session.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = (event.clientX - drag.start.x) / scale
    const dy = (event.clientY - drag.start.y) / scale
    if (!drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
    drag.moved = true
    const snapped = snapBox(
      {
        x: drag.origin.x + dx,
        y: drag.origin.y + dy,
        ...drag.size,
      },
      drag.lines,
      { free: event.altKey },
    )
    write(snapped.x, snapped.y)
    const parent = elementOf(frame, parentId)
    if (parent) {
      const box = parent.getBoundingClientRect()
      setGuides({
        parent: {
          x: box.left + parent.clientLeft,
          y: box.top + parent.clientTop,
          width: parent.clientWidth,
          height: parent.clientHeight,
        },
        ...snapped.guides,
      })
    }
  }

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (session.current?.pointerId !== event.pointerId) return
    session.current = null
    setGuides(null)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return (
    <>
      <div
        data-testid='canvas-free-drag'
        title='Arraste para posicionar (Alt desliga o alinhamento automático)'
        className='pointer-events-auto absolute inset-0 cursor-move touch-none'
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={() => {
          const node = getNode(store.getState().doc, id)
          if (node && catalog.components[node.type]?.inlineText) {
            store.setEditingText(id)
          }
        }}
      />
      {guides?.x.map((line) => (
        <div
          key={`x-${line}`}
          data-testid='canvas-snap-guide'
          className='pointer-events-none absolute w-px bg-primary'
          style={{
            left: (guides.parent.x + line - rect.x) * scale,
            top: (guides.parent.y - rect.y) * scale,
            height: guides.parent.height * scale,
          }}
        />
      ))}
      {guides?.y.map((line) => (
        <div
          key={`y-${line}`}
          data-testid='canvas-snap-guide'
          className='pointer-events-none absolute h-px bg-primary'
          style={{
            top: (guides.parent.y + line - rect.y) * scale,
            left: (guides.parent.x - rect.x) * scale,
            width: guides.parent.width * scale,
          }}
        />
      ))}
    </>
  )
}
