/**
 * Pure geometry of pulling an element's handles ("redimensionar"). Works in
 * the parent's coordinates (frame px, zoom already divided out); the hook
 * converts the result to the units the element stores.
 */
import { SNAP_THRESHOLD, type SnapBox } from './snap'

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface ResizeLimits {
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

export interface ResizeResult {
  box: SnapBox
  /** Guide lines in parent coordinates. */
  guides: { x: number[]; y: number[] }
}

/**
 * Handles an element offers. In the flow only the right/bottom edges (and
 * the corner) can be pulled; a freely positioned child also moves when its
 * left/top edges are pulled, so it gets all of them.
 */
export function handlesFor({
  width,
  height,
  free,
}: {
  width: boolean
  height: boolean
  free: boolean
}): ResizeHandle[] {
  if (width && height) {
    return free
      ? ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
      : ['e', 's', 'se']
  }
  if (width) return free ? ['e', 'w'] : ['e', 'se']
  if (height) return free ? ['n', 's'] : ['s']
  return []
}

const affects = (handle: ResizeHandle) => ({
  east: handle.includes('e'),
  west: handle.includes('w'),
  north: handle.includes('n'),
  south: handle.includes('s'),
})

function snapEdge(
  value: number,
  lines: number[],
  threshold: number,
): { value: number; guide: number | null } {
  let best: { distance: number; line: number } | null = null
  for (const line of lines) {
    const distance = Math.abs(value - line)
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { distance, line }
    }
  }
  return best ? { value: best.line, guide: best.line } : { value, guide: null }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * New box after pulling `handle` by (`dx`, `dy`). The moving edges snap to
 * `lines` (Alt turns it off); `aspect` locks the width/height ratio (Shift
 * passes the starting ratio). The opposite edge stays put.
 */
export function resizeBox({
  handle,
  start,
  dx,
  dy,
  limits,
  lines = { x: [], y: [] },
  aspect = null,
  free = false,
  threshold = SNAP_THRESHOLD,
}: {
  handle: ResizeHandle
  start: SnapBox
  dx: number
  dy: number
  limits: ResizeLimits
  lines?: { x: number[]; y: number[] }
  aspect?: number | null
  /** Skip snapping. */
  free?: boolean
  threshold?: number
}): ResizeResult {
  const { east, west, north, south } = affects(handle)
  const guides: { x: number[]; y: number[] } = { x: [], y: [] }

  let left = start.x + (west ? dx : 0)
  let right = start.x + start.width + (east ? dx : 0)
  let top = start.y + (north ? dy : 0)
  let bottom = start.y + start.height + (south ? dy : 0)

  if (!free) {
    if (east) {
      const snap = snapEdge(right, lines.x, threshold)
      right = snap.value
      if (snap.guide !== null) guides.x.push(snap.guide)
    }
    if (west) {
      const snap = snapEdge(left, lines.x, threshold)
      left = snap.value
      if (snap.guide !== null) guides.x.push(snap.guide)
    }
    if (south) {
      const snap = snapEdge(bottom, lines.y, threshold)
      bottom = snap.value
      if (snap.guide !== null) guides.y.push(snap.guide)
    }
    if (north) {
      const snap = snapEdge(top, lines.y, threshold)
      top = snap.value
      if (snap.guide !== null) guides.y.push(snap.guide)
    }
  }

  let width = clamp(right - left, limits.minWidth, limits.maxWidth)
  let height = clamp(bottom - top, limits.minHeight, limits.maxHeight)

  if (aspect && aspect > 0) {
    const horizontal = east || west
    const vertical = north || south
    if (horizontal && vertical) {
      // Corner: the axis pulled further decides.
      const byWidth =
        Math.abs(width / Math.max(start.width, 1) - 1) >=
        Math.abs(height / Math.max(start.height, 1) - 1)
      if (byWidth) height = width / aspect
      else width = height * aspect
    } else if (horizontal) {
      height = width / aspect
    } else {
      width = height * aspect
    }
    // Keep the ratio inside the limits.
    if (width > limits.maxWidth) {
      width = limits.maxWidth
      height = width / aspect
    }
    if (width < limits.minWidth) {
      width = limits.minWidth
      height = width / aspect
    }
    if (height > limits.maxHeight) {
      height = limits.maxHeight
      width = height * aspect
    }
    if (height < limits.minHeight) {
      height = limits.minHeight
      width = height * aspect
    }
  }

  width = Math.round(width)
  height = Math.round(height)
  const x = west
    ? Math.round(start.x + start.width - width)
    : Math.round(start.x)
  const y = north
    ? Math.round(start.y + start.height - height)
    : Math.round(start.y)
  return { box: { x, y, width, height }, guides }
}
