import { describe, expect, it } from 'vitest'
import { COMPETITOR_COMPARISON } from '@/src/config/competitor-comparison'
import {
  type ComparisonBlock,
  ComparisonBlockSchema,
  ComparisonCatalogSchema,
  ListPriceSchema,
} from '../competitor-comparison.schema'

const block: ComparisonBlock = {
  module: 'crm',
  title: 'Steel vs CRM',
  competitors: [
    {
      id: 'acme',
      name: 'Acme CRM',
      domain: 'acme.test',
      currency: 'USD',
      sourceUrl: 'https://acme.test/pricing',
      plans: [{ name: 'Team', price: { kind: 'per-seat', cents: 1000 } }],
    },
  ],
  features: [
    { label: 'Leads', steel: 'yes', competitors: { acme: 'no-info' } },
  ],
  notes: [],
}

describe('ComparisonBlockSchema', () => {
  it('accepts a well-formed block', () => {
    expect(ComparisonBlockSchema.safeParse(block).success).toBe(true)
  })

  it('requires every feature to rate exactly the block competitors', () => {
    const missing = {
      ...block,
      features: [{ label: 'Leads', steel: 'yes', competitors: {} }],
    }
    const extra = {
      ...block,
      features: [
        {
          label: 'Leads',
          steel: 'yes',
          competitors: { acme: 'yes', other: 'yes' },
        },
      ],
    }
    expect(ComparisonBlockSchema.safeParse(missing).success).toBe(false)
    expect(ComparisonBlockSchema.safeParse(extra).success).toBe(false)
  })

  it.each([
    ['a "no" rating (only no-info is allowed)', { steel: 'no' }],
    ['a source that is not a url', { sourceUrl: 'acme pricing' }],
  ])('rejects %s', (_label, patch) => {
    const bad =
      'sourceUrl' in patch
        ? {
            ...block,
            competitors: [{ ...block.competitors[0], ...patch }],
          }
        : { ...block, features: [{ ...block.features[0], ...patch }] }
    expect(ComparisonBlockSchema.safeParse(bad).success).toBe(false)
  })
})

describe('CompetitorSchema domain', () => {
  it('takes a bare domain, never a URL', () => {
    const withDomain = (domain: string) =>
      ComparisonBlockSchema.safeParse({
        ...block,
        competitors: [{ ...block.competitors[0], domain }],
      }).success
    expect(withDomain('blip.ai')).toBe(true)
    expect(withDomain('https://blip.ai')).toBe(false)
    expect(withDomain('blip')).toBe(false)
  })
})

describe('ListPriceSchema', () => {
  it('rejects negative and fractional cents', () => {
    expect(
      ListPriceSchema.safeParse({ kind: 'per-seat', cents: -1 }).success,
    ).toBe(false)
    expect(
      ListPriceSchema.safeParse({ kind: 'flat', cents: 1.5 }).success,
    ).toBe(false)
  })
})

describe('ComparisonCatalogSchema', () => {
  it('requires one block per module, in order', () => {
    const blocks = COMPETITOR_COMPARISON.blocks
    expect(
      ComparisonCatalogSchema.safeParse({
        ...COMPETITOR_COMPARISON,
        blocks: [blocks[1], blocks[0], blocks[2]],
      }).success,
    ).toBe(false)
  })

  it('requires a positive exchange rate with an ISO date', () => {
    for (const exchangeRate of [
      { usdBrl: 0, date: '2026-10-14' },
      { usdBrl: 5.04, date: '14/10/2026' },
    ]) {
      expect(
        ComparisonCatalogSchema.safeParse({
          ...COMPETITOR_COMPARISON,
          exchangeRate,
        }).success,
      ).toBe(false)
    }
  })

  it('requires a YYYY-MM check date', () => {
    expect(
      ComparisonCatalogSchema.safeParse({
        ...COMPETITOR_COMPARISON,
        checkedAt: '2026-13',
      }).success,
    ).toBe(false)
  })

  it('ships the three approved blocks with dated, sourced competitors', () => {
    expect(COMPETITOR_COMPARISON.checkedAt).toMatch(/^\d{4}-\d{2}$/)
    expect(COMPETITOR_COMPARISON.blocks.map((b) => b.title)).toEqual([
      'Steel vs ServiceDesk',
      'Steel vs CRM',
      'Steel vs Comunicação',
    ])
    expect(
      COMPETITOR_COMPARISON.blocks.map((b) => b.competitors.map((c) => c.id)),
    ).toEqual([
      ['zendesk', 'freshservice', 'jsm'],
      ['salesforce', 'hubspot', 'pipedrive', 'rdstation'],
      ['zenvia', 'blip', 'octadesk'],
    ])
    for (const b of COMPETITOR_COMPARISON.blocks) {
      for (const c of b.competitors) {
        expect(c.sourceUrl.startsWith('https://')).toBe(true)
      }
    }
  })
})
