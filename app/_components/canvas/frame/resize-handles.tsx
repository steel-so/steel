'use client'

import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { getNode, parentOf } from '@/src/lib/canvas/ops'
import { getIn } from '@/src/lib/canvas/path'
import type { Resizable } from '@/src/lib/canvas/registry'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { useCanvasEditor } from '../editor-context'
import type { Rect } from '../lib/drop-target'
import { writeField } from '../lib/fields'
import { boxElementOf, elementOf } from '../lib/frame-handle'
import {
  handlesFor,
  type ResizeHandle,
  type ResizeLimits,
  resizeBox,
} from '../lib/resize'
import {
  freeContext,
  isResponsivePath,
  writeFreePosition,
} from '../lib/resize-write'
import { snapLines } from '../lib/snap'
import { boxIn } from './free-drag'

interface ResizeSession {
  pointerId: number
  handle: ResizeHandle
  start: { x: number; y: number }
  box: { x: number; y: number; width: number; height: number }
  parentWidth: number
  limits: ResizeLimits
  lines: { x: number[]; y: number[] }
  ratio: number
  moved: boolean
}

interface Guides {
  parent: Rect
  x: number[]
  y: number[]
}

const HANDLE_CLASS: Record<ResizeHandle, string> = {
  n: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
  s: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
  e: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  w: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  ne: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  nw: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  sw: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
}

const HANDLE_LABEL: Record<ResizeHandle, string> = {
  n: 'Alterar a altura pela borda de cima',
  s: 'Alterar a altura',
  e: 'Alterar a largura',
  w: 'Alterar a largura pela borda da esquerda',
  ne: 'Redimensionar pelo canto superior direito',
  nw: 'Redimensionar pelo canto superior esquerdo',
  se: 'Redimensionar',
  sw: 'Redimensionar pelo canto inferior esquerdo',
}

/** Fractions of the parent width the width snaps to in the flow. */
const FLOW_WIDTH_STEPS = [1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25]

const round1 = (value: number) => Math.round(value * 10) / 10

/** Limits in px for the box being pulled. A dimension the element does not
 * store stays fixed (or follows the aspect ratio). */
function limitsFor(
  resizable: Resizable,
  start: { width: number; height: number },
  parentWidth: number,
): ResizeLimits {
  const toPx = (value: number) =>
    resizable.widthUnit === '%' ? (value / 100) * parentWidth : value
  return {
    minWidth: resizable.widthPath
      ? toPx(resizable.min.width ?? 8)
      : start.width,
    maxWidth: resizable.widthPath
      ? toPx(resizable.max.width ?? 10000)
      : start.width,
    minHeight: resizable.heightPath ? (resizable.min.height ?? 4) : 1,
    maxHeight: resizable.heightPath ? (resizable.max.height ?? 10000) : 100000,
  }
}

/**
 * Pull handles over the selection box of a resizable element. Dragging
 * writes the size to the paths declared in `resizable` (and `x`/`y` when a
 * freely positioned child is pulled from its left/top edge); Shift keeps
 * the aspect ratio, Alt turns snapping off. The whole drag is one undo step.
 */
export function ResizeHandles({
  id,
  resizable,
  rect,
  scale,
}: {
  id: CanvasNodeId
  resizable: Resizable
  /** Current box of the node, in frame coordinates. */
  rect: Rect
  scale: number
}) {
  const { frame, store, catalog } = useCanvasEditor()
  const session = useRef<ResizeSession | null>(null)
  const gestureId = useRef('')
  const [guides, setGuides] = useState<Guides | null>(null)
  const [active, setActive] = useState(false)

  const free = freeContext(store, catalog, id)
  const handles = handlesFor({
    width: !!resizable.widthPath,
    height: !!resizable.heightPath,
    free: free !== null,
  })
  if (handles.length === 0) return null

  const parentElement = () => {
    const parentId = parentOf(store.getState().doc, id)
    return (
      (parentId ? elementOf(frame, parentId) : null) ??
      elementOf(frame, id)?.parentElement ??
      null
    )
  }

  const write = (
    box: { x: number; y: number; width: number; height: number },
    parentWidth: number,
    handle: ResizeHandle,
    first: boolean,
  ) => {
    const { doc, breakpoint } = store.getState()
    const node = getNode(doc, id)
    if (!node) return
    const definition = catalog.components[node.type]
    const set: Record<string, unknown> = {}
    const put = (path: string, next: unknown) => {
      set[path] = writeField(
        getIn(node.props, path),
        {
          path,
          label: '',
          control: { kind: 'number' },
          responsive: isResponsivePath(definition, path),
        },
        breakpoint,
        next,
      )
    }
    if (resizable.widthPath) {
      const percent = resizable.widthUnit === '%'
      const raw = percent
        ? round1((box.width / Math.max(parentWidth, 1)) * 100)
        : box.width
      const min = resizable.min.width ?? 0
      const max = resizable.max.width ?? Number.POSITIVE_INFINITY
      const value = Math.min(max, Math.max(min, raw))
      put(
        resizable.widthPath,
        resizable.widthFormat === 'size'
          ? { value, unit: resizable.widthUnit ?? 'px' }
          : value,
      )
    }
    if (resizable.heightPath) {
      const max = resizable.max.height ?? Number.POSITIVE_INFINITY
      put(
        resizable.heightPath,
        Math.min(max, Math.max(resizable.min.height ?? 0, box.height)),
      )
    }
    if (Object.keys(set).length > 0) {
      // One drag is one undo step, however long the pointer rests.
      if (first) {
        gestureId.current = `resize-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`
      }
      store.dispatch(
        { kind: 'update', id, set },
        { label: 'resize', gesture: gestureId.current },
      )
    }
    if (free && (handle.includes('w') || handle.includes('n'))) {
      writeFreePosition(store, id, free.childPath, {
        x: handle.includes('w') ? box.x : undefined,
        y: handle.includes('n') ? box.y : undefined,
      })
    }
  }

  const onPointerDown =
    (handle: ResizeHandle) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      const element = elementOf(frame, id)
      const parent = parentElement()
      if (!element || !parent) return
      event.preventDefault()
      event.stopPropagation()
      // The visible box (an image can be narrower than its wrapper).
      const box = boxIn(boxElementOf(frame, id) ?? element, parent)
      const flowLeft = boxIn(element, parent).x
      const parentWidth = parent.clientWidth
      let lines: { x: number[]; y: number[] }
      if (free) {
        const siblings = (
          getNode(store.getState().doc, free.parentId)?.children ?? []
        )
          .filter((child) => child !== id)
          .map((child) => elementOf(frame, child))
          .filter((sibling): sibling is HTMLElement => sibling !== null)
          .map((sibling) => boxIn(sibling, parent))
        lines = snapLines(
          { width: parentWidth, height: parent.clientHeight },
          siblings,
        )
      } else {
        // In the flow the width snaps to full / three quarters / half…
        lines = {
          x: FLOW_WIDTH_STEPS.map((step) => flowLeft + parentWidth * step),
          y: [],
        }
      }
      session.current = {
        pointerId: event.pointerId,
        handle,
        start: { x: event.clientX, y: event.clientY },
        box,
        parentWidth,
        limits: limitsFor(resizable, box, parentWidth),
        lines,
        ratio: box.width / Math.max(box.height, 1),
        moved: false,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setActive(true)
    }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = session.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = (event.clientX - drag.start.x) / scale
    const dy = (event.clientY - drag.start.y) / scale
    if (!drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
    const first = !drag.moved
    drag.moved = true
    // Width-only elements (images) keep their ratio: the height follows.
    const followsWidth = !!resizable.widthPath && !resizable.heightPath
    const aspect =
      resizable.aspect ?? (followsWidth || event.shiftKey ? drag.ratio : null)
    const result = resizeBox({
      handle: drag.handle,
      start: drag.box,
      dx,
      dy: followsWidth ? 0 : dy,
      limits: drag.limits,
      lines: drag.lines,
      aspect,
      free: event.altKey,
    })
    write(result.box, drag.parentWidth, drag.handle, first)
    const parent = parentElement()
    if (parent) {
      const box = parent.getBoundingClientRect()
      setGuides({
        parent: {
          x: box.left + parent.clientLeft,
          y: box.top + parent.clientTop,
          width: parent.clientWidth,
          height: parent.clientHeight,
        },
        ...result.guides,
      })
    }
  }

  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (session.current?.pointerId !== event.pointerId) return
    session.current = null
    setGuides(null)
    setActive(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return (
    <>
      {handles.map((handle) => (
        <button
          key={handle}
          type='button'
          data-testid={`canvas-resize-${handle}`}
          aria-label={HANDLE_LABEL[handle]}
          title='Arraste para mudar o tamanho (Shift mantém a proporção, Alt desliga o alinhamento)'
          className={cn(
            'group/handle pointer-events-auto absolute z-10 flex size-4 touch-none items-center justify-center focus-visible:outline-none',
            HANDLE_CLASS[handle],
          )}
          onPointerDown={onPointerDown(handle)}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
        >
          <span className='size-2.5 rounded-[3px] border-2 border-primary bg-background shadow-sm transition-transform group-hover/handle:scale-125 group-focus-visible/handle:ring-2 group-focus-visible/handle:ring-primary/50' />
        </button>
      ))}
      {active && (
        <span
          data-testid='canvas-resize-hint'
          className='pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[11px] leading-none font-medium whitespace-nowrap text-background tabular-nums shadow-sm'
        >
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      )}
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
