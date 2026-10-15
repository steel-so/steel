import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DashboardDisplayProvider } from '@/app/_components/crm/dashboard/dashboard-display'
import {
  ConversionBlock,
  DealStatsBlock,
  ForecastBlock,
  GoalBlock,
  PipelineBlock,
  ProposalsBlock,
  RankingBlock,
  ScoreboardBlock,
  StalledBlock,
  WinsFeedBlock,
  winSentence,
} from '@/app/_components/crm/dashboard/sales/sales-blocks'
import {
  firstName,
  formatAgo,
  formatBrl,
  formatChange,
  formatDays,
  formatPct,
  initialsOf,
} from '@/app/_components/crm/dashboard/sales/sales-format'
import { SalesWidget } from '@/app/_components/crm/dashboard/sales/sales-widget'
import { salesMetricsQuery } from '@/app/_components/crm/dashboard/sales/use-sales-metric'
import { mockFetch } from '@/src/__tests__/component-utils'
import type { SalesMetricOf } from '@/src/schemas/crm-sales-metrics.schema'

const PERIOD = {
  key: '2026-10',
  label: 'outubro de 2026',
  fromDay: '2026-10-01',
  toDay: '2026-10-31',
  endsAt: '2026-11-01T03:00:00.000Z',
  timeZone: 'America/Sao_Paulo',
}
const ana = { id: 'u1', name: 'Ana Souza', image: null }
const bruno = { id: 'u2', name: 'Bruno Lima', image: null }

function goal(
  overrides: Partial<SalesMetricOf<'goal'>> = {},
): SalesMetricOf<'goal'> {
  return {
    kind: 'goal',
    period: PERIOD,
    wonAmount: 33_000,
    wonCount: 2,
    targetAmount: 66_000,
    pct: 50,
    remaining: 33_000,
    businessDays: { total: 22, elapsed: 11, left: 12 },
    requiredPerDay: 2750,
    paceAmount: 70_000,
    onTrack: true,
    ...overrides,
  }
}

describe('sales-format', () => {
  it('formats money, percent, days and trends in pt-BR', () => {
    expect(formatBrl(18_400)).toBe('R$ 18.400')
    expect(formatBrl(1_250_000, true)).toBe('R$ 1,3 mi')
    expect(formatBrl(99_000, true)).toBe('R$ 99.000')
    expect(formatPct(null)).toBe('—')
    expect(formatPct(7.25)).toBe('7,3%')
    expect(formatDays(null)).toBe('—')
    expect(formatDays(1)).toBe('1 dia')
    expect(formatDays(12.5)).toBe('12,5 dias')
    expect(formatChange(12.5)).toBe('+12,5%')
    expect(formatChange(-3)).toBe('−3%')
    expect(formatChange(0)).toBe('0%')
  })

  it('builds initials, first names and relative times', () => {
    expect(initialsOf('Ana Maria Souza')).toBe('AS')
    expect(initialsOf('ana')).toBe('A')
    expect(initialsOf('  ')).toBe('?')
    expect(firstName('Ana Souza')).toBe('Ana')
    expect(firstName('')).toBe('')
    const now = new Date('2026-10-15T15:00:00.000Z')
    expect(formatAgo('2026-10-15T14:59:40.000Z', now)).toBe('agora')
    expect(formatAgo('2026-10-15T14:55:00.000Z', now)).toBe('há 5 min')
    expect(formatAgo('2026-10-15T12:00:00.000Z', now)).toBe('há 3 h')
    expect(formatAgo('2026-10-14T12:00:00.000Z', now)).toBe('há 1 dia')
    expect(formatAgo('2026-10-12T12:00:00.000Z', now)).toBe('há 3 dias')
  })
})

describe('<GoalBlock />', () => {
  it('shows won vs target, the daily need and the pace', () => {
    render(<GoalBlock metric={goal()} />)
    expect(screen.getByTestId('sales-goal-won').textContent).toBe('R$ 33.000')
    expect(screen.getByText(/de R\$ 66.000 · 2 negócios ganhos/)).toBeTruthy()
    expect(screen.getByTestId('sales-goal-pct').textContent).toBe('50%')
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('R$ 2.750')).toBeTruthy()
    expect(screen.getByTestId('sales-goal-pace').textContent).toBe(
      'No ritmo atual, fecha o mês em R$ 70.000',
    )
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '50',
    )
  })

  it('asks for quotas instead of inventing a target', () => {
    render(
      <GoalBlock
        metric={goal({
          targetAmount: null,
          pct: null,
          remaining: null,
          wonCount: 1,
        })}
      />,
    )
    expect(screen.getByText(/Cadastre as metas/)).toBeTruthy()
    expect(screen.getByText('1 negócio ganho')).toBeTruthy()
  })

  it('celebrates a hit target and handles missing pace', () => {
    render(<GoalBlock metric={goal({ wonAmount: 70_000, pct: 106 })} />)
    expect(screen.getByText(/Meta batida/)).toBeTruthy()
    render(
      <GoalBlock
        metric={goal({
          paceAmount: null,
          requiredPerDay: null,
          onTrack: false,
        })}
      />,
    )
    expect(screen.getAllByText('—')).toHaveLength(1)
    expect(screen.queryByTestId('sales-goal-pace')).toBeNull()
  })
})

describe('<RankingBlock />', () => {
  it('ranks sellers with podium positions and quota share', () => {
    render(
      <RankingBlock
        metric={{
          kind: 'ranking',
          period: PERIOD,
          hasQuotas: true,
          rows: [
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
              quotaAmount: null,
              pct: null,
            },
          ],
        }}
      />,
    )
    const rows = screen.getAllByTestId('sales-ranking-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('1º')
    expect(rows[0].textContent).toContain('Ana Souza')
    expect(rows[0].textContent).toContain('120% da meta')
    expect(rows[1].textContent).toContain('sem meta')
  })

  it('explains an empty ranking and unassigned wins', () => {
    const { unmount } = render(
      <RankingBlock
        metric={{ kind: 'ranking', period: PERIOD, hasQuotas: false, rows: [] }}
      />,
    )
    expect(
      screen.getByText('Nenhuma venda ganha em outubro de 2026 ainda.'),
    ).toBeTruthy()
    unmount()
    render(
      <RankingBlock
        metric={{
          kind: 'ranking',
          period: PERIOD,
          hasQuotas: false,
          rows: [
            {
              position: 1,
              owner: { id: null, name: 'Sem responsável', image: null },
              wonAmount: 1000,
              wonCount: 1,
              quotaAmount: null,
              pct: null,
            },
          ],
        }}
      />,
    )
    expect(
      screen.getByText(/Defina o responsável das oportunidades para ranquear/),
    ).toBeTruthy()
  })
})

describe('<PipelineBlock /> and <ForecastBlock />', () => {
  it('lists stages with weighted amounts', () => {
    render(
      <PipelineBlock
        metric={{
          kind: 'pipeline',
          pipeline: { id: 'p1', name: 'Vendas' },
          stages: [
            {
              id: 's1',
              name: 'Qualificação',
              color: null,
              probability: 20,
              count: 2,
              amount: 15_000,
              weightedAmount: 3000,
            },
            {
              id: 's2',
              name: 'Proposta',
              color: null,
              probability: 60,
              count: 0,
              amount: 0,
              weightedAmount: 0,
            },
          ],
          totals: { count: 2, amount: 15_000, weightedAmount: 3000 },
        }}
      />,
    )
    expect(screen.getAllByTestId('sales-pipeline-stage')).toHaveLength(2)
    expect(screen.getByText(/Vendas · 2 abertas/)).toBeTruthy()
  })

  it('tells what to configure without pipeline or stages', () => {
    const empty = {
      kind: 'pipeline' as const,
      stages: [],
      totals: { count: 0, amount: 0, weightedAmount: 0 },
    }
    const { unmount } = render(
      <PipelineBlock metric={{ ...empty, pipeline: null }} />,
    )
    expect(screen.getByText('Nenhum pipeline no CRM.')).toBeTruthy()
    unmount()
    render(
      <PipelineBlock metric={{ ...empty, pipeline: { id: 'p', name: 'X' } }} />,
    )
    expect(
      screen.getByText('Este pipeline não tem etapas abertas.'),
    ).toBeTruthy()
  })

  it('shows commit, weighted and best case', () => {
    render(
      <ForecastBlock
        metric={{
          kind: 'forecast',
          period: PERIOD,
          wonAmount: 10_000,
          commitAmount: 18_000,
          bestCaseAmount: 22_000,
          weightedAmount: 17_200,
          targetAmount: 50_000,
          openCount: 2,
        }}
      />,
    )
    expect(screen.getByText('Comprometido (≥ 70%)')).toBeTruthy()
    expect(screen.getByText('R$ 18.000')).toBeTruthy()
    expect(screen.getByText(/meta R\$ 50.000/)).toBeTruthy()
  })
})

describe('<ConversionBlock /> and <DealStatsBlock />', () => {
  const window = (label: string, lead: number | null, won: number | null) => ({
    label,
    leads: 40,
    leadsToOpportunity: 10,
    leadToOpportunityPct: lead,
    opportunities: 8,
    opportunitiesWon: 2,
    opportunityToWonPct: won,
  })

  it('compares rates with the previous period in p.p.', () => {
    render(
      <ConversionBlock
        metric={{
          kind: 'conversion',
          current: window('outubro de 2026', 25, 25),
          previous: window('setembro de 2026', 20, null),
        }}
      />,
    )
    expect(screen.getByTestId('sales-conversion-lead').textContent).toBe('25%')
    expect(screen.getByText('+5 p.p.')).toBeTruthy()
    expect(screen.getByText('setembro de 2026: —')).toBeTruthy()
  })

  it('has an empty state for a month without leads or deals', () => {
    render(
      <ConversionBlock
        metric={{
          kind: 'conversion',
          current: {
            ...window('outubro de 2026', null, null),
            leads: 0,
            opportunities: 0,
          },
          previous: window('setembro de 2026', null, null),
        }}
      />,
    )
    expect(
      screen.getByText('Sem leads nem oportunidades em outubro de 2026.'),
    ).toBeTruthy()
  })

  it('shows ticket and cycle with a trend where lower cycle is better', () => {
    render(
      <DealStatsBlock
        metric={{
          kind: 'deal-stats',
          current: {
            label: 'out',
            wins: 2,
            averageTicket: 10_000,
            averageCycleDays: 15,
          },
          previous: {
            label: 'setembro de 2026',
            wins: 1,
            averageTicket: 8000,
            averageCycleDays: 20,
          },
          ticketChangePct: 25,
          cycleChangePct: -25,
        }}
      />,
    )
    expect(screen.getByTestId('sales-ticket').textContent).toBe('R$ 10.000')
    expect(screen.getByTestId('sales-cycle').textContent).toBe('15 dias')
    expect(screen.getByText('+25%')).toBeTruthy()
    expect(screen.getByText('−25%')).toBeTruthy()
  })

  it('explains deal stats without wins', () => {
    render(
      <DealStatsBlock
        metric={{
          kind: 'deal-stats',
          current: {
            label: 'a',
            wins: 0,
            averageTicket: null,
            averageCycleDays: null,
          },
          previous: {
            label: 'b',
            wins: 0,
            averageTicket: null,
            averageCycleDays: null,
          },
          ticketChangePct: null,
          cycleChangePct: null,
        }}
      />,
    )
    expect(screen.getByText('Sem negócios ganhos para calcular.')).toBeTruthy()
  })
})

describe('<StalledBlock />, <ProposalsBlock /> and <ScoreboardBlock />', () => {
  it('lists stalled deals or praises the team', () => {
    const { unmount } = render(
      <StalledBlock
        metric={{
          kind: 'stalled',
          days: 14,
          total: 3,
          totalAmount: 14_000,
          rows: [
            {
              id: 'o1',
              name: 'Renovação',
              amount: 5000,
              stageName: 'Proposta',
              companyName: 'ACME',
              owner: ana,
              idleDays: 40,
              lastActivityAt: '2026-09-05T12:00:00.000Z',
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('3 parados')).toBeTruthy()
    expect(screen.getByTestId('sales-stalled-row').textContent).toContain(
      '40 dias',
    )
    unmount()
    render(
      <StalledBlock
        metric={{
          kind: 'stalled',
          days: 14,
          total: 0,
          totalAmount: 0,
          rows: [],
        }}
      />,
    )
    expect(screen.getByText(/Nenhum negócio parado há 14\+ dias/)).toBeTruthy()
  })

  it('lists proposals with their expiry', () => {
    const row = {
      id: 'p',
      name: 'Proposta A',
      status: 'VIEWED' as const,
      validUntil: '2026-10-16T02:59:59.999Z',
      expiresInDays: 0,
      expiringThisWeek: true,
      companyName: 'ACME',
      amount: 7000,
      responsible: bruno,
    }
    const { unmount } = render(
      <ProposalsBlock
        metric={{
          kind: 'proposals',
          waitingCount: 3,
          expiringThisWeekCount: 1,
          rows: [
            row,
            {
              ...row,
              id: 'q',
              status: 'SENT',
              expiresInDays: 1,
              companyName: null,
              amount: null,
            },
            { ...row, id: 'r', expiresInDays: 6, expiringThisWeek: false },
            { ...row, id: 's', expiresInDays: null, expiringThisWeek: false },
          ],
        }}
      />,
    )
    expect(screen.getByText('3 aguardando')).toBeTruthy()
    expect(screen.getByText(/1 vencem esta semana/)).toBeTruthy()
    expect(screen.getByText('vence hoje')).toBeTruthy()
    expect(screen.getByText('vence amanhã')).toBeTruthy()
    expect(screen.getByText('vence em 6 dias')).toBeTruthy()
    expect(screen.getByText('sem validade')).toBeTruthy()
    expect(screen.getAllByText(/vista pelo cliente/).length).toBeGreaterThan(0)
    unmount()
    render(
      <ProposalsBlock
        metric={{
          kind: 'proposals',
          waitingCount: 0,
          expiringThisWeekCount: 0,
          rows: [],
        }}
      />,
    )
    expect(
      screen.getByText('Nenhuma proposta aguardando resposta.'),
    ).toBeTruthy()
  })

  it('shows today numbers and leads by source', () => {
    render(
      <ScoreboardBlock
        metric={{
          kind: 'scoreboard',
          day: '2026-10-15',
          winsToday: 2,
          amountToday: 2000,
          meetingsToday: 3,
          activitiesToday: 10,
          newLeadsToday: 4,
          leadsBySource: [
            { source: 'Site', count: 3 },
            { source: 'WhatsApp', count: 1 },
          ],
        }}
      />,
    )
    expect(screen.getByTestId('sales-scoreboard-wins').textContent).toBe('2')
    expect(screen.getByTestId('sales-scoreboard-amount').textContent).toBe(
      'R$ 2.000',
    )
    expect(screen.getByText(/Site \(3\) · WhatsApp \(1\)/)).toBeTruthy()
  })
})

describe('<WinsFeedBlock />', () => {
  const win = {
    id: 'w1',
    opportunityName: 'Renovação anual',
    companyName: 'Empresa X',
    amount: 18_400,
    owner: ana,
    wonAt: '2026-10-15T14:55:00.000Z',
  }

  it('writes the win sentence without contact data', () => {
    expect(winSentence(win)).toBe('Ana fechou R$ 18.400 com Empresa X')
    expect(
      winSentence({ ...win, owner: null, amount: null, companyName: null }),
    ).toBe('O time fechou com Renovação anual')
  })

  it('highlights fresh wins and has an empty state', () => {
    const { unmount } = render(
      <WinsFeedBlock
        metric={{ kind: 'wins-feed', rows: [win, { ...win, id: 'w2' }] }}
        now={new Date('2026-10-15T15:00:00.000Z')}
        freshIds={new Set(['w1'])}
      />,
    )
    const rows = screen.getAllByTestId('sales-win-row')
    expect(rows[0].getAttribute('data-fresh')).toBe('true')
    expect(rows[1].getAttribute('data-fresh')).toBeNull()
    expect(rows[0].textContent).toContain('há 5 min')
    unmount()
    render(
      <WinsFeedBlock
        metric={{ kind: 'wins-feed', rows: [] }}
        now={new Date()}
      />,
    )
    expect(
      screen.getByText('Nenhuma vitória nos últimos 30 dias.'),
    ).toBeTruthy()
  })
})

describe('<SalesWidget />', () => {
  it('loads the metric from the workspace route', async () => {
    const spy = mockFetch([{ match: '/crm/sales-metrics', data: goal() }])
    render(
      <SalesWidget
        workspaceId='ws1'
        widgetId='w1'
        config={{ kind: 'goal', pipelineId: 'p1', limit: 3 }}
      />,
    )
    expect((await screen.findByTestId('sales-goal-pct')).textContent).toBe(
      '50%',
    )
    expect(String(spy.mock.calls[0][0])).toBe(
      '/api/workspaces/ws1/crm/sales-metrics?kind=goal&period=month&pipelineId=p1&stalledDays=14&limit=3',
    )
  })

  it('loads the metric through the TV link', async () => {
    const spy = mockFetch([
      {
        match: '/api/crm/tv/tok/widgets/w1',
        data: { type: 'SALES', metric: goal() },
      },
    ])
    render(
      <DashboardDisplayProvider variant='tv' tvToken='tok'>
        <SalesWidget workspaceId='' widgetId='w1' config={{ kind: 'goal' }} />
      </DashboardDisplayProvider>,
    )
    expect(await screen.findByTestId('sales-goal-won')).toBeTruthy()
    expect(String(spy.mock.calls[0][0])).toBe('/api/crm/tv/tok/widgets/w1')
  })

  it('shows the API error and invalid configs', async () => {
    mockFetch([
      {
        match: '/crm/sales-metrics',
        status: 403,
        error: 'Permissão insuficiente',
      },
    ])
    const { unmount } = render(
      <SalesWidget workspaceId='ws1' config={{ kind: 'ranking' }} />,
    )
    await waitFor(() =>
      expect(screen.getByText('Permissão insuficiente')).toBeTruthy(),
    )
    unmount()
    render(<SalesWidget workspaceId='ws1' config={{ kind: 'nope' }} />)
    expect(
      screen.getByText('Configuração inválida. Edite o widget.'),
    ).toBeTruthy()
  })

  it('renders every kind through the dispatcher', async () => {
    mockFetch([
      {
        match: 'kind=wins-feed',
        data: { kind: 'wins-feed', rows: [] },
      },
    ])
    render(<SalesWidget workspaceId='ws1' config={{ kind: 'wins-feed' }} />)
    expect(
      await screen.findByText('Nenhuma vitória nos últimos 30 dias.'),
    ).toBeTruthy()
  })

  it('builds the query with defaults', () => {
    expect(
      salesMetricsQuery({
        kind: 'scoreboard',
        period: 'quarter',
        stalledDays: 14,
      }),
    ).toBe('kind=scoreboard&period=quarter&stalledDays=14')
  })
})
