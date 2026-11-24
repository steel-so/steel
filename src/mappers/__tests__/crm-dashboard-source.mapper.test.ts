import { describe, expect, it } from 'vitest'
import type {
  CrmDashboardCampaign,
  CrmDashboardCharge,
  CrmDashboardContract,
  CrmDashboardCustomerHealth,
  CrmDashboardProposal,
  CrmDashboardQuota,
} from '@/src/repositories/crm-dashboard-source.repository'
import {
  quotaPeriodStart,
  toCrmCampaignDashboardRow,
  toCrmChargeDashboardRow,
  toCrmContractDashboardRow,
  toCrmCustomerHealthDashboardRow,
  toCrmEmailCampaignDashboardRow,
  toCrmProposalDashboardRow,
  toCrmQuotaDashboardRows,
  wonByQuotaPeriod,
} from '../crm-dashboard-source.mapper'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const d = (value: string) => new Date(value)
const dec = (value: number) => value as never

function proposal(over: Partial<CrmDashboardProposal> = {}) {
  return {
    id: 'p1',
    name: 'Proposta Acme',
    status: 'ACCEPTED',
    responsibleId: 'u1',
    validUntil: null,
    acceptedAt: d('2026-10-05T12:00:00.000Z'),
    expiredAt: null,
    createdAt: d('2026-10-01T12:00:00.000Z'),
    responsible: { name: 'Ana' },
    company: { name: 'Acme' },
    contact: null,
    opportunity: { name: 'Negócio', amount: dec(900) },
    sections: [{ content: { type: 'PRODUCTS_PRICING', total: 1500 } }],
    views: [
      { createdAt: d('2026-10-02T12:00:00.000Z') },
      { createdAt: d('2026-10-03T12:00:00.000Z') },
    ],
    ...over,
  } as CrmDashboardProposal
}

describe('toCrmProposalDashboardRow', () => {
  it('derives acceptance, views and day counts', () => {
    const row = toCrmProposalDashboardRow(proposal(), NOW)
    expect(row).toMatchObject({
      status: 'Aceita',
      responsible: 'Ana',
      company: 'Acme',
      amount: 1500,
      isAccepted: true,
      acceptedPct: 100,
      viewCount: 2,
      isViewed: true,
      daysToFirstView: 1,
      daysToAccept: 4,
      firstViewedAt: '2026-10-02T12:00:00.000Z',
      lastViewedAt: '2026-10-03T12:00:00.000Z',
    })
  })

  it('falls back to the deal amount and flags open proposals about to expire', () => {
    const row = toCrmProposalDashboardRow(
      proposal({
        status: 'SENT',
        sections: [],
        acceptedAt: null,
        views: [],
        validUntil: d('2026-10-12T12:00:00.000Z'),
      }),
      NOW,
    )
    expect(row.amount).toBe(900)
    expect(row.isOpen).toBe(true)
    expect(row.acceptedPct).toBeNull()
    expect(row.daysToExpire).toBe(2)
    expect(row.isExpiringSoon).toBe(true)
    expect(row.daysToAccept).toBeNull()
  })

  it('scores rejected and expired proposals as 0', () => {
    expect(
      toCrmProposalDashboardRow(proposal({ status: 'EXPIRED' }), NOW)
        .acceptedPct,
    ).toBe(0)
  })
})

describe('toCrmContractDashboardRow', () => {
  const contract = (over: Partial<CrmDashboardContract> = {}) =>
    ({
      id: 'c1',
      name: 'Contrato',
      status: 'ACTIVE',
      ownerId: 'u1',
      value: dec(1000),
      startDate: d('2026-01-01T00:00:00.000Z'),
      endDate: d('2026-10-30T12:00:00.000Z'),
      autoRenews: true,
      renewalOpportunityId: null,
      renewalCreatedAt: null,
      createdAt: d('2026-01-01T00:00:00.000Z'),
      company: { name: 'Acme' },
      ...over,
    }) as CrmDashboardContract

  it('flags contracts ending within 30 days and resolves the owner', () => {
    const row = toCrmContractDashboardRow(
      contract(),
      new Map([['u1', 'Ana']]),
      NOW,
    )
    expect(row).toMatchObject({
      status: 'Ativo',
      owner: 'Ana',
      value: 1000,
      isActive: true,
      daysToEnd: 20,
      isExpiringSoon: true,
      renewedPct: null,
    })
  })

  it('scores renewed and expired contracts', () => {
    const members = new Map<string, string>()
    expect(
      toCrmContractDashboardRow(contract({ status: 'RENEWED' }), members, NOW)
        .renewedPct,
    ).toBe(100)
    const expired = toCrmContractDashboardRow(
      contract({ status: 'EXPIRED' }),
      members,
      NOW,
    )
    expect(expired.renewedPct).toBe(0)
    expect(expired.daysToEnd).toBeNull()
    expect(expired.owner).toBeNull()
  })
})

describe('toCrmChargeDashboardRow', () => {
  it('derives payment flags and days to pay', () => {
    const charge = {
      id: 'ch1',
      method: 'PIX',
      provider: 'abacatepay',
      status: 'PAID',
      amount: dec(500),
      paidAmount: dec(500),
      createdById: 'u1',
      expiresAt: d('2026-10-05T00:00:00.000Z'),
      paidAt: d('2026-10-03T00:00:00.000Z'),
      canceledAt: null,
      createdAt: d('2026-10-01T00:00:00.000Z'),
      proposal: { name: 'Proposta', company: { name: 'Acme' } },
    } as CrmDashboardCharge
    const row = toCrmChargeDashboardRow(charge, new Map([['u1', 'Ana']]))
    expect(row).toMatchObject({
      method: 'Pix',
      status: 'Paga',
      isPaid: true,
      paidPct: 100,
      daysToPay: 2,
      company: 'Acme',
      createdBy: 'Ana',
    })
    expect(
      toCrmChargeDashboardRow({ ...charge, status: 'EXPIRED' }, new Map())
        .paidPct,
    ).toBe(0)
  })
})

describe('quotas', () => {
  const quota = (over: Partial<CrmDashboardQuota> = {}) =>
    ({
      id: 'q1',
      ownerId: 'u1',
      period: 'MONTH',
      periodKey: '2026-10',
      targetAmount: dec(1000),
      owner: { name: 'Ana' },
      ...over,
    }) as CrmDashboardQuota

  it('parses period keys', () => {
    expect(quotaPeriodStart('MONTH', '2026-10')?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    )
    expect(quotaPeriodStart('QUARTER', '2026-Q4')?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    )
    expect(quotaPeriodStart('MONTH', 'x')).toBeNull()
  })

  it('sums the won deals of the owner in the period', () => {
    const won = wonByQuotaPeriod([
      { ownerId: 'u1', amount: dec(600), wonAt: d('2026-10-02T00:00:00.000Z') },
      { ownerId: 'u1', amount: dec(500), wonAt: d('2026-10-09T00:00:00.000Z') },
      { ownerId: 'u2', amount: dec(900), wonAt: d('2026-10-09T00:00:00.000Z') },
      { ownerId: null, amount: dec(1), wonAt: d('2026-10-09T00:00:00.000Z') },
    ])
    const [month, quarter] = [
      toCrmQuotaDashboardRows([quota()], won, NOW)[0],
      toCrmQuotaDashboardRows(
        [quota({ period: 'QUARTER', periodKey: '2026-Q4' })],
        won,
        NOW,
      )[0],
    ]
    expect(month).toMatchObject({
      owner: 'Ana',
      period: 'Mensal',
      target: 1000,
      achieved: 1100,
      wonCount: 2,
      remaining: 0,
      attainmentPct: 110,
      isMet: true,
      isCurrent: true,
    })
    expect(quarter.period).toBe('Trimestral')
    expect(quarter.achieved).toBe(1100)
  })

  it('has no attainment for a zero target and skips bad keys', () => {
    const rows = toCrmQuotaDashboardRows(
      [quota({ targetAmount: dec(0) }), quota({ id: 'q2', periodKey: 'bad' })],
      new Map(),
      NOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].attainmentPct).toBeNull()
    expect(rows[0].isMet).toBe(false)
  })
})

describe('toCrmCustomerHealthDashboardRow', () => {
  it('derives health score, delta and level change', () => {
    const row = toCrmCustomerHealthDashboardRow(
      {
        id: 'h1',
        riskScore: 80,
        level: 'HIGH',
        previousScore: 50,
        previousLevel: 'MEDIUM',
        nextAction: { key: 'call', label: 'Ligar', detail: '' },
        computedAt: d('2026-10-10T00:00:00.000Z'),
        company: { name: 'Acme', accountOwnerId: 'u1' },
      } as CrmDashboardCustomerHealth,
      new Map([['u1', 'Ana']]),
    )
    expect(row).toMatchObject({
      kind: 'Cliente',
      healthScore: 20,
      level: 'Risco alto',
      isHighRisk: true,
      scoreDelta: 30,
      levelChanged: true,
      nextAction: 'Ligar',
      owner: 'Ana',
    })
  })
})

describe('campaign rows', () => {
  const campaign: CrmDashboardCampaign = {
    id: 'cm1',
    name: 'Black Friday',
    status: 'COMPLETED',
    whatsappEnabled: true,
    hasEmail: true,
    createdAt: d('2026-10-01T00:00:00.000Z'),
    scheduledAt: null,
    startedAt: d('2026-10-02T00:00:00.000Z'),
    completedAt: d('2026-10-03T00:00:00.000Z'),
  }

  it('computes rates from the recipient counters', () => {
    const row = toCrmCampaignDashboardRow(campaign, {
      campaignId: 'cm1',
      recipients: 100,
      emailSent: 90,
      emailDelivered: 80,
      emailOpened: 40,
      emailClicked: 8,
      emailBounced: 10,
      unsubscribed: 1,
      whatsappSent: 10,
      whatsappDelivered: 10,
      whatsappRead: 5,
      whatsappClicked: 1,
      whatsappReplied: 2,
      converted: 5,
    })
    expect(row).toMatchObject({
      kind: 'Multicanal',
      status: 'Concluída',
      emailOpenRate: 50,
      emailClickRate: 10,
      whatsappReadRate: 50,
      conversionRate: 5,
    })
  })

  it('has null rates without counters', () => {
    const row = toCrmCampaignDashboardRow(campaign, undefined)
    expect(row.recipients).toBe(0)
    expect(row.emailOpenRate).toBeNull()
  })

  it('maps the legacy e-mail campaign without tracking', () => {
    const row = toCrmEmailCampaignDashboardRow(
      { ...campaign, status: 'SENT', whatsappEnabled: false },
      { recipients: 20, sent: 18 },
    )
    expect(row).toMatchObject({
      kind: 'E-mail',
      status: 'Enviada',
      recipients: 20,
      emailSent: 18,
      emailOpened: null,
      hasWhatsapp: false,
    })
  })
})
