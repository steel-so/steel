import { describe, expect, it } from 'vitest'
import { latencyStats, percentile } from '../voice-agent/latency'

describe('percentile()', () => {
  it('uses the nearest rank and does not reorder the input', () => {
    const values = [900, 100, 500, 300, 700]
    expect(percentile(values, 50)).toBe(500)
    expect(percentile(values, 95)).toBe(900)
    expect(percentile(values, 100)).toBe(900)
    expect(percentile(values, 1)).toBe(100)
    expect(percentile(values, 0)).toBe(100)
    expect(values).toEqual([900, 100, 500, 300, 700])
  })

  it('is null for no data', () => {
    expect(percentile([], 50)).toBeNull()
  })
})

describe('latencyStats()', () => {
  it('summarizes the turns of a call', () => {
    expect(latencyStats([800, 1200, 600, 1000])).toEqual({
      turns: 4,
      p50Ms: 800,
      p95Ms: 1200,
      maxMs: 1200,
    })
  })

  it('reports nothing for a call without turns', () => {
    expect(latencyStats([])).toEqual({
      turns: 0,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    })
  })
})
