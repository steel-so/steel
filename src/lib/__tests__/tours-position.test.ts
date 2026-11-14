import { describe, expect, it } from 'vitest'
import { placeTourCard, TOUR_GAP, TOUR_MARGIN } from '../tours/position'

const viewport = { width: 1280, height: 800 }
const card = { width: 340, height: 200 }

describe('placeTourCard()', () => {
  it('should center the card when there is no target', () => {
    expect(placeTourCard(null, card, viewport)).toEqual({
      top: 300,
      left: 470,
    })
  })

  it('should go below the target by default, centered on it', () => {
    const target = { top: 100, left: 500, width: 100, height: 40 }

    expect(placeTourCard(target, card, viewport)).toEqual({
      top: 140 + TOUR_GAP,
      left: 380,
    })
  })

  it('should honor the preferred side when it fits', () => {
    const target = { top: 300, left: 100, width: 60, height: 200 }

    expect(placeTourCard(target, card, viewport, 'right')).toEqual({
      top: 300,
      left: 160 + TOUR_GAP,
    })
  })

  it('should flip to another side when the preferred one does not fit', () => {
    const target = { top: 720, left: 500, width: 100, height: 40 }

    const position = placeTourCard(target, card, viewport, 'bottom')

    expect(position.top).toBe(720 - card.height - TOUR_GAP)
  })

  it('should keep the card inside the screen next to an edge', () => {
    const target = { top: 10, left: 1240, width: 30, height: 30 }

    const position = placeTourCard(target, card, viewport)

    expect(position.left).toBe(viewport.width - card.width - TOUR_MARGIN)
    expect(position.top).toBe(40 + TOUR_GAP)
  })

  it('should dock at the bottom when the target fills the screen', () => {
    const target = { top: 0, left: 0, width: 1280, height: 800 }

    expect(placeTourCard(target, card, viewport)).toEqual({
      top: viewport.height - card.height - TOUR_MARGIN,
      left: 470,
    })
  })

  it('should never leave a screen smaller than the card', () => {
    const position = placeTourCard(
      { top: 50, left: 20, width: 100, height: 40 },
      card,
      { width: 320, height: 180 },
    )

    expect(position).toEqual({ top: TOUR_MARGIN, left: TOUR_MARGIN })
  })
})
