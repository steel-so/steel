import type { TourPlacement } from './types'

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Space between the highlighted element and the card. */
export const TOUR_GAP = 14
/** Minimum distance between the card and the edges of the screen. */
export const TOUR_MARGIN = 12

const ORDER: readonly TourPlacement[] = ['bottom', 'top', 'right', 'left']

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

function candidate(
  side: TourPlacement,
  target: Box,
  card: Size,
): { top: number; left: number } {
  const centerX = target.left + target.width / 2 - card.width / 2
  const centerY = target.top + target.height / 2 - card.height / 2
  if (side === 'bottom') {
    return { top: target.top + target.height + TOUR_GAP, left: centerX }
  }
  if (side === 'top') {
    return { top: target.top - card.height - TOUR_GAP, left: centerX }
  }
  if (side === 'right') {
    return { top: centerY, left: target.left + target.width + TOUR_GAP }
  }
  return { top: centerY, left: target.left - card.width - TOUR_GAP }
}

function fits(
  side: TourPlacement,
  position: { top: number; left: number },
  card: Size,
  viewport: Size,
): boolean {
  if (side === 'bottom' || side === 'top') {
    return (
      position.top >= TOUR_MARGIN &&
      position.top + card.height <= viewport.height - TOUR_MARGIN
    )
  }
  return (
    position.left >= TOUR_MARGIN &&
    position.left + card.width <= viewport.width - TOUR_MARGIN
  )
}

/**
 * Where the tour card goes. Without a target it sits in the middle of the
 * screen. With one, it takes the preferred side when the card fits there,
 * then the other sides; when none fits (the target fills the screen) it
 * docks at the bottom. The result never leaves the screen.
 */
export function placeTourCard(
  target: Box | null,
  card: Size,
  viewport: Size,
  preferred?: TourPlacement,
): { top: number; left: number } {
  const maxLeft = viewport.width - card.width - TOUR_MARGIN
  const maxTop = viewport.height - card.height - TOUR_MARGIN

  if (!target) {
    return {
      top: clamp((viewport.height - card.height) / 2, TOUR_MARGIN, maxTop),
      left: clamp((viewport.width - card.width) / 2, TOUR_MARGIN, maxLeft),
    }
  }

  const sides = preferred
    ? [preferred, ...ORDER.filter((side) => side !== preferred)]
    : ORDER
  for (const side of sides) {
    const position = candidate(side, target, card)
    if (!fits(side, position, card, viewport)) continue
    return {
      top: clamp(position.top, TOUR_MARGIN, maxTop),
      left: clamp(position.left, TOUR_MARGIN, maxLeft),
    }
  }

  return {
    top: clamp(maxTop, TOUR_MARGIN, maxTop),
    left: clamp((viewport.width - card.width) / 2, TOUR_MARGIN, maxLeft),
  }
}
