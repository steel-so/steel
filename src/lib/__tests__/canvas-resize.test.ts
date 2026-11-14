import { describe, expect, it } from 'vitest'
import { handlesFor, resizeBox } from '@/app/_components/canvas/lib/resize'

const limits = {
  minWidth: 20,
  maxWidth: 400,
  minHeight: 10,
  maxHeight: 300,
}
const start = { x: 10, y: 20, width: 200, height: 100 }

describe('handlesFor', () => {
  it('offers only the right/bottom edges in the flow', () => {
    expect(handlesFor({ width: true, height: true, free: false })).toEqual([
      'e',
      's',
      'se',
    ])
    expect(handlesFor({ width: true, height: false, free: false })).toEqual([
      'e',
      'se',
    ])
    expect(handlesFor({ width: false, height: true, free: false })).toEqual([
      's',
    ])
  })

  it('offers every edge to a freely positioned element', () => {
    expect(handlesFor({ width: true, height: true, free: true })).toHaveLength(
      8,
    )
    expect(handlesFor({ width: true, height: false, free: true })).toEqual([
      'e',
      'w',
    ])
    expect(handlesFor({ width: false, height: true, free: true })).toEqual([
      'n',
      's',
    ])
  })

  it('offers nothing when no dimension is stored', () => {
    expect(handlesFor({ width: false, height: false, free: true })).toEqual([])
  })
})

describe('resizeBox', () => {
  it('grows from the east edge keeping the origin', () => {
    const { box } = resizeBox({
      handle: 'e',
      start,
      dx: 50,
      dy: 0,
      limits,
      free: true,
    })
    expect(box).toEqual({ x: 10, y: 20, width: 250, height: 100 })
  })

  it('moves the origin when pulled from the west edge', () => {
    const { box } = resizeBox({
      handle: 'w',
      start,
      dx: -30,
      dy: 0,
      limits,
      free: true,
    })
    expect(box).toEqual({ x: -20, y: 20, width: 230, height: 100 })
  })

  it('pulls from the north edge', () => {
    const { box } = resizeBox({
      handle: 'n',
      start,
      dx: 0,
      dy: -40,
      limits,
      free: true,
    })
    expect(box).toEqual({ x: 10, y: -20, width: 200, height: 140 })
  })

  it('clamps to the limits', () => {
    expect(
      resizeBox({ handle: 'e', start, dx: 900, dy: 0, limits, free: true }).box
        .width,
    ).toBe(400)
    expect(
      resizeBox({ handle: 'e', start, dx: -900, dy: 0, limits, free: true }).box
        .width,
    ).toBe(20)
    expect(
      resizeBox({ handle: 's', start, dx: 0, dy: 900, limits, free: true }).box
        .height,
    ).toBe(300)
  })

  it('snaps the moving edge to a guide line and reports it', () => {
    const result = resizeBox({
      handle: 'e',
      start,
      dx: 93,
      dy: 0,
      limits,
      lines: { x: [300], y: [] },
    })
    expect(result.box.width).toBe(290)
    expect(result.guides.x).toEqual([300])
  })

  it('does not snap when free is set', () => {
    const result = resizeBox({
      handle: 'e',
      start,
      dx: 93,
      dy: 0,
      limits,
      lines: { x: [300], y: [] },
      free: true,
    })
    expect(result.box.width).toBe(293)
    expect(result.guides.x).toEqual([])
  })

  it('snaps the bottom and top edges to horizontal guides', () => {
    const south = resizeBox({
      handle: 's',
      start,
      dx: 0,
      dy: 57,
      limits,
      lines: { x: [], y: [180] },
    })
    expect(south.box.height).toBe(160)
    expect(south.guides.y).toEqual([180])
    const north = resizeBox({
      handle: 'n',
      start,
      dx: 0,
      dy: -17,
      limits,
      lines: { x: [], y: [0] },
    })
    expect(north.box.y).toBe(0)
    expect(north.guides.y).toEqual([0])
    const west = resizeBox({
      handle: 'w',
      start,
      dx: -8,
      dy: 0,
      limits,
      lines: { x: [0], y: [] },
    })
    expect(west.box.x).toBe(0)
    expect(west.guides.x).toEqual([0])
  })

  it('keeps the aspect ratio from a corner', () => {
    const { box } = resizeBox({
      handle: 'se',
      start,
      dx: 100,
      dy: 5,
      limits,
      aspect: 2,
      free: true,
    })
    expect(box.width).toBe(300)
    expect(box.height).toBe(150)
  })

  it('lets the vertical pull decide a corner when it is larger', () => {
    const { box } = resizeBox({
      handle: 'se',
      start,
      dx: 2,
      dy: 100,
      limits,
      aspect: 2,
      free: true,
    })
    expect(box.height).toBe(200)
    expect(box.width).toBe(400)
  })

  it('derives the height from the width on a side edge with an aspect', () => {
    const { box } = resizeBox({
      handle: 'e',
      start,
      dx: 100,
      dy: 0,
      limits,
      aspect: 2,
      free: true,
    })
    expect(box).toEqual({ x: 10, y: 20, width: 300, height: 150 })
    const vertical = resizeBox({
      handle: 's',
      start,
      dx: 0,
      dy: 50,
      limits,
      aspect: 2,
      free: true,
    })
    expect(vertical.box.width).toBe(300)
  })

  it('keeps the ratio inside the limits', () => {
    const wide = resizeBox({
      handle: 'e',
      start,
      dx: 900,
      dy: 0,
      limits: { ...limits, maxHeight: 100 },
      aspect: 2,
      free: true,
    })
    expect(wide.box).toMatchObject({ width: 200, height: 100 })
    const narrow = resizeBox({
      handle: 'e',
      start,
      dx: -900,
      dy: 0,
      limits: { ...limits, minWidth: 40 },
      aspect: 2,
      free: true,
    })
    expect(narrow.box).toMatchObject({ width: 40, height: 20 })
    const short = resizeBox({
      handle: 's',
      start,
      dx: 0,
      dy: -900,
      limits: { ...limits, minHeight: 50, minWidth: 1 },
      aspect: 2,
      free: true,
    })
    expect(short.box).toMatchObject({ width: 100, height: 50 })
    const wideMax = resizeBox({
      handle: 'e',
      start,
      dx: 900,
      dy: 0,
      limits: { ...limits, maxWidth: 1000, maxHeight: 150 },
      aspect: 2,
      free: true,
    })
    expect(wideMax.box).toMatchObject({ width: 300, height: 150 })
  })

  it('anchors the opposite corner when pulled from the north-west', () => {
    const { box } = resizeBox({
      handle: 'nw',
      start,
      dx: -20,
      dy: -10,
      limits,
      free: true,
    })
    expect(box).toEqual({ x: -10, y: 10, width: 220, height: 110 })
  })
})
