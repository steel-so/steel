import { describe, expect, it } from 'vitest'
import {
  type AdReportReferral,
  buildAdReport,
  proratedAdSpend,
} from '../whatsapp/ad-report'

const base: AdReportReferral = {
  sourceId: 'ad1',
  sourceType: 'ad',
  sourceUrl: null,
  headline: null,
  contactId: 'ct1',
  conversationId: 'cv1',
  leadId: null,
  receivedAt: new Date('2026-10-05T12:00:00Z'),
}

function referral(overrides: Partial<AdReportReferral>): AdReportReferral {
  return { ...base, ...overrides }
}

describe('proratedAdSpend', () => {
  const spend = {
    periodStart: '2026-10-01',
    periodEnd: '2026-10-10',
    amount: 1000,
  }

  it('counts the whole amount when the range covers the period', () => {
    expect(proratedAdSpend(spend, '2026-09-01', '2026-10-31')).toBe(1000)
  })

  it('counts only the days inside the range', () => {
    expect(proratedAdSpend(spend, '2026-10-06', '2026-10-31')).toBe(500)
    expect(proratedAdSpend(spend, '2026-10-01', '2026-10-01')).toBe(100)
  })

  it('is zero outside the period or for an inverted period', () => {
    expect(proratedAdSpend(spend, '2026-11-01', '2026-11-30')).toBe(0)
    expect(proratedAdSpend(spend, '2026-09-01', '2026-09-30')).toBe(0)
    expect(
      proratedAdSpend(
        { periodStart: '2026-10-10', periodEnd: '2026-10-01', amount: 5 },
        '2026-10-01',
        '2026-10-31',
      ),
    ).toBe(0)
  })
})

describe('buildAdReport', () => {
  it('returns empty totals without data', () => {
    const report = buildAdReport({
      from: '2026-10-01',
      to: '2026-10-31',
      referrals: [],
      leads: [],
      spends: [],
    })
    expect(report.rows).toEqual([])
    expect(report.totals).toMatchObject({
      clicks: 0,
      conversations: 0,
      spend: 0,
      costPerLead: null,
      costPerConversation: null,
      roi: null,
    })
  })

  it('builds the funnel, revenue and ROI per ad', () => {
    const report = buildAdReport({
      from: '2026-10-01',
      to: '2026-10-31',
      referrals: [
        referral({ conversationId: 'cv1', contactId: 'ct1', leadId: 'l1' }),
        referral({ conversationId: 'cv2', contactId: 'ct2', leadId: 'l2' }),
        // Same chat clicking again: one more click, same conversation.
        referral({ conversationId: 'cv2', contactId: 'ct2' }),
        referral({
          sourceId: 'ad2',
          conversationId: 'cv3',
          contactId: 'ct3',
          leadId: 'l3',
        }),
      ],
      leads: [
        { id: 'l1', closeResult: 'WON', closedAmount: 3000 },
        { id: 'l2', closeResult: 'LOST', closedAmount: null },
        { id: 'l3', closeResult: 'WON', closedAmount: null },
      ],
      spends: [
        {
          sourceId: 'ad1',
          label: 'Verão',
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          amount: 1000,
        },
      ],
    })

    const ad1 = report.rows.find((row) => row.sourceId === 'ad1')
    expect(ad1).toMatchObject({
      clicks: 3,
      conversations: 2,
      contacts: 2,
      leads: 2,
      leadsWon: 1,
      revenue: 3000,
      spend: 1000,
      costPerConversation: 500,
      costPerLead: 500,
      roi: 2,
    })
    const ad2 = report.rows.find((row) => row.sourceId === 'ad2')
    expect(ad2).toMatchObject({
      leads: 1,
      leadsWon: 1,
      revenue: 0,
      spend: 0,
      roi: null,
      costPerLead: null,
    })
    expect(report.totals).toMatchObject({
      clicks: 4,
      conversations: 3,
      contacts: 3,
      leads: 3,
      leadsWon: 2,
      revenue: 3000,
      spend: 1000,
      roi: 2,
    })
    // Most conversations first.
    expect(report.rows[0].sourceId).toBe('ad1')
  })

  it('ignores a lead that no longer exists (deleted) in the funnel', () => {
    const report = buildAdReport({
      from: '2026-10-01',
      to: '2026-10-31',
      referrals: [referral({ leadId: 'gone' })],
      leads: [],
      spends: [],
    })
    expect(report.totals.leads).toBe(0)
    expect(report.rows[0].leads).toBe(0)
  })

  it('keeps an ad that only has spend and names it by the label', () => {
    const report = buildAdReport({
      from: '2026-10-01',
      to: '2026-10-10',
      referrals: [],
      leads: [],
      spends: [
        {
          sourceId: 'adX',
          label: 'Campanha X',
          periodStart: '2026-10-01',
          periodEnd: '2026-10-10',
          amount: 200,
        },
        {
          sourceId: 'adOut',
          label: null,
          periodStart: '2026-01-01',
          periodEnd: '2026-01-10',
          amount: 999,
        },
      ],
    })
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      sourceId: 'adX',
      name: 'Campanha X',
      spend: 200,
      clicks: 0,
      costPerConversation: null,
      roi: -1,
    })
  })

  it('names the ad by its latest headline and keeps the latest type and url', () => {
    const report = buildAdReport({
      from: '2026-10-01',
      to: '2026-10-31',
      referrals: [
        referral({
          headline: 'Antigo',
          receivedAt: new Date('2026-10-02T00:00:00Z'),
        }),
        referral({
          headline: 'Novo',
          sourceType: 'post',
          sourceUrl: 'https://fb.me/new',
          receivedAt: new Date('2026-10-09T00:00:00Z'),
        }),
        // Older click without headline never overwrites the name.
        referral({
          headline: null,
          sourceUrl: null,
          receivedAt: new Date('2026-10-03T00:00:00Z'),
        }),
      ],
      leads: [],
      spends: [],
    })
    expect(report.rows[0]).toMatchObject({
      name: 'Novo',
      sourceType: 'post',
      sourceUrl: 'https://fb.me/new',
    })
  })

  it('breaks ties by spend then by id', () => {
    const report = buildAdReport({
      from: '2026-10-01',
      to: '2026-10-31',
      referrals: [
        referral({ sourceId: 'b', conversationId: 'c1' }),
        referral({ sourceId: 'a', conversationId: 'c2' }),
        referral({ sourceId: 'c', conversationId: 'c3' }),
      ],
      leads: [],
      spends: [
        {
          sourceId: 'c',
          label: null,
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          amount: 50,
        },
      ],
    })
    expect(report.rows.map((row) => row.sourceId)).toEqual(['c', 'a', 'b'])
  })
})
