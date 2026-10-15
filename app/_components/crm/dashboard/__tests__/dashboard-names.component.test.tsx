import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DashboardDisplayProvider } from '@/app/_components/crm/dashboard/dashboard-display'
import { clearDashboardRowsCache } from '@/app/_components/crm/dashboard/use-dashboard-rows'
import {
  aggregateChart,
  aggregateCompare,
  aggregateTotal,
  formatCell,
  passesFilters,
  refLabelsOf,
  viewRows,
} from '@/app/_components/crm/dashboard/widget-data'
import { sourceNeedsLookups } from '@/app/_components/crm/dashboard/widget-meta'
import { ViewWidget } from '@/app/_components/crm/dashboard/widgets/view-widget'
import { mockFetch } from '@/src/__tests__/component-utils'
import { clearDashboardLookupsCache } from '@/src/hooks/use-crm-dashboard-tv'
import {
  ChartConfigSchema,
  ViewConfigSchema,
} from '@/src/schemas/crm-dashboard.schema'
import type { CrmDashboardLookupsDTO } from '@/types/crm-dashboard'

const LOOKUPS: CrmDashboardLookupsDTO = {
  pipelines: [{ id: 'p1', name: 'Vendas' }],
  stages: [
    {
      id: 's1',
      name: 'Proposta enviada',
      pipelineId: 'p1',
      category: 'OPEN',
      color: null,
    },
    { id: 's2', name: 'Ganho', pipelineId: 'p1', category: 'WON', color: null },
  ],
  users: [{ id: 'u1', name: 'Ana Souza', image: null }],
}
const labels = refLabelsOf(LOOKUPS)

const ROWS = [
  {
    id: 'o1',
    name: 'A',
    stageId: 's1',
    ownerId: 'u1',
    amount: 100,
    createdAt: '2026-10-10T12:00:00.000Z',
  },
  {
    id: 'o2',
    name: 'B',
    stageId: 's2',
    ownerId: 'u1',
    amount: 300,
    createdAt: '2026-10-11T12:00:00.000Z',
  },
  {
    id: 'o3',
    name: 'C',
    stageId: 's1',
    ownerId: 'gone',
    amount: 50,
    createdAt: '2026-10-12T12:00:00.000Z',
  },
]

beforeEach(() => {
  clearDashboardRowsCache()
  clearDashboardLookupsCache()
})

describe('names behind ids', () => {
  it('maps stage, pipeline, people and lead stage fields', () => {
    expect(formatCell('stageId', 's1', labels)).toBe('Proposta enviada')
    expect(formatCell('pipelineId', 'p1', labels)).toBe('Vendas')
    expect(formatCell('ownerId', 'u1', labels)).toBe('Ana Souza')
    expect(formatCell('assigneeId', 'u1', labels)).toBe('Ana Souza')
    expect(formatCell('stage', 'QUALIFIED', labels)).toBe('Qualificado')
    // A user who left the workspace stays visible as the raw value.
    expect(formatCell('ownerId', 'gone', labels)).toBe('gone')
    expect(formatCell('amount', 10, labels)).toBe('10')
    expect(formatCell('stageId', 's1')).toBe('s1')
    expect(refLabelsOf(null)).toEqual({})
  })

  it('groups charts by stage name and owner name', () => {
    const config = ChartConfigSchema.parse({
      chartType: 'vertical',
      source: 'opportunities',
      xField: 'stageId',
      yField: 'amount',
      groupBy: 'ownerId',
    })
    const data = aggregateChart(ROWS, config, new Date(), labels)
    expect(data.categories).toEqual(['Proposta enviada', 'Ganho'])
    expect(data.seriesKeys).toEqual(['Ana Souza', 'gone'])
    expect(data.valueAt('Proposta enviada', 'Ana Souza')).toBe(100)
  })

  it('filters by the name as well as by the id', () => {
    const filter = (
      operator: 'equals' | 'contains' | 'not_equals',
      value: string,
    ) => ({
      field: 'stageId',
      operator,
      value,
    })
    expect(
      passesFilters(ROWS[0], [filter('equals', 'proposta enviada')], labels),
    ).toBe(true)
    expect(passesFilters(ROWS[0], [filter('equals', 's1')], labels)).toBe(true)
    expect(passesFilters(ROWS[0], [filter('contains', 'envia')], labels)).toBe(
      true,
    )
    expect(
      passesFilters(
        ROWS[0],
        [filter('not_equals', 'Proposta enviada')],
        labels,
      ),
    ).toBe(false)
    expect(
      passesFilters(
        ROWS[1],
        [filter('not_equals', 'Proposta enviada')],
        labels,
      ),
    ).toBe(true)
    expect(passesFilters(ROWS[0], [filter('contains', 'envia')])).toBe(false)

    const total = ChartConfigSchema.parse({
      chartType: 'aggregate',
      source: 'opportunities',
      yField: 'amount',
      aggregation: 'sum',
      filters: [filter('equals', 'Proposta enviada')],
      compareRange: '30d',
    })
    expect(aggregateTotal(ROWS, total, new Date(), labels)).toBe(150)
    expect(
      aggregateCompare(
        ROWS,
        total,
        new Date('2026-10-20T12:00:00.000Z'),
        labels,
      )?.current,
    ).toBe(150)
    const view = ViewConfigSchema.parse({
      source: 'opportunities',
      filters: [filter('equals', 'Ganho')],
    })
    expect(
      viewRows(ROWS, view, new Date(), labels).map((row) => row.id),
    ).toEqual(['o2'])
  })

  it('only fetches names for CRM sources with ids', () => {
    expect(sourceNeedsLookups('opportunities')).toBe(true)
    expect(sourceNeedsLookups('tasks')).toBe(true)
    expect(sourceNeedsLookups('forms')).toBe(false)
    expect(sourceNeedsLookups('sd-tickets')).toBe(false)
    expect(sourceNeedsLookups('socials')).toBe(false)
  })

  it('shows names in a table widget', async () => {
    const spy = mockFetch([
      { match: '/crm/dashboards/lookups', data: LOOKUPS },
      { match: '/crm/opportunities', data: ROWS },
    ])
    render(
      <ViewWidget
        workspaceId='ws1'
        config={ViewConfigSchema.parse({
          source: 'opportunities',
          fields: ['name', 'stageId', 'ownerId'],
        })}
      />,
    )
    await waitFor(() =>
      expect(screen.getAllByText('Proposta enviada')).toHaveLength(2),
    )
    expect(screen.getAllByText('Ana Souza')).toHaveLength(2)
    expect(screen.getByText('gone')).toBeTruthy()
    expect(
      spy.mock.calls.some(([url]) => String(url).includes('/lookups')),
    ).toBe(true)
  })

  it('reads rows and names through the TV link without workspace calls', async () => {
    const spy = mockFetch([
      {
        match: '/api/crm/tv/tok/widgets/w1',
        data: { type: 'ROWS', rows: ROWS },
      },
    ])
    render(
      <DashboardDisplayProvider variant='tv' tvToken='tok' lookups={LOOKUPS}>
        <ViewWidget
          workspaceId=''
          widgetId='w1'
          config={ViewConfigSchema.parse({
            source: 'opportunities',
            fields: ['name', 'stageId'],
          })}
        />
      </DashboardDisplayProvider>,
    )
    expect(await screen.findByText('Ganho')).toBeTruthy()
    expect(
      spy.mock.calls.every(([url]) => String(url).startsWith('/api/crm/tv/')),
    ).toBe(true)
  })
})
