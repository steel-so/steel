import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { SdConfigBootstrapDTO } from '@/types/sd-config'
import type {
  SdInventoryDiscoveryRangeDTO,
  SdInventorySettingsDTO,
  SdInventorySnmpTargetDTO,
} from '@/types/sd-inventory'
import {
  formatInventoryDateTime,
  formatMegabytes,
  usageTone,
} from '../../inventory/sd-inventory-format'
import { SdInventoryTab } from '../inventory-tab'
import { SdSettingsProvider } from '../sd-settings-kit'
import { SD_SETTINGS_TABS } from '../settings-tabs'

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/servicedesk/inventory`
const SETTINGS = `${BASE}/settings`
const TARGETS = `${BASE}/snmp-targets`
const RANGES = `${BASE}/discovery-ranges`

const settings: SdInventorySettingsDTO = {
  diskThresholdPercent: 90,
  ramThresholdPercent: 85,
  staleAfterDays: 7,
  syncConfigItems: true,
  defaultTypeId: null,
}

const target: SdInventorySnmpTargetDTO = {
  id: 'tgt-1',
  name: 'Rede da matriz',
  ranges: ['10.0.0.0/24'],
  port: 161,
  intervalMinutes: 1440,
  active: true,
  customerId: null,
  snmpVersion: 'V2C',
  hasCommunity: true,
  v3Username: null,
  v3AuthProtocol: null,
  v3PrivProtocol: null,
  hasV3AuthKey: false,
  hasV3PrivKey: false,
  nextRunAt: '2026-10-02T12:00:00.000Z',
  lastRunAt: '2026-10-01T12:00:00.000Z',
  lastStatus: 'PARTIAL',
  lastFound: 12,
  lastError: '2 endereço(s) com falha na varredura',
  createdAt: '2026-10-01T10:00:00.000Z',
}

const range: SdInventoryDiscoveryRangeDTO = {
  id: 'rng-1',
  name: 'VLAN de estações',
  cidr: '10.0.1.0/24',
  enabled: true,
  intervalMinutes: 1440,
  customerId: null,
  nextRunAt: '2026-10-02T12:00:00.000Z',
  lastRunAt: '2026-10-01T12:00:00.000Z',
  lastStatus: 'SUCCESS',
  lastProbed: 254,
  lastFound: 12,
  lastError: null,
  createdAt: '2026-10-01T10:00:00.000Z',
}

function renderTab(canEdit = true) {
  return renderWithQuery(
    <SdSettingsProvider
      value={{
        workspaceId: WS,
        canEdit,
        config: {} as unknown as SdConfigBootstrapDTO,
      }}
    >
      <SdInventoryTab />
    </SdSettingsProvider>,
  )
}

describe('formatting helpers', () => {
  it('formats megabytes in base 1024 with pt-BR decimals', () => {
    expect(formatMegabytes(null)).toBe('—')
    expect(formatMegabytes(512)).toBe('512 MB')
    expect(formatMegabytes(1536)).toBe('1,5 GB')
    expect(formatMegabytes(2_097_152)).toBe('2 TB')
  })

  it('formats dates in São Paulo time, independent of the machine zone', () => {
    expect(formatInventoryDateTime(null)).toBe('—')
    // 02:30 UTC is still the previous evening in São Paulo (UTC-3).
    expect(formatInventoryDateTime('2026-10-02T02:30:00.000Z')).toContain(
      '01/10/2026',
    )
    expect(formatInventoryDateTime('2026-10-02T02:30:00.000Z')).toContain(
      '23:30',
    )
  })

  it('picks the usage tone by band', () => {
    const [none, ok, warn, bad] = [null, 40, 80, 95].map(usageTone)
    expect(new Set([none, ok, warn, bad]).size).toBe(4)
    expect(usageTone(90)).toBe(bad)
    expect(usageTone(75)).toBe(warn)
    expect(usageTone(74)).toBe(ok)
  })
})

describe('SD_SETTINGS_TABS', () => {
  it('registers the inventory tab after monitoring', () => {
    const ids = SD_SETTINGS_TABS.map((item) => item.id)
    expect(ids.indexOf('inventory')).toBeGreaterThan(ids.indexOf('monitoring'))
    const tab = SD_SETTINGS_TABS.find((item) => item.id === 'inventory')
    expect(tab?.label).toBe('Inventário')
    expect(tab?.component).toBe(SdInventoryTab)
  })
})

describe('<SdInventoryTab />', () => {
  it('shows empty states and the thresholds for an admin', async () => {
    mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, data: [] },
    ])
    renderTab()
    expect(await screen.findByText(/Nenhum alvo cadastrado/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Novo alvo/ })).toBeTruthy()
    await waitFor(() =>
      expect(
        (screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value,
      ).toBe('90'),
    )
  })

  it('hides targets for non-admins and warns they are read only', async () => {
    const spy = mockFetch([{ match: SETTINGS, data: settings }])
    renderTab(false)
    expect(await screen.findByText(/modo leitura/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Novo alvo/ })).toBeNull()
    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining('/snmp-targets'),
      expect.anything(),
    )
  })

  it('creates an SNMP target with the lines as ranges', async () => {
    const spy = mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, data: [] },
      { method: 'POST', match: TARGETS, status: 201, data: target },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Novo alvo/ }))
    fireEvent.change(screen.getByPlaceholderText('Rede da matriz'), {
      target: { value: 'Filial' },
    })
    fireEvent.change(screen.getByPlaceholderText(/10\.0\.0\.0\/24/), {
      target: { value: '10.1.0.0/24\n  192.168.1.10  \n' },
    })
    const save = screen.getByRole('button', {
      name: 'Salvar',
    }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      {
        target: { value: 'public' },
      },
    )
    fireEvent.click(save)

    await waitFor(() =>
      expect(fetchBody(spy, TARGETS)).toMatchObject({
        name: 'Filial',
        ranges: ['10.1.0.0/24', '192.168.1.10'],
        community: 'public',
        port: 161,
        intervalMinutes: 1440,
        active: true,
      }),
    )
  })

  it('shows the last scan and asks for a scan now', async () => {
    const spy = mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, data: [target] },
      { method: 'POST', match: `${TARGETS}/tgt-1/scan`, data: null },
    ])
    renderTab()
    expect(await screen.findByText('Rede da matriz')).toBeTruthy()
    expect(screen.getByText('Parcial')).toBeTruthy()
    expect(screen.getByText(/2 endereço\(s\) com falha/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Varrer agora/ }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/tgt-1/scan'),
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('keeps the community when editing a target without typing a new one', async () => {
    const spy = mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, data: [target] },
      { method: 'PATCH', match: `${TARGETS}/tgt-1`, data: target },
    ])
    renderTab()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Editar Rede da matriz' }),
    )
    fireEvent.change(screen.getByPlaceholderText('Rede da matriz'), {
      target: { value: 'Rede nova' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => {
      const body = fetchBody(spy, `${TARGETS}/tgt-1`, 'PATCH')
      expect(body.name).toBe('Rede nova')
      expect(body).not.toHaveProperty('community')
    })
  })

  it('saves a threshold on commit', async () => {
    const spy = mockFetch([
      { match: SETTINGS, data: settings },
      {
        method: 'PATCH',
        match: SETTINGS,
        data: { ...settings, diskThresholdPercent: 80 },
      },
      { match: TARGETS, data: [] },
    ])
    renderTab()
    await waitFor(() =>
      expect(
        (screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value,
      ).toBe('90'),
    )
    const input = screen.getAllByRole('spinbutton')[0] as HTMLInputElement
    fireEvent.change(input, { target: { value: '80' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(fetchBody(spy, SETTINGS, 'PATCH')).toEqual({
        diskThresholdPercent: 80,
      }),
    )
  })

  it('surfaces a failing query', async () => {
    mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, status: 500, error: 'Falha nos alvos' },
    ])
    renderTab()
    expect(await screen.findByText('Falha nos alvos')).toBeTruthy()
  })

  it('creates an SNMPv3 target without sending a community', async () => {
    const spy = mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, data: [] },
      { match: RANGES, data: [] },
      { method: 'POST', match: TARGETS, status: 201, data: target },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Novo alvo/ }))
    fireEvent.change(screen.getByPlaceholderText('Rede da matriz'), {
      target: { value: 'Core' },
    })
    fireEvent.change(screen.getByPlaceholderText(/10\.0\.0\.0\/24/), {
      target: { value: '10.2.0.0/30' },
    })
    fireEvent.click(screen.getByText('SNMP v2c (community)'))
    const v3Option = await screen.findByRole('option', { name: /SNMP v3/ })
    fireEvent.pointerDown(v3Option)
    fireEvent.pointerUp(v3Option)
    fireEvent.click(v3Option)

    const username = await screen.findByLabelText('Usuário SNMPv3')
    const save = screen.getByRole('button', {
      name: 'Salvar',
    }) as HTMLButtonElement
    // v3 sem usuário: ainda não dá para salvar.
    expect(save.disabled).toBe(true)
    fireEvent.change(username, {
      target: { value: 'monitor' },
    })
    expect(save.disabled).toBe(false)

    // Chave curta demais trava; privacidade sem autenticação também.
    const [authKey, privKey] = Array.from(
      document.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[]
    fireEvent.change(authKey as HTMLInputElement, {
      target: { value: 'curta' },
    })
    expect(save.disabled).toBe(true)
    fireEvent.change(authKey as HTMLInputElement, {
      target: { value: 'auth-secret-1' },
    })
    fireEvent.change(privKey as HTMLInputElement, {
      target: { value: 'priv-secret-1' },
    })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => {
      const body = fetchBody(spy, TARGETS)
      expect(body).toMatchObject({
        name: 'Core',
        snmpVersion: 'V3',
        v3Username: 'monitor',
        v3AuthProtocol: 'SHA',
        v3AuthKey: 'auth-secret-1',
        v3PrivProtocol: 'AES',
        v3PrivKey: 'priv-secret-1',
      })
      expect(body).not.toHaveProperty('community')
    })
  })

  it('keeps stored v3 keys when editing without typing new ones', async () => {
    const v3Target: SdInventorySnmpTargetDTO = {
      ...target,
      snmpVersion: 'V3',
      hasCommunity: false,
      v3Username: 'monitor',
      v3AuthProtocol: 'SHA256',
      v3PrivProtocol: 'AES',
      hasV3AuthKey: true,
      hasV3PrivKey: true,
    }
    const spy = mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, data: [v3Target] },
      { match: RANGES, data: [] },
      { method: 'PATCH', match: `${TARGETS}/tgt-1`, data: v3Target },
    ])
    renderTab()
    expect(await screen.findByText(/SNMPv3/)).toBeTruthy()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Editar Rede da matriz' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => {
      const body = fetchBody(spy, `${TARGETS}/tgt-1`, 'PATCH')
      expect(body).toMatchObject({
        snmpVersion: 'V3',
        v3Username: 'monitor',
        v3AuthProtocol: 'SHA256',
      })
      expect(body).not.toHaveProperty('v3AuthKey')
      expect(body).not.toHaveProperty('v3PrivKey')
    })
  })

  it('creates a discovery range switched off by default (opt-in)', async () => {
    const spy = mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, data: [] },
      { match: RANGES, data: [] },
      { method: 'POST', match: RANGES, status: 201, data: range },
    ])
    renderTab()
    expect(await screen.findByText(/Nenhuma faixa cadastrada/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Nova faixa/ }))
    fireEvent.change(screen.getByPlaceholderText('VLAN de estações'), {
      target: { value: 'Filial' },
    })
    fireEvent.change(screen.getByPlaceholderText('10.0.1.0/24'), {
      target: { value: '192.168.5.0/24' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(fetchBody(spy, RANGES)).toEqual({
        name: 'Filial',
        cidr: '192.168.5.0/24',
        intervalMinutes: 1440,
        enabled: false,
      }),
    )
  })

  it('lists ranges, asks for a scan and disables it while switched off', async () => {
    const spy = mockFetch([
      { match: SETTINGS, data: settings },
      { match: TARGETS, data: [] },
      {
        match: RANGES,
        data: [
          range,
          { ...range, id: 'rng-2', name: 'Visitantes', enabled: false },
        ],
      },
      { method: 'POST', match: `${RANGES}/rng-1/scan`, data: null },
      { method: 'PATCH', match: `${RANGES}/rng-1`, data: range },
    ])
    renderTab()
    expect(await screen.findByText('VLAN de estações')).toBeTruthy()
    expect(screen.getByText('Desligada')).toBeTruthy()
    const scanButtons = screen.getAllByRole('button', { name: /Varrer agora/ })
    expect(
      (scanButtons[scanButtons.length - 1] as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(scanButtons[0] as HTMLButtonElement)
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/rng-1/scan'),
        expect.objectContaining({ method: 'POST' }),
      ),
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Editar VLAN de estações' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${RANGES}/rng-1`, 'PATCH')).toMatchObject({
        cidr: '10.0.1.0/24',
        enabled: true,
      }),
    )
  })
})
