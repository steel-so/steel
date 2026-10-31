import { describe, expect, it } from 'vitest'
import {
  createFakeQaConfig,
  createFakeQaCriterion,
  createFakeQaReview,
} from '@/src/__tests__/factories/nov-t2-qa.factory'
import { DEFAULT_QA_CRITERIA } from '@/src/lib/qa/criteria'
import {
  buildQaCoaching,
  QA_DEFAULT_CONFIG,
  toQaConfigDTO,
  toQaCriterionDTO,
  toQaReviewDTO,
  weekStartOf,
} from '../qa-review.mapper'

const range = {
  from: new Date('2026-10-01T00:00:00.000Z'),
  to: new Date('2026-11-30T00:00:00.000Z'),
}

describe('toQaConfigDTO', () => {
  it('falls back to the defaults and the seeded criteria', () => {
    const dto = toQaConfigDTO(null, [])
    expect(dto).toMatchObject({ ...QA_DEFAULT_CONFIG })
    expect(dto.enabled).toBe(false)
    expect(dto.criteria.map((c) => c.key)).toEqual(
      DEFAULT_QA_CRITERIA.map((c) => c.key),
    )
  })

  it('maps the saved rule and criteria', () => {
    const criterion = createFakeQaCriterion({ key: 'k', weight: 3 })
    const dto = toQaConfigDTO(
      createFakeQaConfig({ enabled: true, lowScoreThreshold: 70 }),
      [criterion],
    )
    expect(dto.enabled).toBe(true)
    expect(dto.lowScoreThreshold).toBe(70)
    expect(dto.criteria).toEqual([toQaCriterionDTO(criterion)])
  })
})

describe('toQaReviewDTO', () => {
  it('maps dates and parses the JSON columns defensively', () => {
    const dto = toQaReviewDTO(
      createFakeQaReview({
        criteriaResults: [
          { key: 'a', name: 'A', weight: 1, score: 50, evidence: 'e' },
          { key: 'b', score: 10 },
          { key: 3, score: 10 },
          { key: 'c' },
          'x',
          null,
        ],
        coachingTips: ['dica', 7],
        reviewedAt: null,
        subjectEndedAt: null,
      }),
    )
    expect(dto.criteriaResults).toEqual([
      { key: 'a', name: 'A', weight: 1, score: 50, evidence: 'e' },
      { key: 'b', name: 'b', weight: 1, score: 10, evidence: '' },
    ])
    expect(dto.coachingTips).toEqual(['dica'])
    expect(dto.reviewedAt).toBeNull()
    expect(dto.subjectEndedAt).toBeNull()
    expect(dto.createdAt).toBe('2026-11-03T12:00:00.000Z')
  })

  it('tolerates non-array JSON', () => {
    const dto = toQaReviewDTO(
      createFakeQaReview({ criteriaResults: {}, coachingTips: 'x' }),
    )
    expect(dto.criteriaResults).toEqual([])
    expect(dto.coachingTips).toEqual([])
  })
})

describe('weekStartOf', () => {
  it('returns the Monday of the week in UTC', () => {
    expect(weekStartOf(new Date('2026-11-04T15:00:00Z')).toISOString()).toBe(
      '2026-11-02T00:00:00.000Z',
    )
    expect(weekStartOf(new Date('2026-11-08T23:00:00Z')).toISOString()).toBe(
      '2026-11-02T00:00:00.000Z',
    )
  })
})

describe('buildQaCoaching', () => {
  const review = (overrides: Parameters<typeof createFakeQaReview>[0]) =>
    toQaReviewDTO(createFakeQaReview(overrides))

  it('groups by agent, worst average first, with the bot as its own row', () => {
    const coaching = buildQaCoaching(
      [
        review({
          agentUserId: 'u1',
          agentName: 'Carlos',
          score: 90,
          reviewedAt: new Date('2026-11-03T10:00:00Z'),
        }),
        review({
          agentUserId: 'u1',
          agentName: 'Carlos',
          score: 50,
          lowScore: true,
          reviewedAt: new Date('2026-11-10T10:00:00Z'),
          coachingTips: ['Confirme o protocolo', 'confirme o protocolo '],
        }),
        review({
          agentUserId: 'u2',
          agentName: null,
          score: 40,
          lowScore: true,
          coachingTips: [],
        }),
        review({
          agentUserId: null,
          agentName: null,
          handlerKind: 'BOT',
          score: 75,
          criteriaResults: [],
        }),
        review({ score: null, status: 'SKIPPED' }),
      ],
      range,
    )
    expect(coaching.reviews).toBe(4)
    expect(coaching.averageScore).toBe(64)
    expect(coaching.lowScoreCount).toBe(2)
    expect(coaching.botAverage).toBe(75)
    expect(coaching.humanAverage).toBe(60)
    expect(coaching.agents.map((a) => a.agentName)).toEqual([
      'Atendente removido',
      'Carlos',
      'Bot / sem responsável',
    ])
    const carlos = coaching.agents[1]
    expect(carlos).toMatchObject({ reviews: 2, averageScore: 70 })
    expect(carlos.weakestCriterion?.key).toBe('resolution')
    expect(carlos.trend.map((t) => t.weekStart)).toEqual([
      '2026-11-02T00:00:00.000Z',
      '2026-11-09T00:00:00.000Z',
    ])
    expect(carlos.topTips).toEqual([
      { tip: 'Confirme o protocolo', count: 2 },
      { tip: 'Confirme o protocolo antes de encerrar', count: 1 },
    ])
    expect(carlos.lowest[0].score).toBe(50)
    expect(coaching.from).toBe(range.from.toISOString())
  })

  it('is empty without completed reviews', () => {
    const coaching = buildQaCoaching([], range)
    expect(coaching).toMatchObject({
      reviews: 0,
      averageScore: null,
      humanAverage: null,
      botAverage: null,
      agents: [],
    })
  })

  it('skips trend points without a review date', () => {
    const coaching = buildQaCoaching(
      [review({ reviewedAt: null, score: 80 })],
      range,
    )
    expect(coaching.agents[0].trend).toEqual([])
  })
})
