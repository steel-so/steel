import { describe, expect, it } from 'vitest'
import {
  formatContactCreatedAt,
  startOfSaoPauloDay,
} from '@/src/lib/whatsapp/contact-created-today'

describe('startOfSaoPauloDay', () => {
  it('returns São Paulo midnight (03:00 UTC) during the day', () => {
    expect(
      startOfSaoPauloDay(new Date('2026-10-27T15:30:00Z')).toISOString(),
    ).toBe('2026-10-27T03:00:00.000Z')
  })

  it('keeps the São Paulo day between 21:00 and 23:59 when UTC already turned', () => {
    // 22:30 in São Paulo on the 27th = 01:30 UTC on the 28th.
    expect(
      startOfSaoPauloDay(new Date('2026-10-28T01:30:00Z')).toISOString(),
    ).toBe('2026-10-27T03:00:00.000Z')
    // 23:59:59 in São Paulo.
    expect(
      startOfSaoPauloDay(new Date('2026-10-28T02:59:59Z')).toISOString(),
    ).toBe('2026-10-27T03:00:00.000Z')
  })

  it('turns the day exactly at São Paulo midnight', () => {
    expect(
      startOfSaoPauloDay(new Date('2026-10-28T03:00:00Z')).toISOString(),
    ).toBe('2026-10-28T03:00:00.000Z')
  })

  it('handles the start of the UTC day that is still yesterday in São Paulo', () => {
    expect(
      startOfSaoPauloDay(new Date('2026-01-01T00:00:00Z')).toISOString(),
    ).toBe('2025-12-31T03:00:00.000Z')
  })

  it('defaults to the current instant', () => {
    const start = startOfSaoPauloDay()
    expect(start.getTime()).toBeLessThanOrEqual(Date.now())
    expect(Date.now() - start.getTime()).toBeLessThan(86_400_000)
  })
})

describe('formatContactCreatedAt', () => {
  it('formats in São Paulo time, not UTC', () => {
    expect(formatContactCreatedAt('2026-10-28T01:30:00.000Z')).toBe(
      '27/10/2026 22:30',
    )
    expect(formatContactCreatedAt('2026-10-27T03:05:00.000Z')).toBe(
      '27/10/2026 00:05',
    )
  })
})
