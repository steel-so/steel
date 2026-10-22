import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSlaChip, WhatsappSlaFilterSelect } from '../whatsapp-sla-chip'
import { WhatsappSlaReport } from '../whatsapp-sla-report'

vi.setConfig({ testTimeout: 20_000 })

const OPEN = '/api/workspaces/ws_1/whatsapp/sla/open'
const REPORT = '/api/workspaces/ws_1/whatsapp/sla/report'

afterEach(() => {
  vi.useRealTimers()
})

function cycle(
  conversationId: string,
  dueInMinutes: number,
  warnInMinutes: number,
) {
  const at = (minutes: number) =>
    new Date(Date.now() + minutes * 60_000).toISOString()
  return {
    cycleId: `c-${conversationId}`,
    conversationId,
    startedAt: at(-30),
    firstResponse: {
      dueAt: at(dueInMinutes),
      warnAt: at(warnInMinutes),
      doneAt: null,
      state: 'OK',
    },
    resolution: null,
    state: 'OK',
  }
}

describe('<WhatsappSlaChip />', () => {
  it('shows the time left of the running first response', async () => {
    mockFetch([{ match: OPEN, data: [cycle('conv1', 12, 5)] }])
    renderWithQuery(
      <WhatsappSlaChip workspaceId='ws_1' conversationId='conv1' />,
    )

    const chip = await screen.findByTitle(/SLA: 1ª resposta vence em/)
    expect(chip.getAttribute('data-sla-state')).toBe('OK')
  })

  it('flags an at-risk cycle', async () => {
    mockFetch([{ match: OPEN, data: [cycle('conv1', 3, -2)] }])
    renderWithQuery(
      <WhatsappSlaChip workspaceId='ws_1' conversationId='conv1' />,
    )

    const chip = await screen.findByTitle(/SLA: 1ª resposta vence em/)
    expect(chip.getAttribute('data-sla-state')).toBe('AT_RISK')
  })

  it('says the SLA is breached once the deadline passed', async () => {
    mockFetch([{ match: OPEN, data: [cycle('conv1', -4, -10)] }])
    renderWithQuery(
      <WhatsappSlaChip workspaceId='ws_1' conversationId='conv1' />,
    )

    expect(
      await screen.findByText(/SLA estourado · 1ª resposta venceu há/),
    ).toBeTruthy()
  })

  it('renders nothing for a conversation without an open cycle', async () => {
    const fetchSpy = mockFetch([{ match: OPEN, data: [cycle('other', 12, 5)] }])
    const { container } = renderWithQuery(
      <WhatsappSlaChip workspaceId='ws_1' conversationId='conv1' />,
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})

describe('<WhatsappSlaFilterSelect />', () => {
  it('stays hidden while the workspace has no open SLA cycle', async () => {
    const fetchSpy = mockFetch([{ match: OPEN, data: [] }])
    const { container } = renderWithQuery(
      <WhatsappSlaFilterSelect
        workspaceId='ws_1'
        value='all'
        onChange={vi.fn()}
      />,
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('offers the risk and breached filters once a cycle exists', async () => {
    mockFetch([{ match: OPEN, data: [cycle('conv1', 12, 5)] }])
    renderWithQuery(
      <WhatsappSlaFilterSelect
        workspaceId='ws_1'
        value='risk'
        onChange={vi.fn()}
      />,
    )
    expect(
      await screen.findByLabelText('Filtrar conversas por SLA'),
    ).toBeTruthy()
    expect(screen.getByText('SLA em risco ou estourado')).toBeTruthy()
  })
})

const report = {
  from: '2026-09-23T03:00:00.000Z',
  to: '2026-10-23T03:00:00.000Z',
  timeZone: 'America/Sao_Paulo',
  teamId: null,
  firstResponse: {
    evaluated: 10,
    withinTarget: 8,
    withinPercent: 80,
    averageSeconds: 600,
    p90Seconds: 1800,
  },
  resolution: { evaluated: 0, withinTarget: 0, withinPercent: null },
  byAgent: [{ id: 'u1', label: 'Ana', cycles: 6, breaches: 1 }],
  byTeam: [],
}

describe('<WhatsappSlaReport />', () => {
  it('shows the indicators and the breakdown by agent', async () => {
    mockFetch([
      { match: '/whatsapp/teams', data: [] },
      { match: REPORT, data: report },
    ])
    renderWithQuery(<WhatsappSlaReport workspaceId='ws_1' />)

    expect(await screen.findByText('80%')).toBeTruthy()
    expect(screen.getByText('8 de 10')).toBeTruthy()
    expect(screen.getByText('10 min')).toBeTruthy()
    expect(screen.getByText('30 min')).toBeTruthy()
    expect(screen.getByText('Ana')).toBeTruthy()
    expect(screen.getByText('Sem dados no período.')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('re-queries with the chosen period and links the CSV export', async () => {
    const fetchSpy = mockFetch([
      { match: '/whatsapp/teams', data: [] },
      { match: REPORT, data: report },
    ])
    renderWithQuery(<WhatsappSlaReport workspaceId='ws_1' />)
    await screen.findByText('80%')

    fireEvent.change(screen.getByLabelText('De'), {
      target: { value: '2026-10-01' },
    })
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).includes('from=2026-10-01'),
        ),
      ).toBe(true),
    )
    const link = screen.getByRole('link', { name: /Exportar CSV/ })
    expect(link.getAttribute('href')).toContain('format=csv')
    expect(link.getAttribute('href')).toContain('from=2026-10-01')
    expect(fetchBody(fetchSpy, REPORT, 'GET')).toBeUndefined()
  })

  it('renders nothing for people the API refuses', async () => {
    mockFetch([
      { match: '/whatsapp/teams', data: [] },
      { match: REPORT, status: 403, error: 'Permissão insuficiente' },
    ])
    const { container } = renderWithQuery(
      <WhatsappSlaReport workspaceId='ws_1' />,
    )
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
  })
})
