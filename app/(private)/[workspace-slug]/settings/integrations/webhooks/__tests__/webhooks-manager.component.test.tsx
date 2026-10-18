import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WebhookDeliveryDTO, WebhookEndpointDTO } from '@/types/webhook'
import {
  prettyBody,
  webhookEventGroups,
  webhookEventsSummary,
  webhookHost,
} from '../webhook-format'
import { WebhooksManager } from '../webhooks-manager'

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/webhooks`

function endpoint(
  overrides: Partial<WebhookEndpointDTO> = {},
): WebhookEndpointDTO {
  return {
    id: 'e1',
    workspaceId: WS,
    url: 'https://erp.example.com/steel',
    description: 'ERP',
    events: ['crm.deal.won'],
    active: true,
    secretHint: 'whsec_…a1b2',
    disabledAt: null,
    disabledReason: null,
    failingSince: null,
    lastSuccessAt: '2026-10-08T15:30:00.000Z',
    lastFailureAt: null,
    createdById: 'u1',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

function delivery(
  overrides: Partial<WebhookDeliveryDTO> = {},
): WebhookDeliveryDTO {
  return {
    id: 'd1',
    endpointId: 'e1',
    eventId: 'evt_1',
    eventType: 'crm.deal.won',
    status: 'FAILED',
    attempts: 6,
    responseStatus: 500,
    responseBody: '{"error":"boom"}',
    durationMs: 120,
    error: 'http_500',
    requestBody: '{"id":"evt_1"}',
    lastAttemptAt: '2026-10-08T15:30:00.000Z',
    deliveredAt: null,
    createdAt: '2026-10-08T15:00:00.000Z',
    ...overrides,
  }
}

function render() {
  return renderWithQuery(<WebhooksManager workspaceId={WS} />)
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('webhook page helpers', () => {
  it('summarizes, groups and formats', () => {
    expect(webhookEventsSummary(['*'])).toBe('Todos os eventos')
    expect(webhookEventsSummary(['a'])).toBe('1 evento')
    expect(webhookEventsSummary(['a', 'b'])).toBe('2 eventos')
    expect(webhookHost('https://erp.example.com/x')).toBe('erp.example.com')
    expect(webhookHost('nope')).toBe('nope')
    expect(prettyBody('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyBody('plain')).toBe('plain')
    expect(prettyBody(null)).toBe('')
    const groups = webhookEventGroups()
    expect(groups.map((group) => group.label)).toEqual([
      'ServiceDesk',
      'CRM',
      'Comunicação',
      'Steel Agents',
    ])
    expect(
      groups.flatMap((g) => g.events).some((e) => e.type === 'steel.ping'),
    ).toBe(false)
  })
})

describe('<WebhooksManager />', () => {
  it('shows the empty state', async () => {
    mockFetch([
      { match: `${BASE}/endpoints`, data: { items: [], nextCursor: null } },
      { match: `${BASE}/deliveries`, data: { items: [], nextCursor: null } },
    ])
    render()
    expect(await screen.findByText('Nenhum webhook cadastrado')).toBeTruthy()
    expect(
      await screen.findByText('Nenhuma entrega por aqui ainda.'),
    ).toBeTruthy()
  })

  it('lists endpoints with their state and the delivery log', async () => {
    mockFetch([
      {
        match: `${BASE}/endpoints`,
        data: {
          items: [
            endpoint(),
            endpoint({
              id: 'e2',
              description: null,
              url: 'https://bi.example.com/in',
              active: false,
              disabledReason: 'auto',
              events: ['*'],
            }),
          ],
          nextCursor: null,
        },
      },
      {
        match: `${BASE}/deliveries`,
        data: { items: [delivery()], nextCursor: null },
      },
    ])
    render()
    expect(await screen.findByText('ERP')).toBeTruthy()
    expect(screen.getByText('Desativado por falhas')).toBeTruthy()
    expect(screen.getByText(/Todos os eventos · segredo/)).toBeTruthy()
    expect(await screen.findByText('Falhou')).toBeTruthy()
    expect(screen.getByText('HTTP 500')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }))
    expect(screen.getByText(/"error": "boom"/)).toBeTruthy()
  })

  it('creates an endpoint and shows the secret once', async () => {
    const spy = mockFetch([
      { match: `${BASE}/endpoints`, data: { items: [], nextCursor: null } },
      { match: `${BASE}/deliveries`, data: { items: [], nextCursor: null } },
      {
        method: 'POST',
        match: `${BASE}/endpoints`,
        status: 201,
        data: { endpoint: endpoint(), secret: 'whsec_created_secret' },
      },
    ])
    render()
    await screen.findByText('Nenhum webhook cadastrado')
    fireEvent.click(screen.getByRole('button', { name: /Novo webhook/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('URL do endpoint'), {
      target: { value: 'https://erp.example.com/steel' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))
    expect(await screen.findByDisplayValue('whsec_created_secret')).toBeTruthy()
    expect(fetchBody(spy, `${BASE}/endpoints`)).toEqual({
      url: 'https://erp.example.com/steel',
      events: ['*'],
    })
  })

  it('validates the URL before sending', async () => {
    const spy = mockFetch([
      { match: `${BASE}/endpoints`, data: { items: [], nextCursor: null } },
      { match: `${BASE}/deliveries`, data: { items: [], nextCursor: null } },
    ])
    render()
    await screen.findByText('Nenhum webhook cadastrado')
    fireEvent.click(screen.getByRole('button', { name: /Novo webhook/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('URL do endpoint'), {
      target: { value: 'http://erp.example.com' },
    })
    fireEvent.submit(
      within(dialog)
        .getByLabelText('URL do endpoint')
        .closest('form') as HTMLFormElement,
    )
    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    expect(fetchBody(spy, `${BASE}/endpoints`)).toBeUndefined()
  })

  it('sends a test and re-delivers a failed delivery', async () => {
    const spy = mockFetch([
      {
        match: `${BASE}/endpoints`,
        data: { items: [endpoint()], nextCursor: null },
      },
      {
        match: `${BASE}/deliveries`,
        data: { items: [delivery()], nextCursor: null },
      },
      {
        method: 'POST',
        match: `${BASE}/endpoints/e1/test`,
        data: delivery({
          id: 'd2',
          eventType: 'steel.ping',
          status: 'SUCCEEDED',
          responseStatus: 200,
        }),
      },
      {
        method: 'POST',
        match: `${BASE}/deliveries/d1/retry`,
        status: 202,
        data: delivery({ status: 'PENDING' }),
      },
    ])
    render()
    fireEvent.click(await screen.findByRole('button', { name: /Enviar teste/ }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) =>
          String(url).includes('/endpoints/e1/test'),
        ),
      ).toBe(true),
    )
    fireEvent.click(await screen.findByRole('button', { name: /Reenviar/ }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) =>
          String(url).includes('/deliveries/d1/retry'),
        ),
      ).toBe(true),
    )
  })
})
