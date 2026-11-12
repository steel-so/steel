import { beforeEach, describe, expect, it, vi } from 'vitest'

const metaRequest = vi.hoisted(() => vi.fn())
vi.mock('../whatsapp/meta-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  metaRequest,
}))

import type { PriceRow } from '../whatsapp/cost'
import { MetaApiError } from '../whatsapp/meta-client'
import {
  describeMetaSpendError,
  displayDigits,
  fetchMetaSpend,
  metaSpendWindow,
  pricingAnalyticsField,
  pricingPoints,
  summarizePricing,
} from '../whatsapp/meta-pricing'

const credentials = {
  phoneNumberId: 'pn1',
  wabaId: 'waba1',
  accessToken: 'token',
}

const prices: PriceRow[] = [
  {
    category: 'MARKETING',
    country: 'BR',
    currency: 'BRL',
    unitPrice: 0.3217,
    liteUnitPrice: 0.3,
    validFrom: new Date('2000-01-01T00:00:00Z'),
  },
  {
    category: 'UTILITY',
    country: 'BR',
    currency: 'BRL',
    unitPrice: 0.035,
    validFrom: new Date('2000-01-01T00:00:00Z'),
  },
  {
    category: 'AUTHENTICATION',
    country: 'BR',
    currency: 'BRL',
    unitPrice: 0.035,
    validFrom: new Date('2000-01-01T00:00:00Z'),
  },
]

const NOV_1 = 1_793_491_200 // 2026-11-01T00:00:00Z

function analytics(points: object[], currency = 'BRL') {
  return { currency, pricing_analytics: { data: [{ data_points: points }] } }
}

beforeEach(() => {
  metaRequest.mockReset()
})

describe('metaSpendWindow()', () => {
  it('spans the closed UTC days of the São Paulo usage month', () => {
    const window = metaSpendWindow(new Date('2026-11-11T15:00:00Z'))
    expect(window.period).toBe('2026-11')
    expect(window.start.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-11-11T00:00:00.000Z')
  })

  it('keeps the São Paulo month at night, when UTC already turned', () => {
    // 22:00 on Oct 31 in São Paulo = 01:00 on Nov 1 UTC.
    const window = metaSpendWindow(new Date('2026-11-01T01:00:00Z'))
    expect(window.period).toBe('2026-10')
    expect(window.start.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('is empty on the first São Paulo day of the month', () => {
    const window = metaSpendWindow(new Date('2026-11-01T04:00:00Z'))
    expect(window.end.getTime()).toBe(window.start.getTime())
  })
})

describe('field helpers', () => {
  it('keeps only the digits of the display number', () => {
    expect(displayDigits('+55 11 99999-0000')).toBe('5511999990000')
    expect(displayDigits(undefined)).toBe('')
  })

  it('builds the day-aligned pricing_analytics expression', () => {
    const field = pricingAnalyticsField(
      {
        start: new Date('2026-11-01T00:00:00Z'),
        end: new Date('2026-11-11T00:00:00Z'),
      },
      '5511999990000',
      ['COST', 'VOLUME'],
    )
    expect(field).toBe(
      `pricing_analytics.start(${NOV_1}).end(${NOV_1 + 10 * 86_400}).granularity(DAILY).phone_numbers(["5511999990000"]).metric_types(["COST","VOLUME"]).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`,
    )
  })

  it('flattens the data points and tolerates a malformed body', () => {
    const body = analytics([{ volume: 1 }, { volume: 2 }])
    expect(pricingPoints(body)).toHaveLength(2)
    expect(pricingPoints(null)).toEqual([])
    expect(
      pricingPoints({ pricing_analytics: { data: [{}, { data_points: [] }] } }),
    ).toEqual([])
  })
})

describe('summarizePricing()', () => {
  const points = [
    {
      start: NOV_1,
      pricing_category: 'MARKETING',
      pricing_type: 'REGULAR',
      volume: 496,
      cost: 159.56,
    },
    {
      start: NOV_1,
      pricing_category: 'SERVICE',
      pricing_type: 'FREE_CUSTOMER_SERVICE',
      volume: 500,
      cost: 0,
    },
    {
      start: NOV_1,
      pricing_category: 'UTILITY',
      pricing_type: 'FREE_ENTRY_POINT',
      volume: 3,
    },
  ]

  it('sums Meta’s own cost with META_COST', () => {
    const summary = summarizePricing(points, 'META_COST', prices)
    expect(summary.cost).toBe(159.56)
    expect(summary.byCategory[0]).toEqual({
      category: 'MARKETING',
      volume: 496,
      billableVolume: 496,
      cost: 159.56,
    })
    expect(
      summary.byCategory.find((row) => row.category === 'SERVICE'),
    ).toEqual({ category: 'SERVICE', volume: 500, billableVolume: 0, cost: 0 })
  })

  it('prices only the billable volume with META_VOLUME', () => {
    const summary = summarizePricing(points, 'META_VOLUME', prices)
    expect(summary.cost).toBe(159.5632)
    expect(
      summary.byCategory.find((row) => row.category === 'UTILITY'),
    ).toEqual({ category: 'UTILITY', volume: 3, billableVolume: 0, cost: 0 })
  })

  it('maps Lite, international authentication and unknown categories', () => {
    const summary = summarizePricing(
      [
        { start: NOV_1, pricing_category: 'MARKETING_LITE', volume: 10 },
        {
          start: NOV_1,
          pricing_category: 'AUTHENTICATION_INTERNATIONAL',
          volume: 10,
        },
        { start: NOV_1, pricing_category: 'UTILITY', volume: 10 },
        { start: NOV_1, pricing_category: 'SOMETHING_NEW', volume: 1 },
        { start: NOV_1, volume: 0 },
      ],
      'META_VOLUME',
      prices,
    )
    const cost = (category: string) =>
      summary.byCategory.find((row) => row.category === category)?.cost
    expect(cost('MARKETING_LITE')).toBe(3)
    expect(cost('AUTHENTICATION_INTERNATIONAL')).toBe(0.35)
    expect(cost('UTILITY')).toBe(0.35)
    expect(cost('SOMETHING_NEW')).toBe(0.3217)
    expect(cost('OTHER')).toBe(0)
  })

  it('treats a non-number metric as zero', () => {
    const summary = summarizePricing(
      [
        {
          pricing_category: 'MARKETING',
          volume: 'x' as never,
          cost: Number.NaN,
        },
      ],
      'META_COST',
      prices,
    )
    expect(summary.cost).toBe(0)
  })
})

describe('describeMetaSpendError()', () => {
  it.each([
    [new MetaApiError('x', 401, 190), /token de acesso/],
    [new MetaApiError('x', 400, 10), /permissão/],
    [new MetaApiError('x', 403), /permissão/],
    [new MetaApiError('x', 429), /limitou/],
    [new MetaApiError('x', 400, 80_004), /limitou/],
    [new MetaApiError('x', 503), /instável/],
    [new MetaApiError('x', 400, 100), /Não foi possível/],
    [Object.assign(new Error('t'), { name: 'TimeoutError' }), /demorou/],
    [Object.assign(new Error('t'), { name: 'AbortError' }), /demorou/],
    ['boom', /Não foi possível/],
  ])('maps %s', (error, expected) => {
    expect(describeMetaSpendError(error)).toMatch(expected)
  })
})

describe('fetchMetaSpend()', () => {
  const NOW = new Date('2026-11-11T15:00:00Z')

  it('returns null when no day of the month has closed', async () => {
    const dayOne = new Date('2026-11-01T04:00:00Z')
    expect(await fetchMetaSpend(credentials, prices, dayOne)).toBeNull()
    expect(metaRequest).not.toHaveBeenCalled()
  })

  it('uses Meta’s COST when allowed', async () => {
    metaRequest
      .mockResolvedValueOnce({ display_phone_number: '+55 11 99999-0000' })
      .mockResolvedValueOnce(
        analytics([
          {
            start: NOV_1,
            pricing_category: 'MARKETING',
            pricing_type: 'REGULAR',
            volume: 10,
            cost: 3.2,
          },
        ]),
      )

    const reading = await fetchMetaSpend(credentials, prices, NOW)

    expect(reading).toMatchObject({
      source: 'META_COST',
      cost: 3.2,
      currency: 'BRL',
    })
    expect(reading?.periodEnd.toISOString()).toBe('2026-11-11T00:00:00.000Z')
    expect(metaRequest.mock.calls[0][1]).toBe(
      '/pn1?fields=display_phone_number',
    )
    const path = decodeURIComponent(metaRequest.mock.calls[1][1])
    expect(path).toContain('/waba1?fields=currency,pricing_analytics')
    expect(path).toContain('phone_numbers(["5511999990000"])')
    expect(path).toContain('metric_types(["COST","VOLUME"])')
  })

  it('falls back to Meta’s VOLUME x the price table when COST is refused', async () => {
    metaRequest
      .mockResolvedValueOnce({ display_phone_number: '5511999990000' })
      .mockRejectedValueOnce(
        new MetaApiError(
          'Application does not have permission for this action',
          400,
          10,
        ),
      )
      .mockResolvedValueOnce(
        analytics(
          [
            {
              start: NOV_1,
              pricing_category: 'MARKETING',
              pricing_type: 'REGULAR',
              volume: 100,
            },
          ],
          'USD',
        ),
      )

    const reading = await fetchMetaSpend(credentials, prices, NOW)

    expect(reading).toMatchObject({
      source: 'META_VOLUME',
      cost: 32.17,
      currency: 'BRL',
      costRefusal: 'Application does not have permission for this action',
    })
    expect(decodeURIComponent(metaRequest.mock.calls[2][1])).toContain(
      'metric_types(["VOLUME"])',
    )
  })

  it('records a non-Error refusal and defaults the currencies', async () => {
    metaRequest
      .mockResolvedValueOnce({ display_phone_number: '5511999990000' })
      .mockRejectedValueOnce('refused')
      .mockResolvedValueOnce(null)
    const reading = await fetchMetaSpend(credentials, [], NOW)
    expect(reading).toMatchObject({
      source: 'META_VOLUME',
      cost: 0,
      currency: 'BRL',
      costRefusal: 'refused',
    })

    metaRequest
      .mockResolvedValueOnce({ display_phone_number: '5511999990000' })
      .mockResolvedValueOnce({})
    expect(await fetchMetaSpend(credentials, prices, NOW)).toMatchObject({
      source: 'META_COST',
      currency: 'BRL',
    })
  })

  it('throws when Meta has no display number or both reads fail', async () => {
    metaRequest.mockResolvedValueOnce(null)
    await expect(fetchMetaSpend(credentials, prices, NOW)).rejects.toThrow(
      'Meta returned no display_phone_number',
    )

    metaRequest
      .mockResolvedValueOnce({ display_phone_number: '5511999990000' })
      .mockRejectedValueOnce(new MetaApiError('down', 503))
      .mockRejectedValueOnce(new MetaApiError('down', 503))
    await expect(fetchMetaSpend(credentials, prices, NOW)).rejects.toThrow(
      'down',
    )
  })
})
