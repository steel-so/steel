import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { SdConfigBootstrapDTO } from '@/types/sd-config'
import type {
  SdIntegrationDTO,
  SdIntegrationsOverviewDTO,
} from '@/types/sd-integration'
import { SdIntegrationsTab } from '../integrations-tab'
import { SdSettingsProvider } from '../sd-settings-kit'
import { SD_SETTINGS_TABS } from '../settings-tabs'

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/servicedesk/integrations`
const CHANNELS = `${BASE}/slack/channels`
const MANAGE = '/acme/settings/integrations'

const config = {
  departments: [
    { id: 'dep-1', name: 'Suporte N1', children: [] },
    { id: 'dep-2', name: 'Infra', children: [{ id: 'dep-3', name: 'Redes' }] },
  ],
} as unknown as SdConfigBootstrapDTO

const SLACK_CONFIG: NonNullable<SdIntegrationDTO['slack']> = {
  channels: [{ departmentId: 'dep-1', channelId: 'C1', channelName: 'redes' }],
  allowTicketFromMessage: true,
  mirrorThreadReplies: true,
  ticketType: 'INCIDENT',
  departmentId: null,
}

function connection(
  overrides: Partial<SdIntegrationDTO> = {},
): SdIntegrationDTO {
  return {
    id: 'int-slack',
    kind: 'SLACK',
    status: 'ACTIVE',
    statusError: null,
    externalId: 'T0001',
    externalName: 'Stratus',
    baseUrl: null,
    hasWebhookSecret: false,
    lastEventAt: null,
    slack: SLACK_CONFIG,
    repo: null,
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  }
}

const github = (overrides: Partial<SdIntegrationDTO> = {}) =>
  connection({
    id: 'int-gh',
    kind: 'GITHUB',
    externalId: 'steel-so/steel',
    externalName: 'steel-so/steel',
    hasWebhookSecret: true,
    slack: null,
    repo: { suggestPhaseOnClose: true, allowIssueFromTicket: true },
    ...overrides,
  })

const gitlab = (overrides: Partial<SdIntegrationDTO> = {}) =>
  github({
    id: 'int-gl',
    kind: 'GITLAB',
    externalId: 'stratus/steel',
    externalName: 'stratus/steel',
    baseUrl: 'https://gitlab.com',
    ...overrides,
  })

function overview(
  overrides: Partial<SdIntegrationsOverviewDTO> = {},
): SdIntegrationsOverviewDTO {
  return {
    slackConfigured: true,
    manageHref: MANAGE,
    slack: null,
    github: null,
    gitlab: null,
    ...overrides,
  }
}

function renderTab(canEdit = true) {
  return renderWithQuery(
    <SdSettingsProvider value={{ workspaceId: WS, canEdit, config }}>
      <SdIntegrationsTab />
    </SdSettingsProvider>,
  )
}

describe('SD_SETTINGS_TABS', () => {
  it('keeps the Integrações tab before Notificações', () => {
    const ids = SD_SETTINGS_TABS.map((tab) => tab.id)
    expect(ids.indexOf('integrations')).toBeLessThan(
      ids.indexOf('notifications'),
    )
    const tab = SD_SETTINGS_TABS.find((item) => item.id === 'integrations')
    expect(tab?.label).toBe('Integrações')
    expect(tab?.component).toBe(SdIntegrationsTab)
  })
})

describe('<SdIntegrationsTab /> — not connected', () => {
  it('points every provider to Ajustes › Integrações', async () => {
    mockFetch([{ match: BASE, data: overview() }])
    renderTab()
    expect(
      await screen.findByText(/O Slack ainda não foi conectado/),
    ).toBeTruthy()
    const links = screen.getAllByRole('link', {
      name: /Conectar em Ajustes › Integrações/,
    })
    expect(links).toHaveLength(3)
    expect(links.every((link) => link.getAttribute('href') === MANAGE)).toBe(
      true,
    )
    expect(screen.getByText(/Nenhum repositório conectado/)).toBeTruthy()
    expect(screen.getByText(/Nenhum projeto conectado/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Ajustes › Integrações' }),
    ).toBeTruthy()
  })

  it('explains when the server has no Slack app and no manage link', async () => {
    mockFetch([
      {
        match: BASE,
        data: overview({ slackConfigured: false, manageHref: null }),
      },
    ])
    renderTab()
    expect(
      await screen.findByText(/não está configurado neste servidor/),
    ).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('<SdIntegrationsTab /> — Slack', () => {
  it('shows the connection, its error and a channel selector per team', async () => {
    mockFetch([
      {
        match: CHANNELS,
        data: [
          { id: 'C0', name: 'geral', isPrivate: false },
          { id: 'C1', name: 'redes', isPrivate: true },
        ],
      },
      {
        match: BASE,
        data: overview({
          slack: connection({
            status: 'ERROR',
            statusError: 'canal não encontrado',
          }),
        }),
      },
    ])
    renderTab()
    expect(await screen.findByText('Stratus')).toBeTruthy()
    expect(screen.getByText('Com erro')).toBeTruthy()
    expect(screen.getByText('canal não encontrado')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Gerenciar conexão' })).toBeTruthy()
    expect(await screen.findByText('Suporte N1')).toBeTruthy()
    expect(screen.getByText('Infra › Redes')).toBeTruthy()
    expect(screen.getAllByText('Usar o canal da regra').length).toBeGreaterThan(
      0,
    )
  })

  it('shows the channel listing error and the empty team list', async () => {
    mockFetch([
      { match: CHANNELS, status: 502, error: 'O Slack não respondeu' },
      { match: BASE, data: overview({ slack: connection() }) },
    ])
    renderTab()
    expect(await screen.findByText('O Slack não respondeu')).toBeTruthy()
  })

  it('turns thread mirroring and ticket from message off', async () => {
    const spy = mockFetch([
      { match: CHANNELS, data: [] },
      { match: BASE, data: overview({ slack: connection() }) },
      { method: 'PATCH', match: `${BASE}/slack`, data: connection() },
    ])
    renderTab()
    fireEvent.click(
      await screen.findByRole('switch', {
        name: /Respostas da thread entram no histórico/,
      }),
    )
    await waitFor(() => {
      expect(fetchBody(spy, `${BASE}/slack`, 'PATCH')).toEqual({
        mirrorThreadReplies: false,
      })
    })
    fireEvent.click(
      screen.getByRole('switch', { name: /Abrir chamado por atalho/ }),
    )
    await waitFor(() => {
      expect(
        spy.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
      ).toHaveLength(2)
    })
  })

  it('disables the switches in read-only mode', async () => {
    mockFetch([
      { match: CHANNELS, data: [] },
      { match: BASE, data: overview({ slack: connection() }) },
    ])
    renderTab(false)
    const toggle = await screen.findByRole('switch', {
      name: /Respostas da thread/,
    })
    expect(
      toggle.hasAttribute('disabled') ||
        toggle.getAttribute('aria-disabled') === 'true' ||
        toggle.hasAttribute('data-disabled'),
    ).toBe(true)
  })
})

describe('<SdIntegrationsTab /> — GitHub and GitLab', () => {
  it('shows both repositories and their webhook state', async () => {
    mockFetch([
      {
        match: BASE,
        data: overview({
          github: github(),
          gitlab: gitlab({
            hasWebhookSecret: false,
            statusError: 'token expirado',
          }),
        }),
      },
    ])
    renderTab()
    expect(await screen.findByText('steel-so/steel')).toBeTruthy()
    expect(screen.getByText('stratus/steel')).toBeTruthy()
    expect(screen.getByText('Webhook assinado')).toBeTruthy()
    expect(screen.getByText('Sem segredo de webhook')).toBeTruthy()
    expect(screen.getByText('token expirado')).toBeTruthy()
  })

  it('updates the phase suggestion of each provider on its own route', async () => {
    const spy = mockFetch([
      { match: BASE, data: overview({ github: github(), gitlab: gitlab() }) },
      { method: 'PATCH', match: `${BASE}/github`, data: github() },
      { method: 'PATCH', match: `${BASE}/gitlab`, data: gitlab() },
    ])
    renderTab()
    const toggles = await screen.findAllByRole('switch', {
      name: /Fechar a issue sugere avançar a fase/,
    })
    expect(toggles).toHaveLength(2)
    fireEvent.click(toggles[1])
    await waitFor(() => {
      expect(fetchBody(spy, `${BASE}/gitlab`, 'PATCH')).toEqual({
        suggestPhaseOnClose: false,
      })
    })
    fireEvent.click(
      screen.getAllByRole('switch', {
        name: /Abrir issue a partir do chamado/,
      })[0],
    )
    await waitFor(() => {
      expect(fetchBody(spy, `${BASE}/github`, 'PATCH')).toEqual({
        allowIssueFromTicket: false,
      })
    })
  })
})

describe('<SdIntegrationsTab /> — tab states', () => {
  it('shows the loading text and then the query error', async () => {
    mockFetch([{ match: BASE, status: 403, error: 'Só administradores' }])
    renderTab()
    expect(screen.getByText('Carregando integrações…')).toBeTruthy()
    expect(await screen.findByText('Só administradores')).toBeTruthy()
  })
})
