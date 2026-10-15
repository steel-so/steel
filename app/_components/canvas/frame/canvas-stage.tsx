'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCanvasEditor } from '../editor-context'
import { useCanvasStore } from '../use-canvas'
import { CanvasFrame } from './canvas-frame'
import { CanvasOverlay } from './canvas-overlay'

const STAGE_PADDING = 40

export const DEFAULT_VIEWPORTS = { base: 1200, tablet: 768, mobile: 375 }

/** Zoom that fits `width` in the available space (never above 100%). */
export function fitZoom(width: number, available: number): number {
  if (available <= 0) return 1
  return Math.max(0.1, Math.min(1, (available - STAGE_PADDING * 2) / width))
}

/**
 * The scrollable workspace around the canvas: centers the iframe at the
 * breakpoint's width, applies the zoom and hosts the editing overlay.
 */
export function CanvasStage() {
  const { store, frame, props } = useCanvasEditor()
  const breakpoint = useCanvasStore((state) => state.breakpoint)
  const zoom = useCanvasStore((state) => state.zoom)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState({ width: 0, height: 0 })
  const width =
    props.viewportWidths[breakpoint] ?? DEFAULT_VIEWPORTS[breakpoint]
  const [frameHeight, setFrameHeight] = useState(0)

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    frame.scroller = scroller
    const observer = new ResizeObserver(([entry]) => {
      setAvailable({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(scroller)
    return () => {
      observer.disconnect()
      frame.scroller = null
    }
  }, [frame])

  // Open (and switch breakpoints) at the zoom where the page fits.
  useEffect(() => {
    if (available.width === 0) return
    store.setZoom(fitZoom(width, available.width))
  }, [width, available.width > 0])

  useLayoutEffect(() => {
    frame.scale = zoom
    frame.notify()
  }, [zoom, frame])

  // Height of the iframe = its content; observed through the frame handle.
  useEffect(
    () =>
      frame.subscribe(() => {
        const height = frame.iframe?.offsetHeight ?? 0
        setFrameHeight((prev) => (prev === height ? prev : height))
      }),
    [frame],
  )

  const minHeight = Math.max(
    320,
    (available.height - STAGE_PADDING * 2) / Math.max(zoom, 0.1),
  )
  const height = Math.max(frameHeight, minHeight)

  return (
    <div
      ref={scrollerRef}
      data-testid='canvas-stage'
      className='relative h-full min-h-0 overflow-auto bg-muted/60 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px] dark:bg-muted/30'
      onPointerDown={(event) => {
        if (
          event.target === event.currentTarget ||
          (event.target as HTMLElement).dataset.stageGutter !== undefined
        ) {
          store.setEditingText(null)
          store.select(null)
        }
      }}
    >
      <div
        data-stage-gutter=''
        className='flex min-h-full min-w-fit justify-center'
        style={{ padding: STAGE_PADDING }}
      >
        <div
          className='relative shrink-0'
          style={{ width: width * zoom, height: height * zoom }}
        >
          <div
            className='absolute top-0 left-0 overflow-hidden rounded-sm shadow-[0_1px_3px_rgb(0_0_0/0.08),0_8px_24px_-8px_rgb(0_0_0/0.18)] ring-1 ring-foreground/10'
            style={{
              width,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            <CanvasFrame width={width} minHeight={minHeight} />
          </div>
          <CanvasOverlay />
        </div>
      </div>
    </div>
  )
}
