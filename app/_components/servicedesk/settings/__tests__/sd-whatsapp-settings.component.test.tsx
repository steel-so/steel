import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { sdConnection, WS } from '../../ai/__tests__/sd-ai-fixtures'
import { SdSettingsProvider } from '../sd-settings-kit'
import { SD_SETTINGS_TABS } from '../settings-tabs'
import { SdWhatsappSettingsTab, sdWebhookUrl } from '../whatsapp-tab'

const SD_URL = `/api/workspaces/${WS}/servicedesk`
const CONNECTIONS = `${SD_URL}/whatsapp/connections`

const settings = {
  whatsappConnectionId: 'conn-1',
  whatsappSendAcknowledgement: true,
}

function renderTab(canEdit = true) {
  return renderWithQuery(
    <SdSettingsProvider value={{ workspaceId: WS, canEdit, config: undefined }}>
      <SdWhatsappSettingsTab />
    </SdSettingsProvider>,
  )
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('SD_SETTINGS_TABS', () => {
  it('registers the WhatsApp tab before the AI one', () => {
    const ids = SD_SETTINGS_TABS.map((tab) => tab.id)
    expect(ids).toContain('whatsapp')
    expect(ids.indexOf('whatsapp')).toBeLessThan(ids.indexOf('ai'))
    const tab = SD_SETTINGS_TABS.find((item) => item.id === 'whatsapp')
    expect(tab?.label).toBe('WhatsApp')
    expect(tab?.component).toBe(SdWhatsappSettingsTab)
  })
})

describe('sdWebhookUrl', () => {
  it('prefixes the path with the public origin', () => {
    expect(sdWebhookUrl('/api/whatsapp/webhook/meta')).toMatch(
      /\/api\/whatsapp\/webhook\/meta$/,
    )
  })
})

describe('<SdWhatsappSettingsTab />', () => {
  it('invites the admin to add the first connection', async () => {
    mockFetch([
      { match: CONNECTIONS, data: [] },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()
    expect(await screen.findByText(/Nenhuma conexão cadastrada/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Adicionar conexão' }),
    ).toBeTruthy()
  })

  it('surfaces the error of the connections query', async () => {
    mockFetch([
      { match: CONNECTIONS, status: 403, error: 'Só administradores' },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()
    expect(await screen.findByText('Só administradores')).toBeTruthy()
  })

  it('shows the active connection with its webhook url and copies it', async () => {
    mockFetch([
      { match: CONNECTIONS, data: [sdConnection()] },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()

    expect(await screen.findByText('Conexão ativa')).toBeTruthy()
    expect(screen.getByText('Z-API')).toBeTruthy()
    expect(screen.getByText('Conectado')).toBeTruthy()
    expect(screen.getByText(/Cole em Z-API > Webhooks/)).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Copiar a URL do webhook de Suporte',
      }),
    )
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/api/whatsapp/webhook/zapi?secret=abc'),
      ),
    )
  })

  it('tests a connection and reports the provider answer', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${CONNECTIONS}/conn-1/test`,
        data: { connected: true, status: 'CONNECTED', error: null },
      },
      { match: CONNECTIONS, data: [sdConnection()] },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Testar' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).endsWith('/test')),
      ).toBe(true),
    )
  })

  it('switches the active connection of the module', async () => {
    const spy = mockFetch([
      { method: 'PATCH', match: `${SD_URL}/settings`, data: settings },
      {
        match: CONNECTIONS,
        data: [
          sdConnection(),
          sdConnection({
            id: 'conn-2',
            label: 'Plantão',
            provider: 'META',
            active: false,
            zapiInstanceId: null,
            metaPhoneNumberId: 'meta-1',
            webhookPath: '/api/whatsapp/webhook/meta',
          }),
        ],
      },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Usar esta conexão' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, `${SD_URL}/settings`, 'PATCH')).toEqual({
        whatsappConnectionId: 'conn-2',
      }),
    )
    expect(screen.getByText(/Cole no app da Meta/)).toBeTruthy()
  })

  it('clears the active connection', async () => {
    const spy = mockFetch([
      { method: 'PATCH', match: `${SD_URL}/settings`, data: settings },
      { match: CONNECTIONS, data: [sdConnection()] },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Desativar' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${SD_URL}/settings`, 'PATCH')).toEqual({
        whatsappConnectionId: null,
      }),
    )
  })

  it('turns off the ticket code reply on WhatsApp', async () => {
    const spy = mockFetch([
      { method: 'PATCH', match: `${SD_URL}/settings`, data: settings },
      { match: CONNECTIONS, data: [sdConnection()] },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()

    const toggle = await screen.findByRole('switch', {
      name: 'Confirmar a abertura pelo WhatsApp',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(fetchBody(spy, `${SD_URL}/settings`, 'PATCH')).toEqual({
        whatsappSendAcknowledgement: false,
      }),
    )
  })

  it('creates a Z-API connection from the dialog', async () => {
    const spy = mockFetch([
      { method: 'POST', match: CONNECTIONS, data: sdConnection() },
      { match: CONNECTIONS, data: [] },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Adicionar conexão' }),
    )
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'Central' },
    })
    fireEvent.change(screen.getByLabelText('Número (DDI + DDD + número)'), {
      target: { value: '5511988887777' },
    })
    fireEvent.change(screen.getByLabelText('ID da instância'), {
      target: { value: 'inst-9' },
    })
    fireEvent.change(screen.getByLabelText('Token'), {
      target: { value: 'tok-9' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar conexão' }))

    await waitFor(() =>
      expect(fetchBody(spy, CONNECTIONS)).toEqual({
        provider: 'ZAPI',
        label: 'Central',
        phoneNumber: '5511988887777',
        zapiInstanceId: 'inst-9',
        zapiToken: 'tok-9',
      }),
    )
  })

  it('creates a Meta connection from the dialog', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: CONNECTIONS,
        data: sdConnection({ provider: 'META' }),
      },
      { match: CONNECTIONS, data: [] },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Adicionar conexão' }),
    )
    fireEvent.change(await screen.findByLabelText('Provedor'), {
      target: { value: 'META' },
    })
    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Oficial' },
    })
    fireEvent.change(screen.getByLabelText('Número (DDI + DDD + número)'), {
      target: { value: '5511988887777' },
    })
    fireEvent.change(screen.getByLabelText('Phone Number ID'), {
      target: { value: 'pn-1' },
    })
    fireEvent.change(screen.getByLabelText('WhatsApp Business Account ID'), {
      target: { value: 'waba-1' },
    })
    fireEvent.change(screen.getByLabelText('Access Token'), {
      target: { value: 'tok-meta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar conexão' }))

    await waitFor(() =>
      expect(fetchBody(spy, CONNECTIONS)).toEqual({
        provider: 'META',
        label: 'Oficial',
        phoneNumber: '5511988887777',
        metaPhoneNumberId: 'pn-1',
        metaWabaId: 'waba-1',
        metaAccessToken: 'tok-meta',
      }),
    )
  })

  it('hides every action in read-only mode', async () => {
    mockFetch([
      { match: CONNECTIONS, data: [sdConnection()] },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab(false)

    expect(await screen.findByText(/modo leitura/)).toBeTruthy()
    expect(
      (
        await screen.findByRole('switch', {
          name: 'Confirmar a abertura pelo WhatsApp',
        })
      ).hasAttribute('data-disabled'),
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'Testar' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Adicionar conexão' }),
    ).toBeNull()
  })

  it('reports the status error of a broken connection', async () => {
    mockFetch([
      {
        match: CONNECTIONS,
        data: [
          sdConnection({
            status: 'ERROR',
            statusError: 'Token inválido',
            active: false,
          }),
        ],
      },
      { match: `${SD_URL}/settings`, data: settings },
    ])
    renderTab()

    expect(await screen.findByText('Token inválido')).toBeTruthy()
    expect(screen.getByText('Com erro')).toBeTruthy()
  })
})
