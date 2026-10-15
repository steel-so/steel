import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CelebrationOverlay,
  CrmDashboardTv,
  countdownLabel,
  tvRotationSeconds,
  tvScreens,
} from '@/app/_components/crm/dashboard/tv/crm-dashboard-tv'
import {
  CrmDashboardTvPublic,
  TV_BOOT_REFRESH_MS,
} from '@/app/_components/crm/dashboard/tv/crm-dashboard-tv-screens'
import { clearDashboardRowsCache } from '@/app/_components/crm/dashboard/use-dashboard-rows'
import { mockFetch } from '@/src/__tests__/component-utils'
import type {
  CrmDashboardTvBootDTO,
  CrmDashboardWidgetDTO,
} from '@/types/crm-dashboard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/tv/tok',
}))

function widget(
  id: string,
  page: number,
  title: string,
): CrmDashboardWidgetDTO {
  return {
    id,
    dashboardId: 'd1',
    type: 'RICH_TEXT',
    x: 0,
    y: 0,
    w: 6,
    h: 4,
    page,
    config: { title, html: `<p>Conteúdo ${id}</p>` },
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  }
}

const SETTINGS = {
  pages: ['Metas do mês', 'Pipeline e funil'],
  rotateSeconds: 30,
}
const WIDGETS = [
  widget('a', 0, 'Bloco da meta'),
  widget('b', 1, 'Bloco do funil'),
]

const WIN = {
  id: 'win-1',
  opportunityName: 'Renovação anual',
  companyName: 'Empresa X',
  amount: 18_400,
  owner: { id: 'u1', name: 'Ana Souza', image: null },
  wonAt: '2026-10-15T14:59:00.000Z',
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

beforeEach(() => {
  clearDashboardRowsCache()
  setReducedMotion(false)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 1920,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: 1080,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TV helpers', () => {
  it('lists the screens that have widgets, clamped to the screen count', () => {
    expect(tvScreens([{ page: 1 }, { page: 0 }, { page: 1 }], 2)).toEqual([
      0, 1,
    ])
    expect(tvScreens([{ page: 2 }], 2)).toEqual([1])
    expect(tvScreens([], 1)).toEqual([])
  })

  it('takes ?interval over the dashboard rotation, within bounds', () => {
    expect(tvRotationSeconds(SETTINGS)).toBe(30)
    expect(tvRotationSeconds(SETTINGS, 'x')).toBe(30)
    expect(tvRotationSeconds(SETTINGS, '5')).toBe(10)
    expect(tvRotationSeconds(SETTINGS, '9999')).toBe(600)
    expect(tvRotationSeconds(SETTINGS, '45')).toBe(45)
  })

  it('counts down to the end of the month', () => {
    const end = new Date('2026-11-01T03:00:00.000Z')
    expect(countdownLabel(new Date('2026-10-15T15:00:00.000Z'), end)).toBe(
      '16d 12h 00min',
    )
    expect(countdownLabel(new Date('2026-10-31T20:30:00.000Z'), end)).toBe(
      '06h 30min',
    )
    expect(countdownLabel(new Date('2026-11-02T00:00:00.000Z'), end)).toBe(
      '00h 00min',
    )
  })
})

describe('<CrmDashboardTv />', () => {
  it('shows the first screen, the clock and the month countdown', async () => {
    mockFetch([
      { match: 'kind=wins-feed', data: { kind: 'wins-feed', rows: [] } },
    ])
    render(
      <CrmDashboardTv
        title='Vendas — TV'
        settings={SETTINGS}
        widgets={WIDGETS}
        workspaceId='ws1'
        timeZone='America/Sao_Paulo'
        exitHref='/acme/crm/dashboards/d1'
      />,
    )
    expect(screen.getByRole('heading', { name: 'Vendas — TV' })).toBeTruthy()
    expect(screen.getByTestId('tv-screen-title').textContent).toBe(
      'Metas do mês',
    )
    expect(await screen.findByText('Bloco da meta')).toBeTruthy()
    expect(screen.queryByText('Bloco do funil')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('tv-countdown').textContent).toMatch(
        /\d+h \d{2}min/,
      ),
    )
    expect(
      screen
        .getByRole('link', { name: 'Sair do modo TV' })
        .getAttribute('href'),
    ).toBe('/acme/crm/dashboards/d1')
  })

  it('rotates between the screens with widgets', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch([
      { match: 'kind=wins-feed', data: { kind: 'wins-feed', rows: [] } },
    ])
    render(
      <CrmDashboardTv
        title='Vendas — TV'
        settings={SETTINGS}
        widgets={WIDGETS}
        workspaceId='ws1'
        timeZone='America/Sao_Paulo'
        interval='10'
      />,
    )
    expect(await screen.findByText('Bloco da meta')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(screen.getByTestId('tv-screen-title').textContent).toBe(
      'Pipeline e funil',
    )
    expect(await screen.findByText('Bloco do funil')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(screen.getByTestId('tv-screen-title').textContent).toBe(
      'Metas do mês',
    )
  })

  it('does not rotate when rotation is off or there is one screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch([
      { match: 'kind=wins-feed', data: { kind: 'wins-feed', rows: [] } },
    ])
    render(
      <CrmDashboardTv
        title='TV'
        settings={{ ...SETTINGS, rotateSeconds: 0 }}
        widgets={WIDGETS}
        workspaceId='ws1'
        timeZone='America/Sao_Paulo'
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(screen.getByTestId('tv-screen-title').textContent).toBe(
      'Metas do mês',
    )
  })

  it('celebrates a win that arrives after the first poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let rows: (typeof WIN)[] = []
    mockFetch([
      {
        match: '/api/crm/tv/tok/wins',
        handler: () => ({ kind: 'wins-feed', rows }),
      },
      { match: '/api/crm/tv/tok/widgets/', data: { type: 'ROWS', rows: [] } },
    ])
    render(
      <CrmDashboardTv
        title='TV'
        settings={SETTINGS}
        widgets={WIDGETS}
        workspaceId=''
        tvToken='tok'
        timeZone='America/Sao_Paulo'
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.queryByTestId('tv-celebration')).toBeNull()

    rows = [WIN]
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    const overlay = await screen.findByTestId('tv-celebration')
    expect(overlay.textContent).toContain('Ana fechou R$ 18.400 com Empresa X')
    expect(overlay.querySelectorAll('[data-piece]').length).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000)
    })
    expect(screen.queryByTestId('tv-celebration')).toBeNull()
  })

  it('reports a revoked link from the wins poll', async () => {
    const onGone = vi.fn()
    mockFetch([{ match: '/api/crm/tv/tok/wins', status: 404, error: 'gone' }])
    render(
      <CrmDashboardTv
        title='TV'
        settings={SETTINGS}
        widgets={[]}
        workspaceId=''
        tvToken='tok'
        timeZone='America/Sao_Paulo'
        onGone={onGone}
      />,
    )
    await waitFor(() => expect(onGone).toHaveBeenCalled())
    expect(screen.getByText('Este painel ainda não tem widgets.')).toBeTruthy()
  })

  it('refreshes on demand and toggles fullscreen', async () => {
    const request = vi.fn()
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: request,
    })
    mockFetch([
      { match: 'kind=wins-feed', data: { kind: 'wins-feed', rows: [] } },
    ])
    render(
      <CrmDashboardTv
        title='TV'
        settings={SETTINGS}
        widgets={WIDGETS}
        workspaceId='ws1'
        timeZone='America/Sao_Paulo'
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tela cheia' }))
    expect(request).toHaveBeenCalled()
  })
})

describe('<CelebrationOverlay />', () => {
  it('skips the confetti with prefers-reduced-motion and dismisses on click', () => {
    const onDismiss = vi.fn()
    render(<CelebrationOverlay win={WIN} reducedMotion onDismiss={onDismiss} />)
    const overlay = screen.getByTestId('tv-celebration')
    expect(overlay.querySelectorAll('[data-piece]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button'))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('<CrmDashboardTvPublic />', () => {
  const boot: CrmDashboardTvBootDTO = {
    workspaceName: 'Stratus',
    timeZone: 'America/Sao_Paulo',
    dashboard: { id: 'd1', title: 'Vendas — TV', settings: SETTINGS },
    widgets: WIDGETS,
    lookups: { pipelines: [], stages: [], users: [] },
  }

  it('reloads the layout and stops when the link is revoked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let status = 200
    mockFetch([
      { match: '/api/crm/tv/tok/wins', data: { kind: 'wins-feed', rows: [] } },
      {
        match: /\/api\/crm\/tv\/tok$/,
        handler: () =>
          status === 404
            ? new Response(JSON.stringify({ success: false }), { status: 404 })
            : {
                ...boot,
                dashboard: { ...boot.dashboard, title: 'Vendas — sala 2' },
              },
      },
    ])
    render(<CrmDashboardTvPublic token='tok' boot={boot} />)
    expect(screen.getByRole('heading', { name: 'Vendas — TV' })).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TV_BOOT_REFRESH_MS)
    })
    expect(
      screen.getByRole('heading', { name: 'Vendas — sala 2' }),
    ).toBeTruthy()

    status = 404
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TV_BOOT_REFRESH_MS)
    })
    expect(await screen.findByTestId('tv-link-gone')).toBeTruthy()
  })
})
