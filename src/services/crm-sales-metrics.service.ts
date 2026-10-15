import type { CrmQuotaPeriod, Prisma } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  businessDayProgress,
  DEFAULT_SALES_TIME_ZONE,
  daysBetween,
  dayWindow,
  holidaySet,
  type SalesPeriodKind,
  type SalesWindow,
  salesWindow,
  weekDays,
} from '@/src/lib/crm-sales/period'
import { localDayKey } from '@/src/lib/productivity/period'
import { ok, type Result } from '@/src/lib/result'
import {
  CrmSalesMetricsRepository,
  type SalesPersonRow,
  type WonDealRow,
} from '@/src/repositories/crm-sales-metrics.repository'
import type {
  SalesConfig,
  SalesMetric,
  SalesMetricOf,
  SalesMetricsQuery,
  SalesPeriodInfo,
  SalesPerson,
} from '@/src/schemas/crm-sales-metrics.schema'
import { assertModuleMember } from './authz'

/** Probability from which an open deal counts as "commit" in the forecast. */
export const COMMIT_PROBABILITY = 70

const DAY_MS = 86_400_000
const WINS_FEED_DAYS = 30
const DEFAULT_ROWS = 8
const DEFAULT_RANKING_ROWS = 10
const MAX_LEAD_SOURCES = 6
const UNASSIGNED = 'Sem responsável'
const NO_SOURCE = 'Sem origem'

export interface SalesClock {
  timeZone: string
  holidays: Set<string>
}

type Input = Pick<
  SalesConfig,
  'kind' | 'period' | 'pipelineId' | 'stalledDays' | 'limit'
>

const QUOTA_PERIOD: Record<SalesPeriodKind, CrmQuotaPeriod> = {
  month: 'MONTH',
  quarter: 'QUARTER',
}

function money(value: Prisma.Decimal | null): number {
  return value === null ? 0 : Number(value)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function pctOf(part: number, whole: number): number | null {
  return whole > 0 ? round1((part / whole) * 100) : null
}

function changePct(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null
  return round1(((current - previous) / previous) * 100)
}

function person(row: SalesPersonRow | null): SalesPerson | null {
  return row ? { id: row.id, name: row.name, image: row.image } : null
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function periodInfo(window: SalesWindow, timeZone: string): SalesPeriodInfo {
  return {
    key: window.key,
    label: window.label,
    fromDay: window.fromKey,
    toDay: window.toKey,
    endsAt: window.end.toISOString(),
    timeZone,
  }
}

function sumWon(rows: WonDealRow[]): number {
  return round2(rows.reduce((sum, row) => sum + money(row.amount), 0))
}

/** Sum of the quotas; `null` when none (or only zeros) was registered. */
function targetOf(quotas: { targetAmount: Prisma.Decimal }[]): number | null {
  const total = round2(
    quotas.reduce((sum, quota) => sum + Number(quota.targetAmount), 0),
  )
  return total > 0 ? total : null
}

/* --------------------------------- metrics -------------------------------- */

async function goal(
  workspaceId: string,
  input: Input,
  now: Date,
  clock: SalesClock,
): Promise<Result<SalesMetricOf<'goal'>>> {
  const window = salesWindow(now, clock.timeZone, input.period)
  const [won, quotas] = await Promise.all([
    CrmSalesMetricsRepository.listWonBetween(
      workspaceId,
      window.start,
      window.end,
    ),
    CrmSalesMetricsRepository.listQuotas(
      workspaceId,
      QUOTA_PERIOD[input.period],
      window.key,
    ),
  ])
  if (!won.ok) return won
  if (!quotas.ok) return quotas

  const wonAmount = sumWon(won.value)
  const targetAmount = targetOf(quotas.value)
  const days = businessDayProgress(
    window,
    localDayKey(now, clock.timeZone),
    clock.holidays,
  )
  const remaining =
    targetAmount === null ? null : round2(Math.max(0, targetAmount - wonAmount))
  const paceAmount =
    days.elapsed > 0 ? round2((wonAmount / days.elapsed) * days.total) : null

  let requiredPerDay: number | null = null
  if (remaining !== null) {
    if (remaining === 0) requiredPerDay = 0
    else if (days.left > 0) requiredPerDay = round2(remaining / days.left)
  }

  let onTrack: boolean | null = null
  if (targetAmount !== null) {
    onTrack =
      wonAmount >= targetAmount ||
      (paceAmount !== null && paceAmount >= targetAmount)
  }

  return ok({
    kind: 'goal',
    period: periodInfo(window, clock.timeZone),
    wonAmount,
    wonCount: won.value.length,
    targetAmount,
    pct: targetAmount === null ? null : pctOf(wonAmount, targetAmount),
    remaining,
    businessDays: days,
    requiredPerDay,
    paceAmount,
    onTrack,
  })
}

async function ranking(
  workspaceId: string,
  input: Input,
  now: Date,
  clock: SalesClock,
): Promise<Result<SalesMetricOf<'ranking'>>> {
  const window = salesWindow(now, clock.timeZone, input.period)
  const [won, quotas] = await Promise.all([
    CrmSalesMetricsRepository.listWonBetween(
      workspaceId,
      window.start,
      window.end,
    ),
    CrmSalesMetricsRepository.listQuotas(
      workspaceId,
      QUOTA_PERIOD[input.period],
      window.key,
    ),
  ])
  if (!won.ok) return won
  if (!quotas.ok) return quotas

  type Acc = {
    owner: SalesPerson
    wonAmount: number
    wonCount: number
    quotaAmount: number | null
  }
  const byOwner = new Map<string, Acc>()
  const accOf = (key: string, owner: SalesPerson): Acc => {
    let acc = byOwner.get(key)
    if (!acc) {
      acc = { owner, wonAmount: 0, wonCount: 0, quotaAmount: null }
      byOwner.set(key, acc)
    }
    return acc
  }

  for (const deal of won.value) {
    const owner = person(deal.owner)
    const acc = owner
      ? accOf(owner.id as string, owner)
      : accOf('', { id: null, name: UNASSIGNED, image: null })
    acc.wonAmount += money(deal.amount)
    acc.wonCount += 1
  }
  for (const quota of quotas.value) {
    const acc = accOf(quota.ownerId, person(quota.owner) as SalesPerson)
    const target = Number(quota.targetAmount)
    acc.quotaAmount = target > 0 ? target : null
  }

  const rows = [...byOwner.values()]
    .map((acc) => ({
      owner: acc.owner,
      wonAmount: round2(acc.wonAmount),
      wonCount: acc.wonCount,
      quotaAmount: acc.quotaAmount,
      pct:
        acc.quotaAmount === null ? null : pctOf(acc.wonAmount, acc.quotaAmount),
    }))
    .sort(
      (a, b) =>
        b.wonAmount - a.wonAmount ||
        (b.pct ?? -1) - (a.pct ?? -1) ||
        a.owner.name.localeCompare(b.owner.name, 'pt-BR'),
    )
    .slice(0, input.limit ?? DEFAULT_RANKING_ROWS)
    .map((row, index) => ({ position: index + 1, ...row }))

  return ok({
    kind: 'ranking',
    period: periodInfo(window, clock.timeZone),
    hasQuotas: quotas.value.length > 0,
    rows,
  })
}

async function pipeline(
  workspaceId: string,
  input: Input,
): Promise<Result<SalesMetricOf<'pipeline'>>> {
  const empty = {
    kind: 'pipeline' as const,
    pipeline: null,
    stages: [],
    totals: { count: 0, amount: 0, weightedAmount: 0 },
  }
  const found = await CrmSalesMetricsRepository.findPipeline(
    workspaceId,
    input.pipelineId,
  )
  if (!found.ok) return found
  if (!found.value) return ok(empty)

  const [stages, open] = await Promise.all([
    CrmSalesMetricsRepository.listStages(workspaceId, found.value.id),
    CrmSalesMetricsRepository.listOpen(workspaceId, found.value.id),
  ])
  if (!stages.ok) return stages
  if (!open.ok) return open

  const rows = stages.value
    .filter((stage) => stage.category === 'OPEN')
    .map((stage) => ({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      probability: stage.probability,
      count: 0,
      amount: 0,
      weightedAmount: 0,
    }))
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const deal of open.value) {
    const row = byId.get(deal.stage.id)
    if (!row) continue
    const amount = money(deal.amount)
    row.count += 1
    row.amount += amount
    row.weightedAmount +=
      (amount * (deal.probability ?? deal.stage.probability)) / 100
  }

  const totals = { count: 0, amount: 0, weightedAmount: 0 }
  for (const row of rows) {
    row.amount = round2(row.amount)
    row.weightedAmount = round2(row.weightedAmount)
    totals.count += row.count
    totals.amount += row.amount
    totals.weightedAmount += row.weightedAmount
  }

  return ok({
    kind: 'pipeline',
    pipeline: found.value,
    stages: rows,
    totals: {
      count: totals.count,
      amount: round2(totals.amount),
      weightedAmount: round2(totals.weightedAmount),
    },
  })
}

async function forecast(
  workspaceId: string,
  input: Input,
  now: Date,
  clock: SalesClock,
): Promise<Result<SalesMetricOf<'forecast'>>> {
  const window = salesWindow(now, clock.timeZone, input.period)
  const [won, open, quotas] = await Promise.all([
    CrmSalesMetricsRepository.listWonBetween(
      workspaceId,
      window.start,
      window.end,
      { pipelineId: input.pipelineId },
    ),
    CrmSalesMetricsRepository.listOpen(workspaceId, input.pipelineId),
    CrmSalesMetricsRepository.listQuotas(
      workspaceId,
      QUOTA_PERIOD[input.period],
      window.key,
    ),
  ])
  if (!won.ok) return won
  if (!open.ok) return open
  if (!quotas.ok) return quotas

  const wonAmount = sumWon(won.value)
  let commit = 0
  let best = 0
  let weighted = 0
  let openCount = 0
  for (const deal of open.value) {
    if (!deal.closeDate) continue
    const at = deal.closeDate.getTime()
    if (at < window.start.getTime() || at >= window.end.getTime()) continue
    const amount = money(deal.amount)
    const probability = deal.probability ?? deal.stage.probability
    openCount += 1
    best += amount
    weighted += (amount * probability) / 100
    if (probability >= COMMIT_PROBABILITY) commit += amount
  }

  return ok({
    kind: 'forecast',
    period: periodInfo(window, clock.timeZone),
    wonAmount,
    commitAmount: round2(wonAmount + commit),
    bestCaseAmount: round2(wonAmount + best),
    weightedAmount: round2(wonAmount + weighted),
    // Quotas are per owner, not per pipeline: no target on a pipeline cut.
    targetAmount: input.pipelineId ? null : targetOf(quotas.value),
    openCount,
  })
}

async function conversionWindow(workspaceId: string, window: SalesWindow) {
  const [leads, deals] = await Promise.all([
    CrmSalesMetricsRepository.countLeadFunnel(
      workspaceId,
      window.start,
      window.end,
    ),
    CrmSalesMetricsRepository.countDealFunnel(
      workspaceId,
      window.start,
      window.end,
    ),
  ])
  if (!leads.ok) return leads
  if (!deals.ok) return deals
  return ok({
    label: window.label,
    leads: leads.value.total,
    leadsToOpportunity: leads.value.converted,
    leadToOpportunityPct: pctOf(leads.value.converted, leads.value.total),
    opportunities: deals.value.total,
    opportunitiesWon: deals.value.won,
    opportunityToWonPct: pctOf(deals.value.won, deals.value.total),
  })
}

async function conversion(
  workspaceId: string,
  input: Input,
  now: Date,
  clock: SalesClock,
): Promise<Result<SalesMetricOf<'conversion'>>> {
  const [current, previous] = await Promise.all([
    conversionWindow(
      workspaceId,
      salesWindow(now, clock.timeZone, input.period),
    ),
    conversionWindow(
      workspaceId,
      salesWindow(now, clock.timeZone, input.period, -1),
    ),
  ])
  if (!current.ok) return current
  if (!previous.ok) return previous
  return ok({
    kind: 'conversion',
    current: current.value,
    previous: previous.value,
  })
}

function dealStatsOf(label: string, rows: WonDealRow[]) {
  const priced = rows.filter((row) => row.amount !== null)
  const averageTicket =
    priced.length > 0 ? round2(sumWon(priced) / priced.length) : null
  const averageCycleDays =
    rows.length > 0
      ? round1(
          rows.reduce(
            (sum, row) =>
              sum +
              Math.max(0, row.wonAt.getTime() - row.createdAt.getTime()) /
                DAY_MS,
            0,
          ) / rows.length,
        )
      : null
  return { label, wins: rows.length, averageTicket, averageCycleDays }
}

async function dealStats(
  workspaceId: string,
  input: Input,
  now: Date,
  clock: SalesClock,
): Promise<Result<SalesMetricOf<'deal-stats'>>> {
  const current = salesWindow(now, clock.timeZone, input.period)
  const previous = salesWindow(now, clock.timeZone, input.period, -1)
  const [a, b] = await Promise.all([
    CrmSalesMetricsRepository.listWonBetween(
      workspaceId,
      current.start,
      current.end,
    ),
    CrmSalesMetricsRepository.listWonBetween(
      workspaceId,
      previous.start,
      previous.end,
    ),
  ])
  if (!a.ok) return a
  if (!b.ok) return b

  const currentStats = dealStatsOf(current.label, a.value)
  const before = dealStatsOf(previous.label, b.value)
  return ok({
    kind: 'deal-stats',
    current: currentStats,
    previous: before,
    ticketChangePct: changePct(
      currentStats.averageTicket,
      before.averageTicket,
    ),
    cycleChangePct: changePct(
      currentStats.averageCycleDays,
      before.averageCycleDays,
    ),
  })
}

async function stalled(
  workspaceId: string,
  input: Input,
  now: Date,
): Promise<Result<SalesMetricOf<'stalled'>>> {
  const open = await CrmSalesMetricsRepository.listOpen(
    workspaceId,
    input.pipelineId,
  )
  if (!open.ok) return open
  const activity = await CrmSalesMetricsRepository.lastActivityByOpportunity(
    workspaceId,
    open.value.map((deal) => deal.id),
  )
  if (!activity.ok) return activity

  const threshold = input.stalledDays
  const idle = open.value
    .map((deal) => {
      const logged = activity.value.get(deal.id)
      const last =
        logged && logged.getTime() > deal.updatedAt.getTime()
          ? logged
          : deal.updatedAt
      return {
        deal,
        last,
        idleDays: Math.floor((now.getTime() - last.getTime()) / DAY_MS),
      }
    })
    .filter((entry) => entry.idleDays >= threshold)
    .sort(
      (a, b) =>
        b.idleDays - a.idleDays || money(b.deal.amount) - money(a.deal.amount),
    )

  return ok({
    kind: 'stalled',
    days: threshold,
    total: idle.length,
    totalAmount: round2(
      idle.reduce((sum, entry) => sum + money(entry.deal.amount), 0),
    ),
    rows: idle.slice(0, input.limit ?? DEFAULT_ROWS).map((entry) => ({
      id: entry.deal.id,
      name: entry.deal.name,
      amount: entry.deal.amount === null ? null : Number(entry.deal.amount),
      stageName: entry.deal.stage.name,
      companyName: entry.deal.company?.name ?? null,
      owner: person(entry.deal.owner),
      idleDays: entry.idleDays,
      lastActivityAt: entry.last.toISOString(),
    })),
  })
}

async function proposals(
  workspaceId: string,
  input: Input,
  now: Date,
  clock: SalesClock,
): Promise<Result<SalesMetricOf<'proposals'>>> {
  const result =
    await CrmSalesMetricsRepository.listWaitingProposals(workspaceId)
  if (!result.ok) return result

  const today = localDayKey(now, clock.timeZone)
  const week = weekDays(now, clock.timeZone)
  const rows = result.value
    .map((proposal) => {
      const expiresInDays = proposal.validUntil
        ? daysBetween(today, localDayKey(proposal.validUntil, clock.timeZone))
        : null
      return {
        id: proposal.id,
        name: proposal.name,
        status: proposal.status,
        validUntil: proposal.validUntil?.toISOString() ?? null,
        expiresInDays,
        expiringThisWeek:
          expiresInDays !== null &&
          daysBetween(today, week.toKey) >= expiresInDays,
        companyName: proposal.company?.name ?? null,
        amount: proposal.opportunity?.amount
          ? Number(proposal.opportunity.amount)
          : null,
        responsible: person(proposal.responsible) as SalesPerson,
      }
    })
    // Validity already over: the daily job will expire it, it is not waiting.
    .filter((row) => row.expiresInDays === null || row.expiresInDays >= 0)

  return ok({
    kind: 'proposals',
    waitingCount: rows.length,
    expiringThisWeekCount: rows.filter((row) => row.expiringThisWeek).length,
    rows: rows.slice(0, input.limit ?? DEFAULT_ROWS),
  })
}

async function scoreboard(
  workspaceId: string,
  now: Date,
  clock: SalesClock,
): Promise<Result<SalesMetricOf<'scoreboard'>>> {
  const day = dayWindow(now, clock.timeZone)
  const [won, activity, sources] = await Promise.all([
    CrmSalesMetricsRepository.listWonBetween(workspaceId, day.start, day.end),
    CrmSalesMetricsRepository.countDayActivity(workspaceId, day.start, day.end),
    CrmSalesMetricsRepository.groupLeadsBySource(
      workspaceId,
      day.start,
      day.end,
    ),
  ])
  if (!won.ok) return won
  if (!activity.ok) return activity
  if (!sources.ok) return sources

  const bySource = new Map<string, number>()
  let newLeads = 0
  for (const group of sources.value) {
    const label = group.source?.trim() || group.channel?.trim() || NO_SOURCE
    bySource.set(label, (bySource.get(label) ?? 0) + group.count)
    newLeads += group.count
  }

  return ok({
    kind: 'scoreboard',
    day: day.key,
    winsToday: won.value.length,
    amountToday: sumWon(won.value),
    meetingsToday: activity.value.meetings,
    activitiesToday: activity.value.tasksDone + activity.value.contactAttempts,
    newLeadsToday: newLeads,
    leadsBySource: [...bySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
      .slice(0, MAX_LEAD_SOURCES),
  })
}

async function winsFeed(
  workspaceId: string,
  input: Input,
  now: Date,
): Promise<Result<SalesMetricOf<'wins-feed'>>> {
  const won = await CrmSalesMetricsRepository.listWonBetween(
    workspaceId,
    new Date(now.getTime() - WINS_FEED_DAYS * DAY_MS),
    new Date(now.getTime() + 60_000),
    { limit: input.limit ?? DEFAULT_ROWS },
  )
  if (!won.ok) return won
  return ok({
    kind: 'wins-feed',
    rows: won.value.map((deal) => ({
      id: deal.id,
      opportunityName: deal.name,
      companyName: deal.company?.name ?? null,
      amount: deal.amount === null ? null : Number(deal.amount),
      owner: person(deal.owner),
      wonAt: deal.wonAt.toISOString(),
    })),
  })
}

export const CrmSalesMetricsService = {
  /**
   * Time zone and holidays of the workspace: its default business calendar
   * when there is one (ServiceDesk), else São Paulo without holidays.
   */
  async clock(workspaceId: string): Promise<Result<SalesClock>> {
    const calendar = await CrmSalesMetricsRepository.findClock(workspaceId)
    if (!calendar.ok) return calendar
    const zone = calendar.value?.timezone
    return ok({
      timeZone: zone && isTimeZone(zone) ? zone : DEFAULT_SALES_TIME_ZONE,
      holidays: holidaySet(calendar.value?.holidays),
    })
  },

  /**
   * Computes one metric for a workspace that was already authorized (the
   * route via {@link CrmSalesMetricsService.get}, the TV via its token).
   */
  async compute(
    workspaceId: string,
    input: Input,
    now: Date = new Date(),
  ): Promise<Result<SalesMetric>> {
    const clock = await CrmSalesMetricsService.clock(workspaceId)
    if (!clock.ok) return clock

    const result = await (async (): Promise<Result<SalesMetric>> => {
      switch (input.kind) {
        case 'goal':
          return goal(workspaceId, input, now, clock.value)
        case 'ranking':
          return ranking(workspaceId, input, now, clock.value)
        case 'pipeline':
          return pipeline(workspaceId, input)
        case 'forecast':
          return forecast(workspaceId, input, now, clock.value)
        case 'conversion':
          return conversion(workspaceId, input, now, clock.value)
        case 'deal-stats':
          return dealStats(workspaceId, input, now, clock.value)
        case 'stalled':
          return stalled(workspaceId, input, now)
        case 'proposals':
          return proposals(workspaceId, input, now, clock.value)
        case 'scoreboard':
          return scoreboard(workspaceId, now, clock.value)
        case 'wins-feed':
          return winsFeed(workspaceId, input, now)
      }
    })()

    if (!result.ok) {
      logger.error('crm_sales_metrics.compute_failed', {
        workspaceId,
        kind: input.kind,
        error: result.error.code,
      })
    }
    return result
  },

  /** One metric of the kit for a CRM member who can see opportunities. */
  async get(
    actorId: string,
    workspaceId: string,
    query: SalesMetricsQuery,
    now: Date = new Date(),
  ): Promise<Result<SalesMetric>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    return CrmSalesMetricsService.compute(workspaceId, query, now)
  },
}
