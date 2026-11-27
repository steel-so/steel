import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type {
  WhatsAppAgentDailyReportDTO,
  WhatsAppAgentReportDTO,
} from '@/types/whatsapp-agent-report'
import { WhatsappAgentReport } from '../whatsapp-agent-report'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.setConfig({ testTimeout: 20_000 })

const BASE = '/api/workspaces/ws_1/whatsapp'

const emptyTotals = {
  closed: 0,
  tabulated: 0,
  success: 0,
  failure: 0,
  successRate: null,
  untabulated: 0,
  avgHandlingSeconds: null,
  open: 0,
  byStatus: [],
}

const agents: WhatsAppAgentReportDTO = {
  fromDay: '2026-11-20',
  toDay: '2026-11-26',
  timeZone: 'America/Sao_Paulo',
  teamId: null,
  connectionId: null,
  visibility: 'ALL',
  rows: [{ agentId: 'u1', agentName: 'Ana Souza', ...emptyTotals }],
  totals: emptyTotals,
  statuses: [],
}

const daily: WhatsAppAgentDailyReportDTO = {
  fromDay: '2026-11-20',
  toDay: '2026-11-26',
  timeZone: 'America/Sao_Paulo',
  teamId: null,
  connectionId: null,
  visibility: 'ALL',
  rows: [
    {
      day: '2026-11-25',
      teamId: 'tm_1',
      teamName: 'Suporte N1',
      closed: 4,
      success: 3,
      failure: 1,
      untabulated: 0,
      messages: 120,
    },
    {
      day: '2026-11-25',
      teamId: null,
      teamName: 'Sem equipe',
      closed: 1,
      success: 0,
      failure: 0,
      untabulated: 1,
      messages: 7,
    },
  ],
  totals: {
    closed: 5,
    success: 3,
    failure: 1,
    untabulated: 1,
    messages: 127,
  },
}

function routes(dailyData: WhatsAppAgentDailyReportDTO = daily) {
  // The daily route goes first: both URLs share the same path.
  return mockFetch([
    { match: 'view=daily', data: dailyData },
    { match: `${BASE}/reports/agents`, data: agents },
    { match: `${BASE}/teams`, data: [] },
    { match: `${BASE}/connections`, data: [] },
  ])
}

describe('<WhatsappAgentReport /> - view selector', () => {
  it('starts on the agent view and does not call the daily endpoint', async () => {
    const fetchSpy = routes()
    renderWithQuery(<WhatsappAgentReport workspaceId='ws_1' />)

    expect(await screen.findByText('Ana Souza')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Por atendente' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Por dia e equipe' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes('view=daily'),
      ),
    ).toBe(false)
  })

  it('switches to day and team, renders the table and points the CSV at the daily view', async () => {
    const fetchSpy = routes()
    renderWithQuery(<WhatsappAgentReport workspaceId='ws_1' />)
    await screen.findByText('Ana Souza')

    fireEvent.click(screen.getByRole('button', { name: 'Por dia e equipe' }))

    expect(await screen.findByText('Suporte N1')).toBeTruthy()
    expect(screen.getAllByText('25/11/2026')).toHaveLength(2)
    expect(screen.getByText('Sem equipe')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
    expect(screen.getByText('127')).toBeTruthy()
    expect(screen.getByText('Total')).toBeTruthy()
    expect(screen.queryByText('Ana Souza')).toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'Por dia e equipe' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('link', { name: /Exportar CSV/ }).getAttribute('href'),
    ).toContain('view=daily&format=csv')
    expect(
      fetchSpy.mock.calls.some((call) =>
        String(call[0]).includes('view=daily'),
      ),
    ).toBe(true)
  })

  it('shows the daily empty state and goes back to the agent view', async () => {
    routes({
      ...daily,
      rows: [],
      totals: {
        closed: 0,
        success: 0,
        failure: 0,
        untabulated: 0,
        messages: 0,
      },
    })
    renderWithQuery(<WhatsappAgentReport workspaceId='ws_1' />)
    await screen.findByText('Ana Souza')

    fireEvent.click(screen.getByRole('button', { name: 'Por dia e equipe' }))
    expect(
      await screen.findByText(
        /Nenhuma conversa encerrada nem mensagem no período/,
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Por atendente' }))
    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeTruthy())
  })
})
