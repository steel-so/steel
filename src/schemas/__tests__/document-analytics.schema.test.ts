import { describe, expect, it } from 'vitest'
import {
  DocumentAnalyticsQuerySchema,
  documentAnalyticsPeriodDays,
} from '../document-analytics.schema'

describe('DocumentAnalyticsQuerySchema', () => {
  it('defaults to every session', () => {
    expect(DocumentAnalyticsQuerySchema.parse({})).toEqual({ days: 'all' })
  })

  it.each(['7', '30', '90', 'all'] as const)('accepts days=%s', (days) => {
    expect(DocumentAnalyticsQuerySchema.parse({ days })).toEqual({ days })
  })

  it('rejects other periods', () => {
    expect(DocumentAnalyticsQuerySchema.safeParse({ days: '14' }).success).toBe(
      false,
    )
  })
})

describe('documentAnalyticsPeriodDays', () => {
  it('turns a period into days, null for all time', () => {
    expect(documentAnalyticsPeriodDays('7')).toBe(7)
    expect(documentAnalyticsPeriodDays('90')).toBe(90)
    expect(documentAnalyticsPeriodDays('all')).toBeNull()
  })
})
