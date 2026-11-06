import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { WhatsAppAgentReportDTO } from '@/types/whatsapp-agent-report'
import { WhatsappAgentReport } from '../whatsapp-agent-report'
import { WhatsappReportsTabs } from '../whatsapp-reports-tabs'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.setConfig({ testTimeout: 20_000 })

vi.mock('../whatsapp-sla-report', () => ({
  WhatsappSlaReport: () => <div>Relatório de SLA</div>,
}))
vi.mock('../whatsapp-reports-list', () => ({
  WhatsappReportsList: () => <div>Lista de relatórios</div>,
}))
vi.mock('../costs/whatsapp-costs-tab', () => ({
  WhatsAppCostsTab: () => <div>Custos</div>,
}))
vi.mock('../ads/whatsapp-ads-tab', () => ({
  WhatsAppAdsTab: () => <div>Anúncios</div>,
}))

const BASE = '/api/workspaces/ws_1/whatsapp'

const totals = {
  closed: 3,
  tabulated: 2,
  success: 1,
  failure: 1,
  successRate: 50,
  untabulated: 1,
  avgHandlingSeconds: 5400,
  open: 2,
  byStatus: [
    { label: 'Venda realizada', outcome: 'SUCCESS' as const, count: 1 },
    { label: 'Sem interesse', outcome: 'FAILURE' as const, count: 1 },
  ],
}

const report: WhatsAppAgentReportDTO = {
  fromDay: '2026-10-31',
  toDay: '2026-11-06',
  timeZone: 'America/Sao_Paulo',
  teamId: null,
  connectionId: null,
  visibility: 'ALL',
  rows: [
    { agentId: 'u1', agentName: 'Ana Souza', ...totals },
    {
      agentId: null,
      agentName: 'Sem atendente',
      ...totals,
      closed: 0,
      tabulated: 0,
      success: 0,
      failure: 0,
      successRate: null,
      untabulated: 0,
      avgHandlingSeconds: null,
      open: 1,
      byStatus: [],
    },
  ],
  totals,
  statuses: totals.byStatus,
}

function routes(data: WhatsAppAgentReportDTO = report) {
  return mockFetch([
    { match: `${BASE}/reports/agents`, data },
    { match: `${BASE}/teams`, data: [] },
    { match: `${BASE}/connections`, data: [] },
  ])
}

describe('<WhatsappReportsTabs /> — Atendentes tab', () => {
  it('does not render the tab (nor call the API) when the report is off', () => {
    const fetchSpy = routes()
    renderWithQuery(
      <WhatsappReportsTabs workspaceId='ws_1' slug='acme' canSeeCosts />,
    )
    expect(screen.queryByRole('tab', { name: 'Atendentes' })).toBeNull()
    expect(
      fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes('/reports/agents'),
      ),
    ).toBe(false)
  })

  it('ignores ?aba=atendentes while the report is off', () => {
    routes()
    renderWithQuery(
      <WhatsappReportsTabs
        workspaceId='ws_1'
        slug='acme'
        canSeeCosts={false}
        initialTab='atendentes'
      />,
    )
    expect(screen.getByText('Lista de relatórios')).toBeTruthy()
  })

  it('shows the tab when enabled, for any role', async () => {
    routes()
    renderWithQuery(
      <WhatsappReportsTabs
        workspaceId='ws_1'
        slug='acme'
        canSeeCosts={false}
        agentReportEnabled
      />,
    )
    const tab = screen.getByRole('tab', { name: 'Atendentes' })
    fireEvent.click(tab)
    expect(await screen.findByText('Ana Souza')).toBeTruthy()
  })

  it('opens straight on the tab with ?aba=atendentes', async () => {
    routes()
    renderWithQuery(
      <WhatsappReportsTabs
        workspaceId='ws_1'
        slug='acme'
        canSeeCosts
        agentReportEnabled
        initialTab='atendentes'
      />,
    )
    expect(await screen.findByText('Ana Souza')).toBeTruthy()
  })
})

describe('<WhatsappAgentReport />', () => {
  it('lists the agents, the total and the status breakdown', async () => {
    routes()
    renderWithQuery(<WhatsappAgentReport workspaceId='ws_1' />)

    expect(await screen.findByText('Ana Souza')).toBeTruthy()
    expect(screen.getByText('Sem atendente')).toBeTruthy()
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 h 30 min').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Venda realizada · 1/).length).toBeGreaterThan(0)
    expect(screen.getByText('Total')).toBeTruthy()
    expect(screen.getByText('Resumo por status de fechamento')).toBeTruthy()
    expect(
      screen.getByText(/Período: 31\/10\/2026 a 06\/11\/2026/),
    ).toBeTruthy()
  })

  it('asks for the last 7 days by default and points the CSV at the same filters', async () => {
    const fetchSpy = routes()
    renderWithQuery(<WhatsappAgentReport workspaceId='ws_1' />)
    await screen.findByText('Ana Souza')

    const url = String(
      fetchSpy.mock.calls.find((call) =>
        String(call[0]).includes('/reports/agents'),
      )?.[0],
    )
    const query = new URL(url, 'http://localhost').searchParams
    expect(query.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(query.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const csv = screen.getByRole('link', { name: /Exportar CSV/ })
    expect(csv.getAttribute('href')).toContain(
      `${BASE}/reports/agents?from=${query.get('from')}&to=${query.get('to')}&format=csv`,
    )
  })

  it('switches the period with a preset', async () => {
    const fetchSpy = routes()
    renderWithQuery(<WhatsappAgentReport workspaceId='ws_1' />)
    await screen.findByText('Ana Souza')

    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }))
    await waitFor(() => {
      const last = new URL(
        String(fetchSpy.mock.calls.at(-1)?.[0]),
        'http://localhost',
      ).searchParams
      expect(last.get('from')).toBe(last.get('to'))
    })
  })

  it('shows the empty state', async () => {
    routes({
      ...report,
      rows: [],
      statuses: [],
      totals: {
        ...totals,
        closed: 0,
        tabulated: 0,
        success: 0,
        failure: 0,
        successRate: null,
        untabulated: 0,
        avgHandlingSeconds: null,
        open: 0,
        byStatus: [],
      },
    })
    renderWithQuery(<WhatsappAgentReport workspaceId='ws_1' />)
    expect(
      await screen.findByText(/Nenhuma conversa encerrada nem em aberto/),
    ).toBeTruthy()
  })

  it('shows the error state', async () => {
    mockFetch([
      {
        match: `${BASE}/reports/agents`,
        status: 500,
        error: 'Falha ao montar o relatório',
      },
      { match: `${BASE}/teams`, data: [] },
      { match: `${BASE}/connections`, data: [] },
    ])
    renderWithQuery(<WhatsappAgentReport workspaceId='ws_1' />)
    expect(await screen.findByText('Falha ao montar o relatório')).toBeTruthy()
  })
})
