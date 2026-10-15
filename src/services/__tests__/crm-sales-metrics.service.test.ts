import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-sales-metrics.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import {
  CrmSalesMetricsRepository,
  type OpenDealRow,
  type WaitingProposalRow,
  type WonDealRow,
} from '@/src/repositories/crm-sales-metrics.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type {
  SalesConfig,
  SalesMetricOf,
} from '@/src/schemas/crm-sales-metrics.schema'
import { CrmSalesMetricsService } from '../crm-sales-metrics.service'

const repo = vi.mocked(CrmSalesMetricsRepository)
const memberships = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

/** Thursday 15/10/2026, noon in São Paulo. */
const NOW = new Date('2026-10-15T15:00:00.000Z')
const DAY = 86_400_000

const ana = { id: 'u-ana', name: 'Ana Souza', image: 'https://img/ana.png' }
const bruno = { id: 'u-bruno', name: 'Bruno Lima', image: null }

function dec(value: number | null) {
  return value === null ? null : new Prisma.Decimal(value)
}

function won(overrides: Partial<WonDealRow> & { amount?: number | null }) {
  const { amount = 1000, ...rest } = overrides
  return {
    id: 'o1',
    name: 'Negócio',
    amount: dec(amount),
    ownerId: ana.id,
    createdAt: new Date(NOW.getTime() - 10 * DAY),
    wonAt: new Date(NOW.getTime() - DAY),
    owner: ana,
    company: { name: 'Empresa X' },
    ...rest,
  } as WonDealRow
}

function open(overrides: Partial<OpenDealRow> & { amount?: number | null }) {
  const { amount = 1000, ...rest } = overrides
  return {
    id: 'op1',
    name: 'Aberta',
    amount: dec(amount),
    probability: null,
    closeDate: null,
    updatedAt: new Date(NOW.getTime() - DAY),
    pipelineId: 'p1',
    stage: {
      id: 's1',
      name: 'Qualificação',
      probability: 20,
      color: null,
      position: 0,
    },
    owner: ana,
    company: null,
    ...rest,
  } as OpenDealRow
}

function quota(owner: typeof ana, target: number) {
  return { ownerId: owner.id, targetAmount: new Prisma.Decimal(target), owner }
}

function config(overrides: Partial<SalesConfig> = {}) {
  return {
    kind: 'goal' as const,
    period: 'month' as const,
    stalledDays: 14,
    ...overrides,
  }
}

async function compute<K extends SalesConfig['kind']>(
  kind: K,
  overrides: Partial<SalesConfig> = {},
) {
  const result = await CrmSalesMetricsService.compute(
    'ws1',
    config({ ...overrides, kind }),
    NOW,
  )
  return expectOk(result) as SalesMetricOf<K>
}

beforeEach(() => {
  repo.findClock.mockResolvedValue(ok(null))
  repo.listWonBetween.mockResolvedValue(ok([]))
  repo.listQuotas.mockResolvedValue(ok([]))
  repo.listOpen.mockResolvedValue(ok([]))
  repo.lastActivityByOpportunity.mockResolvedValue(ok(new Map()))
  repo.countLeadFunnel.mockResolvedValue(ok({ total: 0, converted: 0 }))
  repo.countDealFunnel.mockResolvedValue(ok({ total: 0, won: 0 }))
  repo.listWaitingProposals.mockResolvedValue(ok([]))
  repo.countDayActivity.mockResolvedValue(
    ok({ meetings: 0, tasksDone: 0, contactAttempts: 0 }),
  )
  repo.groupLeadsBySource.mockResolvedValue(ok([]))
  repo.findPipeline.mockResolvedValue(ok({ id: 'p1', name: 'Vendas' }))
  repo.listStages.mockResolvedValue(ok([]))
})

describe('CrmSalesMetricsService.clock()', () => {
  it('defaults to São Paulo without holidays', async () => {
    const clock = expectOk(await CrmSalesMetricsService.clock('ws1'))
    expect(clock.timeZone).toBe('America/Sao_Paulo')
    expect(clock.holidays.size).toBe(0)
  })

  it('uses the default business calendar zone and holidays', async () => {
    repo.findClock.mockResolvedValue(
      ok({
        timezone: 'America/Manaus',
        holidays: [{ date: '2026-10-12', name: 'Aparecida' }],
      }),
    )
    const clock = expectOk(await CrmSalesMetricsService.clock('ws1'))
    expect(clock.timeZone).toBe('America/Manaus')
    expect(clock.holidays.has('2026-10-12')).toBe(true)
  })

  it('ignores an invalid time zone', async () => {
    repo.findClock.mockResolvedValue(
      ok({ timezone: 'Mars/Base', holidays: [] }),
    )
    const clock = expectOk(await CrmSalesMetricsService.clock('ws1'))
    expect(clock.timeZone).toBe('America/Sao_Paulo')
  })

  it('propagates a database error', async () => {
    repo.findClock.mockResolvedValue(err(databaseError()))
    expectErr(await CrmSalesMetricsService.clock('ws1'), 'DATABASE_ERROR')
    expectErr(
      await CrmSalesMetricsService.compute('ws1', config(), NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('goal', () => {
  it('reads the month of São Paulo and the MONTH quotas', async () => {
    await compute('goal')
    const [, from, to] = repo.listWonBetween.mock.calls[0]
    expect(from.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(to.toISOString()).toBe('2026-11-01T03:00:00.000Z')
    expect(repo.listQuotas).toHaveBeenCalledWith('ws1', 'MONTH', '2026-10')
  })

  it('computes %, remaining, business days, required per day and pace', async () => {
    repo.listWonBetween.mockResolvedValue(
      ok([won({ id: 'a', amount: 20_000 }), won({ id: 'b', amount: 13_000 })]),
    )
    repo.listQuotas.mockResolvedValue(
      ok([quota(ana, 40_000), quota(bruno, 26_000)]),
    )
    const goal = await compute('goal')
    expect(goal).toMatchObject({
      wonAmount: 33_000,
      wonCount: 2,
      targetAmount: 66_000,
      pct: 50,
      remaining: 33_000,
      businessDays: { total: 22, elapsed: 11, left: 12 },
      requiredPerDay: 2750,
      paceAmount: 66_000,
      onTrack: true,
    })
    expect(goal.period).toMatchObject({
      key: '2026-10',
      label: 'outubro de 2026',
      endsAt: '2026-11-01T03:00:00.000Z',
      timeZone: 'America/Sao_Paulo',
    })
  })

  it('is off track when the pace misses the target', async () => {
    repo.listWonBetween.mockResolvedValue(ok([won({ amount: 10_000 })]))
    repo.listQuotas.mockResolvedValue(ok([quota(ana, 100_000)]))
    const goal = await compute('goal')
    expect(goal.onTrack).toBe(false)
    expect(goal.paceAmount).toBe(20_000)
  })

  it('is on track once the target is hit, with nothing more per day', async () => {
    repo.listWonBetween.mockResolvedValue(ok([won({ amount: 50_000 })]))
    repo.listQuotas.mockResolvedValue(ok([quota(ana, 40_000)]))
    const goal = await compute('goal')
    expect(goal).toMatchObject({
      remaining: 0,
      requiredPerDay: 0,
      onTrack: true,
    })
  })

  it('has no target (and no fake one) without quotas', async () => {
    repo.listWonBetween.mockResolvedValue(ok([won({ amount: null })]))
    const goal = await compute('goal')
    expect(goal).toMatchObject({
      wonAmount: 0,
      wonCount: 1,
      targetAmount: null,
      pct: null,
      remaining: null,
      requiredPerDay: null,
      onTrack: null,
    })
  })

  it('treats quotas of zero as no target', async () => {
    repo.listQuotas.mockResolvedValue(ok([quota(ana, 0)]))
    expect((await compute('goal')).targetAmount).toBeNull()
  })

  it('subtracts holidays of the business calendar', async () => {
    repo.findClock.mockResolvedValue(
      ok({ timezone: 'America/Sao_Paulo', holidays: [{ date: '2026-10-12' }] }),
    )
    const goal = await compute('goal')
    expect(goal.businessDays).toEqual({ total: 21, elapsed: 10, left: 12 })
  })

  it('has no daily need when no business day is left', async () => {
    // Saturday 31/10: no business day left, pace still over 22 days.
    repo.listWonBetween.mockResolvedValue(ok([won({ amount: 10_000 })]))
    repo.listQuotas.mockResolvedValue(ok([quota(ana, 20_000)]))
    const goal = expectOk(
      await CrmSalesMetricsService.compute(
        'ws1',
        config(),
        new Date('2026-10-31T15:00:00.000Z'),
      ),
    ) as SalesMetricOf<'goal'>
    expect(goal.businessDays.left).toBe(0)
    expect(goal.requiredPerDay).toBeNull()
  })

  it('has no pace before the first business day', async () => {
    // Saturday 01/08/2026: no business day elapsed yet.
    const goal = expectOk(
      await CrmSalesMetricsService.compute(
        'ws1',
        config(),
        new Date('2026-08-01T15:00:00.000Z'),
      ),
    ) as SalesMetricOf<'goal'>
    expect(goal.paceAmount).toBeNull()
  })

  it('uses QUARTER quotas for the quarter', async () => {
    await compute('goal', { period: 'quarter' })
    expect(repo.listQuotas).toHaveBeenCalledWith('ws1', 'QUARTER', '2026-Q4')
  })

  it('propagates database errors', async () => {
    repo.listWonBetween.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute('ws1', config(), NOW),
      'DATABASE_ERROR',
    )
    expect(logger.error).toHaveBeenCalledWith(
      'crm_sales_metrics.compute_failed',
      expect.objectContaining({ kind: 'goal' }),
    )
    repo.listWonBetween.mockResolvedValue(ok([]))
    repo.listQuotas.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute('ws1', config(), NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('ranking', () => {
  it('ranks by won amount with % of the individual quota', async () => {
    repo.listWonBetween.mockResolvedValue(
      ok([
        won({ id: 'a', amount: 5000, owner: bruno, ownerId: bruno.id }),
        won({ id: 'b', amount: 8000 }),
        won({ id: 'c', amount: 4000 }),
      ]),
    )
    repo.listQuotas.mockResolvedValue(
      ok([quota(ana, 10_000), quota(bruno, 20_000)]),
    )
    const ranking = await compute('ranking')
    expect(ranking.hasQuotas).toBe(true)
    expect(ranking.rows).toEqual([
      {
        position: 1,
        owner: ana,
        wonAmount: 12_000,
        wonCount: 2,
        quotaAmount: 10_000,
        pct: 120,
      },
      {
        position: 2,
        owner: bruno,
        wonAmount: 5000,
        wonCount: 1,
        quotaAmount: 20_000,
        pct: 25,
      },
    ])
  })

  it('lists quota holders who have not sold yet and unassigned wins', async () => {
    repo.listWonBetween.mockResolvedValue(
      ok([won({ id: 'x', amount: 3000, owner: null, ownerId: null })]),
    )
    repo.listQuotas.mockResolvedValue(ok([quota(bruno, 0), quota(ana, 9000)]))
    const ranking = await compute('ranking')
    expect(
      ranking.rows.map((row) => [row.owner.name, row.wonAmount, row.pct]),
    ).toEqual([
      ['Sem responsável', 3000, null],
      ['Ana Souza', 0, 0],
      ['Bruno Lima', 0, null],
    ])
  })

  it('caps the rows with the limit', async () => {
    repo.listQuotas.mockResolvedValue(ok([quota(ana, 1), quota(bruno, 1)]))
    expect((await compute('ranking', { limit: 1 })).rows).toHaveLength(1)
  })

  it('is empty without wins nor quotas', async () => {
    const ranking = await compute('ranking')
    expect(ranking).toMatchObject({ hasQuotas: false, rows: [] })
  })

  it('propagates database errors', async () => {
    repo.listQuotas.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'ranking' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.listWonBetween.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'ranking' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('pipeline', () => {
  const stage = (
    id: string,
    name: string,
    probability: number,
    category: 'OPEN' | 'WON' | 'LOST' = 'OPEN',
  ) => ({
    id,
    name,
    pipelineId: 'p1',
    position: 0,
    probability,
    color: null,
    category,
  })

  it('weights open deals by stage with the deal override', async () => {
    repo.listStages.mockResolvedValue(
      ok([
        stage('s1', 'Qualificação', 20),
        stage('s2', 'Proposta', 60),
        stage('s3', 'Ganho', 100, 'WON'),
      ]),
    )
    repo.listOpen.mockResolvedValue(
      ok([
        open({ id: 'a', amount: 10_000 }),
        open({ id: 'b', amount: 5000, probability: 50 }),
        open({
          id: 'c',
          amount: 20_000,
          stage: {
            id: 's2',
            name: 'Proposta',
            probability: 60,
            color: null,
            position: 1,
          },
        }),
        open({
          id: 'd',
          amount: null,
          stage: {
            id: 'gone',
            name: 'Velha',
            probability: 10,
            color: null,
            position: 9,
          },
        }),
      ]),
    )
    const metric = await compute('pipeline', { pipelineId: 'p1' })
    expect(repo.findPipeline).toHaveBeenCalledWith('ws1', 'p1')
    expect(metric.pipeline).toEqual({ id: 'p1', name: 'Vendas' })
    expect(metric.stages).toEqual([
      expect.objectContaining({
        id: 's1',
        count: 2,
        amount: 15_000,
        weightedAmount: 4500,
      }),
      expect.objectContaining({
        id: 's2',
        count: 1,
        amount: 20_000,
        weightedAmount: 12_000,
      }),
    ])
    expect(metric.totals).toEqual({
      count: 3,
      amount: 35_000,
      weightedAmount: 16_500,
    })
  })

  it('is empty without a pipeline', async () => {
    repo.findPipeline.mockResolvedValue(ok(null))
    const metric = await compute('pipeline')
    expect(metric).toEqual({
      kind: 'pipeline',
      pipeline: null,
      stages: [],
      totals: { count: 0, amount: 0, weightedAmount: 0 },
    })
  })

  it('propagates database errors', async () => {
    repo.listOpen.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'pipeline' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.listStages.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'pipeline' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.findPipeline.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'pipeline' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('forecast', () => {
  it('splits commit, weighted and best case of deals closing in the period', async () => {
    repo.listWonBetween.mockResolvedValue(ok([won({ amount: 10_000 })]))
    repo.listQuotas.mockResolvedValue(ok([quota(ana, 50_000)]))
    const inOctober = new Date('2026-10-20T15:00:00.000Z')
    repo.listOpen.mockResolvedValue(
      ok([
        open({
          id: 'commit',
          amount: 8000,
          probability: 80,
          closeDate: inOctober,
        }),
        open({ id: 'low', amount: 4000, closeDate: inOctober }),
        open({
          id: 'nov',
          amount: 9000,
          probability: 90,
          closeDate: new Date('2026-11-05T15:00:00.000Z'),
        }),
        open({
          id: 'late',
          amount: 9000,
          closeDate: new Date('2026-09-20T15:00:00.000Z'),
        }),
        open({ id: 'nodate', amount: 9000 }),
      ]),
    )
    const metric = await compute('forecast')
    expect(metric).toMatchObject({
      wonAmount: 10_000,
      commitAmount: 18_000,
      bestCaseAmount: 22_000,
      weightedAmount: 10_000 + 6400 + 800,
      targetAmount: 50_000,
      openCount: 2,
    })
  })

  it('has no target on a pipeline cut', async () => {
    repo.listQuotas.mockResolvedValue(ok([quota(ana, 50_000)]))
    const metric = await compute('forecast', { pipelineId: 'p2' })
    expect(metric.targetAmount).toBeNull()
    expect(repo.listOpen).toHaveBeenCalledWith('ws1', 'p2')
    expect(repo.listWonBetween).toHaveBeenCalledWith(
      'ws1',
      expect.any(Date),
      expect.any(Date),
      { pipelineId: 'p2' },
    )
  })

  it('propagates database errors', async () => {
    for (const method of [
      'listQuotas',
      'listOpen',
      'listWonBetween',
    ] as const) {
      repo[method].mockResolvedValue(err(databaseError()) as never)
      expectErr(
        await CrmSalesMetricsService.compute(
          'ws1',
          config({ kind: 'forecast' }),
          NOW,
        ),
        'DATABASE_ERROR',
      )
    }
  })
})

describe('conversion', () => {
  it('compares this month with the previous one', async () => {
    repo.countLeadFunnel
      .mockResolvedValueOnce(ok({ total: 40, converted: 10 }))
      .mockResolvedValueOnce(ok({ total: 0, converted: 0 }))
    repo.countDealFunnel
      .mockResolvedValueOnce(ok({ total: 8, won: 2 }))
      .mockResolvedValueOnce(ok({ total: 5, won: 1 }))
    const metric = await compute('conversion')
    expect(metric.current).toEqual({
      label: 'outubro de 2026',
      leads: 40,
      leadsToOpportunity: 10,
      leadToOpportunityPct: 25,
      opportunities: 8,
      opportunitiesWon: 2,
      opportunityToWonPct: 25,
    })
    expect(metric.previous).toMatchObject({
      label: 'setembro de 2026',
      leadToOpportunityPct: null,
      opportunityToWonPct: 20,
    })
  })

  it('propagates database errors', async () => {
    repo.countDealFunnel.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'conversion' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.countLeadFunnel.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'conversion' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.countLeadFunnel.mockResolvedValueOnce(ok({ total: 1, converted: 1 }))
    repo.countDealFunnel
      .mockResolvedValueOnce(ok({ total: 1, won: 1 }))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'conversion' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('deal-stats', () => {
  it('averages ticket and cycle with trend', async () => {
    const created = new Date('2026-10-01T15:00:00.000Z')
    repo.listWonBetween
      .mockResolvedValueOnce(
        ok([
          won({
            id: 'a',
            amount: 10_000,
            createdAt: created,
            wonAt: new Date(created.getTime() + 10 * DAY),
          }),
          won({
            id: 'b',
            amount: null,
            createdAt: created,
            wonAt: new Date(created.getTime() + 20 * DAY),
          }),
        ]),
      )
      .mockResolvedValueOnce(
        ok([
          won({
            id: 'c',
            amount: 8000,
            createdAt: created,
            wonAt: new Date(created.getTime() + 20 * DAY),
          }),
        ]),
      )
    const metric = await compute('deal-stats')
    expect(metric.current).toEqual({
      label: 'outubro de 2026',
      wins: 2,
      averageTicket: 10_000,
      averageCycleDays: 15,
    })
    expect(metric.previous).toMatchObject({
      wins: 1,
      averageTicket: 8000,
      averageCycleDays: 20,
    })
    expect(metric.ticketChangePct).toBe(25)
    expect(metric.cycleChangePct).toBe(-25)
  })

  it('has no averages nor trend without wins', async () => {
    const metric = await compute('deal-stats')
    expect(metric.current).toMatchObject({
      wins: 0,
      averageTicket: null,
      averageCycleDays: null,
    })
    expect(metric.ticketChangePct).toBeNull()
    expect(metric.cycleChangePct).toBeNull()
  })

  it('propagates database errors', async () => {
    repo.listWonBetween
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'deal-stats' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.listWonBetween
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValueOnce(ok([]))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'deal-stats' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('stalled', () => {
  it('lists open deals idle for N days, most idle first', async () => {
    repo.listOpen.mockResolvedValue(
      ok([
        open({ id: 'fresh', updatedAt: new Date(NOW.getTime() - 2 * DAY) }),
        open({
          id: 'old',
          amount: 5000,
          updatedAt: new Date(NOW.getTime() - 40 * DAY),
          company: { name: 'ACME' },
        }),
        open({ id: 'touched', updatedAt: new Date(NOW.getTime() - 40 * DAY) }),
        open({
          id: 'mid',
          amount: null,
          owner: null,
          updatedAt: new Date(NOW.getTime() - 20 * DAY),
        }),
        open({
          id: 'tie',
          amount: 9000,
          updatedAt: new Date(NOW.getTime() - 20 * DAY),
        }),
      ]),
    )
    repo.lastActivityByOpportunity.mockResolvedValue(
      ok(
        new Map([
          ['touched', new Date(NOW.getTime() - DAY)],
          ['old', new Date(NOW.getTime() - 60 * DAY)],
        ]),
      ),
    )
    const metric = await compute('stalled', { stalledDays: 14, limit: 2 })
    expect(metric.days).toBe(14)
    expect(metric.total).toBe(3)
    expect(metric.totalAmount).toBe(14_000)
    expect(metric.rows.map((row) => [row.id, row.idleDays])).toEqual([
      ['old', 40],
      ['tie', 20],
    ])
    expect(metric.rows[0]).toMatchObject({
      companyName: 'ACME',
      stageName: 'Qualificação',
      owner: ana,
    })
  })

  it('keeps unassigned deals without amount', async () => {
    repo.listOpen.mockResolvedValue(
      ok([
        open({
          id: 'x',
          amount: null,
          owner: null,
          updatedAt: new Date(NOW.getTime() - 30 * DAY),
        }),
      ]),
    )
    const metric = await compute('stalled')
    expect(metric.rows[0]).toMatchObject({
      amount: null,
      owner: null,
      companyName: null,
    })
  })

  it('propagates database errors', async () => {
    repo.lastActivityByOpportunity.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'stalled' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.listOpen.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'stalled' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('proposals', () => {
  function proposal(
    overrides: Partial<WaitingProposalRow>,
  ): WaitingProposalRow {
    return {
      id: 'pr',
      name: 'Proposta',
      status: 'SENT',
      validUntil: null,
      company: null,
      opportunity: null,
      responsible: bruno,
      ...overrides,
    }
  }

  it('flags the ones expiring this week and drops the already expired', async () => {
    repo.listWaitingProposals.mockResolvedValue(
      ok([
        proposal({
          id: 'past',
          validUntil: new Date('2026-10-14T02:59:59.999Z'),
        }),
        proposal({
          id: 'today',
          status: 'VIEWED',
          validUntil: new Date('2026-10-16T02:59:59.999Z'),
          company: { name: 'ACME' },
          opportunity: { amount: dec(7000) },
        }),
        proposal({
          id: 'sunday',
          validUntil: new Date('2026-10-19T02:59:59.999Z'),
        }),
        proposal({
          id: 'next-week',
          validUntil: new Date('2026-10-20T02:59:59.999Z'),
          opportunity: { amount: null },
        }),
        proposal({ id: 'open-ended' }),
      ]),
    )
    const metric = await compute('proposals', { limit: 3 })
    expect(metric.waitingCount).toBe(4)
    expect(metric.expiringThisWeekCount).toBe(2)
    expect(
      metric.rows.map((row) => [
        row.id,
        row.expiresInDays,
        row.expiringThisWeek,
      ]),
    ).toEqual([
      ['today', 0, true],
      ['sunday', 3, true],
      ['next-week', 4, false],
    ])
    expect(metric.rows[0]).toMatchObject({
      companyName: 'ACME',
      amount: 7000,
      responsible: bruno,
    })
  })

  it('propagates database errors', async () => {
    repo.listWaitingProposals.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'proposals' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('scoreboard', () => {
  it('sums today in the workspace time zone', async () => {
    repo.listWonBetween.mockResolvedValue(
      ok([won({ amount: 1500 }), won({ id: 'b', amount: 500 })]),
    )
    repo.countDayActivity.mockResolvedValue(
      ok({ meetings: 3, tasksDone: 4, contactAttempts: 6 }),
    )
    repo.groupLeadsBySource.mockResolvedValue(
      ok([
        { source: 'Site', channel: null, count: 2 },
        { source: null, channel: 'WhatsApp', count: 3 },
        { source: '  ', channel: null, count: 1 },
        { source: 'Site', channel: 'Instagram', count: 1 },
      ]),
    )
    const metric = await compute('scoreboard')
    const [, from, to] = repo.listWonBetween.mock.calls[0]
    expect(from.toISOString()).toBe('2026-10-15T03:00:00.000Z')
    expect(to.toISOString()).toBe('2026-10-16T03:00:00.000Z')
    expect(metric).toEqual({
      kind: 'scoreboard',
      day: '2026-10-15',
      winsToday: 2,
      amountToday: 2000,
      meetingsToday: 3,
      activitiesToday: 10,
      newLeadsToday: 7,
      leadsBySource: [
        { source: 'Site', count: 3 },
        { source: 'WhatsApp', count: 3 },
        { source: 'Sem origem', count: 1 },
      ],
    })
  })

  it('propagates database errors', async () => {
    repo.groupLeadsBySource.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'scoreboard' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.countDayActivity.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'scoreboard' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.listWonBetween.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'scoreboard' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('wins-feed', () => {
  it('lists the latest wins of the last 30 days', async () => {
    repo.listWonBetween.mockResolvedValue(
      ok([
        won({ id: 'a', amount: 18_400 }),
        won({ id: 'b', amount: null, owner: null, company: null }),
      ]),
    )
    const metric = await compute('wins-feed', { limit: 5 })
    const [, from, , options] = repo.listWonBetween.mock.calls[0]
    expect(NOW.getTime() - from.getTime()).toBe(30 * DAY)
    expect(options).toEqual({ limit: 5 })
    expect(metric.rows).toEqual([
      {
        id: 'a',
        opportunityName: 'Negócio',
        companyName: 'Empresa X',
        amount: 18_400,
        owner: ana,
        wonAt: new Date(NOW.getTime() - DAY).toISOString(),
      },
      expect.objectContaining({
        id: 'b',
        amount: null,
        owner: null,
        companyName: null,
      }),
    ])
  })

  it('propagates database errors', async () => {
    repo.listWonBetween.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSalesMetricsService.compute(
        'ws1',
        config({ kind: 'wins-feed' }),
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmSalesMetricsService.get()', () => {
  it('returns FORBIDDEN for a non-member', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await CrmSalesMetricsService.get('u1', 'ws1', config(), NOW),
      'FORBIDDEN',
    )
    expect(repo.listWonBetween).not.toHaveBeenCalled()
  })

  it('returns MODULE_DISABLED when the CRM is off', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await CrmSalesMetricsService.get('u1', 'ws1', config(), NOW),
      'MODULE_DISABLED',
    )
  })

  it('computes the metric for a member', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    const metric = expectOk(
      await CrmSalesMetricsService.get('u1', 'ws1', config()),
    )
    expect(metric.kind).toBe('goal')
  })
})
