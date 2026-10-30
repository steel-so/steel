import { describe, expect, it } from 'vitest'
import { totalWeight } from '../crm-health/core'
import {
  CUSTOMER_FACTOR_KEYS,
  CUSTOMER_FACTOR_SPECS,
  CUSTOMER_NEXT_ACTIONS,
  type CustomerHealthSignals,
  computeCustomerHealth,
} from '../crm-health/customer'

const now = new Date('2026-10-30T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)

function signals(
  overrides: Partial<CustomerHealthSignals> = {},
): CustomerHealthSignals {
  return {
    now,
    companyCreatedAt: daysAgo(400),
    crm: {
      lastInteractionAt: daysAgo(2),
      openDeals: 0,
      highRiskDeals: 0,
      mediumRiskDeals: 0,
      totalDeals: 0,
      lostDeals180d: 0,
      wonDeals180d: 0,
      overdueTasks: 0,
    },
    zap: null,
    sd: null,
    ...overrides,
  }
}

describe('customer health', () => {
  it('has weights that sum 100 and an action per factor', () => {
    expect(totalWeight(CUSTOMER_FACTOR_SPECS)).toBe(100)
    expect(CUSTOMER_FACTOR_SPECS.map((s) => s.key).sort()).toEqual(
      [...CUSTOMER_FACTOR_KEYS].sort(),
    )
    for (const key of CUSTOMER_FACTOR_KEYS) {
      expect(CUSTOMER_NEXT_ACTIONS[key].label).not.toBe('')
    }
  })

  it('is healthy with recent contact and no other signal', () => {
    const r = computeCustomerHealth(signals())
    expect(r.riskScore).toBe(0)
    expect(r.level).toBe('LOW')
    expect(r.factors).toEqual([])
    expect(r.nextAction.key).toBe('keep_nurturing')
    expect(r.missing).toContain('Sentimento no WhatsApp')
    expect(r.missing).toContain('Chamados abertos')
  })

  it('scores a silent customer from the company birth when never contacted', () => {
    const r = computeCustomerHealth(
      signals({
        companyCreatedAt: daysAgo(120),
        crm: { ...signals().crm, lastInteractionAt: null },
      }),
    )
    expect(r.riskScore).toBe(80)
    expect(r.level).toBe('HIGH')
    expect(r.factors[0]?.detail).toBe(
      'Nenhuma interação registrada em 120 dias',
    )
    expect(r.nextAction.key).toBe('reach_out')
  })

  it('is not penalised for a brand new company', () => {
    const r = computeCustomerHealth(
      signals({
        companyCreatedAt: daysAgo(1),
        crm: { ...signals().crm, lastInteractionAt: null },
      }),
    )
    expect(r.riskScore).toBe(0)
  })

  it('explains the engagement gap', () => {
    const r = computeCustomerHealth(
      signals({ crm: { ...signals().crm, lastInteractionAt: daysAgo(52) } }),
    )
    expect(r.factors[0]).toMatchObject({
      key: 'engagement',
      detail: 'Última interação há 52 dias',
    })
  })

  it('weighs open deals at risk and recovered losses', () => {
    const r = computeCustomerHealth(
      signals({
        crm: {
          ...signals().crm,
          openDeals: 2,
          highRiskDeals: 1,
          mediumRiskDeals: 1,
          totalDeals: 4,
          lostDeals180d: 1,
          wonDeals180d: 0,
          overdueTasks: 3,
        },
      }),
    )
    const keys = r.factors.map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining(['deals_at_risk', 'lost_deals', 'overdue_tasks']),
    )
    const lost = r.factors.find((f) => f.key === 'lost_deals')
    expect(lost?.points).toBe(4)
    expect(r.factors.find((f) => f.key === 'deals_at_risk')?.detail).toContain(
      '1 de 2',
    )
  })

  it('counts a loss fully when nothing is open and nothing was won', () => {
    const r = computeCustomerHealth(
      signals({
        crm: { ...signals().crm, totalDeals: 1, lostDeals180d: 1 },
      }),
    )
    const lost = r.factors.find((f) => f.key === 'lost_deals')
    expect(lost?.points).toBe(8)
    expect(lost?.detail).toContain('nenhum aberto')
  })

  it('reports no losses and no risky deals as clean factors', () => {
    const r = computeCustomerHealth(
      signals({
        crm: { ...signals().crm, openDeals: 1, totalDeals: 1 },
      }),
    )
    expect(r.factors).toEqual([])
    expect(r.missing).not.toContain('Negócios abertos em risco')
    expect(r.missing).not.toContain('Negócios perdidos')
  })

  it('uses the WhatsApp sentiment when conversations are scored', () => {
    const r = computeCustomerHealth(
      signals({
        zap: { conversations: 3, avgSentiment: -0.6, negativeConversations: 2 },
      }),
    )
    const zap = r.factors.find((f) => f.key === 'zap_sentiment')
    expect(zap?.points).toBeCloseTo(13.3, 1)
    expect(zap?.detail).toBe(
      'Sentimento médio de -60% em 3 conversa(s) do WhatsApp, 2 negativa(s)',
    )
    expect(r.nextAction.key).toBe('recover_sentiment')
  })

  it('shows a positive sign for positive sentiment and skips unscored zap', () => {
    const ok = computeCustomerHealth(
      signals({
        zap: { conversations: 1, avgSentiment: 0.5, negativeConversations: 0 },
      }),
    )
    expect(ok.factors).toEqual([])
    const unscored = computeCustomerHealth(
      signals({
        zap: { conversations: 1, avgSentiment: null, negativeConversations: 0 },
      }),
    )
    expect(unscored.missing).toContain('Sentimento no WhatsApp')
  })

  it('reads the ServiceDesk signals', () => {
    const r = computeCustomerHealth(
      signals({
        sd: {
          openTickets: 6,
          breachedTickets90d: 3,
          tickets90d: 8,
          csatAvg: 2,
          csatCount: 4,
          highRiskOpenTickets: 2,
        },
      }),
    )
    expect(r.factors.map((f) => f.key)).toEqual([
      'sd_breaches',
      'sd_open_volume',
      'sd_csat',
      'sd_high_risk',
    ])
    expect(r.factors.find((f) => f.key === 'sd_csat')?.detail).toBe(
      'Nota média 2,0 de 5 em 4 avaliação(ões)',
    )
    expect(r.nextAction.key).toBe('review_sla')
  })

  it('reports clean ServiceDesk factors and skips csat without ratings', () => {
    const r = computeCustomerHealth(
      signals({
        sd: {
          openTickets: 0,
          breachedTickets90d: 0,
          tickets90d: 0,
          csatAvg: null,
          csatCount: 0,
          highRiskOpenTickets: 0,
        },
      }),
    )
    expect(r.factors).toEqual([])
    expect(r.missing).toEqual(
      expect.arrayContaining(['Satisfação nos chamados']),
    )
    expect(r.missing).not.toContain('Chamados abertos')
  })

  it('reaches the high band with several bad signals', () => {
    const r = computeCustomerHealth(
      signals({
        crm: { ...signals().crm, lastInteractionAt: daysAgo(100) },
        zap: { conversations: 2, avgSentiment: -0.9, negativeConversations: 2 },
        sd: {
          openTickets: 5,
          breachedTickets90d: 3,
          tickets90d: 6,
          csatAvg: 1.5,
          csatCount: 2,
          highRiskOpenTickets: 2,
        },
      }),
    )
    expect(r.level).toBe('HIGH')
    expect(r.riskScore).toBeGreaterThanOrEqual(70)
  })
})
