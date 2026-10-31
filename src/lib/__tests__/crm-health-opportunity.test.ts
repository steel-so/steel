import { describe, expect, it } from 'vitest'
import { totalWeight } from '../crm-health/core'
import {
  computeOpportunityHealth,
  OPPORTUNITY_FACTOR_KEYS,
  OPPORTUNITY_FACTOR_SPECS,
  OPPORTUNITY_NEXT_ACTIONS,
  type OpportunityHealthSignals,
} from '../crm-health/opportunity'

const now = new Date('2026-10-30T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)
const daysAhead = (n: number) => new Date(now.getTime() + n * 86_400_000)

function signals(
  overrides: Partial<OpportunityHealthSignals> = {},
): OpportunityHealthSignals {
  return {
    now,
    createdAt: daysAgo(60),
    stageChangedAt: null,
    lastActivityAt: daysAgo(1),
    lastInteractionAt: daysAgo(2),
    closeDate: daysAhead(10),
    pointOfContactId: 'p1',
    contactChangedAt: null,
    overdueTasks: 0,
    hasNextStep: true,
    ...overrides,
  }
}

describe('opportunity health', () => {
  it('has weights that sum 100 and an action per factor', () => {
    expect(totalWeight(OPPORTUNITY_FACTOR_SPECS)).toBe(100)
    for (const key of OPPORTUNITY_FACTOR_KEYS) {
      expect(OPPORTUNITY_NEXT_ACTIONS[key].label).not.toBe('')
    }
  })

  it('is healthy when moving', () => {
    const r = computeOpportunityHealth(signals())
    expect(r.riskScore).toBe(0)
    expect(r.level).toBe('LOW')
    expect(r.nextAction.key).toBe('advance')
    expect(r.missing).toEqual([])
  })

  it('says moved today when the last activity is from today', () => {
    const r = computeOpportunityHealth(
      signals({ lastActivityAt: now, lastInteractionAt: now }),
    )
    expect(r.factors).toEqual([])
  })

  it('flags a stalled deal and suggests reactivating it', () => {
    const r = computeOpportunityHealth(
      signals({
        lastActivityAt: daysAgo(40),
        lastInteractionAt: daysAgo(40),
        createdAt: daysAgo(90),
      }),
    )
    expect(r.factors[0]).toMatchObject({
      key: 'stalled',
      points: 35,
      detail: 'Sem movimentação há 40 dias',
    })
    expect(r.nextAction.key).toBe('reactivate')
    expect(r.level).toBe('MEDIUM')
  })

  it('counts from the creation date for a deal with no history', () => {
    const fresh = computeOpportunityHealth(
      signals({
        createdAt: daysAgo(2),
        lastActivityAt: null,
        lastInteractionAt: null,
      }),
    )
    expect(fresh.riskScore).toBe(0)
    const old = computeOpportunityHealth(
      signals({
        createdAt: daysAgo(45),
        lastActivityAt: null,
        lastInteractionAt: null,
      }),
    )
    expect(old.factors.map((f) => f.key)).toContain('engagement')
    expect(old.factors.find((f) => f.key === 'engagement')?.detail).toBe(
      'Nenhum contato com o cliente em 45 dias',
    )
  })

  it('uses the stage change as activity', () => {
    const r = computeOpportunityHealth(
      signals({
        lastActivityAt: daysAgo(40),
        lastInteractionAt: daysAgo(40),
        stageChangedAt: daysAgo(1),
      }),
    )
    expect(r.factors.find((f) => f.key === 'stalled')).toBeUndefined()
  })

  it('flags a missing or recently changed contact', () => {
    const none = computeOpportunityHealth(signals({ pointOfContactId: null }))
    expect(none.factors[0]).toMatchObject({
      key: 'contact',
      points: 15,
      detail: 'Negócio sem contato principal',
    })
    expect(none.nextAction.key).toBe('confirm_contact')

    const changed = computeOpportunityHealth(
      signals({ contactChangedAt: daysAgo(5) }),
    )
    expect(changed.factors[0]).toMatchObject({
      key: 'contact',
      points: 10,
      detail: 'O contato principal mudou há 5 dias',
    })

    const oldChange = computeOpportunityHealth(
      signals({ contactChangedAt: daysAgo(80) }),
    )
    expect(oldChange.factors).toEqual([])
  })

  it('reads the close date', () => {
    const none = computeOpportunityHealth(signals({ closeDate: null }))
    expect(none.factors[0]?.detail).toBe('Sem data de fechamento prevista')
    const late = computeOpportunityHealth(signals({ closeDate: daysAgo(15) }))
    expect(late.factors[0]).toMatchObject({
      key: 'close_date',
      detail: 'Data de fechamento vencida há 15 dias',
    })
    expect(late.nextAction.key).toBe('update_close_date')
    const today = computeOpportunityHealth(
      signals({ closeDate: new Date(now.getTime() - 3_600_000) }),
    )
    expect(today.factors).toEqual([])
  })

  it('flags overdue tasks and the lack of a next step', () => {
    const r = computeOpportunityHealth(
      signals({ overdueTasks: 2, hasNextStep: false }),
    )
    expect(r.factors.map((f) => f.key)).toEqual([
      'no_next_step',
      'overdue_tasks',
    ])
    expect(r.nextAction.key).toBe('schedule_next_step')
  })

  it('reaches the high band when everything is wrong', () => {
    const r = computeOpportunityHealth(
      signals({
        lastActivityAt: null,
        lastInteractionAt: null,
        createdAt: daysAgo(90),
        pointOfContactId: null,
        closeDate: daysAgo(40),
        overdueTasks: 4,
        hasNextStep: false,
      }),
    )
    expect(r.level).toBe('HIGH')
    expect(r.riskScore).toBe(100)
  })
})
