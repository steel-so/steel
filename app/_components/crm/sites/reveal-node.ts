import {
  elementOf,
  type FrameHandle,
} from '@/app/_components/canvas/lib/frame-handle'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'

const SCROLL_RETRY_MS = [0, 150, 500]

/**
 * Selects a block of the open document and scrolls it into view. The frame
 * may still be painting right after a page switch, so the scroll is retried
 * a few times until the element exists. Returns `false` when the block is
 * not in the document (deleted since the checklist ran).
 */
export function revealNode(
  store: CanvasStore,
  frame: FrameHandle,
  nodeId: string,
): boolean {
  if (!getNode(store.getState().doc, nodeId)) return false
  store.select(nodeId)
  for (const delay of SCROLL_RETRY_MS) {
    setTimeout(() => {
      elementOf(frame, nodeId)?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      })
    }, delay)
  }
  return true
}
