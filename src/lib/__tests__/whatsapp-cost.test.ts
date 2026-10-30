import { describe, expect, it } from 'vitest'
import {
  agentCost,
  budgetLevel,
  countryFromWaId,
  currentMonthRange,
  daysInPeriod,
  monthBounds,
  multiplyMoney,
  normalizeTemplateCategory,
  type PriceRow,
  projectMonthCost,
  proratedFee,
  rangeBounds,
  resolveUnitPrice,
  roundCents,
  safeRatio,
  saoPauloDay,
} from '../whatsapp/cost'

const row = (
  category: PriceRow['category'],
  unitPrice: number,
  validFrom: string,
  country = 'BR',
): PriceRow => ({
  category,
  country,
  currency: 'BRL',
  unitPrice,
  validFrom: new Date(validFrom),
})

describe('resolveUnitPrice', () => {
  const rows = [
    row('MARKETING', 0.3, '2026-01-01T00:00:00Z'),
    row('MARKETING', 0.4, '2026-07-01T00:00:00Z'),
    row('MARKETING', 0.9, '2026-07-01T00:00:00Z', 'US'),
    row('UTILITY', 0.04, '2026-01-01T00:00:00Z'),
  ]

  it('uses the latest row not after the send instant', () => {
    const before = resolveUnitPrice(
      rows,
      'MARKETING',
      'BR',
      new Date('2026-06-30T23:59:59Z'),
    )
    const after = resolveUnitPrice(
      rows,
      'MARKETING',
      'BR',
      new Date('2026-07-01T00:00:00Z'),
    )
    expect(before).toMatchObject({ unitPrice: 0.3, source: 'country' })
    expect(after).toMatchObject({ unitPrice: 0.4, source: 'country' })
  })

  it('prefers the recipient country and falls back to BR', () => {
    const at = new Date('2026-08-01T00:00:00Z')
    expect(resolveUnitPrice(rows, 'MARKETING', 'US', at)).toMatchObject({
      unitPrice: 0.9,
      source: 'country',
    })
    expect(resolveUnitPrice(rows, 'MARKETING', 'AR', at)).toMatchObject({
      unitPrice: 0.4,
      source: 'default-country',
    })
  })

  it('is zero with source none when nothing applies yet', () => {
    expect(
      resolveUnitPrice(
        rows,
        'MARKETING',
        'BR',
        new Date('2025-12-31T00:00:00Z'),
      ),
    ).toEqual({ unitPrice: 0, currency: 'BRL', source: 'none' })
    expect(
      resolveUnitPrice(rows, 'AUTHENTICATION', 'BR', new Date()),
    ).toMatchObject({ unitPrice: 0, source: 'none' })
  })

  it('prices a Marketing Messages Lite send with the Lite price when set', () => {
    const lite = [
      { ...row('MARKETING', 0.4, '2026-01-01T00:00:00Z'), liteUnitPrice: 0.35 },
      { ...row('MARKETING', 0.9, '2026-01-01T00:00:00Z', 'US') },
      { ...row('UTILITY', 0.04, '2026-01-01T00:00:00Z'), liteUnitPrice: 0.01 },
    ]
    const at = new Date('2026-08-01T00:00:00Z')
    expect(
      resolveUnitPrice(lite, 'MARKETING', 'BR', at, { lite: true }),
    ).toMatchObject({ unitPrice: 0.35, source: 'country' })
    // Not a Lite send: the regular price.
    expect(resolveUnitPrice(lite, 'MARKETING', 'BR', at)).toMatchObject({
      unitPrice: 0.4,
    })
    // Country fallback also reads the Lite column.
    expect(
      resolveUnitPrice(lite, 'MARKETING', 'AR', at, { lite: true }),
    ).toMatchObject({ unitPrice: 0.35, source: 'default-country' })
    // No Lite price on the row: same as the regular one.
    expect(
      resolveUnitPrice(lite, 'MARKETING', 'US', at, { lite: true }),
    ).toMatchObject({ unitPrice: 0.9 })
    // Lite only exists for MARKETING.
    expect(
      resolveUnitPrice(lite, 'UTILITY', 'BR', at, { lite: true }),
    ).toMatchObject({ unitPrice: 0.04 })
  })

  it('never charges the service window', () => {
    expect(
      resolveUnitPrice(rows, 'SERVICE', 'BR', new Date('2026-08-01')),
    ).toMatchObject({ unitPrice: 0 })
  })
})

describe('country and category helpers', () => {
  it.each([
    ['5511999990000', 'BR'],
    ['351912345678', 'PT'],
    ['14155550123', 'US'],
    ['598991234567', 'UY'],
    ['595981123456', 'PY'],
    ['+54 9 11 5555-0000', 'AR'],
    ['4915112345678', 'BR'],
  ])('countryFromWaId(%s) = %s', (waId, country) => {
    expect(countryFromWaId(waId)).toBe(country)
  })

  it('normalizes template categories, defaulting to the dearest tier', () => {
    expect(normalizeTemplateCategory('utility')).toBe('UTILITY')
    expect(normalizeTemplateCategory('AUTHENTICATION')).toBe('AUTHENTICATION')
    expect(normalizeTemplateCategory('MARKETING')).toBe('MARKETING')
    expect(normalizeTemplateCategory('???')).toBe('MARKETING')
    expect(normalizeTemplateCategory(null)).toBe('MARKETING')
  })

  it('builds the agent cost context', () => {
    expect(agentCost('u1', 'c1')).toEqual({
      source: 'AGENT',
      userId: 'u1',
      conversationId: 'c1',
    })
  })
})

describe('money math', () => {
  it('rounds the product to 6 decimals and totals to cents', () => {
    expect(multiplyMoney(0.3625, 3)).toBe(1.0875)
    expect(multiplyMoney(0.1, 3)).toBe(0.3)
    expect(roundCents(1.005 + 0.0001)).toBe(1.01)
  })

  it('never divides by zero', () => {
    expect(safeRatio(100, 0)).toBe(0)
    expect(safeRatio(100, 4)).toBe(25)
  })
})

describe('proratedFee', () => {
  it('charges a whole month in full', () => {
    expect(
      proratedFee(
        300,
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-10-31T00:00:00Z'),
      ),
    ).toBeCloseTo(300)
  })

  it('charges by day inside a month', () => {
    expect(
      proratedFee(
        310,
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-10-10T00:00:00Z'),
      ),
    ).toBeCloseTo(100)
  })

  it('splits a range across months by each month length', () => {
    // 30 Sep (1/30) + 1 Oct (1/31) of a 300 fee.
    expect(
      proratedFee(
        300,
        new Date('2026-09-30T00:00:00Z'),
        new Date('2026-10-01T00:00:00Z'),
      ),
    ).toBeCloseTo(300 / 30 + 300 / 31)
  })

  it('is zero without a fee or with an inverted range', () => {
    const a = new Date('2026-10-01T00:00:00Z')
    const b = new Date('2026-10-05T00:00:00Z')
    expect(proratedFee(0, a, b)).toBe(0)
    expect(proratedFee(100, b, a)).toBe(0)
  })
})

describe('projection and budget', () => {
  it('extends the run-rate to the whole month', () => {
    expect(
      projectMonthCost({ costToDate: 50, daysElapsed: 10, daysInMonth: 31 }),
    ).toBeCloseTo(155)
    expect(
      projectMonthCost({ costToDate: 50, daysElapsed: 0, daysInMonth: 31 }),
    ).toBe(0)
  })

  it('reports the highest budget level reached', () => {
    expect(budgetLevel(79, 100)).toBeNull()
    expect(budgetLevel(80, 100)).toBe(80)
    expect(budgetLevel(99.99, 100)).toBe(80)
    expect(budgetLevel(100, 100)).toBe(100)
    expect(budgetLevel(500, null)).toBeNull()
    expect(budgetLevel(5, 0)).toBeNull()
  })
})

describe('São Paulo calendar helpers', () => {
  it('turns an inclusive day range into instants at -03:00', () => {
    const { start, endExclusive } = rangeBounds('2026-10-01', '2026-10-02')
    expect(start.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(endExclusive.toISOString()).toBe('2026-10-03T03:00:00.000Z')
  })

  it('bounds a usage month, including December', () => {
    expect(monthBounds('2026-10').endExclusive.toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    )
    expect(monthBounds('2026-12').endExclusive.toISOString()).toBe(
      '2027-01-01T03:00:00.000Z',
    )
    expect(daysInPeriod('2026-02')).toBe(28)
    expect(daysInPeriod('2026-10')).toBe(31)
  })

  it('does not turn the day at 21:00 UTC-3 on the wrong side', () => {
    expect(saoPauloDay(new Date('2026-10-23T01:30:00Z'))).toBe('2026-10-22')
    expect(currentMonthRange(new Date('2026-10-23T01:30:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-22',
    })
  })
})
