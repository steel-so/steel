import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { SiteAnalyticsDTO } from '@/types/site-platform'
import { deltaText, formatDay, SiteMetrics } from '../metrics/site-metrics'
import { fakeSite, SITE_ID, WS } from './harness'

vi.mock('@nivo/line', () => ({
  ResponsiveLine: ({ ariaLabel }: { ariaLabel: string }) => (
    <div role='img' aria-label={ariaLabel} />
  ),
}))

const BASE = `/api/workspaces/${WS}/crm/sites/${SITE_ID}`

function analytics(
  overrides: Partial<SiteAnalyticsDTO> = {},
): SiteAnalyticsDTO {
  return {
    siteId: SITE_ID,
    timezone: 'America/Sao_Paulo',
    from: '2026-10-09',
    to: '2026-10-15',
    totals: { views: 120, visitors: 80, conversions: 6, conversionRate: 0.05 },
    previous: { views: 100, visitors: 0, conversions: 6 },
    days: [
      { date: '2026-10-14', views: 60, visitors: 40, conversions: 3 },
      { date: '2026-10-15', views: 60, visitors: 40, conversions: 3 },
    ],
    topPages: [
      { key: '/', label: 'Início', views: 90, visitors: 60 },
      { key: '/antiga', label: null, views: 30, visitors: 20 },
    ],
    referrers: [
      { key: null, views: 70, visitors: 50 },
      { key: 'www.google.com', views: 50, visitors: 30 },
    ],
    utmSources: [{ key: 'instagram', views: 40, visitors: 30 }],
    utmMediums: [{ key: 'social', views: 40, visitors: 30 }],
    utmCampaigns: [],
    conversionsByPage: [
      {
        path: '/contato',
        label: 'Contato',
        views: 50,
        conversions: 5,
        rate: 0.1,
      },
      { path: '/sumiu', label: null, views: 10, conversions: 1, rate: 0.1 },
    ],
    ...overrides,
  }
}

function setup(
  data: SiteAnalyticsDTO | null = analytics(),
  status = 'PUBLISHED',
) {
  const spy = mockFetch([
    data
      ? { match: `${BASE}/analytics`, data }
      : { match: `${BASE}/analytics`, status: 500, error: 'x' },
    {
      match: new RegExp(`${BASE}$`),
      data: fakeSite({ status: status as 'PUBLISHED' }),
    },
    { match: `${BASE}/pages`, data: [] },
    { match: `${BASE}/globals`, data: [] },
  ])
  renderWithQuery(
    <SiteMetrics
      workspaceId={WS}
      slug='acme'
      siteId={SITE_ID}
      now={new Date('2026-10-15T15:00:00Z')}
    />,
  )
  return spy
}

beforeEach(() => vi.clearAllMocks())

describe('site metrics helpers', () => {
  it('formats days and deltas without the browser timezone', () => {
    expect(formatDay('2026-10-05')).toBe('5 out')
    expect(deltaText(120, 100)).toBe('+20% vs. período anterior')
    expect(deltaText(50, 100)).toBe('-50% vs. período anterior')
    expect(deltaText(0, 0)).toBe('Sem variação')
    expect(deltaText(3, 0)).toBe('Sem dados no período anterior')
  })
})

describe('<SiteMetrics />', () => {
  it('shows totals, the daily chart, breakdowns and conversions', async () => {
    const spy = setup()
    expect(await screen.findByText('Clínica São Lucas')).toBeTruthy()
    await screen.findByText('120')
    expect(screen.getByText('+20% vs. período anterior')).toBeTruthy()
    expect(screen.getByText('Sem dados no período anterior')).toBeTruthy()
    expect(screen.getByText('5%')).toBeTruthy()
    expect(
      screen.getByRole('img', { name: 'Visitas e visitantes por dia' }),
    ).toBeTruthy()
    const pages = screen.getByRole('list', { name: 'Visitas por página' })
    expect(within(pages).getByText('Início')).toBeTruthy()
    expect(within(pages).getByText('/antiga')).toBeTruthy()
    expect(screen.getByText('Acesso direto')).toBeTruthy()
    expect(screen.getByText('instagram')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Campanha' }))
    expect(screen.getByText('Nenhuma visita com UTM no período.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Meio' }))
    expect(screen.getByText('social')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByText('Contato')).toBeTruthy()
    expect(within(table).getByText('/sumiu')).toBeTruthy()
    // Last 30 days in the site's timezone.
    expect(
      spy.mock.calls.some(([url]) =>
        String(url).endsWith('/analytics?from=2026-09-16&to=2026-10-15'),
      ),
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '7 dias' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) =>
          String(url).endsWith('/analytics?from=2026-10-09&to=2026-10-15'),
        ),
      ).toBe(true),
    )
    expect(
      screen
        .getByRole('button', { name: '7 dias' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByText('Abrir editor').closest('a')?.getAttribute('href'),
    ).toBe('/acme/crm/sites/site_1')
  })

  it('explains empty periods and drafts', async () => {
    setup(
      analytics({
        totals: { views: 0, visitors: 0, conversions: 0, conversionRate: 0 },
        previous: { views: 0, visitors: 0, conversions: 0 },
        topPages: [],
        referrers: [],
        utmSources: [],
        conversionsByPage: [],
      }),
      'DRAFT',
    )
    expect(
      await screen.findByText('Ainda não há visitas neste período.'),
    ).toBeTruthy()
    expect(screen.getByText(/ainda não foi publicado/)).toBeTruthy()
    expect(screen.getByText(/Nenhum formulário enviado/)).toBeTruthy()
  })

  it('tells when the metrics fail to load', async () => {
    setup(null)
    expect(
      await screen.findByText(/Não foi possível carregar as métricas/),
    ).toBeTruthy()
  })
})
