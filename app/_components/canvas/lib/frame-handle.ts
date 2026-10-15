import type { CanvasNodeId } from '@/src/lib/canvas/types'
import type { Rect } from './drop-target'
import type { InlineEditorState } from './inline'

/**
 * Live handle on the canvas iframe, shared by the overlay, the drag logic and
 * the inline text editor. Mutable on purpose (DOM refs); `notify()` bumps
 * `version` so subscribers re-measure after a resize, zoom or scroll.
 */
export interface FrameHandle {
  iframe: HTMLIFrameElement | null
  /** The iframe's document once it is ready. */
  document: Document | null
  /** Scrollable viewport around the stage (auto-scroll while dragging). */
  scroller: HTMLElement | null
  /** Current zoom applied to the iframe. */
  scale: number
  /** Open inline text editor (floating toolbar). */
  inline: InlineEditorState | null
  version: number
  subscribe(listener: () => void): () => void
  getVersion(): number
  notify(): void
}

export function createFrameHandle(): FrameHandle {
  const listeners = new Set<() => void>()
  const handle: FrameHandle = {
    iframe: null,
    document: null,
    scroller: null,
    scale: 1,
    inline: null,
    version: 0,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getVersion: () => handle.version,
    notify() {
      handle.version++
      for (const listener of [...listeners]) listener()
    },
  }
  return handle
}

const attr = (id: CanvasNodeId) =>
  `[data-canvas-id="${id.replace(/["\\]/g, '\\$&')}"]`

export function elementOf(
  handle: FrameHandle,
  id: CanvasNodeId,
): HTMLElement | null {
  return handle.document?.querySelector<HTMLElement>(attr(id)) ?? null
}

/** Node box in frame coordinates (the iframe never scrolls: it is as tall
 * as its content and the stage scrolls instead). */
export function frameRectOf(
  handle: FrameHandle,
  id: CanvasNodeId,
): Rect | null {
  const element = elementOf(handle, id)
  if (!element) return null
  const box = element.getBoundingClientRect()
  return { x: box.left, y: box.top, width: box.width, height: box.height }
}

/** Node id at an element (the closest `data-canvas-id` ancestor). */
export function nodeIdAt(target: EventTarget | null): CanvasNodeId | null {
  const element =
    target && (target as Node).nodeType === 1
      ? (target as Element)
      : ((target as Node | null)?.parentElement ?? null)
  const owner = element?.closest('[data-canvas-id]')
  return owner?.getAttribute('data-canvas-id') ?? null
}

/** Parent-document point → frame coordinates; `null` outside the iframe. */
export function toFramePoint(
  handle: FrameHandle,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const iframe = handle.iframe
  if (!iframe) return null
  const box = iframe.getBoundingClientRect()
  if (
    clientX < box.left ||
    clientX > box.right ||
    clientY < box.top ||
    clientY > box.bottom
  ) {
    return null
  }
  return {
    x: (clientX - box.left) / handle.scale,
    y: (clientY - box.top) / handle.scale,
  }
}
