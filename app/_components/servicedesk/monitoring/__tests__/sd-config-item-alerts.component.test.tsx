import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { SdMonitorAlertDTO } from '@/types/sd-monitor'
import { SdConfigItemAlerts } from '../sd-monitor-alert-list'

const WS = 'ws-1'
const ALERTS = `/api/workspaces/${WS}/servicedesk/monitor-alerts`

function alert(overrides: Partial<SdMonitorAlertDTO> = {}): SdMonitorAlertDTO {
  return {
    id: 'a1',
    sourceId: 'src-1',
    sourceName: 'Grafana matriz',
    sourceKind: 'GRAFANA',
    status: 'OPEN',
    externalId: 'fp-1',
    severity: 'critical',
    host: 'srv-01',
    subject: 'CPU acima de 90%',
    body: null,
    configItem: { id: 'ci-1', name: 'SRV-01' },
    ticket: { id: 't1', number: 42, title: 'CPU', phase: 'Novo' },
    correlated: false,
    occurrences: 1,
    lastSeenAt: '2026-10-01T12:00:00.000Z',
    startedAt: '2026-10-01T15:30:00.000Z',
    resolvedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

function renderList() {
  return renderWithQuery(
    <SdConfigItemAlerts workspaceId={WS} slug='demo' configItemId='ci-1' />,
  )
}

describe('<SdConfigItemAlerts />', () => {
  it('lists the alerts of the item with source, counters and ticket link', async () => {
    const spy = mockFetch([
      {
        match: ALERTS,
        data: [
          alert({ occurrences: 4, correlated: true }),
          alert({
            id: 'a2',
            subject: 'Disco cheio',
            status: 'RESOLVED',
            severity: null,
            ticket: null,
          }),
        ],
      },
    ])
    renderList()
    expect(await screen.findByText('CPU acima de 90%')).toBeTruthy()
    expect(screen.getByText('Disco cheio')).toBeTruthy()
    expect(screen.getAllByText('Grafana matriz')).toHaveLength(2)
    expect(screen.getByText('critical')).toBeTruthy()
    expect(screen.getByText('4 ocorrências')).toBeTruthy()
    expect(screen.getByText('correlacionado')).toBeTruthy()
    expect(screen.getByText('Aberto')).toBeTruthy()
    expect(screen.getByText('Normalizado')).toBeTruthy()
    // 15:30Z = 12:30 em Brasília, qualquer que seja o fuso do ambiente
    expect(screen.getAllByText(/12:30/).length).toBeGreaterThan(0)
    const link = screen.getByRole('link', { name: 'Chamado #42' })
    expect(link.getAttribute('href')).toBe('/demo/servicedesk/tickets/42')
    expect(spy.mock.calls[0][0]).toContain('configItemId=ci-1')
  })

  it('explains the empty state', async () => {
    mockFetch([{ match: ALERTS, data: [] }])
    renderList()
    expect(await screen.findByText('Nenhum alerta recebido')).toBeTruthy()
  })

  it('shows the error of the query', async () => {
    mockFetch([{ match: ALERTS, status: 403, error: 'Só agentes' }])
    renderList()
    expect(await screen.findByText('Só agentes')).toBeTruthy()
  })
})
