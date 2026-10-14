import { describe, expect, it } from 'vitest'
import { PAID_PLAN_PRICES } from '@/src/config/plan-prices'
import {
  competitorLogoUrl,
  competitorYearlyCost,
  formatListPrice,
  formatMoney,
  steelComparisonPlans,
  steelYearlyCost,
  teamMonthlyCost,
  toBrlCents,
} from '@/src/lib/pricing/comparison'
import type { Competitor } from '@/src/schemas/competitor-comparison.schema'

describe('formatMoney', () => {
  it('keeps the original currency and hides whole cents', () => {
    expect(formatMoney(5500, 'USD')).toBe('US$ 55')
    expect(formatMoney(6570, 'BRL')).toBe('R$ 65,70')
    expect(formatMoney(249900, 'BRL')).toBe('R$ 2.499')
  })
})

describe('formatListPrice', () => {
  it.each([
    [{ kind: 'per-seat', cents: 1900 } as const, 'US$ 19 por usuário/mês'],
    [
      { kind: 'per-seat-range', minCents: 9000, maxCents: 10000 } as const,
      'US$ 90 a US$ 100 por usuário/mês',
    ],
    [{ kind: 'flat', cents: 60000 } as const, 'US$ 600 por mês'],
    [{ kind: 'quote' } as const, 'Sob consulta'],
  ])('%o', (price, text) => {
    expect(formatListPrice(price, 'USD')).toBe(text)
  })
})

describe('teamMonthlyCost', () => {
  it('multiplies per-seat prices by the team size', () => {
    expect(teamMonthlyCost({ kind: 'per-seat', cents: 2000 }, 'USD')).toBe(
      'US$ 200',
    )
    expect(teamMonthlyCost({ kind: 'per-seat', cents: 1000 }, 'BRL', 3)).toBe(
      'R$ 30',
    )
    expect(
      teamMonthlyCost(
        { kind: 'per-seat-range', minCents: 700, maxCents: 2000 },
        'USD',
      ),
    ).toBe('US$ 70 a US$ 200')
  })

  it('cannot compute account-wide or on-request prices', () => {
    expect(teamMonthlyCost({ kind: 'flat', cents: 60000 }, 'BRL')).toBeNull()
    expect(teamMonthlyCost({ kind: 'quote' }, 'BRL')).toBeNull()
  })
})

describe('steelComparisonPlans', () => {
  it('reads Steel prices from plan-prices on annual billing', () => {
    const plans = steelComparisonPlans()
    expect(plans.map((p) => p.name)).toEqual([
      'Free',
      'Pro',
      'Business',
      'Enterprise',
    ])
    expect(plans[0]).toEqual({
      name: 'Free',
      price: { kind: 'per-seat', cents: 0 },
      note: 'até 12 usuários',
    })
    expect(plans[1]).toEqual({
      name: 'Pro',
      price: {
        kind: 'per-seat',
        cents: Math.round(PAID_PLAN_PRICES.PRO.yearly / 12),
      },
    })
    expect(plans[2].note).toBe('até 12 usuários')
    expect(plans[3]).toEqual({ name: 'Enterprise', price: { kind: 'quote' } })
  })
})

describe('competitorLogoUrl', () => {
  it('hotlinks the vendor icon from Brandfetch with the client id', () => {
    expect(competitorLogoUrl('zendesk.com')).toMatch(
      /^https:\/\/cdn\.brandfetch\.io\/zendesk\.com\/w\/128\/h\/128\/fallback\/lettermark\/icon\?c=\w+$/,
    )
  })
})

describe('toBrlCents', () => {
  it('converts dollars at the given rate and keeps reais untouched', () => {
    expect(toBrlCents(2400, 'USD', 5.0441)).toBe(12106)
    expect(toBrlCents(6570, 'BRL', 5.0441)).toBe(6570)
  })
})

describe('competitorYearlyCost', () => {
  const competitor = (
    plans: Competitor['plans'],
    currency: Competitor['currency'] = 'USD',
  ): Competitor => ({
    id: 'acme',
    name: 'Acme',
    domain: 'acme.test',
    currency,
    sourceUrl: 'https://acme.test/pricing',
    plans,
  })

  it('uses the cheapest paid per-seat plan, skipping free ones', () => {
    const cost = competitorYearlyCost(
      competitor([
        { name: 'Free', price: { kind: 'per-seat', cents: 0 } },
        { name: 'Standard', price: { kind: 'per-seat', cents: 2000 } },
        { name: 'Premium', price: { kind: 'per-seat', cents: 5000 } },
      ]),
      10,
      5,
    )
    expect(cost?.plan.name).toBe('Standard')
    expect(cost?.perAccount).toBe(false)
    expect(cost?.yearlyBrlCents).toBe(2000 * 12 * 10 * 5)
  })

  it('counts a range at its minimum', () => {
    const cost = competitorYearlyCost(
      competitor([
        {
          name: 'Starter',
          price: { kind: 'per-seat-range', minCents: 700, maxCents: 2000 },
        },
      ]),
      2,
      1,
    )
    expect(cost?.yearlyBrlCents).toBe(700 * 12 * 2)
  })

  it('does not multiply account-wide prices by the team', () => {
    const cost = competitorYearlyCost(
      competitor(
        [{ name: 'Specialist', price: { kind: 'flat', cents: 60000 } }],
        'BRL',
      ),
      50,
      5,
    )
    expect(cost).toEqual({
      plan: { name: 'Specialist', price: { kind: 'flat', cents: 60000 } },
      perAccount: true,
      yearlyBrlCents: 60000 * 12,
    })
  })

  it('returns null when no plan has a public paid price', () => {
    expect(
      competitorYearlyCost(
        competitor([
          {
            name: 'Free',
            price: { kind: 'per-seat-range', minCents: 0, maxCents: 0 },
          },
          { name: 'Enterprise', price: { kind: 'quote' } },
          { name: 'Grátis', price: { kind: 'flat', cents: 0 } },
        ]),
        10,
        5,
      ),
    ).toBeNull()
  })
})

describe('steelYearlyCost', () => {
  it('prices every seat at Steel Pro on annual billing', () => {
    expect(steelYearlyCost(7)).toBe(PAID_PLAN_PRICES.PRO.yearly * 7)
  })
})
