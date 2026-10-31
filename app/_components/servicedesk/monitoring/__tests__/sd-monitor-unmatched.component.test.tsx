import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { SdMonitorAlertDTO } from '@/types/sd-monitor'

vi.mock('@/app/_components/servicedesk/pickers', () => ({
  SdConfigItemPicker: ({
    onChange,
  }: {
    onChange: (option: { id: string; label: string; sublabel: null }) => void
  }) => (
    <button
      type='button'
      onClick={() => onChange({ id: 'ci-9', label: 'SRV-01', sublabel: null })}
    >
      escolher item
    </button>
  ),
}))

import {
  groupUnmatchedByHost,
  SdMonitorUnmatchedPanel,
} from '../sd-monitor-unmatched'

const WS = 'ws-1'
const ALERTS = `/api/workspaces/${WS}/servicedesk/monitor-alerts`

function alert(overrides: Partial<SdMonitorAlertDTO> = {}): SdMonitorAlertDTO {
  return {
    id: 'a1',
    sourceId: 'src-1',
    sourceName: 'Zabbix',
    sourceKind: 'ZABBIX',
    status: 'OPEN',
    externalId: '1',
    severity: null,
    host: 'srv-01',
    subject: 'CPU alta',
    body: null,
    configItem: null,
    ticket: null,
    correlated: false,
    occurrences: 1,
    suppressed: false,
    lastSeenAt: '2026-10-01T12:00:00.000Z',
    startedAt: '2026-10-01T12:00:00.000Z',
    resolvedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

describe('groupUnmatchedByHost', () => {
  it('groups by host ignoring case and skips alerts without host or with a CI', () => {
    const groups = groupUnmatchedByHost([
      alert({ id: 'a1', host: 'SRV-01' }),
      alert({ id: 'a2', host: 'srv-01' }),
      alert({ id: 'a3', host: 'srv-02' }),
      alert({ id: 'a4', host: null }),
      alert({
        id: 'a5',
        host: 'srv-03',
        configItem: { id: 'ci-1', name: 'SRV-03' },
      }),
    ])
    expect(groups.map((g) => [g.host, g.alerts.length])).toEqual([
      ['SRV-01', 2],
      ['srv-02', 1],
    ])
  })
})

describe('<SdMonitorUnmatchedPanel />', () => {
  it('renders nothing when every host already matched', async () => {
    const spy = mockFetch([{ match: ALERTS, data: [] }])
    const { container } = renderWithQuery(
      <SdMonitorUnmatchedPanel workspaceId={WS} canEdit />,
    )
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls[0][0]).toContain('unmatched=true')
    expect(container.textContent).toBe('')
  })

  it('links the latest alert of the host and remembers it by default', async () => {
    const spy = mockFetch([
      {
        match: ALERTS,
        data: [
          alert({ id: 'a2', host: 'srv-01' }),
          alert({ id: 'a1', host: 'SRV-01' }),
        ],
      },
      {
        method: 'PATCH',
        match: `${ALERTS}/a2`,
        data: alert({ id: 'a2', configItem: { id: 'ci-9', name: 'SRV-01' } }),
      },
    ])
    renderWithQuery(<SdMonitorUnmatchedPanel workspaceId={WS} canEdit />)
    expect(await screen.findByText('Hosts sem item na CMDB')).toBeTruthy()
    expect(screen.getByText(/2 alertas/)).toBeTruthy()

    const link = screen.getByRole('button', { name: 'Ligar' })
    expect(link.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'escolher item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ligar' }))

    await waitFor(() =>
      expect(fetchBody(spy, `${ALERTS}/a2`, 'PATCH')).toEqual({
        configItemId: 'ci-9',
        remember: true,
      }),
    )
  })

  it('lets the agent link only this alert', async () => {
    const spy = mockFetch([
      { match: ALERTS, data: [alert({ id: 'a1' })] },
      { method: 'PATCH', match: `${ALERTS}/a1`, data: alert() },
    ])
    renderWithQuery(<SdMonitorUnmatchedPanel workspaceId={WS} canEdit />)
    expect(await screen.findByText(/1 alerta ·/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'escolher item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ligar' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${ALERTS}/a1`, 'PATCH')).toEqual({
        configItemId: 'ci-9',
        remember: false,
      }),
    )
  })

  it('survives a failed link', async () => {
    const spy = mockFetch([
      { match: ALERTS, data: [alert({ id: 'a1' })] },
      {
        method: 'PATCH',
        match: `${ALERTS}/a1`,
        status: 404,
        error: 'Item não encontrado',
      },
    ])
    renderWithQuery(<SdMonitorUnmatchedPanel workspaceId={WS} canEdit />)
    await screen.findByText('Hosts sem item na CMDB')
    fireEvent.click(screen.getByRole('button', { name: 'escolher item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ligar' }))
    await waitFor(() =>
      expect(spy.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(
        true,
      ),
    )
    expect(screen.getByRole('button', { name: 'Ligar' })).toBeTruthy()
  })

  it('is read only without edit permission', async () => {
    mockFetch([{ match: ALERTS, data: [alert()] }])
    renderWithQuery(
      <SdMonitorUnmatchedPanel workspaceId={WS} canEdit={false} />,
    )
    expect(await screen.findByText('srv-01')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ligar' })).toBeNull()
  })
})
