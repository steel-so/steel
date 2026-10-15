/**
 * Snapping of a freely positioned child ("posição livre") while it is
 * dragged inside its container. Pure geometry in the container's
 * coordinates: the child's start, center and end are compared with the
 * guide lines (container edges and center, siblings' edges and centers);
 * the closest one within `threshold` wins and is drawn as a guide.
 */

export interface SnapBox {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapResult {
  x: number
  y: number
  /** Guide lines in container coordinates (vertical at `x`, horizontal at `y`). */
  guides: { x: number[]; y: number[] }
}

/** Default snapping distance, in canvas px. */
export const SNAP_THRESHOLD = 6

/** Guide lines of the container (edges, center) and of the siblings. */
export function snapLines(
  container: { width: number; height: number },
  siblings: SnapBox[],
): { x: number[]; y: number[] } {
  const x = [0, container.width / 2, container.width]
  const y = [0, container.height / 2, container.height]
  for (const box of siblings) {
    x.push(box.x, box.x + box.width / 2, box.x + box.width)
    y.push(box.y, box.y + box.height / 2, box.y + box.height)
  }
  return { x, y }
}

function snapAxis(
  start: number,
  size: number,
  lines: number[],
  threshold: number,
): { value: number; guide: number | null } {
  let best: { distance: number; value: number; guide: number } | null = null
  for (const anchor of [0, size / 2, size]) {
    for (const line of lines) {
      const distance = Math.abs(start + anchor - line)
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { distance, value: line - anchor, guide: line }
      }
    }
  }
  return best
    ? { value: best.value, guide: best.guide }
    : { value: start, guide: null }
}

/** Snaps `box` (already moved) to the lines; `free` skips snapping (Alt
 * held). Positions are rounded to whole pixels. */
export function snapBox(
  box: SnapBox,
  lines: { x: number[]; y: number[] },
  { threshold = SNAP_THRESHOLD, free = false } = {},
): SnapResult {
  if (free) {
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      guides: { x: [], y: [] },
    }
  }
  const x = snapAxis(box.x, box.width, lines.x, threshold)
  const y = snapAxis(box.y, box.height, lines.y, threshold)
  return {
    x: Math.round(x.value),
    y: Math.round(y.value),
    guides: {
      x: x.guide === null ? [] : [x.guide],
      y: y.guide === null ? [] : [y.guide],
    },
  }
}
