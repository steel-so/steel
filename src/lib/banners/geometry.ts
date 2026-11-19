/** Geometry of dragging and resizing elements on the banner stage. */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Guides {
  /** x positions (format px) of vertical guide lines to draw. */
  vertical: number[]
  /** y positions of horizontal guide lines. */
  horizontal: number[]
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const MIN_SIZE = 4

function snapAxis(
  start: number,
  size: number,
  targets: number[],
  threshold: number,
): { value: number; guide: number | null } {
  // The element's near edge, center and far edge against each target.
  const anchors = [0, size / 2, size]
  let best: { value: number; guide: number | null; distance: number } = {
    value: start,
    guide: null,
    distance: threshold + 1,
  }
  for (const anchor of anchors) {
    for (const target of targets) {
      const distance = Math.abs(start + anchor - target)
      if (distance <= threshold && distance < best.distance) {
        best = { value: target - anchor, guide: target, distance }
      }
    }
  }
  return { value: best.value, guide: best.guide }
}

/**
 * Moves `box` to (`x`,`y`), pulling it onto the canvas edges/center and onto
 * the edges/centers of `others` when within `threshold` format pixels.
 */
export function snapMove(
  box: Box,
  x: number,
  y: number,
  canvas: { width: number; height: number },
  others: Box[],
  threshold: number,
): { x: number; y: number; guides: Guides } {
  const xTargets = [0, canvas.width / 2, canvas.width]
  const yTargets = [0, canvas.height / 2, canvas.height]
  for (const other of others) {
    xTargets.push(other.x, other.x + other.w / 2, other.x + other.w)
    yTargets.push(other.y, other.y + other.h / 2, other.y + other.h)
  }
  const sx = snapAxis(x, box.w, xTargets, threshold)
  const sy = snapAxis(y, box.h, yTargets, threshold)
  return {
    x: sx.value,
    y: sy.value,
    guides: {
      vertical: sx.guide === null ? [] : [sx.guide],
      horizontal: sy.guide === null ? [] : [sy.guide],
    },
  }
}

/**
 * Resizes `start` by dragging `handle` by (`dx`,`dy`) format pixels. With
 * `keepAspect` corners keep the original ratio (edges ignore it).
 */
export function resizeBox(
  start: Box,
  handle: Handle,
  dx: number,
  dy: number,
  keepAspect: boolean,
): Box {
  let { x, y, w, h } = start
  const right = start.x + start.w
  const bottom = start.y + start.h

  if (handle.includes('e')) w = start.w + dx
  if (handle.includes('s')) h = start.h + dy
  if (handle.includes('w')) {
    w = start.w - dx
    x = start.x + dx
  }
  if (handle.includes('n')) {
    h = start.h - dy
    y = start.y + dy
  }

  if (keepAspect && handle.length === 2) {
    const ratio = start.w / start.h
    // Follow the axis the pointer moved most.
    if (Math.abs(w - start.w) / start.w >= Math.abs(h - start.h) / start.h) {
      h = w / ratio
    } else {
      w = h * ratio
    }
    if (handle.includes('w')) x = right - w
    if (handle.includes('n')) y = bottom - h
  }

  if (w < MIN_SIZE) {
    if (handle.includes('w')) x = right - MIN_SIZE
    w = MIN_SIZE
  }
  if (h < MIN_SIZE) {
    if (handle.includes('n')) y = bottom - MIN_SIZE
    h = MIN_SIZE
  }
  return { x, y, w, h }
}

/** Largest scale (≤ `max`) that fits the format inside the available area. */
export function fitScale(
  format: { width: number; height: number },
  available: { width: number; height: number },
  max = 3,
): number {
  if (available.width <= 0 || available.height <= 0) return 1
  return Math.min(
    max,
    available.width / format.width,
    available.height / format.height,
  )
}
