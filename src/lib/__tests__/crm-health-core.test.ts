import { describe, expect, it } from 'vitest'
import {
  buildHealth,
  clamp01,
  daysBetween,
  type HealthFactorSpec,
  healthLevel,
  pickNextAction,
  pluralDays,
  ramp,
  scoreFactors,
  shouldAlertHealth,
  totalWeight,
} from '../crm-health/core'

const specs: HealthFactorSpec[] = [
  { key: 'a', label: 'Fator A', weight: 60 },
  { key: 'b', label: 'Fator B', weight: 40 },
]
const outcome = (key: string, ratio: number, applicable = true) => ({
  key,
  ratio,
  applicable,
  detail: `detalhe ${key}`,
})

describe('crm-health core', () => {
  it('clamps and ramps', () => {
    expect(clamp01(-2)).toBe(0)
    expect(clamp01(3)).toBe(1)
    expect(ramp(5, 0, 10)).toBe(0.5)
    expect(ramp(-1, 1, -1)).toBe(1)
    expect(ramp(0.2, 0.2, -1)).toBe(0)
    expect(ramp(4, 4, 4)).toBe(1)
    expect(ramp(3, 4, 4)).toBe(0)
  })

  it('counts whole days and never negative', () => {
    const a = new Date('2026-10-01T00:00:00Z')
    expect(daysBetween(a, new Date('2026-10-04T12:00:00Z'))).toBe(3)
    expect(daysBetween(new Date('2026-10-05T00:00:00Z'), a)).toBe(0)
    expect(pluralDays(1)).toBe('1 dia')
    expect(pluralDays(3)).toBe('3 dias')
  })

  it('uses the same cuts as the ServiceDesk risk', () => {
    expect(healthLevel(39)).toBe('LOW')
    expect(healthLevel(40)).toBe('MEDIUM')
    expect(healthLevel(69)).toBe('MEDIUM')
    expect(healthLevel(70)).toBe('HIGH')
  })

  it('sums weights', () => {
    expect(totalWeight(specs)).toBe(100)
  })

  it('scores the plain sum when every factor is applicable', () => {
    const r = scoreFactors(specs, [outcome('a', 1), outcome('b', 0.5)])
    expect(r.riskScore).toBe(80)
    expect(r.factors.map((f) => f.key)).toEqual(['a', 'b'])
    expect(r.factors[0]).toMatchObject({ points: 60, max: 60 })
    expect(r.missing).toEqual([])
  })

  it('drops non applicable factors from the denominator', () => {
    const r = scoreFactors(specs, [outcome('a', 1), outcome('b', 1, false)])
    expect(r.riskScore).toBe(100)
    expect(r.missing).toEqual(['Fator B'])
  })

  it('treats a factor without outcome as missing and scores 0 with nothing', () => {
    const r = scoreFactors(specs, [])
    expect(r.riskScore).toBe(0)
    expect(r.missing).toEqual(['Fator A', 'Fator B'])
  })

  it('skips factors that did not score and keeps table order on ties', () => {
    const r = scoreFactors(
      [
        { key: 'x', label: 'X', weight: 50 },
        { key: 'y', label: 'Y', weight: 50 },
      ],
      [outcome('x', 0.5), outcome('y', 0.5)],
    )
    expect(r.factors.map((f) => f.key)).toEqual(['x', 'y'])
    expect(
      scoreFactors(specs, [outcome('a', 0), outcome('b', 0)]).factors,
    ).toEqual([])
  })

  it('picks the action of the top factor or the fallback', () => {
    const actions = {
      a: { key: 'do_a', label: 'A', detail: 'a' },
    }
    const fallback = { key: 'ok', label: 'ok', detail: 'ok' }
    const factors = [
      { key: 'zzz', label: 'z', points: 9, max: 10, detail: '' },
      { key: 'a', label: 'a', points: 5, max: 10, detail: '' },
    ]
    expect(pickNextAction(factors, actions, fallback).key).toBe('do_a')
    expect(pickNextAction([], actions, fallback)).toBe(fallback)
  })

  it('builds the whole computation', () => {
    const built = buildHealth(
      specs,
      [outcome('a', 1), outcome('b', 1)],
      { a: { key: 'do_a', label: 'A', detail: 'a' } },
      { key: 'ok', label: 'ok', detail: 'ok' },
    )
    expect(built.riskScore).toBe(100)
    expect(built.level).toBe('HIGH')
    expect(built.nextAction.key).toBe('do_a')
  })

  describe('shouldAlertHealth', () => {
    const base = { jump: 20, previousLevel: null, previousScore: null }
    it('alerts when entering the high band', () => {
      expect(shouldAlertHealth({ ...base, level: 'HIGH', riskScore: 80 })).toBe(
        true,
      )
      expect(
        shouldAlertHealth({
          ...base,
          level: 'HIGH',
          riskScore: 80,
          previousLevel: 'HIGH',
          previousScore: 75,
        }),
      ).toBe(false)
    })
    it('alerts on a big jump above low, never twice for the same state', () => {
      expect(
        shouldAlertHealth({
          ...base,
          level: 'MEDIUM',
          riskScore: 60,
          previousLevel: 'LOW',
          previousScore: 30,
        }),
      ).toBe(true)
      expect(
        shouldAlertHealth({
          ...base,
          level: 'MEDIUM',
          riskScore: 45,
          previousLevel: 'LOW',
          previousScore: 30,
        }),
      ).toBe(false)
      expect(
        shouldAlertHealth({ ...base, level: 'MEDIUM', riskScore: 50 }),
      ).toBe(false)
      expect(
        shouldAlertHealth({
          ...base,
          level: 'LOW',
          riskScore: 30,
          previousLevel: 'LOW',
          previousScore: 0,
        }),
      ).toBe(false)
    })
  })
})
