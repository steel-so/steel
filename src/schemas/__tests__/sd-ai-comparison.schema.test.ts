import { describe, expect, it } from 'vitest'
import { SdAiComparisonQuerySchema } from '../sd-ai-comparison.schema'

describe('SdAiComparisonQuerySchema', () => {
  it('defaults to 30 days, also for an empty or null value', () => {
    expect(SdAiComparisonQuerySchema.parse({}).days).toBe(30)
    expect(SdAiComparisonQuerySchema.parse({ days: '' }).days).toBe(30)
    expect(SdAiComparisonQuerySchema.parse({ days: null }).days).toBe(30)
  })

  it('accepts the three periods, coercing the query string', () => {
    for (const days of [7, 30, 90]) {
      expect(SdAiComparisonQuerySchema.parse({ days: String(days) }).days).toBe(
        days,
      )
    }
  })

  it('rejects any other period', () => {
    expect(SdAiComparisonQuerySchema.safeParse({ days: '15' }).success).toBe(
      false,
    )
    expect(SdAiComparisonQuerySchema.safeParse({ days: 'abc' }).success).toBe(
      false,
    )
  })
})
