import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDashboardRowsCache } from '@/app/_components/crm/dashboard/use-dashboard-rows'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { CrmDashboardWidgetDTO } from '@/types/crm-dashboard'
import { SdDashboardTv, sdTvInterval, sdTvRotation } from '../sd-dashboard-tv'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/servicedesk/dashboards/d1/tv',
}))

const WS = 'ws-1'
const DASHBOARDS = [
  { id: 'd1', title: 'KPIs (TV)' },
  { id: 'd2', title: 'Dashboard analítico' },
]

function widget(
  overrides: Partial<CrmDashboardWidgetDTO> = {},
): CrmDashboardWidgetDTO {
  return {
    id: 'w1',
    dashboardId: 'd1',
    type: 'RICH_TEXT',
    x: 0,
    y: 0,
    w: 6,
    h: 4,
    page: 0,
    config: { title: 'SLA em risco', html: '<p>3 chamados</p>' },
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  }
}

const VIEW_WIDGET = widget({
  id: 'w-view',
  type: 'VIEW',
  config: {
    title: 'Fila agora',
    source: 'sd-tickets',
    fields: ['code', 'title'],
    filters: [],
    sort: [],
  },
})

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null
  close() {}
}

beforeEach(() => {
  clearDashboardRowsCache()
  vi.stubGlobal('EventSource', FakeEventSource)
  // jsdom reports 0 for every box; `useContainerWidth` (offsetWidth) and o
  // cálculo da altura da linha precisam de uma tela de verdade.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 1920,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: 1080,
  })
})

function renderTv(
  props: Partial<Parameters<typeof SdDashboardTv>[0]> = {},
  widgets: CrmDashboardWidgetDTO[] = [widget()],
) {
  const spy = mockFetch([{ match: '/servicedesk/dashboards/', data: widgets }])
  renderWithQuery(
    <SdDashboardTv
      workspaceId={WS}
      slug='acme'
      dashboardId='d1'
      dashboards={DASHBOARDS}
      {...props}
    />,
  )
  return spy
}

describe('sdTvRotation', () => {
  it('always starts on the open dashboard and drops unknown ids', () => {
    expect(sdTvRotation('d1', 'd2,ghost,d1', DASHBOARDS)).toEqual(['d1', 'd2'])
  })

  it('returns only the open dashboard without ?rotate', () => {
    expect(sdTvRotation('d1', undefined, DASHBOARDS)).toEqual(['d1'])
  })
})

describe('sdTvInterval', () => {
  it('defaults to 60s and clamps out-of-range values', () => {
    expect(sdTvInterval(undefined)).toBe(60)
    expect(sdTvInterval('abc')).toBe(60)
    expect(sdTvInterval('5')).toBe(10)
    expect(sdTvInterval('90')).toBe(90)
    expect(sdTvInterval('99999')).toBe(3600)
  })
})

describe('<SdDashboardTv />', () => {
  it('shows the dashboard name, the clock and the widget tiles', async () => {
    renderTv()

    expect(
      await screen.findByRole('heading', { name: 'KPIs (TV)' }),
    ).toBeTruthy()
    expect(screen.getByText(/Atualizado às/)).toBeTruthy()
    expect(screen.getByText('Hora atual:')).toBeTruthy()
    expect(await screen.findByText('SLA em risco')).toBeTruthy()
  })

  it('reports an empty dashboard', async () => {
    renderTv({}, [])
    expect(
      await screen.findByText('Este painel ainda não tem widgets.'),
    ).toBeTruthy()
  })

  it('refetches the widget data when asked to refresh', async () => {
    const spy = mockFetch([
      {
        match: '/dashboards/sources/sd-tickets',
        data: [{ id: 't1', code: 'INC-000001', title: 'Sem internet' }],
      },
      { match: '/servicedesk/dashboards/', data: [VIEW_WIDGET] },
    ])
    renderWithQuery(
      <SdDashboardTv
        workspaceId={WS}
        slug='acme'
        dashboardId='d1'
        dashboards={DASHBOARDS}
      />,
    )

    const sourceCalls = () =>
      spy.mock.calls.filter(([url]) =>
        String(url).includes('/dashboards/sources/sd-tickets'),
      ).length
    await waitFor(() => expect(sourceCalls()).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }))

    await waitFor(() => expect(sourceCalls()).toBe(2))
  })

  it('enters and leaves fullscreen through the Fullscreen API', async () => {
    const request = vi.fn()
    const exit = vi.fn()
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: request,
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exit,
    })
    renderTv()

    fireEvent.click(await screen.findByRole('button', { name: 'Tela cheia' }))
    expect(request).toHaveBeenCalled()

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    })
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sair da tela cheia' }),
    )
    expect(exit).toHaveBeenCalled()
  })

  it('rotates between dashboards on the configured interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderTv({ rotate: 'd2', interval: '10' })
      expect(
        await screen.findByRole('heading', { name: 'KPIs (TV)' }),
      ).toBeTruthy()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(
        screen.getByRole('heading', { name: 'Dashboard analítico' }),
      ).toBeTruthy()
      expect(screen.getByText(/painel 2 de 2/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('links back to the dashboard editor', async () => {
    renderTv()
    const exit = await screen.findByRole('link', { name: 'Sair do modo TV' })
    expect(exit.getAttribute('href')).toBe('/acme/servicedesk/dashboards/d1')
  })
})
