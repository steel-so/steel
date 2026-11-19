'use client'

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'
import { FONT_STACKS } from '@/src/lib/banners/document'
import {
  type Box,
  fitScale,
  type Guides,
  HANDLES,
  type Handle,
  resizeBox,
  snapMove,
} from '@/src/lib/banners/geometry'
import { renderFormat } from '@/src/lib/banners/render'
import type {
  BannerElement,
  BannerFormat,
} from '@/src/schemas/crm-banner.schema'

type Gesture =
  | {
      kind: 'move'
      id: string
      startX: number
      startY: number
      box: Box
      started: boolean
    }
  | {
      kind: 'resize'
      id: string
      handle: Handle
      startX: number
      startY: number
      box: Box
      started: boolean
    }

const HANDLE_POSITION: Record<Handle, string> = {
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  n: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  s: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
  sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
}

/**
 * The artboard: the canvas preview of one format plus a DOM layer for
 * selecting, dragging (with snapping guides), resizing and editing text in
 * place. Geometry changes come out through `onPatch`; `onGestureStart` fires
 * once per drag so the editor makes it a single undo step.
 */
export function BannerStage({
  format,
  images,
  fontsReady,
  selectedId,
  zoom,
  onSelect,
  onGestureStart,
  onPatch,
}: {
  format: BannerFormat
  images: ReadonlyMap<string, HTMLImageElement>
  fontsReady: boolean
  selectedId: string | null
  zoom: number
  onSelect: (id: string | null) => void
  onGestureStart: () => void
  onPatch: (id: string, patch: Record<string, unknown>) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [available, setAvailable] = useState({ width: 0, height: 0 })
  const [guides, setGuides] = useState<Guides>({ vertical: [], horizontal: [] })
  const [editingId, setEditingId] = useState<string | null>(null)
  const gesture = useRef<Gesture | null>(null)

  const fit = fitScale(format, available)
  const scale = Math.max(0.05, fit * zoom)
  const width = format.width * scale
  const height = format.height * scale

  // Latest props for the window-level pointer listeners.
  const latest = useRef({ format, scale, onPatch, onGestureStart })
  latest.current = { format, scale, onPatch, onGestureStart }

  useLayoutEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const measure = () =>
      setAvailable({
        width: Math.max(0, node.clientWidth - 48),
        height: Math.max(0, node.clientHeight - 48),
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    renderFormat(ctx, format, {
      scale: scale * ratio,
      images,
      placeholders: true,
      skipIds: editingId ? new Set([editingId]) : undefined,
    })
    void fontsReady
  }, [format, images, scale, width, height, editingId, fontsReady])

  function beginMove(event: ReactPointerEvent, element: BannerElement) {
    event.stopPropagation()
    onSelect(element.id)
    if (element.locked || editingId) return
    gesture.current = {
      kind: 'move',
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      box: { x: element.x, y: element.y, w: element.w, h: element.h },
      started: false,
    }
    attach()
  }

  function beginResize(
    event: ReactPointerEvent,
    element: BannerElement,
    handle: Handle,
  ) {
    event.stopPropagation()
    event.preventDefault()
    gesture.current = {
      kind: 'resize',
      id: element.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      box: { x: element.x, y: element.y, w: element.w, h: element.h },
      started: false,
    }
    attach()
  }

  function attach() {
    const onMove = (event: PointerEvent) => {
      const current = gesture.current
      if (!current) return
      const {
        format: f,
        scale: s,
        onPatch: patch,
        onGestureStart: start,
      } = latest.current
      const dx = (event.clientX - current.startX) / s
      const dy = (event.clientY - current.startY) / s
      // The undo step starts with the first real movement, not the click.
      if (!current.started && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
        current.started = true
        start()
      }
      if (!current.started) return
      if (current.kind === 'move') {
        const others = f.elements
          .filter((e) => e.id !== current.id && !e.hidden)
          .map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }))
        const snapped = event.altKey
          ? {
              x: current.box.x + dx,
              y: current.box.y + dy,
              guides: { vertical: [], horizontal: [] } as Guides,
            }
          : snapMove(
              current.box,
              current.box.x + dx,
              current.box.y + dy,
              f,
              others,
              6 / s,
            )
        setGuides(snapped.guides)
        patch(current.id, {
          x: Math.round(snapped.x * 100) / 100,
          y: Math.round(snapped.y * 100) / 100,
        })
      } else {
        const next = resizeBox(
          current.box,
          current.handle,
          dx,
          dy,
          event.shiftKey,
        )
        patch(current.id, {
          x: Math.round(next.x * 100) / 100,
          y: Math.round(next.y * 100) / 100,
          w: Math.round(next.w * 100) / 100,
          h: Math.round(next.h * 100) / 100,
        })
      }
    }
    const onUp = () => {
      gesture.current = null
      setGuides({ vertical: [], horizontal: [] })
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const editing = editingId
    ? format.elements.find((element) => element.id === editingId)
    : undefined

  return (
    <div
      ref={wrapRef}
      data-testid='banner-stage'
      className='flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-6'
      onPointerDown={() => {
        setEditingId(null)
        onSelect(null)
      }}
    >
      <div
        className='relative shrink-0 shadow-md ring-1 ring-border'
        style={{ width, height }}
      >
        <canvas
          ref={canvasRef}
          style={{ width, height }}
          className='block'
          aria-label={`Banner ${format.width} por ${format.height}`}
        />

        {/* Hit areas, in painting order so the topmost element wins. */}
        {format.elements.map((element) => {
          if (element.hidden) return null
          const selected = element.id === selectedId
          return (
            <div
              key={element.id}
              data-testid={`banner-element-${element.role}`}
              onPointerDown={(event) => beginMove(event, element)}
              onDoubleClick={() => {
                if (
                  !element.locked &&
                  (element.type === 'text' || element.type === 'button')
                ) {
                  setEditingId(element.id)
                }
              }}
              className={cn(
                'absolute touch-none',
                element.locked ? 'cursor-default' : 'cursor-move',
                selected
                  ? 'outline outline-2 outline-primary'
                  : 'hover:outline hover:outline-1 hover:outline-primary/60',
              )}
              style={{
                left: element.x * scale,
                top: element.y * scale,
                width: element.w * scale,
                height: element.h * scale,
                transform: element.rotation
                  ? `rotate(${element.rotation}deg)`
                  : undefined,
              }}
            >
              {selected && !element.locked && !editingId
                ? HANDLES.map((handle) => (
                    <span
                      key={handle}
                      role='presentation'
                      onPointerDown={(event) =>
                        beginResize(event, element, handle)
                      }
                      className={cn(
                        'absolute size-2.5 rounded-sm border border-primary bg-background',
                        HANDLE_POSITION[handle],
                      )}
                    />
                  ))
                : null}
            </div>
          )
        })}

        {guides.vertical.map((x) => (
          <span
            key={`v${x}`}
            className='pointer-events-none absolute top-0 h-full w-px bg-fuchsia-500'
            style={{ left: x * scale }}
          />
        ))}
        {guides.horizontal.map((y) => (
          <span
            key={`h${y}`}
            className='pointer-events-none absolute left-0 h-px w-full bg-fuchsia-500'
            style={{ top: y * scale }}
          />
        ))}

        {editing && (editing.type === 'text' || editing.type === 'button') ? (
          <textarea
            autoFocus
            aria-label='Editar texto'
            value={editing.text}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onPatch(editing.id, { text: event.target.value })
            }
            onBlur={() => setEditingId(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditingId(null)
              event.stopPropagation()
            }}
            className='absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline outline-2 outline-primary'
            style={{
              left: editing.x * scale,
              top: editing.y * scale,
              width: editing.w * scale,
              height: editing.h * scale,
              fontFamily: FONT_STACKS[editing.fontFamily],
              fontSize: editing.fontSize * scale,
              fontWeight: editing.fontWeight,
              color: editing.color,
              lineHeight: editing.type === 'text' ? editing.lineHeight : 1.2,
              textAlign: editing.type === 'text' ? editing.align : 'center',
              textTransform: editing.uppercase ? 'uppercase' : 'none',
              background:
                editing.type === 'button' ? 'rgba(0,0,0,0.35)' : 'transparent',
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
