import { describe, expect, it } from 'vitest'
import {
  aggregateChart,
  aggregateCompare,
  aggregateTotal,
  applyPeriod,
  dateBucketOf,
  formatAggregate,
  formatDurationMinutes,
  periodStart,
  type Row,
  viewRows,
} from '@/app/_components/crm/dashboard/widget-data'
import {
  moduleOfBasePath,
  sourcesForBasePath,
} from '@/app/_components/crm/dashboard/widget-meta'
import {
  CHART_SOURCES,
  ChartConfigSchema,
  VIEW_SOURCES,
  ViewConfigSchema,
} from '@/src/schemas/crm-dashboard.schema'

const NOW = new Date(2026, 8, 22, 15, 0, 0)
const iso = (d: Date) => d.toISOString()
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

const chart = (input: Record<string, unknown>) =>
  ChartConfigSchema.parse({ source: 'sd-tickets', ...input })

const tickets: Row[] = [
  {
    id: 't1',
    priority: 'P1',
    resolutionMinutes: 30,
    slaResolutionMetPct: 100,
    isOpen: false,
    createdAt: iso(daysAgo(0)),
    resolvedAt: iso(daysAgo(0)),
  },
  {
    id: 't2',
    priority: 'P1',
    resolutionMinutes: 90,
    slaResolutionMetPct: 0,
    isOpen: false,
    createdAt: iso(daysAgo(2)),
    resolvedAt: iso(daysAgo(1)),
  },
  {
    id: 't3',
    priority: 'P2',
    resolutionMinutes: null,
    slaResolutionMetPct: null,
    isOpen: true,
    createdAt: iso(daysAgo(40)),
    resolvedAt: null,
  },
]

describe('aggregation modes', () => {
  it('averages numbers and ignores rows without a value (MTTR)', () => {
    const config = chart({
      chartType: 'aggregate',
      yField: 'resolutionMinutes',
      aggregation: 'avg',
    })
    expect(aggregateTotal(tickets, config, NOW)).toBe(60)
  })

  it('computes a compliance rate as the average of 0/100 flags', () => {
    const config = chart({
      chartType: 'aggregate',
      yField: 'slaResolutionMetPct',
      aggregation: 'avg',
    })
    expect(aggregateTotal(tickets, config, NOW)).toBe(50)
  })

  it('supports min, max, sum and explicit count', () => {
    const base = { chartType: 'aggregate', yField: 'resolutionMinutes' }
    expect(
      aggregateTotal(tickets, chart({ ...base, aggregation: 'min' })),
    ).toBe(30)
    expect(
      aggregateTotal(tickets, chart({ ...base, aggregation: 'max' })),
    ).toBe(90)
    expect(
      aggregateTotal(tickets, chart({ ...base, aggregation: 'sum' })),
    ).toBe(120)
    expect(
      aggregateTotal(tickets, chart({ ...base, aggregation: 'count' })),
    ).toBe(3)
  })

  it('returns 0 for avg/min/max without numbers and counts without a value field', () => {
    const empty = [{ id: 'x', resolutionMinutes: null }]
    for (const aggregation of ['avg', 'min', 'max'] as const) {
      expect(
        aggregateTotal(
          empty,
          chart({
            chartType: 'aggregate',
            yField: 'resolutionMinutes',
            aggregation,
          }),
        ),
      ).toBe(0)
    }
    expect(
      aggregateTotal(
        tickets,
        chart({ chartType: 'aggregate', aggregation: 'avg' }),
      ),
    ).toBe(3)
  })

  it('keeps the legacy auto mode (sum when numeric, count otherwise)', () => {
    expect(
      aggregateTotal(
        tickets,
        chart({ chartType: 'aggregate', yField: 'resolutionMinutes' }),
      ),
    ).toBe(120)
    expect(
      aggregateTotal(
        tickets,
        chart({ chartType: 'aggregate', yField: 'priority' }),
      ),
    ).toBe(3)
  })

  it('averages per category in a bar chart', () => {
    const data = aggregateChart(
      tickets,
      chart({
        chartType: 'vertical',
        xField: 'priority',
        yField: 'resolutionMinutes',
        aggregation: 'avg',
      }),
      NOW,
    )
    expect(data.categories).toEqual(['P1', 'P2'])
    expect(data.valueAt('P1', 'Total')).toBe(60)
    expect(data.valueAt('P2', 'Total')).toBe(0)
  })
})

describe('periods', () => {
  it('filters rows by the period on the chosen date field', () => {
    const today = chart({
      chartType: 'aggregate',
      period: 'today',
      periodField: 'resolvedAt',
    })
    expect(aggregateTotal(tickets, today, NOW)).toBe(1)
    const month = chart({ chartType: 'aggregate', period: 'month' })
    expect(aggregateTotal(tickets, month, NOW)).toBe(2)
  })

  it('computes the start of every period', () => {
    expect(periodStart('today', NOW).getHours()).toBe(0)
    expect(periodStart('7d', NOW).getTime()).toBe(daysAgo(7).getTime())
    expect(periodStart('30d', NOW).getTime()).toBe(daysAgo(30).getTime())
    expect(periodStart('90d', NOW).getTime()).toBe(daysAgo(90).getTime())
    expect(periodStart('month', NOW).getDate()).toBe(1)
    expect(periodStart('year', NOW).getMonth()).toBe(0)
  })

  it('skips rows without a valid date and keeps all rows without a period', () => {
    const rows = [{ createdAt: 'nope' }, { createdAt: null }, { createdAt: 5 }]
    expect(applyPeriod(rows, { period: '7d' }, NOW)).toEqual([])
    expect(applyPeriod(rows, {}, NOW)).toBe(rows)
    expect(
      applyPeriod(
        [{ date: iso(NOW) }],
        { period: '7d', source: 'socials' },
        NOW,
      ),
    ).toHaveLength(1)
  })
})

describe('date buckets', () => {
  it('groups by day in chronological order', () => {
    const rows = [
      { createdAt: iso(daysAgo(0)) },
      { createdAt: iso(daysAgo(2)) },
      { createdAt: iso(daysAgo(0)) },
    ]
    const data = aggregateChart(
      rows,
      chart({ chartType: 'line', xField: 'createdAt', dateBucket: 'day' }),
      NOW,
    )
    expect(data.categories).toHaveLength(2)
    expect(data.valueAt(data.categories[0], 'Total')).toBe(1)
    expect(data.valueAt(data.categories[1], 'Total')).toBe(2)
  })

  it('labels weeks from monday and months', () => {
    const week = dateBucketOf(iso(NOW), 'week')
    expect(week?.label.startsWith('Sem.')).toBe(true)
    expect(week?.key).toBe('2026-09-21')
    expect(dateBucketOf(iso(NOW), 'month')?.key).toBe('2026-09-01')
    expect(dateBucketOf('x', 'day')).toBeNull()
  })

  it('sorts bucketed categories by date when an x sort is set', () => {
    const rows = [
      { createdAt: iso(daysAgo(0)) },
      { createdAt: iso(daysAgo(40)) },
    ]
    const data = aggregateChart(
      rows,
      chart({
        chartType: 'vertical',
        xField: 'createdAt',
        dateBucket: 'month',
        xSort: 'desc',
      }),
      NOW,
    )
    expect(dateBucketOf(iso(NOW), 'month')?.label).toBe(data.categories[0])
  })

  it('splits series with groupBy (created × resolved)', () => {
    const events = [
      { flow: 'Criados', createdAt: iso(daysAgo(1)) },
      { flow: 'Resolvidos', createdAt: iso(daysAgo(1)) },
      { flow: 'Criados', createdAt: iso(daysAgo(1)) },
    ]
    const data = aggregateChart(
      events,
      chart({
        chartType: 'line',
        source: 'sd-ticket-events',
        xField: 'createdAt',
        dateBucket: 'day',
        groupBy: 'flow',
      }),
      NOW,
    )
    const day = data.categories[0]
    expect(data.valueAt(day, 'Criados')).toBe(2)
    expect(data.valueAt(day, 'Resolvidos')).toBe(1)
  })
})

describe('limits, sorting and compare', () => {
  it('keeps only the top N categories', () => {
    const rows = [
      { customer: 'A' },
      { customer: 'B' },
      { customer: 'B' },
      { customer: 'C' },
    ]
    const data = aggregateChart(
      rows,
      chart({
        chartType: 'horizontal',
        xField: 'customer',
        ySort: 'desc',
        limit: 1,
      }),
      NOW,
    )
    expect(data.categories).toEqual(['B'])
  })

  it('accumulates with the new aggregation engine', () => {
    const rows = [{ day: 'a' }, { day: 'b' }, { day: 'b' }]
    const data = aggregateChart(
      rows,
      chart({ chartType: 'line', xField: 'day', cumulative: true }),
      NOW,
    )
    expect(data.valueAt('b', 'Total')).toBe(3)
  })

  it('compares periods on a custom date field', () => {
    const config = chart({
      chartType: 'aggregate',
      compareRange: '7d',
      periodField: 'resolvedAt',
    })
    const result = aggregateCompare(
      [
        ...tickets,
        { id: 'old', resolvedAt: iso(daysAgo(10)) },
        { id: 'bad', resolvedAt: 'x' },
      ],
      config,
      NOW,
    )
    expect(result).toEqual({ current: 2, previous: 1, changePct: 100 })
  })

  it('formats integers, averages and fixed decimals in pt-BR', () => {
    expect(formatAggregate(1200, {})).toBe('1.200')
    expect(formatAggregate(12.345, { aggregation: 'avg' })).toBe('12,3')
    expect(formatAggregate(12, { decimals: 2 })).toBe('12,00')
    expect(formatAggregate(2.5, {})).toBe('2,5')
  })

  it('turns minutes into hours and days', () => {
    expect(formatDurationMinutes(0)).toBe('0min')
    expect(formatDurationMinutes(45)).toBe('45min')
    expect(formatDurationMinutes(60)).toBe('1h')
    expect(formatDurationMinutes(114.3)).toBe('1h 54min')
    expect(formatDurationMinutes(1439)).toBe('23h 59min')
    expect(formatDurationMinutes(1440)).toBe('1d')
    expect(formatDurationMinutes(21208)).toBe('14d 17h')
    expect(formatDurationMinutes(28763)).toBe('19d 23h')
    expect(formatAggregate(114.3, { valueFormat: 'duration' })).toBe('1h 54min')
  })

  it('applies period, filters, sort and limit to a table', () => {
    const config = ViewConfigSchema.parse({
      source: 'sd-tickets',
      filters: [{ field: 'isOpen', operator: 'equals', value: 'false' }],
      sort: [{ field: 'resolutionMinutes', direction: 'desc' }],
      limit: 1,
      period: '30d',
    })
    expect(viewRows(tickets, config, NOW).map((r) => r.id)).toEqual(['t2'])
  })
})

describe('module sources', () => {
  it('offers only ServiceDesk sources to ServiceDesk dashboards', () => {
    expect(moduleOfBasePath('servicedesk')).toBe('SERVICE_DESK')
    expect(moduleOfBasePath('whatsapp')).toBe('COMMUNICATION')
    expect(moduleOfBasePath('crm')).toBe('CRM')
    expect(sourcesForBasePath(VIEW_SOURCES, 'servicedesk')).toEqual([
      'sd-tickets',
      'sd-ticket-costs',
      'sd-ticket-events',
      'sd-kb-articles',
    ])
    const crm = sourcesForBasePath(CHART_SOURCES, 'crm')
    expect(crm).toContain('socials')
    expect(crm).toContain('whatsapp-conversations')
    expect(crm).not.toContain('sd-tickets')
  })
})
