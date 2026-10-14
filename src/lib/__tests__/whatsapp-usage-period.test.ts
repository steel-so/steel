import { describe, expect, it } from 'vitest'
import {
  crossedUsageThreshold,
  whatsappUsagePeriod,
} from '../whatsapp/usage-period'

describe('whatsappUsagePeriod()', () => {
  it('should use the São Paulo calendar month', () => {
    expect(whatsappUsagePeriod(new Date('2026-10-14T12:00:00.000Z'))).toBe(
      '2026-10',
    )
    // 01/11 00:30 UTC is still 31/10 21:30 in São Paulo.
    expect(whatsappUsagePeriod(new Date('2026-11-01T00:30:00.000Z'))).toBe(
      '2026-10',
    )
    expect(whatsappUsagePeriod(new Date('2026-11-01T03:00:00.000Z'))).toBe(
      '2026-11',
    )
  })

  it('should roll the year over', () => {
    expect(whatsappUsagePeriod(new Date('2027-01-01T03:00:00.000Z'))).toBe(
      '2027-01',
    )
  })
})

describe('crossedUsageThreshold()', () => {
  it('should return null without a limit', () => {
    expect(crossedUsageThreshold(0, 1, null)).toBeNull()
  })

  it('should return the threshold crossed by this increment', () => {
    expect(crossedUsageThreshold(49, 50, 100)).toBe(50)
    expect(crossedUsageThreshold(79, 80, 100)).toBe(80)
    expect(crossedUsageThreshold(99, 100, 100)).toBe(100)
  })

  it('should return null when no threshold is crossed', () => {
    expect(crossedUsageThreshold(10, 11, 100)).toBeNull()
    expect(crossedUsageThreshold(50, 51, 100)).toBeNull()
    expect(crossedUsageThreshold(100, 101, 100)).toBeNull()
  })

  it('should round the threshold up for odd limits', () => {
    // 50% of 3 = 1.5 → crossed on the 2nd unit.
    expect(crossedUsageThreshold(1, 2, 3)).toBe(50)
    expect(crossedUsageThreshold(0, 1, 3)).toBeNull()
  })

  it('should return the highest threshold when one increment crosses several', () => {
    expect(crossedUsageThreshold(0, 1, 1)).toBe(100)
    expect(crossedUsageThreshold(0, 2, 2)).toBe(100)
  })
})
