import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { SiteSeoCardDTO, SiteSeoDetailDTO } from '@/types/site-seo'
import { filterSeoSites, SeoScreen } from '../seo-screen'

const state = vi.hoisted(() => ({
  values: {} as Record<string, string | null>,
}))
const push = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => ({ get: (key: string) => state.values[key] ?? null }),
}))
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
const can = vi.hoisted(() => ({ edit: true }))
vi.mock('@/app/_components/workspace/workspace-permissions', () => ({
  useCan: () => can.edit,
  useIsPrivileged: () => true,
}))

const WS = 'ws_1'
const API = `/api/workspaces/${WS}/crm`

function card(overrides: Partial<SiteSeoCardDTO> = {}): SiteSeoCardDTO {
  return {
    id: 'site_a',
    name: 'Clínica Sorriso',
    slug: 'sorriso',
    status: 'PUBLISHED',
    url: 'https://sorriso.sites.test',
    pageCount: 3,
    hasData: true,
    averages: { seo: 72, aeo: 41, geo: 55 },
    overall: 56,
    issueCount: 14,
    topIssues: [
      {
        checkId: 'aeo.direct-answers',
        pillar: 'aeo',
        label: 'Respostas diretas (40–60 palavras)',
        message: '0 de 2 perguntas têm resposta.',
        pageCount: 2,
      },
    ],
    worstPages: [
      { id: 'sobre', title: 'Sobre', path: '/sobre', score: 40, issues: 8 },
      { id: 'home', title: 'Início', path: '/', score: 60, issues: 6 },
    ],
    technical: { pass: 5, warn: 1, fail: 2, total: 8 },
    keywordCount: 2,
    indexNow: { enabled: true, canPing: true },
    history: [
      { day: '2026-11-18', seo: 70, aeo: 40, geo: 50, overall: 53, issues: 15 },
      { day: '2026-11-19', seo: 72, aeo: 41, geo: 55, overall: 56, issues: 14 },
    ],
    delta: 3,
    ...overrides,
  }
}

const OVERVIEW = {
  generatedAt: '2026-11-19T12:00:00.000Z',
  sites: [
    card(),
    card({
      id: 'site_b',
      name: 'Blog novo',
      slug: 'blog',
      status: 'DRAFT',
      pageCount: 0,
      hasData: false,
      overall: 0,
      issueCount: 0,
      averages: { seo: 0, aeo: 0, geo: 0 },
      topIssues: [],
      worstPages: [],
      history: [],
      delta: null,
      indexNow: { enabled: false, canPing: false },
    }),
  ],
}

function detail(overrides: Partial<SiteSeoDetailDTO> = {}): SiteSeoDetailDTO {
  return {
    generatedAt: '2026-11-19T12:00:00.000Z',
    card: card(),
    pages: [
      {
        id: 'sobre',
        title: 'Sobre',
        path: '/sobre',
        scores: { seo: 50, aeo: 30, geo: 40 },
        issues: 8,
      },
      {
        id: 'home',
        title: 'Início',
        path: '/',
        scores: { seo: 80, aeo: 50, geo: 60 },
        issues: 6,
      },
    ],
    issues: [
      {
        checkId: 'seo.h1',
        pillar: 'seo',
        label: 'Título principal (H1)',
        impact: 3,
        message: 'Nenhum título está marcado como H1.',
        pages: [{ id: 'sobre', title: 'Sobre', status: 'fail' }],
      },
    ],
    technical: [
      {
        id: 'seo.h1',
        label: 'Título principal (H1)',
        hint: 'Cada página precisa de um único H1.',
        scope: 'pages',
        status: 'fail',
        total: 2,
        passed: 1,
        warned: 0,
        failed: 1,
        detail: '1 página precisa de atenção (de 2).',
        pages: [{ id: 'sobre', title: 'Sobre' }],
      },
    ],
    keywords: [
      {
        id: 'k1',
        term: 'clareamento',
        status: 'weak',
        gaps: ['Não aparece em nenhum título de página.'],
        totalCount: 3,
        pages: [
          {
            id: 'home',
            title: 'Início',
            path: '/',
            count: 3,
            density: 1.2,
            inTitle: false,
            inDescription: true,
            inH1: false,
            inHeadings: false,
            focus: false,
          },
        ],
      },
    ],
    history: [
      { day: '2026-11-18', seo: 70, aeo: 40, geo: 50, overall: 53, issues: 15 },
      { day: '2026-11-19', seo: 72, aeo: 41, geo: 55, overall: 56, issues: 14 },
    ],
    ...overrides,
  }
}

function routes(extra: Parameters<typeof mockFetch>[0] = []) {
  return mockFetch([
    ...extra,
    { match: `${API}/seo`, data: OVERVIEW },
    { match: `${API}/sites/site_a/search/seo`, data: detail() },
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  state.values = {}
  can.edit = true
})

describe('SeoScreen overview', () => {
  it('lists the sites with scores, problems, worst pages and a getting-started card', async () => {
    routes()
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const cards = await screen.findAllByTestId('seo-site-card')
    expect(cards).toHaveLength(2)

    // Worst score first; the site without pages is last.
    expect(cards[0].getAttribute('data-site')).toBe('site_a')
    const first = within(cards[0])
    expect(first.getByText('Clínica Sorriso')).toBeTruthy()
    expect(first.getByText('Respostas diretas (40–60 palavras)')).toBeTruthy()
    expect(first.getByText('+3 pts')).toBeTruthy()
    expect(first.getByText('Sobre').closest('a')?.getAttribute('href')).toBe(
      '/acme/crm/sites/site_a?page=sobre',
    )

    const second = within(cards[1])
    expect(
      second.getByText('Este site ainda não tem páginas para analisar.'),
    ).toBeTruthy()
    expect(second.queryByTestId('seo-optimize')).toBeNull()
  })

  it('shows the empty state when the workspace has no sites', async () => {
    mockFetch([
      {
        match: `${API}/seo`,
        data: { generatedAt: OVERVIEW.generatedAt, sites: [] },
      },
    ])
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const empty = await screen.findByTestId('seo-empty')
    expect(
      within(empty)
        .getByText('Criar meu primeiro site')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/acme/crm/sites')
  })

  it('shows an error with retry', async () => {
    mockFetch([{ match: `${API}/seo`, status: 500, error: 'x' }])
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    expect(
      await screen.findByText(/Não foi possível carregar o SEO dos sites/),
    ).toBeTruthy()
    expect(screen.getByText('Tentar de novo')).toBeTruthy()
  })

  it('optimizes the worst pages with AI and opens the review dialog', async () => {
    const spy = routes([
      {
        method: 'POST',
        match: '/sites/site_a/search/ai/optimize',
        data: {
          items: [
            {
              pageId: 'sobre',
              pageTitle: 'Sobre',
              title: { current: 'Sobre', suggested: 'Sobre a clínica' },
            },
          ],
          failed: [],
        },
      },
    ])
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const cards = await screen.findAllByTestId('seo-site-card')
    fireEvent.click(within(cards[0]).getByTestId('seo-optimize'))
    await screen.findByTestId('ai-suggestions')
    expect(fetchBody(spy, '/sites/site_a/search/ai/optimize')).toEqual({
      pageIds: ['sobre', 'home'],
      fields: ['title', 'description', 'answers'],
    })
  })

  it('reindexes through IndexNow and reports the outcome', async () => {
    routes([
      {
        method: 'POST',
        match: '/sites/site_a/search/reindex',
        data: { sent: 4, status: 202 },
      },
    ])
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const cards = await screen.findAllByTestId('seo-site-card')
    fireEvent.click(within(cards[0]).getByTestId('seo-reindex'))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        '4 endereço(s) enviado(s) ao IndexNow (Bing, Yandex e outros).',
      ),
    )
  })

  it('warns when the engine rejects the ping and hides edit actions for viewers', async () => {
    routes([
      {
        method: 'POST',
        match: '/sites/site_a/search/reindex',
        data: { sent: 4, status: 429 },
      },
    ])
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const cards = await screen.findAllByTestId('seo-site-card')
    fireEvent.click(within(cards[0]).getByTestId('seo-reindex'))
    await waitFor(() => expect(notify.warning).toHaveBeenCalled())
  })

  it('lets viewers read and download but not edit', async () => {
    can.edit = false
    routes()
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const cards = await screen.findAllByTestId('seo-site-card')
    expect(within(cards[0]).queryByTestId('seo-optimize')).toBeNull()
    expect(within(cards[0]).queryByTestId('seo-reindex')).toBeNull()
    expect(within(cards[0]).getByTestId('seo-download')).toBeTruthy()
  })
})

describe('filterSeoSites', () => {
  const sites = OVERVIEW.sites
  const options = { query: '', filter: 'all', sort: 'worst' } as const

  it('sorts by score, issues and name, keeping unscored sites last', () => {
    expect(filterSeoSites(sites, options).map((s) => s.id)).toEqual([
      'site_a',
      'site_b',
    ])
    expect(
      filterSeoSites(sites, { ...options, sort: 'best' }).map((s) => s.id),
    ).toEqual(['site_a', 'site_b'])
    expect(
      filterSeoSites(sites, { ...options, sort: 'issues' }).map((s) => s.id),
    ).toEqual(['site_a', 'site_b'])
    expect(
      filterSeoSites(sites, { ...options, sort: 'name' }).map((s) => s.id),
    ).toEqual(['site_b', 'site_a'])
  })

  it('filters by status, problems and an accent-free query', () => {
    expect(
      filterSeoSites(sites, { ...options, filter: 'published' }).map(
        (s) => s.id,
      ),
    ).toEqual(['site_a'])
    expect(
      filterSeoSites(sites, { ...options, filter: 'draft' }).map((s) => s.id),
    ).toEqual(['site_b'])
    expect(
      filterSeoSites(sites, { ...options, filter: 'issues' }).map((s) => s.id),
    ).toEqual(['site_a'])
    expect(
      filterSeoSites(sites, { ...options, query: 'clinica' }).map((s) => s.id),
    ).toEqual(['site_a'])
    expect(filterSeoSites(sites, { ...options, query: 'zzz' })).toEqual([])
  })
})

describe('SeoScreen detail', () => {
  it('shows the summary with the worst pages first', async () => {
    state.values = { site: 'site_a' }
    routes()
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    expect(
      await screen.findByText('Nenhum título está marcado como H1.'),
    ).toBeTruthy()
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Sobre')).toBeTruthy()
    expect(within(rows[2]).getByText('Início')).toBeTruthy()
  })

  it('lists the technical checklist with links to the pages', async () => {
    state.values = { site: 'site_a', tab: 'tecnico' }
    routes()
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const list = await screen.findByTestId('seo-technical')
    expect(
      within(list).getByText('1 página precisa de atenção (de 2).'),
    ).toBeTruthy()
    expect(
      within(list).getByText('Sobre').closest('a')?.getAttribute('href'),
    ).toBe('/acme/crm/sites/site_a?page=sobre')
  })

  it('adds and removes tracked keywords', async () => {
    state.values = { site: 'site_a', tab: 'palavras' }
    const spy = routes([
      {
        method: 'POST',
        match: '/sites/site_a/search/keywords',
        data: { id: 'k2', term: 'implante' },
      },
      {
        method: 'DELETE',
        match: '/sites/site_a/search/keywords/k1',
        data: null,
      },
    ])
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const panel = await screen.findByTestId('seo-keywords')
    expect(within(panel).getByText('Só no texto')).toBeTruthy()
    expect(within(panel).getByText('1,2%')).toBeTruthy()

    const input = within(panel).getByLabelText('Acompanhar uma palavra-chave')
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(await within(panel).findByRole('alert')).toBeTruthy()

    fireEvent.change(input, { target: { value: ' implante ' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await waitFor(() =>
      expect(fetchBody(spy, '/sites/site_a/search/keywords')).toEqual({
        term: 'implante',
      }),
    )

    fireEvent.click(
      within(panel).getByLabelText('Parar de acompanhar clareamento'),
    )
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/keywords/k1') && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('draws the history and explains the Google ranking', async () => {
    state.values = { site: 'site_a', tab: 'historico' }
    routes()
    const view = renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    expect(
      await screen.findByRole('img', {
        name: 'Evolução das notas de SEO, AEO e GEO',
      }),
    ).toBeTruthy()
    view.unmount()

    state.values = { site: 'site_a', tab: 'google' }
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    const section = await screen.findByTestId('seo-google')
    expect(within(section).getByText(/Google Search Console/)).toBeTruthy()
  })

  it('says the history starts today when there is a single point', async () => {
    state.values = { site: 'site_a', tab: 'historico' }
    mockFetch([
      {
        match: `${API}/sites/site_a/search/seo`,
        data: detail({ history: [detail().history[0]] }),
      },
    ])
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    expect(await screen.findByText(/O histórico começa hoje/)).toBeTruthy()
  })

  it('shows an error when the detail fails', async () => {
    state.values = { site: 'site_a' }
    mockFetch([
      { match: `${API}/sites/site_a/search/seo`, status: 500, error: 'x' },
    ])
    renderWithQuery(<SeoScreen workspaceId={WS} slug='acme' />)
    expect(
      await screen.findByText(/Não foi possível carregar o SEO deste site/),
    ).toBeTruthy()
  })
})
