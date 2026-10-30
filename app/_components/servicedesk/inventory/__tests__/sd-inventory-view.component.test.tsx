import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  SdInventoryDeviceDetailDTO,
  SdInventoryDeviceDTO,
} from '@/types/sd-inventory'
import { SdInventoryView } from '../sd-inventory-view'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/servicedesk/inventory`

const device: SdInventoryDeviceDTO = {
  id: 'dev-1',
  source: 'AGENT',
  hostname: 'PC-RECEPCAO',
  osName: 'Windows 11',
  osVersion: null,
  arch: null,
  manufacturer: 'Dell',
  model: 'OptiPlex',
  serialNumber: 'SN-1',
  cpuModel: null,
  cpuCores: null,
  ramTotalMb: 16384,
  ramUsedMb: 8192,
  ramUsedPercent: 50,
  ipAddresses: ['10.0.0.20'],
  macAddresses: [],
  disks: [],
  agentVersion: '1.0.0',
  configItemId: null,
  snmpTargetId: null,
  managed: true,
  mergedIntoId: null,
  mergeLocked: false,
  firstSeenAt: '2026-10-01T10:00:00.000Z',
  lastSeenAt: '2026-10-02T10:00:00.000Z',
  stale: false,
  openAlerts: 0,
}

const found: SdInventoryDeviceDTO = {
  ...device,
  id: 'dev-d',
  source: 'DISCOVERY',
  hostname: 'impressora-3',
  managed: false,
  serialNumber: null,
  ipAddresses: ['10.0.0.55'],
}

const detail = (
  base: SdInventoryDeviceDTO,
  extra?: Partial<SdInventoryDeviceDetailDTO>,
): SdInventoryDeviceDetailDTO => ({
  ...base,
  configItemName: null,
  mergedIntoHostname: null,
  mergedSources: [],
  software: [],
  alerts: [],
  ...extra,
})

const page = (items: SdInventoryDeviceDTO[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
})

const summary = {
  total: 1,
  agents: 1,
  snmp: 0,
  discovered: 1,
  stale: 0,
  openAlerts: 0,
}

function routes(extra: Parameters<typeof mockFetch>[0] = []) {
  return mockFetch([
    ...extra,
    { match: `${BASE}/summary`, data: summary },
    { match: /\/devices\?.*discovered=true/, data: page([found]) },
    { match: /\/devices\?/, data: page([device]) },
    { match: `${BASE}/alerts`, data: [] },
    { match: `${BASE}/software`, data: page([]) },
  ])
}

function renderView(isAdmin = true) {
  return renderWithQuery(
    <SdInventoryView workspaceId={WS} slug='acme' isAdmin={isAdmin} />,
  )
}

describe('<SdInventoryView />', () => {
  it('shows the discovered count next to the other totals', async () => {
    routes()
    renderView()
    expect(await screen.findByText('Para adotar')).toBeTruthy()
    expect(await screen.findByText('PC-RECEPCAO')).toBeTruthy()
    expect(screen.getByText('Agente')).toBeTruthy()
  })

  it('lists the merged sources of a device and separates one on request', async () => {
    const spy = routes([
      {
        match: `${BASE}/devices/dev-1`,
        data: detail(device, {
          mergedSources: [
            { id: 'dev-snmp', hostname: 'pc-recepcao', source: 'SNMP' },
          ],
        }),
      },
      { method: 'POST', match: `${BASE}/devices/dev-snmp/unmerge`, data: null },
    ])
    renderView()
    fireEvent.click(await screen.findByText('PC-RECEPCAO'))
    expect(
      await screen.findByText(/Mesma máquina em outras origens \(1\)/),
    ).toBeTruthy()
    expect(screen.getByText('pc-recepcao')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Separar' }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/dev-snmp/unmerge'),
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('hides merge actions from non-admins', async () => {
    routes([
      {
        match: `${BASE}/devices/dev-1`,
        data: detail(device, {
          mergedSources: [
            { id: 'dev-snmp', hostname: 'pc-recepcao', source: 'SNMP' },
          ],
        }),
      },
    ])
    renderView(false)
    fireEvent.click(await screen.findByText('PC-RECEPCAO'))
    expect(await screen.findByText('pc-recepcao')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Separar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Juntar outro' })).toBeNull()
  })

  it('merges another device into the open one from the picker', async () => {
    const spy = routes([
      { match: `${BASE}/devices/dev-1`, data: detail(device) },
      { method: 'POST', match: `${BASE}/devices/dev-d/merge`, data: null },
    ])
    renderView()
    fireEvent.click(await screen.findByText('PC-RECEPCAO'))
    fireEvent.click(await screen.findByRole('button', { name: 'Juntar outro' }))
    expect(await screen.findByText(/impressora-3/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Juntar' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/devices/dev-d/merge`)).toEqual({
        intoId: 'dev-1',
      }),
    )
  })

  it('adopts or dismisses a discovered device from its sheet', async () => {
    const spy = mockFetch([
      { match: `${BASE}/summary`, data: summary },
      {
        match: `${BASE}/devices/dev-d/adopt`,
        method: 'POST',
        data: { deviceId: 'dev-d', configItemId: 'ci-9' },
      },
      { match: `${BASE}/devices/dev-d`, method: 'DELETE', data: null },
      { match: `${BASE}/devices/dev-d`, data: detail(found) },
      { match: /\/devices\?/, data: page([found]) },
      { match: `${BASE}/alerts`, data: [] },
      { match: `${BASE}/software`, data: page([]) },
    ])
    renderView()
    fireEvent.click(await screen.findByText('impressora-3'))
    expect(await screen.findByText(/ainda sem gestão/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Adotar' }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/dev-d/adopt'),
        expect.objectContaining({ method: 'POST' }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/dev-d'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('does not offer adopt to non-admins', async () => {
    mockFetch([
      { match: `${BASE}/summary`, data: summary },
      { match: `${BASE}/devices/dev-d`, data: detail(found) },
      { match: /\/devices\?/, data: page([found]) },
      { match: `${BASE}/alerts`, data: [] },
      { match: `${BASE}/software`, data: page([]) },
    ])
    renderView(false)
    fireEvent.click(await screen.findByText('impressora-3'))
    expect(await screen.findByText(/ainda sem gestão/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Adotar' })).toBeNull()
  })
})
