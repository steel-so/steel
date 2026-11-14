import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsConnections } from '../whatsapp-settings-connections'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/whatsapp/connections'

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn_1',
    workspaceId: 'ws_1',
    provider: 'ZAPI',
    label: 'Suporte',
    phoneNumber: '5511999999999',
    status: 'CONNECTED',
    statusError: null,
    zapiInstanceId: 'inst',
    metaPhoneNumberId: null,
    metaWabaId: null,
    createdById: 'u_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } })
}

async function openCreateDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar conexão' }))
  return screen.findByRole('dialog')
}

async function openZapiForm() {
  const dialog = await openCreateDialog()
  fireEvent.click(within(dialog).getByRole('radio', { name: /Z-API/ }))
  return dialog
}

describe('<WhatsappSettingsConnections />', () => {
  it('renders connection cards with provider, status and errors', async () => {
    mockFetch([
      {
        match: BASE,
        data: [
          connection(),
          connection({
            id: 'conn_2',
            provider: 'META',
            label: 'Vendas',
            status: 'ERROR',
            statusError: 'Token expirado',
          }),
        ],
      },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)

    expect(await screen.findByText('Suporte')).toBeTruthy()
    expect(screen.getByText('Vendas')).toBeTruthy()
    expect(screen.getByText('Token expirado')).toBeTruthy()
    expect(screen.getByText(/Status: Conectado/)).toBeTruthy()
    // QR code pairing is only offered for Z-API numbers.
    expect(screen.getAllByRole('button', { name: /QR Code/ })).toHaveLength(1)
  })

  it('offers the spending cap on Meta numbers (zap-spend-cap)', async () => {
    mockFetch([
      {
        match: '/whatsapp/costs/spend-caps',
        data: [
          {
            connectionId: 'conn_2',
            label: 'Vendas',
            phoneNumber: '5511999999999',
            period: '2026-11',
            currency: 'BRL',
            monthlyCapAmount: 1500,
            capMode: 'BLOCK',
            spent: 200,
            metaSpent: 200,
            ledgerSpent: 0,
            source: 'META_VOLUME',
            byCategory: [],
            fetchedAt: null,
            metaPeriodEnd: null,
            stale: false,
            staleReason: null,
            percent: 13,
            level: null,
            status: 'ALLOWED',
            projection: 600,
            daysElapsed: 10,
            daysInMonth: 30,
          },
        ],
      },
      {
        match: BASE,
        data: [connection(), connection({ id: 'conn_2', provider: 'META' })],
      },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)

    expect(
      await screen.findByRole('button', { name: /Limite: R\$\s1\.500,00/ }),
    ).toBeTruthy()
  })

  it('shows the empty state', async () => {
    mockFetch([{ match: BASE, data: [] }])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)
    expect(
      await screen.findByText('Nenhuma conexão cadastrada ainda.'),
    ).toBeTruthy()
  })

  it('creates a Z-API connection, omitting an empty client token', async () => {
    const fetchSpy = mockFetch([
      { method: 'POST', match: BASE, data: connection() },
      { match: BASE, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)
    await screen.findByText('Nenhuma conexão cadastrada ainda.')

    const dialog = await openZapiForm()
    expect(
      within(dialog).getByLabelText('ID da instância').hasAttribute('required'),
    ).toBe(true)
    expect(
      within(dialog).getByLabelText('Client-Token').hasAttribute('required'),
    ).toBe(false)

    type(dialog, 'Nome', 'Suporte')
    type(dialog, 'Número (DDD + número)', '5511999999999')
    type(dialog, 'ID da instância', 'inst')
    type(dialog, 'Token', 'tok')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar conexão' }),
    )

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Conexão criada'),
    )
    expect(fetchBody(fetchSpy, BASE)).toEqual({
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: 'inst',
      zapiToken: 'tok',
    })
  })

  it('switches to Meta Cloud API fields and sends the Meta payload', async () => {
    const fetchSpy = mockFetch([
      { method: 'POST', match: BASE, data: connection({ provider: 'META' }) },
      { match: BASE, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)
    await screen.findByText('Nenhuma conexão cadastrada ainda.')
    const dialog = await openCreateDialog()

    // Meta is preselected, but the manual form is behind "Avançado".
    expect(within(dialog).queryByLabelText('Phone Number ID')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: /Avançado/ }))
    expect(await within(dialog).findByLabelText('Phone Number ID')).toBeTruthy()
    expect(within(dialog).queryByLabelText('ID da instância')).toBeNull()

    type(dialog, 'Nome', 'Vendas')
    type(dialog, 'Número (DDD + número)', '5511888888888')
    type(dialog, 'Phone Number ID', 'pn')
    type(dialog, 'WhatsApp Business Account ID', 'waba')
    type(dialog, 'Access Token', 'secret')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar conexão' }),
    )

    await waitFor(() => expect(notify.success).toHaveBeenCalled())
    expect(fetchBody(fetchSpy, BASE)).toEqual({
      provider: 'META',
      label: 'Vendas',
      phoneNumber: '5511888888888',
      metaPhoneNumberId: 'pn',
      metaWabaId: 'waba',
      metaAccessToken: 'secret',
    })
  })

  it('blocks submission while required fields are empty', async () => {
    const fetchSpy = mockFetch([{ match: BASE, data: [] }])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)
    await screen.findByText('Nenhuma conexão cadastrada ainda.')
    const dialog = await openZapiForm()
    type(dialog, 'Nome', 'Suporte')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar conexão' }),
    )

    await new Promise((r) => setTimeout(r, 50))
    expect(fetchBody(fetchSpy, BASE)).toBeUndefined()
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and reports creation errors', async () => {
    mockFetch([
      { method: 'POST', match: BASE, status: 400, error: 'Número inválido' },
      { match: BASE, data: [] },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)
    await screen.findByText('Nenhuma conexão cadastrada ainda.')
    const dialog = await openZapiForm()
    type(dialog, 'Nome', 'X')
    type(dialog, 'Número (DDD + número)', '1')
    type(dialog, 'ID da instância', 'inst')
    type(dialog, 'Token', 'tok')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar conexão' }),
    )

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.calls[0][0] as Error).message).toBe(
      'Número inválido',
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('lets admins test a Z-API connection', async () => {
    mockFetch([
      {
        method: 'POST',
        match: `${BASE}/conn_1/status`,
        data: connection({
          status: 'DISCONNECTED',
          statusError: 'Sem pareamento',
        }),
      },
      { match: BASE, data: [connection()] },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Testar conexão' }),
    )
    await waitFor(() =>
      expect(notify.warning).toHaveBeenCalledWith('Sem pareamento'),
    )
  })

  it('explains when the QR code cannot be loaded and retries', async () => {
    mockFetch([
      {
        match: `${BASE}/conn_1/qr-code`,
        status: 502,
        error: 'A Z-API recusou a chamada',
      },
      { match: BASE, data: [connection()] },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: /QR Code/ }))
    expect(await screen.findByText(/A Z-API recusou a chamada/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
  })

  it('shows the QR code for pairing a Z-API number', async () => {
    mockFetch([
      {
        match: `${BASE}/conn_1/qr-code`,
        data: { status: 'pending', qrCodeBase64: 'data:image/png;base64,AAA' },
      },
      { match: BASE, data: [connection()] },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: /QR Code/ }))
    const img = await screen.findByAltText('QR Code de conexão')
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAA')
  })

  it('confirms before removing a connection', async () => {
    const fetchSpy = mockFetch([
      { method: 'DELETE', match: `${BASE}/conn_1`, data: null },
      { match: BASE, data: [connection()] },
    ])
    renderWithQuery(<WhatsappSettingsConnections workspaceId='ws_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    const alert = await screen.findByRole('alertdialog')
    expect(within(alert).getByText(/"Suporte" será desconectado/)).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Remover' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Conexão removida'),
    )
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(true)
  })
})
