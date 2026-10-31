import { describe, expect, it } from 'vitest'
import {
  CreateQaReviewSchema,
  QaCoachingQuerySchema,
  QaCriterionInputSchema,
  QaReviewListQuerySchema,
  UpdateQaConfigSchema,
} from '../qa-review.schema'

const criterion = {
  key: 'tone',
  name: 'Tom',
  description: 'Cordial e claro',
}

describe('QaCriterionInputSchema', () => {
  it('applies the defaults', () => {
    expect(QaCriterionInputSchema.parse(criterion)).toMatchObject({
      weight: 1,
      appliesTo: 'BOTH',
      active: true,
    })
  })

  it('rejects a bad key, weight and short description', () => {
    expect(
      QaCriterionInputSchema.safeParse({ ...criterion, key: 'Tom Alto' })
        .success,
    ).toBe(false)
    expect(
      QaCriterionInputSchema.safeParse({ ...criterion, weight: 11 }).success,
    ).toBe(false)
    expect(
      QaCriterionInputSchema.safeParse({ ...criterion, description: 'x' })
        .success,
    ).toBe(false)
  })
})

describe('UpdateQaConfigSchema', () => {
  it('accepts partial updates', () => {
    expect(UpdateQaConfigSchema.safeParse({ enabled: true }).success).toBe(true)
    expect(UpdateQaConfigSchema.safeParse({}).success).toBe(true)
  })

  it('rejects out-of-range limits', () => {
    expect(UpdateQaConfigSchema.safeParse({ minMessages: 0 }).success).toBe(
      false,
    )
    expect(
      UpdateQaConfigSchema.safeParse({ lowScoreThreshold: 101 }).success,
    ).toBe(false)
  })

  it('rejects repeated keys and a set with nothing active', () => {
    expect(
      UpdateQaConfigSchema.safeParse({ criteria: [criterion, criterion] })
        .success,
    ).toBe(false)
    expect(
      UpdateQaConfigSchema.safeParse({
        criteria: [{ ...criterion, active: false }],
      }).success,
    ).toBe(false)
    expect(UpdateQaConfigSchema.safeParse({ criteria: [] }).success).toBe(false)
    expect(
      UpdateQaConfigSchema.safeParse({ criteria: [criterion] }).success,
    ).toBe(true)
  })
})

describe('QaReviewListQuerySchema', () => {
  it('coerces the query string', () => {
    const parsed = QaReviewListQuerySchema.parse({
      lowOnly: 'true',
      limit: '10',
      from: '2026-11-01',
    })
    expect(parsed.lowOnly).toBe(true)
    expect(parsed.limit).toBe(10)
    expect(parsed.from).toBeInstanceOf(Date)
  })

  it('defaults the page size and lowOnly', () => {
    const parsed = QaReviewListQuerySchema.parse({})
    expect(parsed.limit).toBe(25)
    expect(parsed.lowOnly).toBe(false)
  })

  it('rejects an unknown status', () => {
    expect(QaReviewListQuerySchema.safeParse({ status: 'X' }).success).toBe(
      false,
    )
  })
})

describe('QaCoachingQuerySchema and CreateQaReviewSchema', () => {
  it('parse their inputs', () => {
    expect(QaCoachingQuerySchema.parse({ agentUserId: 'u1' }).agentUserId).toBe(
      'u1',
    )
    expect(
      CreateQaReviewSchema.safeParse({ subjectType: 'TICKET', subjectId: 't1' })
        .success,
    ).toBe(true)
    expect(CreateQaReviewSchema.safeParse({ subjectType: 'TICKET' }).success).toBe(
      false,
    )
  })
})
