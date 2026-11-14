import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappDashboardsList } from '../whatsapp-dashboards-list'
import { WhatsappReportsList } from '../whatsapp-reports-list'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}))
// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const REPORTS = '/api/workspaces/ws_1/whatsapp/reports'
const DASHBOARDS = '/api/workspaces/ws_1/whatsapp/dashboards'

function report(id: string, name: string, source: string) {
  return {
    id,
    workspaceId: 'ws_1',
    name,
    source,
    columns: [],
    filters: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('<WhatsappReportsList />', () => {
  function setup(extra: FetchRoute[] = [], list: unknown[] = []) {
    return mockFetch([...extra, { match: REPORTS, data: list }])
  }

  it('lists reports with their source label and opens one on click', async () => {
    setup(
      [],
      [
        report('r1', 'Atendimentos da semana', 'whatsapp_conversation'),
        report('r2', 'Campanhas', 'whatsapp_broadcast'),
      ],
    )
    renderWithQuery(<WhatsappReportsList workspaceId='ws_1' slug='acme' />)

    expect(await screen.findByText('Atendimentos da semana')).toBeTruthy()
    expect(screen.getByText('Conversas do WhatsApp')).toBeTruthy()
    expect(screen.getByText('Transmissões do WhatsApp')).toBeTruthy()

    fireEvent.click(screen.getByText('Campanhas'))
    expect(push).toHaveBeenCalledWith('/acme/zap/reports/r2')
  })

  it('shows the empty state once loaded', async () => {
    setup()
    renderWithQuery(<WhatsappReportsList workspaceId='ws_1' slug='acme' />)
    expect(
      await screen.findByText('Nenhum relatório criado ainda.'),
    ).toBeTruthy()
  })

  it('requires a name before creating', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappReportsList workspaceId='ws_1' slug='acme' />)
    fireEvent.click(screen.getByRole('button', { name: /Novo relatório/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: '   ' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar relatório' }),
    )

    expect(notify.error).toHaveBeenCalledWith('Informe o nome do relatório.')
    expect(fetchBody(fetchSpy, REPORTS)).toBeUndefined()
  })

  it('creates a report with the default column and navigates to it', async () => {
    const fetchSpy = setup([
      {
        method: 'POST',
        match: REPORTS,
        data: report('r9', 'Novo', 'whatsapp_conversation'),
      },
    ])
    renderWithQuery(<WhatsappReportsList workspaceId='ws_1' slug='acme' />)
    fireEvent.click(screen.getByRole('button', { name: /Novo relatório/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: '  Novo  ' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar relatório' }),
    )

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/zap/reports/r9'),
    )
    expect(fetchBody(fetchSpy, REPORTS)).toEqual({
      name: 'Novo',
      source: 'whatsapp_conversation',
      columns: ['contactName'],
    })
  })

  it('switches the source to broadcasts', async () => {
    const fetchSpy = setup([
      {
        method: 'POST',
        match: REPORTS,
        data: report('r5', 'Envios', 'whatsapp_broadcast'),
      },
    ])
    renderWithQuery(<WhatsappReportsList workspaceId='ws_1' slug='acme' />)
    fireEvent.click(screen.getByRole('button', { name: /Novo relatório/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Envios' },
    })
    fireEvent.click(within(dialog).getByRole('combobox'))
    const option = within(await screen.findByRole('listbox')).getByRole(
      'option',
      { name: 'Transmissões do WhatsApp' },
    )
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar relatório' }),
    )
    await waitFor(() =>
      expect(fetchBody(fetchSpy, REPORTS)).toEqual({
        name: 'Envios',
        source: 'whatsapp_broadcast',
        columns: ['name'],
      }),
    )
  })

  it('reports deletion failures', async () => {
    setup(
      [
        {
          method: 'DELETE',
          match: `${REPORTS}/r1`,
          status: 403,
          error: 'Sem permissão',
        },
      ],
      [report('r1', 'Semana', 'whatsapp_conversation')],
    )
    renderWithQuery(<WhatsappReportsList workspaceId='ws_1' slug='acme' />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remover relatório' }),
    )
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Remover',
      }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.calls[0][0] as Error).message).toBe(
      'Sem permissão',
    )
  })
})

describe('<WhatsappDashboardsList />', () => {
  const dashboards = [
    { id: 'd1', title: 'Sentimento', workspaceId: 'ws_1' },
    { id: 'd2', title: 'Volume diário', workspaceId: 'ws_1' },
  ]

  it('lists dashboards and navigates on click', async () => {
    mockFetch([{ match: DASHBOARDS, data: dashboards }])
    renderWithQuery(<WhatsappDashboardsList workspaceId='ws_1' slug='acme' />)

    fireEvent.click(await screen.findByText('Volume diário'))
    expect(push).toHaveBeenCalledWith('/acme/zap/dashboards/d2')
  })

  it('shows the empty state', async () => {
    mockFetch([{ match: DASHBOARDS, data: [] }])
    renderWithQuery(<WhatsappDashboardsList workspaceId='ws_1' slug='acme' />)
    expect(await screen.findByText('Nenhum painel criado ainda.')).toBeTruthy()
  })

  it('creates a dashboard and opens it', async () => {
    const fetchSpy = mockFetch([
      { method: 'POST', match: DASHBOARDS, data: { id: 'd9' } },
      { match: DASHBOARDS, data: [] },
    ])
    renderWithQuery(<WhatsappDashboardsList workspaceId='ws_1' slug='acme' />)
    await screen.findByText('Nenhum painel criado ainda.')

    fireEvent.click(screen.getByRole('button', { name: /Novo painel/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'SLA' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar painel' }),
    )

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/zap/dashboards/d9'),
    )
    expect(fetchBody(fetchSpy, DASHBOARDS)).toEqual({ title: 'SLA' })
  })

  it('surfaces the API message when creation fails', async () => {
    mockFetch([
      { method: 'POST', match: DASHBOARDS, status: 422, error: 'Título longo' },
      { match: DASHBOARDS, data: [] },
    ])
    renderWithQuery(<WhatsappDashboardsList workspaceId='ws_1' slug='acme' />)
    await screen.findByText('Nenhum painel criado ainda.')

    fireEvent.click(screen.getByRole('button', { name: /Novo painel/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'x' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar painel' }),
    )

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Título longo'),
    )
    expect(push).not.toHaveBeenCalled()
  })

  it('removes a dashboard and refreshes the list', async () => {
    let list = dashboards
    const fetchSpy = mockFetch([
      {
        method: 'DELETE',
        match: `${DASHBOARDS}/d1`,
        handler: () => {
          list = dashboards.slice(1)
          return null
        },
      },
      { match: DASHBOARDS, handler: () => list },
    ])
    renderWithQuery(<WhatsappDashboardsList workspaceId='ws_1' slug='acme' />)
    await screen.findByText('Sentimento')

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remover painel' })[0],
    )
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Remover',
      }),
    )
    await waitFor(() => expect(screen.queryByText('Sentimento')).toBeNull())
    expect(screen.getByText('Volume diário')).toBeTruthy()
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(true)
  })

  it('shows an error state (not the empty state) when loading fails', async () => {
    let fail = true
    mockFetch([
      {
        match: DASHBOARDS,
        handler: () =>
          fail
            ? new Response(
                JSON.stringify({ success: false, message: 'Falha interna' }),
                { status: 500 },
              )
            : dashboards,
      },
    ])
    renderWithQuery(<WhatsappDashboardsList workspaceId='ws_1' slug='acme' />)

    expect(
      (await screen.findByRole('alert')).textContent?.includes(
        'Não foi possível carregar os painéis.',
      ),
    ).toBe(true)
    expect(screen.queryByText('Nenhum painel criado ainda.')).toBeNull()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Sentimento')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns when creating a dashboard hits a network failure', async () => {
    mockFetch([
      {
        method: 'POST',
        match: DASHBOARDS,
        handler: () => {
          throw new TypeError('Failed to fetch')
        },
      },
      { match: DASHBOARDS, data: [] },
    ])
    renderWithQuery(<WhatsappDashboardsList workspaceId='ws_1' slug='acme' />)
    await screen.findByText('Nenhum painel criado ainda.')

    fireEvent.click(screen.getByRole('button', { name: /Novo painel/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Título'), {
      target: { value: 'SLA' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar painel' }),
    )

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Não foi possível criar o painel. Verifique sua conexão.',
      ),
    )
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Criar painel',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it('surfaces the API message when deletion fails', async () => {
    mockFetch([
      {
        method: 'DELETE',
        match: `${DASHBOARDS}/d1`,
        status: 403,
        error: 'Sem permissão',
      },
      { match: DASHBOARDS, data: dashboards },
    ])
    renderWithQuery(<WhatsappDashboardsList workspaceId='ws_1' slug='acme' />)
    await screen.findByText('Sentimento')

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remover painel' })[0],
    )
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Remover',
      }),
    )
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Sem permissão'),
    )
    expect(screen.getByText('Sentimento')).toBeTruthy()
  })
})
