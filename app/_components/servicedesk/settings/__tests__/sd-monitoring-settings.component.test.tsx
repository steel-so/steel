import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { SdConfigBootstrapDTO } from '@/types/sd-config'
import type { SdMonitorAlertDTO, SdMonitorSourceDTO } from '@/types/sd-monitor'
import {
  SD_MONITOR_KIND_LABEL,
  SdMonitoringTab,
  sdMonitorWebhookUrl,
} from '../monitoring-tab'
import { SdSettingsProvider } from '../sd-settings-kit'
import { SD_SETTINGS_TABS } from '../settings-tabs'

const WS = 'ws-1'
const SD_URL = `/api/workspaces/${WS}/servicedesk`
const SOURCES = `${SD_URL}/monitor-sources`
const ALERTS = `${SD_URL}/monitor-alerts`

const config = {
  departments: [
    { id: 'dep-1', name: 'Suporte N1', children: [] },
    {
      id: 'dep-2',
      name: 'Infra',
      children: [{ id: 'dep-3', name: 'Redes' }],
    },
  ],
  categories: [{ id: 'cat-1', name: 'Infraestrutura' }],
  priorities: [
    { id: 'p-alta', name: 'Alta' },
    { id: 'p-baixa', name: 'Baixa' },
  ],
} as unknown as SdConfigBootstrapDTO

function source(
  overrides: Partial<SdMonitorSourceDTO> = {},
): SdMonitorSourceDTO {
  return {
    id: 'src-1',
    name: 'Zabbix matriz',
    kind: 'ZABBIX',
    active: true,
    ticketType: 'INCIDENT',
    departmentId: null,
    categoryId: null,
    customerId: null,
    severityMap: [{ from: 'Disaster', priorityId: 'p-alta' }],
    autoResolve: true,
    flappingWindowMinutes: 30,
    correlationMode: 'HOST',
    correlationWindowMinutes: 60,
    lastEventAt: '2026-10-01T12:00:00.000Z',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

function alert(overrides: Partial<SdMonitorAlertDTO> = {}): SdMonitorAlertDTO {
  return {
    id: 'a1',
    sourceId: 'src-1',
    sourceName: 'Zabbix matriz',
    sourceKind: 'ZABBIX',
    status: 'OPEN',
    externalId: '31415',
    severity: 'Disaster',
    host: 'SRV-01',
    subject: 'Sem resposta do agente no SRV-01',
    body: null,
    configItem: { id: 'ci-1', name: 'SRV-01' },
    ticket: { id: 't1', number: 42, title: 'Servidor fora', phase: 'Novo' },
    correlated: false,
    occurrences: 1,
    lastSeenAt: '2026-10-01T12:00:00.000Z',
    startedAt: '2026-10-01T12:00:00.000Z',
    resolvedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

function renderTab(canEdit = true) {
  return renderWithQuery(
    <SdSettingsProvider value={{ workspaceId: WS, canEdit, config }}>
      <SdMonitoringTab />
    </SdSettingsProvider>,
  )
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('SD_SETTINGS_TABS', () => {
  it('registers the monitoring tab before the WhatsApp one', () => {
    const ids = SD_SETTINGS_TABS.map((tab) => tab.id)
    expect(ids).toContain('monitoring')
    expect(ids.indexOf('monitoring')).toBeLessThan(ids.indexOf('whatsapp'))
    const tab = SD_SETTINGS_TABS.find((item) => item.id === 'monitoring')
    expect(tab?.label).toBe('Monitoramento')
    expect(tab?.component).toBe(SdMonitoringTab)
  })

  it('labels both kinds in pt-BR and builds the public url', () => {
    expect(SD_MONITOR_KIND_LABEL.ZABBIX).toBe('Zabbix')
    expect(SD_MONITOR_KIND_LABEL.WEBHOOK).toBe('Webhook genérico')
    expect(SD_MONITOR_KIND_LABEL.GRAFANA).toBe('Grafana')
    expect(SD_MONITOR_KIND_LABEL.PRTG).toBe('PRTG')
    expect(sdMonitorWebhookUrl('/api/servicedesk/monitoring/abc')).toMatch(
      /\/api\/servicedesk\/monitoring\/abc$/,
    )
  })
})

describe('<SdMonitoringTab />', () => {
  it('invites the admin to create the first source', async () => {
    mockFetch([{ match: SOURCES, data: [] }])
    renderTab()
    expect(await screen.findByText(/Nenhuma origem cadastrada/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Nova origem/ })).toBeTruthy()
  })

  it('surfaces the error of the sources query', async () => {
    mockFetch([{ match: SOURCES, status: 403, error: 'Só administradores' }])
    renderTab()
    expect(await screen.findByText('Só administradores')).toBeTruthy()
  })

  it('shows the source with its severity map and hides the writes in read only', async () => {
    mockFetch([{ match: SOURCES, data: [source({ active: false })] }])
    renderTab(false)
    expect(await screen.findByText('Zabbix matriz')).toBeTruthy()
    expect(screen.getByText('Zabbix')).toBeTruthy()
    expect(screen.getByText('Inativa')).toBeTruthy()
    expect(screen.getByText('Disaster → Alta')).toBeTruthy()
    expect(screen.getByText(/instabilidade 30 min/)).toBeTruthy()
    expect(screen.getByText(/correlaciona por 60 min/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Nova origem/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Gerar token/ })).toBeNull()
  })

  it('creates a source and shows the token once with the zabbix snippet', async () => {
    const spy = mockFetch([
      { match: SOURCES, data: [] },
      {
        method: 'POST',
        match: SOURCES,
        status: 201,
        data: {
          ...source(),
          token: 'tok-123',
          webhookPath: '/api/servicedesk/monitoring/tok-123',
        },
      },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Nova origem/ }))

    fireEvent.change(screen.getByPlaceholderText('Zabbix matriz'), {
      target: { value: 'Zabbix DC' },
    })
    fireEvent.click(screen.getByRole('button', { name: /\+ Disaster/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('URL de Zabbix matriz')).toBeTruthy()
    const body = fetchBody(spy, SOURCES)
    expect(body.name).toBe('Zabbix DC')
    expect(body.severityMap).toEqual([
      { from: 'Disaster', priorityId: 'p-alta' },
    ])
    expect(body.autoResolve).toBe(true)
    expect(body.flappingWindowMinutes).toBe(30)
    expect(body.correlationMode).toBe('HOST')
    expect(body.correlationWindowMinutes).toBe(60)

    expect(
      screen.getByText(/\/api\/servicedesk\/monitoring\/tok-123/),
    ).toBeTruthy()
    expect(screen.getByText(/"eventId": "\{EVENT.ID\}"/)).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'Copiar a URL do webhook' }),
    )
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/api/servicedesk/monitoring/tok-123'),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Já copiei' }))
    await waitFor(() =>
      expect(screen.queryByText('URL de Zabbix matriz')).toBeNull(),
    )
  })

  it('edits a source and sends only the shown values', async () => {
    const spy = mockFetch([
      { match: SOURCES, data: [source()] },
      { method: 'PATCH', match: `${SOURCES}/src-1`, data: source() },
    ])
    renderTab()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Editar Zabbix matriz' }),
    )
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Encerrar o chamado quando o alerta normalizar',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(fetchBody(spy, `${SOURCES}/src-1`, 'PATCH')).toMatchObject({
        name: 'Zabbix matriz',
        autoResolve: false,
        active: true,
      }),
    )
  })

  it('rotates the token and shows the new url', async () => {
    mockFetch([
      { match: SOURCES, data: [source()] },
      {
        method: 'POST',
        match: `${SOURCES}/src-1/token`,
        data: {
          ...source(),
          token: 'tok-novo',
          webhookPath: '/api/servicedesk/monitoring/tok-novo',
        },
      },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Gerar token/ }))
    expect(
      await screen.findByText(/\/api\/servicedesk\/monitoring\/tok-novo/),
    ).toBeTruthy()
  })

  it('lists the recent alerts of the source on demand', async () => {
    mockFetch([
      { match: SOURCES, data: [source()] },
      {
        match: ALERTS,
        data: [
          alert(),
          alert({
            id: 'a2',
            externalId: '27182',
            status: 'RESOLVED',
            ticket: null,
            severity: null,
            host: null,
            configItem: null,
            subject: 'Disco cheio',
          }),
        ],
      },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver alertas' }))

    expect(
      await screen.findByText('Sem resposta do agente no SRV-01'),
    ).toBeTruthy()
    expect(screen.getByText('31415')).toBeTruthy()
    expect(screen.getByText('Aberto')).toBeTruthy()
    expect(screen.getByText('Normalizado')).toBeTruthy()
    expect(screen.getByText(/#42/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar alertas' }))
    await waitFor(() => expect(screen.queryByText('31415')).toBeNull())
  })

  it('says when the source never received an alert', async () => {
    mockFetch([
      { match: SOURCES, data: [source()] },
      { match: ALERTS, data: [] },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver alertas' }))
    expect(
      await screen.findByText(/Nenhum alerta recebido desta origem ainda/),
    ).toBeTruthy()
  })

  it('surfaces an error of the alerts query', async () => {
    mockFetch([
      { match: SOURCES, data: [source()] },
      { match: ALERTS, status: 403, error: 'Só agentes' },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver alertas' }))
    expect(await screen.findByText('Só agentes')).toBeTruthy()
  })

  it('reports an error of the create mutation', async () => {
    mockFetch([
      { match: SOURCES, data: [] },
      {
        method: 'POST',
        match: SOURCES,
        status: 409,
        error: 'Já existe uma origem com esses dados',
      },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Nova origem/ }))
    fireEvent.change(screen.getByPlaceholderText('Zabbix matriz'), {
      target: { value: 'Repetida' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByText(/URL de/)).toBeNull())
  })

  it('keeps the save button disabled without a name and with an empty severity', async () => {
    mockFetch([{ match: SOURCES, data: [] }])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Nova origem/ }))
    const save = screen.getByRole('button', { name: 'Salvar' })
    expect(save.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('Zabbix matriz'), {
      target: { value: 'Nova' },
    })
    expect(
      screen.getByRole('button', { name: 'Salvar' }).hasAttribute('disabled'),
    ).toBe(false)

    fireEvent.click(
      screen.getByRole('button', { name: /Adicionar severidade/ }),
    )
    expect(
      screen.getByRole('button', { name: 'Salvar' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it.each([
    ['PRTG', /Payload da ação HTTP do PRTG/, /Executar ação HTTP/],
    [
      'GRAFANA',
      /Corpo \(opcional\) do webhook|Contact points/,
      /Contact points/,
    ],
    ['WEBHOOK', /Corpo do webhook genérico/, /Alertmanager/],
    ['ZABBIX', /Corpo do tipo de mídia do Zabbix/, /Tipos de mídia/],
  ] as const)(
    'guides the %s setup after rotating the token',
    async (kind, title, hint) => {
      mockFetch([
        { match: SOURCES, data: [source({ kind })] },
        {
          method: 'POST',
          match: `${SOURCES}/src-1/token`,
          data: {
            ...source({ kind }),
            token: 'tok-novo',
            webhookPath: '/api/servicedesk/monitoring/tok-novo',
          },
        },
      ])
      renderTab()
      fireEvent.click(
        await screen.findByRole('button', { name: /Gerar token/ }),
      )
      expect(await screen.findByText(hint)).toBeTruthy()
      if (kind === 'GRAFANA') {
        // O corpo padrão do Grafana não precisa de snippet.
        expect(
          screen.queryByRole('button', { name: /Copiar o corpo/ }),
        ).toBeNull()
      } else {
        expect(screen.getByText(title)).toBeTruthy()
        expect(
          screen.getByRole('button', { name: /Copiar o corpo/ }),
        ).toBeTruthy()
      }
      if (kind === 'PRTG') expect(screen.getByText(/%sensorid/)).toBeTruthy()
    },
  )

  it('copies the PRTG payload', async () => {
    mockFetch([
      { match: SOURCES, data: [source({ kind: 'PRTG' })] },
      {
        method: 'POST',
        match: `${SOURCES}/src-1/token`,
        data: {
          ...source({ kind: 'PRTG' }),
          token: 'tok-novo',
          webhookPath: '/api/servicedesk/monitoring/tok-novo',
        },
      },
    ])
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Gerar token/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: /Copiar o corpo/ }),
    )
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"%sensorid"'),
      ),
    )
  })

  it('suggests the Grafana severities and keeps the correlation settings on edit', async () => {
    const spy = mockFetch([
      {
        match: SOURCES,
        data: [
          source({
            kind: 'GRAFANA',
            severityMap: [],
            correlationMode: 'OFF',
            correlationWindowMinutes: 15,
          }),
        ],
      },
      { method: 'PATCH', match: `${SOURCES}/src-1`, data: source() },
    ])
    renderTab()
    expect(await screen.findByText(/sem correlação/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Editar Zabbix matriz' }),
    )
    expect(screen.getByRole('button', { name: '+ critical' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '+ Disaster' })).toBeNull()
    expect(screen.getByText('Janela de correlação (minutos)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${SOURCES}/src-1`, 'PATCH')).toMatchObject({
        kind: 'GRAFANA',
        correlationMode: 'OFF',
        correlationWindowMinutes: 15,
      }),
    )
  })

  it('suggests the PRTG severities and none for a generic webhook', async () => {
    mockFetch([
      { match: SOURCES, data: [source({ kind: 'PRTG', severityMap: [] })] },
    ])
    renderTab()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Editar Zabbix matriz' }),
    )
    expect(screen.getByRole('button', { name: '+ Down' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Unusual' })).toBeTruthy()
  })
})
