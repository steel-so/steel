import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { SdConfigBootstrapDTO } from '@/types/sd-config'
import type {
  SdRemoteEndpointDTO,
  SdRemoteSessionDTO,
  SdRemoteSettingsDTO,
} from '@/types/sd-remote'
import { SdRemoteTab } from '../../settings/remote-tab'
import { SdSettingsProvider } from '../../settings/sd-settings-kit'
import { SD_SETTINGS_TABS } from '../../settings/settings-tabs'
import { SdRemoteConnectButton } from '../sd-remote-connect-button'
import { SdRemotePanel } from '../sd-remote-panel'

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/servicedesk/remote`

const on: SdRemoteSettingsDTO = {
  enabled: true,
  provider: 'RUSTDESK',
  linkTemplate: null,
}
const off: SdRemoteSettingsDTO = { ...on, enabled: false }
const endpoint: SdRemoteEndpointDTO = {
  id: 'e1',
  configItemId: 'ci1',
  provider: 'RUSTDESK',
  remoteId: '123456789',
  source: 'MANUAL',
  updatedAt: '2026-10-01T12:00:00.000Z',
}
const session: SdRemoteSessionDTO = {
  id: 's1',
  configItemId: 'ci1',
  ticketId: null,
  provider: 'RUSTDESK',
  remoteId: '123456789',
  startedAt: '2026-10-01T15:30:00.000Z',
  user: { id: 'u1', name: 'Ana Técnica' },
}

const assign = vi.fn()

beforeEach(() => {
  assign.mockReset()
  vi.stubGlobal('location', { ...window.location, assign })
})
afterEach(() => vi.unstubAllGlobals())

describe('<SdRemoteConnectButton />', () => {
  it('renders nothing while the feature is off', async () => {
    mockFetch([
      { match: `${BASE}/settings`, data: off },
      { match: `${BASE}/endpoints`, data: [endpoint] },
    ])
    renderWithQuery(
      <SdRemoteConnectButton workspaceId={WS} configItemId='ci1' />,
    )
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull())
  })

  it('is disabled with an explanation when the asset has no id', async () => {
    mockFetch([
      { match: `${BASE}/settings`, data: on },
      { match: `${BASE}/endpoints`, data: [] },
    ])
    renderWithQuery(
      <SdRemoteConnectButton workspaceId={WS} configItemId='ci1' />,
    )
    const button = await screen.findByRole('button', { name: /Conectar/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('title')).toMatch(/Cadastre o ID do RustDesk/)
  })

  it('connects from a ticket and opens the returned link', async () => {
    const spy = mockFetch([
      { match: `${BASE}/settings`, data: on },
      { match: `${BASE}/endpoints`, data: [endpoint] },
      {
        method: 'POST',
        match: `${BASE}/connect`,
        data: {
          sessionId: 's1',
          provider: 'RUSTDESK',
          remoteId: '123456789',
          link: 'rustdesk://connection/new/123456789',
        },
      },
    ])
    renderWithQuery(
      <SdRemoteConnectButton
        workspaceId={WS}
        configItemId='ci1'
        ticketId='t1'
      />,
    )
    const button = await screen.findByRole('button', { name: /Conectar/ })
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(button)
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        'rustdesk://connection/new/123456789',
      ),
    )
    expect(fetchBody(spy, `${BASE}/connect`)).toEqual({
      configItemId: 'ci1',
      ticketId: 't1',
    })
  })

  it('does not open anything when the server refuses', async () => {
    mockFetch([
      { match: `${BASE}/settings`, data: on },
      { match: `${BASE}/endpoints`, data: [endpoint] },
      {
        method: 'POST',
        match: `${BASE}/connect`,
        status: 409,
        error: 'O acesso remoto não está habilitado neste workspace',
      },
    ])
    renderWithQuery(
      <SdRemoteConnectButton workspaceId={WS} configItemId='ci1' />,
    )
    const button = await screen.findByRole('button', { name: /Conectar/ })
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(button)
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false),
    )
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('<SdRemotePanel />', () => {
  it('stays hidden while the feature is off', async () => {
    mockFetch([
      { match: `${BASE}/settings`, data: off },
      { match: `${BASE}/endpoints`, data: [] },
      { match: `${BASE}/sessions`, data: [] },
    ])
    renderWithQuery(<SdRemotePanel workspaceId={WS} configItemId='ci1' />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText(/Acesso remoto/)).toBeNull()
  })

  it('shows the id, the recent sessions and removes the id', async () => {
    const spy = mockFetch([
      { match: `${BASE}/settings`, data: on },
      {
        match: `${BASE}/endpoints`,
        data: [{ ...endpoint, source: 'INVENTORY' }],
      },
      { match: `${BASE}/sessions`, data: [session] },
      { method: 'DELETE', match: `${BASE}/endpoints/e1`, data: { id: 'e1' } },
    ])
    renderWithQuery(<SdRemotePanel workspaceId={WS} configItemId='ci1' />)
    expect(await screen.findByText('123456789')).toBeTruthy()
    expect(screen.getByText(/veio do inventário/)).toBeTruthy()
    expect(screen.getByText('Ana Técnica')).toBeTruthy()
    // 15:30 UTC is 12:30 in São Paulo.
    expect(screen.getByText(/12:30/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remover o ID' }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/endpoints/e1'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('saves a new id typed by the technician', async () => {
    const spy = mockFetch([
      { match: `${BASE}/settings`, data: on },
      { match: `${BASE}/endpoints`, data: [] },
      { match: `${BASE}/sessions`, data: [] },
      { method: 'PUT', match: `${BASE}/endpoints`, data: endpoint },
    ])
    renderWithQuery(<SdRemotePanel workspaceId={WS} configItemId='ci1' />)
    const input = await screen.findByLabelText('ID do RustDesk')
    const save = screen.getByRole('button', { name: 'Salvar' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '123 456 789' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/endpoints`, 'PUT')).toEqual({
        configItemId: 'ci1',
        provider: 'RUSTDESK',
        remoteId: '123 456 789',
      }),
    )
  })
})

describe('<SdRemoteTab />', () => {
  function renderTab(canEdit = true) {
    return renderWithQuery(
      <SdSettingsProvider
        value={{
          workspaceId: WS,
          canEdit,
          config: {} as unknown as SdConfigBootstrapDTO,
        }}
      >
        <SdRemoteTab />
      </SdSettingsProvider>,
    )
  }

  it('is registered as a settings tab', () => {
    const tab = SD_SETTINGS_TABS.find((item) => item.id === 'remote')
    expect(tab?.label).toBe('Acesso remoto')
    expect(tab?.component).toBe(SdRemoteTab)
  })

  it('turns the feature on and saves a custom link template', async () => {
    const spy = mockFetch([
      { match: `${BASE}/settings`, data: off },
      { method: 'PATCH', match: `${BASE}/settings`, data: on },
    ])
    renderTab()
    const toggle = await screen.findByRole('switch')
    await waitFor(() =>
      expect(toggle.getAttribute('aria-disabled')).not.toBe('true'),
    )
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/settings`, 'PATCH')).toEqual({
        enabled: true,
      }),
    )

    const input = screen.getByPlaceholderText('rustdesk://connection/new/{id}')
    fireEvent.change(input, { target: { value: 'https://r.example.com/{id}' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(
        spy.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
      ).toHaveLength(2),
    )
  })

  it('locks the controls for non-admins', async () => {
    mockFetch([{ match: `${BASE}/settings`, data: on }])
    renderTab(false)
    const toggle = await screen.findByRole('switch')
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
  })

  it('shows the load error', async () => {
    mockFetch([{ match: `${BASE}/settings`, status: 500, error: 'Falhou' }])
    renderTab()
    expect(await screen.findByText(/Falhou|Erro ao carregar/)).toBeTruthy()
  })
})
