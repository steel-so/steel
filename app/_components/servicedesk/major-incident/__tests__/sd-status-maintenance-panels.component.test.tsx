import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  SdStatusComponentDTO,
  SdStatusMaintenanceDTO,
} from '@/types/sd-status-maintenance'
import type { SdStatusPageDTO } from '@/types/sd-status-page'

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
  SdComponentsDialog,
  SdMaintenanceDialog,
  SdMaintenanceSection,
} from '../sd-status-maintenance-panels'

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/servicedesk`

const pageDto: SdStatusPageDTO = {
  id: 'p1',
  name: 'Acme',
  slug: 'acme',
  path: '/status-page/acme',
  description: null,
  customer: null,
  serviceIds: ['s1'],
  services: [{ id: 's1', name: 'Telefonia' }],
  published: true,
  allowSubscriptions: true,
  subscriberCount: 0,
  activeIncidentCount: 0,
  createdAt: '2026-10-01T12:00:00.000Z',
}

function component(
  overrides: Partial<SdStatusComponentDTO> = {},
): SdStatusComponentDTO {
  return {
    id: 'cmp1',
    pageId: 'p1',
    name: 'Telefonia',
    serviceId: null,
    state: 'OPERATIONAL',
    position: 0,
    stateChangedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

function maintenance(
  overrides: Partial<SdStatusMaintenanceDTO> = {},
): SdStatusMaintenanceDTO {
  return {
    id: 'mw1',
    title: 'Troca do switch',
    description: null,
    startsAt: '2026-11-10T22:00:00.000Z',
    endsAt: '2026-11-11T02:00:00.000Z',
    phase: 'SCHEDULED',
    suppressMonitoring: true,
    configItems: [{ id: 'ci1', name: 'SRV-01' }],
    pages: [{ id: 'p1', name: 'Acme', slug: 'acme' }],
    notifySubscribers: true,
    announcedAt: '2026-10-02T10:00:00.000Z',
    canceledAt: null,
    notify: { done: true, total: 3, sent: 2, failed: 1 },
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

describe('SdComponentsDialog', () => {
  it('lets an agent change the state of a component', async () => {
    const spy = mockFetch([
      {
        match: `${BASE}/status-pages/p1/components/cmp1`,
        method: 'PATCH',
        data: component({ state: 'DEGRADED' }),
      },
      {
        match: `${BASE}/status-pages/p1/components`,
        data: { items: [component()] },
      },
    ])
    renderWithQuery(
      <SdComponentsDialog
        workspaceId={WS}
        page={pageDto}
        isAdmin={false}
        onOpenChange={() => undefined}
      />,
    )
    expect(await screen.findByText('Componentes · Acme')).toBeTruthy()
    await screen.findAllByText('Operacional')
    // Agents change the state but do not add or remove components.
    expect(screen.queryByRole('button', { name: 'Adicionar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox'))
    await user.click(
      await screen.findByRole('option', { name: 'Desempenho degradado' }),
    )
    await waitFor(() =>
      expect(
        fetchBody(spy, `${BASE}/status-pages/p1/components/cmp1`, 'PATCH'),
      ).toEqual({ state: 'DEGRADED' }),
    )
  })

  it('lets the admin add a component linked to a catalog service', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${BASE}/status-pages/p1/components`,
        data: component(),
      },
      { match: `${BASE}/status-pages/p1/components`, data: { items: [] } },
    ])
    renderWithQuery(
      <SdComponentsDialog
        workspaceId={WS}
        page={pageDto}
        isAdmin
        onOpenChange={() => undefined}
      />,
    )
    expect(await screen.findByText('Nenhum componente ainda.')).toBeTruthy()
    const add = screen.getByRole('button', { name: 'Adicionar' })
    expect(add.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Telefonia'), {
      target: { value: 'Telefonia fixa' },
    })
    fireEvent.click(add)
    await waitFor(() =>
      expect(
        fetchBody(spy, `${BASE}/status-pages/p1/components`, 'POST'),
      ).toEqual({ name: 'Telefonia fixa' }),
    )
  })
})

describe('SdMaintenanceDialog', () => {
  it('schedules a window reading the typed times in Brasília', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${BASE}/status-maintenances`,
        data: maintenance(),
      },
      {
        match: `${BASE}/status-pages`,
        data: { items: [pageDto] },
      },
    ])
    renderWithQuery(
      <SdMaintenanceDialog
        workspaceId={WS}
        window={null}
        open
        onOpenChange={() => undefined}
      />,
    )
    fireEvent.change(
      screen.getByPlaceholderText('Troca do switch do datacenter'),
      {
        target: { value: 'Troca do switch' },
      },
    )
    const [start, end] = Array.from(
      document.querySelectorAll('input[type="datetime-local"]'),
    )
    fireEvent.change(start, { target: { value: '2026-11-10T19:00' } })
    fireEvent.change(end, { target: { value: '2026-11-10T23:00' } })
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(
      screen.getByRole('switch', {
        name: /Não abrir chamados do monitoramento/,
      }),
    )
    // Suppression needs at least one covered item.
    expect(
      screen.getByRole('button', { name: 'Agendar' }).hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'escolher item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agendar' }))

    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/status-maintenances`, 'POST')).toEqual({
        title: 'Troca do switch',
        description: null,
        startsAt: '2026-11-10T22:00:00.000Z',
        endsAt: '2026-11-11T02:00:00.000Z',
        pageIds: ['p1'],
        notifySubscribers: true,
        suppressMonitoring: true,
        configItemIds: ['ci-9'],
      }),
    )
  })

  it('blocks a window that ends before it starts', async () => {
    mockFetch([{ match: `${BASE}/status-pages`, data: { items: [pageDto] } }])
    renderWithQuery(
      <SdMaintenanceDialog
        workspaceId={WS}
        window={null}
        open
        onOpenChange={() => undefined}
      />,
    )
    fireEvent.change(
      screen.getByPlaceholderText('Troca do switch do datacenter'),
      {
        target: { value: 'Troca do switch' },
      },
    )
    const [start, end] = Array.from(
      document.querySelectorAll('input[type="datetime-local"]'),
    )
    fireEvent.change(start, { target: { value: '2026-11-10T23:00' } })
    fireEvent.change(end, { target: { value: '2026-11-10T19:00' } })
    fireEvent.click(await screen.findByRole('checkbox'))
    expect(
      await screen.findByText('O término precisa ser depois do início.'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Agendar' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('edits an existing window with its times shown in Brasília', async () => {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: `${BASE}/status-maintenances/mw1`,
        data: maintenance(),
      },
      { match: `${BASE}/status-pages`, data: { items: [pageDto] } },
    ])
    renderWithQuery(
      <SdMaintenanceDialog
        workspaceId={WS}
        window={maintenance()}
        open
        onOpenChange={() => undefined}
      />,
    )
    const [start] = Array.from(
      document.querySelectorAll('input[type="datetime-local"]'),
    ) as HTMLInputElement[]
    expect(start.value).toBe('2026-11-10T19:00')
    expect(screen.getByText('SRV-01')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remover SRV-01' }))
    fireEvent.click(screen.getByRole('button', { name: 'escolher item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(
        fetchBody(spy, `${BASE}/status-maintenances/mw1`, 'PATCH'),
      ).toMatchObject({ configItemIds: ['ci-9'], pageIds: ['p1'] }),
    )
  })
})

describe('SdMaintenanceSection', () => {
  it('lists the windows and cancels an open one', async () => {
    const spy = mockFetch([
      {
        method: 'DELETE',
        match: `${BASE}/status-maintenances/mw1`,
        data: maintenance({ phase: 'CANCELED' }),
      },
      {
        match: `${BASE}/status-maintenances`,
        data: {
          items: [
            maintenance(),
            maintenance({
              id: 'mw2',
              title: 'Janela antiga',
              phase: 'FINISHED',
              suppressMonitoring: false,
              configItems: [],
              notify: { done: false, total: 0, sent: 0, failed: 0 },
            }),
          ],
        },
      },
    ])
    renderWithQuery(<SdMaintenanceSection workspaceId={WS} />)
    expect(await screen.findByText('Troca do switch')).toBeTruthy()
    expect(screen.getByText('Agendada')).toBeTruthy()
    expect(screen.getByText('Concluída')).toBeTruthy()
    expect(screen.getByText('Sem chamados do monitoramento')).toBeTruthy()
    expect(screen.getByText(/Aviso enviado a 2 de 3/)).toBeTruthy()
    // Only the open window can be edited or canceled.
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar manutenção' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Cancelar manutenção',
        hidden: false,
      }),
    )
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          (call) =>
            call[1]?.method === 'DELETE' &&
            String(call[0]).includes('status-maintenances/mw1'),
        ),
      ).toBe(true),
    )
  })

  it('shows an empty state', async () => {
    mockFetch([{ match: `${BASE}/status-maintenances`, data: { items: [] } }])
    renderWithQuery(<SdMaintenanceSection workspaceId={WS} />)
    expect(await screen.findByText('Nenhuma manutenção agendada.')).toBeTruthy()
  })

  it('shows the error', async () => {
    mockFetch([
      { match: `${BASE}/status-maintenances`, status: 500, error: 'Falhou' },
    ])
    renderWithQuery(<SdMaintenanceSection workspaceId={WS} />)
    expect(await screen.findByText('Falhou')).toBeTruthy()
  })
})
