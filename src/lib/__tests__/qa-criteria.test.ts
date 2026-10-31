import { describe, expect, it } from 'vitest'
import {
  criteriaForSubject,
  DEFAULT_QA_CRITERIA,
  isLowScore,
  weightedScore,
} from '../qa/criteria'

describe('DEFAULT_QA_CRITERIA', () => {
  it('seeds tone, resolution, compliance and empathy', () => {
    expect(DEFAULT_QA_CRITERIA.map((c) => c.key)).toEqual([
      'tone',
      'resolution',
      'compliance',
      'empathy',
    ])
  })
})

describe('criteriaForSubject', () => {
  const criteria = [
    { key: 'a', active: true, appliesTo: 'BOTH' as const },
    { key: 'b', active: true, appliesTo: 'TICKET' as const },
    { key: 'c', active: true, appliesTo: 'CONVERSATION' as const },
    { key: 'd', active: false, appliesTo: 'BOTH' as const },
  ]

  it('keeps the active criteria of the subject kind', () => {
    expect(criteriaForSubject(criteria, 'TICKET').map((c) => c.key)).toEqual([
      'a',
      'b',
    ])
    expect(
      criteriaForSubject(criteria, 'CONVERSATION').map((c) => c.key),
    ).toEqual(['a', 'c'])
  })
})

describe('weightedScore', () => {
  it('weights each criterion', () => {
    expect(
      weightedScore([
        { score: 100, weight: 1 },
        { score: 40, weight: 3 },
      ]),
    ).toBe(55)
  })

  it('is null without criteria or weight', () => {
    expect(weightedScore([])).toBeNull()
    expect(weightedScore([{ score: 50, weight: 0 }])).toBeNull()
  })
})

describe('isLowScore', () => {
  it('is low only below the threshold', () => {
    expect(isLowScore(59, 60)).toBe(true)
    expect(isLowScore(60, 60)).toBe(false)
  })
})
