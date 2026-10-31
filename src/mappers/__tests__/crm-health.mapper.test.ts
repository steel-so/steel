import type { CrmCustomerHealth, CrmOpportunityHealth } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  parseFactors,
  parseNextAction,
  toCrmCustomerHealthDTO,
  toCrmOpportunityHealthDTO,
} from '../crm-health.mapper'

const computedAt = new Date('2026-10-30T12:00:00Z')
const factor = {
  key: 'engagement',
  label: 'Sem interação recente',
  points: 12.5,
  max: 20,
  detail: 'Última interação há 52 dias',
}
const nextAction = { key: 'reach_out', label: 'Retomar', detail: 'Ligue' }

const customer: CrmCustomerHealth = {
  id: 'h1',
  workspaceId: 'ws1',
  companyId: 'c1',
  riskScore: 72,
  level: 'HIGH',
  factors: [factor],
  missing: ['Sentimento no WhatsApp', 42],
  nextAction,
  signals: {},
  previousScore: 50,
  previousLevel: 'MEDIUM',
  computedAt,
  createdAt: computedAt,
}

describe('crm-health mapper', () => {
  it('maps a customer row with the health as 100 - risk', () => {
    const dto = toCrmCustomerHealthDTO({
      ...customer,
      company: { name: 'Acme', accountOwnerId: null },
    })
    expect(dto).toEqual({
      companyId: 'c1',
      companyName: 'Acme',
      riskScore: 72,
      healthScore: 28,
      level: 'HIGH',
      levelLabel: 'Risco alto',
      factors: [factor],
      missing: ['Sentimento no WhatsApp'],
      nextAction,
      riskDelta: 22,
      computedAt: computedAt.toISOString(),
    })
  })

  it('has no delta on the first computation', () => {
    const dto = toCrmCustomerHealthDTO({
      ...customer,
      previousScore: null,
      previousLevel: null,
      company: { name: 'Acme', accountOwnerId: null },
    })
    expect(dto.riskDelta).toBeNull()
  })

  it('maps a deal row', () => {
    const row: CrmOpportunityHealth = {
      id: 'h2',
      workspaceId: 'ws1',
      opportunityId: 'o1',
      riskScore: 30,
      level: 'LOW',
      factors: [],
      nextAction,
      signals: {},
      previousScore: 35,
      previousLevel: 'LOW',
      computedAt,
      createdAt: computedAt,
    }
    const dto = toCrmOpportunityHealthDTO({
      ...row,
      opportunity: { name: 'Renovação', ownerId: 'u1' },
    })
    expect(dto).toMatchObject({
      opportunityId: 'o1',
      opportunityName: 'Renovação',
      levelLabel: 'Risco baixo',
      riskDelta: -5,
    })
  })

  it('survives malformed json columns', () => {
    expect(parseFactors(null)).toEqual([])
    expect(parseFactors(['x', { key: 1 }, null, factor])).toEqual([factor])
    expect(parseNextAction(null)).toEqual({
      key: 'none',
      label: 'Sem ação sugerida',
      detail: '',
    })
    expect(parseNextAction({ key: 'a', label: 1, detail: 'd' }).key).toBe(
      'none',
    )
    expect(parseNextAction(nextAction)).toEqual(nextAction)
  })
})
