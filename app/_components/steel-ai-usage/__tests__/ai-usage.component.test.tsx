import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SteelAiProvider } from '@/app/_components/steel-ai/steel-ai-context'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import {
  toAiUsageAnalyticsDTO,
  toAiUsageOverviewDTO,
} from '@/src/mappers/ai-usage-analytics.mapper'
import { SteelAiAreaNav } from '../../steel-ai/steel-ai-area-nav'
import { AiUsageAnalytics } from '../ai-usage-analytics'
import { AiUsageOverview } from '../ai-usage-overview'

vi.setConfig({ testTimeout: 20_000 })

const pathname = vi.hoisted(() => ({ value: '/acme/ai/usage' }))
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

const WS = 'ws_1'
const NOW = new Date('2026-10-07T12:00:00.000Z')

function wrap(ui: React.ReactElement) {
  return renderWithQuery(
    <SteelAiProvider
      value={{ workspaceId: WS, slug: 'acme', firstName: 'Ana' }}
    >
      {ui}
    </SteelAiProvider>,
  )
}

const overview = toAiUsageOverviewDTO({
  daily: [
    { day: '2026-09-03', mineUsd: 2, workspaceUsd: 8 },
    { day: '2026-10-02', mineUsd: 1.5, workspaceUsd: 6 },
    { day: '2026-10-06', mineUsd: 0.5, workspaceUsd: 2 },
  ],
  monthlyQuotaUsd: 62,
  canViewWorkspace: false,
  now: NOW,
})

const range = {
  from: new Date('2026-10-01T00:00:00.000Z'),
  to: new Date('2026-10-08T00:00:00.000Z'),
}

function analytics(scope: 'personal' | 'workspace', empty = false) {
  return toAiUsageAnalyticsDTO({
    scope,
    period: 'this_month',
    range,
    groups: empty
      ? []
      : [
          {
            provider: 'anthropic',
            model: 'claude-sonnet-5',
            feature: 'SERVICEDESK_COPILOT',
            module: null,
            costUsd: 3,
            inputTokens: 12000,
            outputTokens: 900,
            calls: 4,
          },
        ],
    userGroups:
      scope === 'workspace'
        ? [
            {
              userId: 'u1',
              costUsd: 3,
              inputTokens: 1,
              outputTokens: 1,
              calls: 4,
            },
          ]
        : null,
    users: [{ id: 'u1', name: 'Bruno Lima', email: 'bruno@x.com' }],
    daily: [{ day: '2026-10-02', mineUsd: 3, workspaceUsd: 3 }],
    canViewWorkspace: scope === 'workspace',
  })
}

const never = () => new Promise<never>(() => {})

describe('<AiUsageOverview />', () => {
  it('shows a skeleton while loading', () => {
    mockFetch([{ match: '/ai/usage', handler: never }])
    wrap(<AiUsageOverview workspaceId={WS} />)
    expect(screen.getByTestId('usage-overview-loading')).toBeTruthy()
  })

  it('shows the error message when the request fails', async () => {
    mockFetch([{ match: '/ai/usage', status: 500, error: 'Falhou' }])
    wrap(<AiUsageOverview workspaceId={WS} />)
    expect(await screen.findByText('Falhou')).toBeTruthy()
  })

  it('shows the month, the week share and the trend with the toggle', async () => {
    mockFetch([{ match: '/ai/usage', data: overview }])
    wrap(<AiUsageOverview workspaceId={WS} />)

    expect(await screen.findByText('Você neste mês')).toBeTruthy()
    expect(screen.getAllByText('US$ 2,00').length).toBeGreaterThan(0)
    expect(screen.getByText('25% do gasto do espaço')).toBeTruthy()
    expect(screen.getByText('de US$ 62,00 da cota mensal')).toBeTruthy()
    expect(screen.getByText('Mês · outubro de 2026')).toBeTruthy()
    expect(screen.getByText('Semana · 05/10 – 11/10')).toBeTruthy()
    expect(
      screen.getByText(/US\$ 62,00 × 7 ÷ 31 dias do mês = US\$ 14,00/),
    ).toBeTruthy()
    expect(
      screen.getAllByText('Cota mensal do espaço (compartilhada)').length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('Total do mês passado')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Semana' }))
    expect(await screen.findByText('Total da semana passada')).toBeTruthy()
    expect(screen.getByText(/da parcela semanal/)).toBeTruthy()
  })

  it('shows "no base" when there is no previous usage', async () => {
    mockFetch([
      {
        match: '/ai/usage',
        data: toAiUsageOverviewDTO({
          daily: [],
          monthlyQuotaUsd: 50,
          canViewWorkspace: false,
          now: NOW,
        }),
      },
    ])
    wrap(<AiUsageOverview workspaceId={WS} />)
    expect(
      (await screen.findAllByText('sem base de comparação')).length,
    ).toBeGreaterThan(0)
  })
})

describe('<AiUsageAnalytics />', () => {
  it('shows a skeleton while loading', () => {
    mockFetch([{ match: '/ai/usage/analytics', handler: never }])
    wrap(<AiUsageAnalytics workspaceId={WS} canViewWorkspace={false} />)
    expect(screen.getByTestId('usage-analytics-loading')).toBeTruthy()
  })

  it('shows the empty state of the personal view and no workspace tab', async () => {
    mockFetch([
      { match: '/ai/usage/analytics', data: analytics('personal', true) },
    ])
    wrap(<AiUsageAnalytics workspaceId={WS} canViewWorkspace={false} />)
    expect(
      await screen.findByText('Você não usou IA neste período.'),
    ).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Espaço de trabalho' })).toBeNull()
  })

  it('shows the breakdowns and lets an admin switch to the workspace', async () => {
    const fetchSpy = mockFetch([
      {
        match: /scope=workspace/,
        data: analytics('workspace'),
      },
      { match: '/ai/usage/analytics', data: analytics('personal') },
    ])
    wrap(<AiUsageAnalytics workspaceId={WS} canViewWorkspace />)

    expect(await screen.findByText('Claude Sonnet 5')).toBeTruthy()
    expect(screen.getByText('Copiloto do ServiceDesk')).toBeTruthy()
    expect(screen.getByText('ServiceDesk')).toBeTruthy()
    expect(screen.queryByText('Por usuário')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Espaço de trabalho' }))
    expect(await screen.findByText('Bruno Lima')).toBeTruthy()
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes('scope=workspace&period=this_month'),
      ),
    ).toBe(true)
  })

  it('shows the error message when the request fails', async () => {
    mockFetch([
      { match: '/ai/usage/analytics', status: 403, error: 'Sem acesso' },
    ])
    wrap(<AiUsageAnalytics workspaceId={WS} canViewWorkspace={false} />)
    expect(await screen.findByText('Sem acesso')).toBeTruthy()
  })
})

describe('<SteelAiAreaNav />', () => {
  it('lists the Steel AI areas and marks the current one', () => {
    pathname.value = '/acme/ai/analytics'
    render(<SteelAiAreaNav slug='acme' />)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Skills',
      'Agentes',
      'Uso',
      'Análises',
      'Avaliações',
      'Memória',
    ])
    expect(
      screen
        .getByRole('link', { name: 'Análises' })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(
      screen.getByRole('link', { name: 'Agentes' }).getAttribute('href'),
    ).toBe('/acme/ai/agents')
    expect(
      screen.getByRole('link', { name: 'Uso' }).getAttribute('aria-current'),
    ).toBeNull()
  })
})
