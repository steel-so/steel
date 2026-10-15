import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultSalesConfig,
  SalesEditor,
} from '@/app/_components/crm/dashboard/sales/sales-editor'
import { SalesTvTemplateButton } from '@/app/_components/crm/dashboard/sales-tv-template-button'
import {
  DashboardScreens,
  rotationLabel,
} from '@/app/_components/crm/dashboard/tv/dashboard-screens'
import { TvLinkDialog } from '@/app/_components/crm/dashboard/tv/tv-link-dialog'
import {
  salesKindMeta,
  widgetTypesForBasePath,
} from '@/app/_components/crm/dashboard/widget-meta'
import { pageOfWidget } from '@/app/_components/crm/dashboard/widget-title'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'
import { clearDashboardLookupsCache } from '@/src/hooks/use-crm-dashboard-tv'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/crm/dashboards',
}))
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

beforeEach(() => {
  clearDashboardLookupsCache()
  push.mockClear()
})

describe('widget meta helpers', () => {
  it('offers the sales kit only on CRM dashboards', () => {
    expect(widgetTypesForBasePath('crm').map((m) => m.type)).toContain('SALES')
    expect(widgetTypesForBasePath('whatsapp').map((m) => m.type)).not.toContain(
      'SALES',
    )
    expect(
      widgetTypesForBasePath('servicedesk').map((m) => m.type),
    ).not.toContain('SALES')
  })

  it('has defaults for every kind and clamps orphan pages', () => {
    expect(defaultSalesConfig('ranking')).toEqual({
      kind: 'ranking',
      title: 'Ranking de vendedores',
      period: 'month',
      stalledDays: 14,
      limit: 6,
    })
    expect(defaultSalesConfig()).not.toHaveProperty('limit')
    expect(salesKindMeta('nope' as never).kind).toBe('goal')
    expect(pageOfWidget({ page: 5 }, 2)).toBe(1)
    expect(pageOfWidget({ page: -1 }, 2)).toBe(0)
    expect(rotationLabel(0)).toBe('Sem rotação')
    expect(rotationLabel(30)).toBe('A cada 30 s')
    expect(rotationLabel(120)).toBe('A cada 2 min')
  })
})

describe('<SalesEditor />', () => {
  it('switches the metric and keeps a hand-written title', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <SalesEditor
        config={defaultSalesConfig('goal')}
        onChange={onChange}
        workspaceId='ws1'
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Ranking de vendedores/ }),
    )
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'ranking',
        title: 'Ranking de vendedores',
      }),
    )

    rerender(
      <SalesEditor
        config={{ ...defaultSalesConfig('goal'), title: 'Meta da Stratus' }}
        onChange={onChange}
        workspaceId='ws1'
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Placar do dia/ }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'scoreboard', title: 'Meta da Stratus' }),
    )
  })

  it('edits stalled days and rows within bounds, with pipelines to choose', async () => {
    mockFetch([
      {
        match: '/crm/dashboards/lookups',
        data: {
          pipelines: [{ id: 'p1', name: 'Parcerias' }],
          stages: [],
          users: [],
        },
      },
    ])
    const onChange = vi.fn()
    render(
      <SalesEditor
        config={{ ...defaultSalesConfig('stalled'), pipelineId: 'p1' }}
        onChange={onChange}
        workspaceId='ws1'
      />,
    )
    expect(await screen.findByText('Parcerias')).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('14'), {
      target: { value: '999' },
    })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ stalledDays: 365 }),
    )
    fireEvent.change(screen.getByDisplayValue('14'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ stalledDays: 14 }),
    )
    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 1 }),
    )
    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: 'x' } })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 4 }),
    )
    fireEvent.change(screen.getByPlaceholderText('Negócios parados'), {
      target: { value: 'Parados há muito' },
    })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Parados há muito' }),
    )
  })

  it('shows the period for goal-like metrics', () => {
    render(
      <SalesEditor
        config={defaultSalesConfig('goal')}
        onChange={vi.fn()}
        workspaceId='ws1'
      />,
    )
    expect(screen.getByLabelText('Período').textContent).toBe('Mês atual')
    expect(screen.queryByLabelText('Pipeline')).toBeNull()
  })
})

describe('<DashboardScreens />', () => {
  const settings = { pages: ['Metas', 'Funil'], rotateSeconds: 30 }

  it('selects, adds and renames screens', () => {
    const onSelect = vi.fn()
    const onChange = vi.fn()
    render(
      <DashboardScreens
        settings={settings}
        current={0}
        counts={[4, 6]}
        onSelect={onSelect}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tabs[1])
    expect(onSelect).toHaveBeenCalledWith(1)

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tela' }))
    expect(onChange).toHaveBeenCalledWith({
      pages: ['Metas', 'Funil', 'Tela 3'],
      rotateSeconds: 30,
    })
    expect(onSelect).toHaveBeenLastCalledWith(2)
  })

  it('turns rotation on when a second screen is added', () => {
    const onChange = vi.fn()
    render(
      <DashboardScreens
        settings={{ pages: ['Tela 1'], rotateSeconds: 0 }}
        current={0}
        counts={[1]}
        onSelect={vi.fn()}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar tela' }))
    expect(onChange).toHaveBeenCalledWith({
      pages: ['Tela 1', 'Tela 2'],
      rotateSeconds: 30,
    })
  })

  it('caps the screens at 3', () => {
    render(
      <DashboardScreens
        settings={{ pages: ['A', 'B', 'C'], rotateSeconds: 30 }}
        current={2}
        counts={[1, 1, 1]}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Adicionar tela' })).toBeNull()
  })

  it('renames and removes the current screen from the settings popover', async () => {
    const onChange = vi.fn()
    const onRemove = vi.fn()
    render(
      <DashboardScreens
        settings={settings}
        current={1}
        counts={[4, 6]}
        onSelect={vi.fn()}
        onChange={onChange}
        onRemove={onRemove}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Telas e modo TV' }))
    const name = await screen.findByLabelText('Nome da tela')
    fireEvent.change(name, { target: { value: 'Pipeline' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({
      pages: ['Metas', 'Pipeline'],
      rotateSeconds: 30,
    })
    onChange.mockClear()
    fireEvent.blur(name)
    fireEvent.change(name, { target: { value: '  ' } })
    fireEvent.blur(name)
    expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.click(
      screen.getByRole('button', { name: /Remover esta tela e 6 widget/ }),
    )
    expect(onRemove).toHaveBeenCalledWith(1)
  })
})

describe('<TvLinkDialog />', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
  })

  const link = {
    id: 'l1',
    dashboardId: 'd1',
    name: 'TV da recepção',
    path: '/tv/tok-1',
    createdById: 'u1',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-10-15T15:00:00.000Z',
  }

  it('creates a link, copies it and revokes another', async () => {
    const spy = mockFetch([
      { match: '/tv-links/l1', method: 'DELETE', data: null },
      {
        match: '/tv-links',
        method: 'POST',
        status: 201,
        data: { ...link, id: 'l2', name: 'Sala', path: '/tv/tok-2' },
      },
      { match: '/tv-links', data: [link] },
    ])
    render(
      <TvLinkDialog
        open
        onOpenChange={vi.fn()}
        workspaceId='ws1'
        dashboardId='d1'
      />,
    )
    expect(await screen.findByText('TV da recepção')).toBeTruthy()
    expect(screen.getByText(/ainda não exibido/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Nome do link'), {
      target: { value: 'Sala' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Criar link/ }))
    await waitFor(() =>
      expect(screen.getAllByTestId('tv-link-row')).toHaveLength(2),
    )
    expect(fetchBody(spy, '/tv-links')).toEqual({ name: 'Sala' })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/tv/tok-2`,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Revogar link TV da recepção' }),
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('tv-link-row')).toHaveLength(1),
    )
    expect(notify.success).toHaveBeenCalledWith(
      'Link revogado. A TV para na próxima atualização.',
    )
  })

  it('explains that only admins manage TV links', async () => {
    mockFetch([
      {
        match: '/tv-links',
        handler: () =>
          new Response(
            JSON.stringify({
              success: false,
              message: 'Permissão insuficiente',
              error: { code: 'FORBIDDEN' },
            }),
            { status: 403 },
          ),
      },
    ])
    render(
      <TvLinkDialog
        open
        onOpenChange={vi.fn()}
        workspaceId='ws1'
        dashboardId='d1'
      />,
    )
    expect(
      await screen.findByText(
        'Só donos e administradores do CRM gerenciam links da TV.',
      ),
    ).toBeTruthy()
  })

  it('restores a link when revoking fails', async () => {
    mockFetch([
      { match: '/tv-links/l1', method: 'DELETE', status: 500, error: 'falhou' },
      { match: '/tv-links', data: [link] },
    ])
    render(
      <TvLinkDialog
        open
        onOpenChange={vi.fn()}
        workspaceId='ws1'
        dashboardId='d1'
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Revogar link TV da recepção',
      }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(screen.getAllByTestId('tv-link-row')).toHaveLength(1)
  })
})

describe('<SalesTvTemplateButton />', () => {
  it('creates the template and opens it', async () => {
    const spy = mockFetch([
      {
        match: '/crm/dashboards/templates',
        method: 'POST',
        status: 201,
        data: { id: 'd9' },
      },
    ])
    render(<SalesTvTemplateButton workspaceId='ws1' slug='acme' />)
    fireEvent.click(screen.getByRole('button', { name: 'Criar "Vendas — TV"' }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/dashboards/d9'),
    )
    expect(fetchBody(spy, '/templates')).toEqual({ template: 'sales-tv' })
  })

  it('reports a failure and lets the user try again', async () => {
    mockFetch([
      {
        match: '/crm/dashboards/templates',
        method: 'POST',
        status: 403,
        error: 'Sem permissão',
      },
    ])
    render(<SalesTvTemplateButton workspaceId='ws1' slug='acme' />)
    fireEvent.click(screen.getByRole('button', { name: 'Criar "Vendas — TV"' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(
      (
        screen.getByRole('button', {
          name: 'Criar "Vendas — TV"',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })
})
