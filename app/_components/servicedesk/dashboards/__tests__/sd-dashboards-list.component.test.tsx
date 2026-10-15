import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { CrmDashboardDTO } from '@/types/crm-dashboard'
import { SdDashboardsList } from '../sd-dashboards-list'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/servicedesk/dashboards',
}))

const WS = 'ws-1'
const LIST_URL = `/api/workspaces/${WS}/servicedesk/dashboards`

function dashboard(overrides: Partial<CrmDashboardDTO> = {}): CrmDashboardDTO {
  return {
    id: 'd1',
    title: 'Dashboard analítico',
    workspaceId: WS,
    module: 'SERVICE_DESK',
    createdById: 'u1',
    updatedById: null,
    position: 0,
    settings: { pages: ['Tela 1'], rotateSeconds: 0 },
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  }
}

function renderList(
  props: Partial<Parameters<typeof SdDashboardsList>[0]> = {},
  routes: Parameters<typeof mockFetch>[0] = [],
  items: CrmDashboardDTO[] = [
    dashboard(),
    dashboard({ id: 'd2', title: 'KPIs (TV)' }),
  ],
) {
  const spy = mockFetch([...routes, { match: LIST_URL, data: items }])
  renderWithQuery(
    <SdDashboardsList
      workspaceId={WS}
      slug='acme'
      canCreate
      canEdit
      canDelete
      {...props}
    />,
  )
  return spy
}

describe('<SdDashboardsList />', () => {
  it('lists the dashboards with a link to the editor and to TV mode', async () => {
    renderList()

    const editor = await screen.findByRole('link', {
      name: 'Dashboard analítico',
    })
    expect(editor.getAttribute('href')).toBe('/acme/servicedesk/dashboards/d1')
    expect(screen.getByRole('link', { name: 'KPIs (TV)' })).toBeTruthy()
    const tv = screen.getAllByRole('link', { name: /Modo TV/ })
    expect(tv[0]?.getAttribute('href')).toBe(
      '/acme/servicedesk/dashboards/d1/tv',
    )
  })

  it('shows the empty state and hides the create button without permission', async () => {
    renderList({ canCreate: false }, [], [])

    expect(await screen.findByText('Nenhum painel por aqui ainda')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Novo painel/ })).toBeNull()
  })

  it('creates a dashboard and navigates to it', async () => {
    const spy = renderList({}, [
      {
        method: 'POST',
        match: /dashboards$/,
        status: 201,
        data: dashboard({ id: 'new', title: 'SLA do turno' }),
      },
    ])

    fireEvent.click(await screen.findByRole('button', { name: /Novo painel/ }))
    const input = await screen.findByLabelText('Nome do painel')
    fireEvent.change(input, { target: { value: 'SLA do turno' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar painel' }))

    await waitFor(() =>
      expect(fetchBody(spy, /dashboards$/, 'POST')).toEqual({
        title: 'SLA do turno',
      }),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/servicedesk/dashboards/new'),
    )
  })

  it('renames a dashboard through the actions menu', async () => {
    const spy = renderList({}, [
      {
        method: 'PATCH',
        match: '/dashboards/d1',
        data: dashboard({ title: 'Operação' }),
      },
    ])

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Ações de Dashboard analítico',
      }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Renomear' }))
    const input = await screen.findByLabelText('Nome do painel')
    fireEvent.change(input, { target: { value: 'Operação' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(fetchBody(spy, '/dashboards/d1', 'PATCH')).toEqual({
        title: 'Operação',
      }),
    )
  })

  it('duplicates a dashboard and opens the copy', async () => {
    renderList({}, [
      {
        method: 'POST',
        match: '/dashboards/d1/duplicate',
        status: 201,
        data: dashboard({ id: 'copy', title: 'Dashboard analítico (cópia)' }),
      },
    ])

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Ações de Dashboard analítico',
      }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicar' }))

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/servicedesk/dashboards/copy'),
    )
  })

  it('asks for confirmation before deleting', async () => {
    const spy = renderList({}, [
      { method: 'DELETE', match: '/dashboards/d1', data: null },
    ])

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Ações de Dashboard analítico',
      }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }))
    expect(await screen.findByText(/não pode ser desfeita/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir painel' }))

    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/dashboards/d1') && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('surfaces a list error', async () => {
    mockFetch([{ match: LIST_URL, status: 500, error: 'Banco indisponível' }])
    renderWithQuery(
      <SdDashboardsList
        workspaceId={WS}
        slug='acme'
        canCreate
        canEdit
        canDelete
      />,
    )

    expect(await screen.findByText('Banco indisponível')).toBeTruthy()
  })
})
