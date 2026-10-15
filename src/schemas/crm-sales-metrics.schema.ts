import z from 'zod'

/**
 * "Vendas" widget kit (ADR 0031): metrics of the sales team computed on the
 * server from opportunities, quotas, leads, proposals and activities. Each
 * kind is one widget; its config lives in `CrmDashboardWidget.config` (type
 * `SALES`) and is also the query of `GET …/crm/sales-metrics`.
 */
export const SALES_KINDS = [
  'goal',
  'ranking',
  'pipeline',
  'forecast',
  'conversion',
  'deal-stats',
  'stalled',
  'proposals',
  'scoreboard',
  'wins-feed',
] as const
export type SalesKind = (typeof SALES_KINDS)[number]

/** Goal / ranking / forecast window: the quota periods of `CrmQuota`. */
export const SALES_PERIODS = ['month', 'quarter'] as const
export type SalesPeriod = (typeof SALES_PERIODS)[number]

export const SALES_DEFAULT_STALLED_DAYS = 14

export const SalesConfigSchema = z.object({
  kind: z.enum(SALES_KINDS),
  /** Header of the widget (and of the TV block). */
  title: z.string().trim().max(120).optional(),
  period: z.enum(SALES_PERIODS).default('month'),
  /** Pipeline of the pipeline/forecast/stalled widgets (default: all). */
  pipelineId: z.string().trim().min(1).max(64).optional(),
  /** Open deals without activity for this many days are "stalled". */
  stalledDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(SALES_DEFAULT_STALLED_DAYS),
  /** Rows of ranking / stalled / proposals / wins feed. */
  limit: z.number().int().min(1).max(20).optional(),
})

export type SalesConfig = z.infer<typeof SalesConfigSchema>

/** Query string of `GET …/crm/sales-metrics` (numbers arrive as text). */
export const SalesMetricsQuerySchema = SalesConfigSchema.omit({
  title: true,
}).extend({
  stalledDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(SALES_DEFAULT_STALLED_DAYS),
  limit: z.coerce.number().int().min(1).max(20).optional(),
})

export type SalesMetricsQuery = z.infer<typeof SalesMetricsQuerySchema>

/* --------------------------------- output --------------------------------- */

const SalesPeriodInfoSchema = z.object({
  /** `2026-10` (month) or `2026-Q4` (quarter) — the `CrmQuota.periodKey`. */
  key: z.string(),
  label: z.string(),
  /** Inclusive first and last civil day, `YYYY-MM-DD`. */
  fromDay: z.string(),
  toDay: z.string(),
  /** Instant the period ends (exclusive), for the TV countdown. */
  endsAt: z.string(),
  timeZone: z.string(),
})

const PersonSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  image: z.string().nullable(),
})

export const SalesGoalSchema = z.object({
  kind: z.literal('goal'),
  period: SalesPeriodInfoSchema,
  wonAmount: z.number(),
  wonCount: z.number().int(),
  /** Sum of the period's quotas; `null` when none was registered. */
  targetAmount: z.number().nullable(),
  pct: z.number().nullable(),
  remaining: z.number().nullable(),
  businessDays: z.object({
    total: z.number().int(),
    elapsed: z.number().int(),
    left: z.number().int(),
  }),
  requiredPerDay: z.number().nullable(),
  /** Projection at the current pace (won ÷ elapsed × total business days). */
  paceAmount: z.number().nullable(),
  onTrack: z.boolean().nullable(),
})

export const SalesRankingSchema = z.object({
  kind: z.literal('ranking'),
  period: SalesPeriodInfoSchema,
  hasQuotas: z.boolean(),
  rows: z.array(
    z.object({
      position: z.number().int(),
      owner: PersonSchema,
      wonAmount: z.number(),
      wonCount: z.number().int(),
      quotaAmount: z.number().nullable(),
      pct: z.number().nullable(),
    }),
  ),
})

export const SalesPipelineSchema = z.object({
  kind: z.literal('pipeline'),
  pipeline: z.object({ id: z.string(), name: z.string() }).nullable(),
  stages: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().nullable(),
      probability: z.number().int(),
      count: z.number().int(),
      amount: z.number(),
      weightedAmount: z.number(),
    }),
  ),
  totals: z.object({
    count: z.number().int(),
    amount: z.number(),
    weightedAmount: z.number(),
  }),
})

export const SalesForecastSchema = z.object({
  kind: z.literal('forecast'),
  period: SalesPeriodInfoSchema,
  wonAmount: z.number(),
  /** Won + open deals closing in the period with probability ≥ 70%. */
  commitAmount: z.number(),
  /** Won + every open deal closing in the period. */
  bestCaseAmount: z.number(),
  /** Won + Σ open × probability. */
  weightedAmount: z.number(),
  targetAmount: z.number().nullable(),
  openCount: z.number().int(),
})

const ConversionWindowSchema = z.object({
  label: z.string(),
  leads: z.number().int(),
  leadsToOpportunity: z.number().int(),
  leadToOpportunityPct: z.number().nullable(),
  opportunities: z.number().int(),
  opportunitiesWon: z.number().int(),
  opportunityToWonPct: z.number().nullable(),
})

export const SalesConversionSchema = z.object({
  kind: z.literal('conversion'),
  current: ConversionWindowSchema,
  previous: ConversionWindowSchema,
})

const DealStatsWindowSchema = z.object({
  label: z.string(),
  wins: z.number().int(),
  averageTicket: z.number().nullable(),
  averageCycleDays: z.number().nullable(),
})

export const SalesDealStatsSchema = z.object({
  kind: z.literal('deal-stats'),
  current: DealStatsWindowSchema,
  previous: DealStatsWindowSchema,
  ticketChangePct: z.number().nullable(),
  cycleChangePct: z.number().nullable(),
})

export const SalesStalledSchema = z.object({
  kind: z.literal('stalled'),
  days: z.number().int(),
  total: z.number().int(),
  totalAmount: z.number(),
  rows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      amount: z.number().nullable(),
      stageName: z.string(),
      companyName: z.string().nullable(),
      owner: PersonSchema.nullable(),
      idleDays: z.number().int(),
      lastActivityAt: z.string(),
    }),
  ),
})

export const SalesProposalsSchema = z.object({
  kind: z.literal('proposals'),
  waitingCount: z.number().int(),
  expiringThisWeekCount: z.number().int(),
  rows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['SENT', 'VIEWED']),
      validUntil: z.string().nullable(),
      /** Civil days until it expires (0 = today); `null` without validity. */
      expiresInDays: z.number().int().nullable(),
      expiringThisWeek: z.boolean(),
      companyName: z.string().nullable(),
      amount: z.number().nullable(),
      responsible: PersonSchema,
    }),
  ),
})

export const SalesScoreboardSchema = z.object({
  kind: z.literal('scoreboard'),
  day: z.string(),
  winsToday: z.number().int(),
  amountToday: z.number(),
  meetingsToday: z.number().int(),
  activitiesToday: z.number().int(),
  newLeadsToday: z.number().int(),
  leadsBySource: z.array(
    z.object({ source: z.string(), count: z.number().int() }),
  ),
})

export const SalesWinsFeedSchema = z.object({
  kind: z.literal('wins-feed'),
  rows: z.array(
    z.object({
      id: z.string(),
      opportunityName: z.string(),
      companyName: z.string().nullable(),
      amount: z.number().nullable(),
      owner: PersonSchema.nullable(),
      wonAt: z.string(),
    }),
  ),
})

export const SalesMetricSchema = z.discriminatedUnion('kind', [
  SalesGoalSchema,
  SalesRankingSchema,
  SalesPipelineSchema,
  SalesForecastSchema,
  SalesConversionSchema,
  SalesDealStatsSchema,
  SalesStalledSchema,
  SalesProposalsSchema,
  SalesScoreboardSchema,
  SalesWinsFeedSchema,
])

export type SalesMetric = z.infer<typeof SalesMetricSchema>
export type SalesMetricOf<K extends SalesKind> = Extract<
  SalesMetric,
  { kind: K }
>
export type SalesPeriodInfo = z.infer<typeof SalesPeriodInfoSchema>
export type SalesPerson = z.infer<typeof PersonSchema>
