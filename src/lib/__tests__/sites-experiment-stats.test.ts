import { describe, expect, it } from 'vitest'
import {
  EXACT_LIMIT,
  experimentResults,
  logBeta,
  logGamma,
  normalCdf,
  probabilityToBeat,
} from '@/src/lib/sites/experiment-stats'

describe('special functions', () => {
  it('computes ln Γ', () => {
    expect(logGamma(1)).toBeCloseTo(0, 10)
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 10)
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10)
    expect(logGamma(0.25)).toBeCloseTo(1.2880225246980774, 8)
    expect(logBeta(2, 3)).toBeCloseTo(Math.log(1 / 12), 10)
  })

  it('computes the normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3)
  })
})

describe('probabilityToBeat', () => {
  it('is one half for identical data', () => {
    expect(
      probabilityToBeat(
        { conversions: 10, visitors: 100 },
        { conversions: 10, visitors: 100 },
      ),
    ).toBeCloseTo(0.5, 6)
    expect(
      probabilityToBeat(
        { conversions: 0, visitors: 0 },
        { conversions: 0, visitors: 0 },
      ),
    ).toBeCloseTo(0.5, 6)
  })

  it('matches the known value of a clear winner', () => {
    // 10% vs 15% on 1000 visitors each: P ≈ 0.9997.
    const p = probabilityToBeat(
      { conversions: 100, visitors: 1000 },
      { conversions: 150, visitors: 1000 },
    )
    expect(p).toBeGreaterThan(0.999)
    expect(p).toBeLessThanOrEqual(1)
    const reverse = probabilityToBeat(
      { conversions: 150, visitors: 1000 },
      { conversions: 100, visitors: 1000 },
    )
    expect(p + reverse).toBeCloseTo(1, 6)
  })

  it('agrees with the normal approximation on large counts', () => {
    const control = { conversions: EXACT_LIMIT + 10, visitors: 100_000 }
    const variant = { conversions: EXACT_LIMIT + 200, visitors: 100_000 }
    const approx = probabilityToBeat(control, variant)
    const exact = probabilityToBeat(
      { conversions: 4000, visitors: 80_000 },
      { conversions: 4152, visitors: 80_000 },
    )
    expect(approx).toBeGreaterThan(0.95)
    expect(exact).toBeGreaterThan(0.95)
    expect(probabilityToBeat(variant, control) + approx).toBeCloseTo(1, 4)
  })

  it('tolerates conversions above visitors', () => {
    const p = probabilityToBeat(
      { conversions: 5, visitors: 3 },
      { conversions: 1, visitors: 3 },
    )
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})

describe('experimentResults', () => {
  it('says there is not enough data yet', () => {
    const results = experimentResults([
      { key: 'A', visitors: 40, conversions: 2 },
      { key: 'B', visitors: 38, conversions: 5 },
    ])
    expect(results.enoughData).toBe(false)
    expect(results.winner).toBeNull()
    expect(results.totals).toEqual({ visitors: 78, conversions: 7 })
    expect(results.variants[0]).toMatchObject({
      rate: 0.05,
      uplift: null,
      probabilityToBeat: null,
    })
    expect(results.variants[1].uplift).toBeCloseTo((5 / 38 - 0.05) / 0.05, 6)
  })

  it('calls a challenger the winner past 95%', () => {
    const results = experimentResults([
      { key: 'A', visitors: 1000, conversions: 100 },
      { key: 'B', visitors: 1000, conversions: 150 },
      { key: 'C', visitors: 1000, conversions: 105 },
    ])
    expect(results.enoughData).toBe(true)
    expect(results.winner).toBe('B')
  })

  it('calls the control the winner when every challenger loses', () => {
    const results = experimentResults([
      { key: 'A', visitors: 1000, conversions: 150 },
      { key: 'B', visitors: 1000, conversions: 90 },
    ])
    expect(results.winner).toBe('A')
  })

  it('stays undecided on a close race', () => {
    const results = experimentResults([
      { key: 'A', visitors: 500, conversions: 50 },
      { key: 'B', visitors: 500, conversions: 52 },
    ])
    expect(results.enoughData).toBe(true)
    expect(results.winner).toBeNull()
  })

  it('handles empty variants and a control without conversions', () => {
    const results = experimentResults([
      { key: 'A', visitors: 0, conversions: 0 },
      { key: 'B', visitors: 0, conversions: 0 },
    ])
    expect(results.variants.map((variant) => variant.rate)).toEqual([0, 0])
    expect(results.variants[1].uplift).toBeNull()
    expect(experimentResults([]).enoughData).toBe(false)
    expect(
      experimentResults([{ key: 'A', visitors: 500, conversions: 50 }])
        .enoughData,
    ).toBe(false)
  })
})
