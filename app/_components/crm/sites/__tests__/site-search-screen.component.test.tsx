import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { DEFAULT_SITE_SEARCH_SETTINGS } from '@/src/schemas/site-search.schema'
import type {
  SiteSearchReportDTO,
  SiteSearchSettingsViewDTO,
} from '@/types/site-search'
import { searchPatch } from '../page-settings-dialog'
import { applyPayload, initialChoices } from '../search/ai-suggestions-dialog'
import { fromDraft, toDraft } from '../search/business-profile-form'
import { parseSynonyms } from '../search/search-fields'
import { SiteSearchScreen } from '../search/site-search-screen'
import { cleanItem } from '../search/structured-data-dialog'
import { fakeSite, PAGES, SITE_ID, WS } from './harness'

const params = vi.hoisted(() => ({ tab: null as string | null }))
const replace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => ({ get: () => params.tab }),
}))
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = `/api/workspaces/${WS}/crm/sites/${SITE_ID}`

function view(
  overrides: Partial<SiteSearchSettingsViewDTO> = {},
): SiteSearchSettingsViewDTO {
  return {
    settings: {
      ...DEFAULT_SITE_SEARCH_SETTINGS,
      business: { name: 'Clínica São Lucas', address: { street: 'Rua A' } },
    },
    prefilled: true,
    completeness: { percent: 30, missing: ['telefone'] },
    published: true,
    urls: {
      robots: 'https://c.site/robots.txt',
      sitemap: 'https://c.site/sitemap.xml',
      llms: 'https://c.site/llms.txt',
      llmsFull: 'https://c.site/llms-full.txt',
      indexNowKey: null,
    },
    ...overrides,
  }
}

const REPORT: SiteSearchReportDTO = {
  generatedAt: '2026-10-15T12:00:00.000Z',
  completeness: { percent: 30, missing: ['telefone'] },
  averages: { seo: 72, aeo: 41, geo: 55 },
  pages: [
    {
      id: 'home',
      title: 'Início',
      path: '/',
      scores: { seo: 80, aeo: 40, geo: 60 },
      issues: 6,
    },
    {
      id: 'sobre',
      title: 'Sobre',
      path: '/sobre',
      scores: { seo: 64, aeo: 42, geo: 50 },
      issues: 8,
    },
  ],
  issues: [
    {
      checkId: 'aeo.direct-answers',
      pillar: 'aeo',
      label: 'Respostas diretas (40–60 palavras)',
      impact: 6,
      message: '0 de 2 perguntas têm resposta.',
      pages: [
        { id: 'home', title: 'Início', status: 'fail' },
        { id: 'sobre', title: 'Sobre', status: 'warn' },
      ],
    },
    {
      checkId: 'seo.social',
      pillar: 'seo',
      label: 'Prévia nas redes sociais',
      impact: 0.5,
      message: 'Sem imagem própria.',
      pages: [{ id: 'sobre', title: 'Sobre', status: 'warn' }],
    },
  ],
}

function setup(
  options: {
    tab?: string
    report?: SiteSearchReportDTO | null
    settings?: SiteSearchSettingsViewDTO
  } = {},
) {
  params.tab = options.tab ?? null
  const spy = mockFetch([
    options.report === null
      ? { match: `${BASE}/search/report`, status: 500, error: 'x' }
      : { match: `${BASE}/search/report`, data: options.report ?? REPORT },
    {
      method: 'PUT',
      match: `${BASE}/search`,
      handler: (_url, init) => {
        const body = JSON.parse(String(init?.body))
        const current = options.settings ?? view()
        return view({
          prefilled: false,
          settings: { ...current.settings, ...body },
        })
      },
    },
    {
      method: 'POST',
      match: `${BASE}/search/ai/optimize`,
      data: {
        items: [
          {
            pageId: 'home',
            pageTitle: 'Início',
            title: { current: 'Início', suggested: 'Clínica em São Paulo' },
            answers: [{ question: 'Dói?', current: '', suggested: 'Não dói.' }],
          },
          { pageId: 'sobre', pageTitle: 'Sobre' },
        ],
        failed: [{ pageId: 'x', pageTitle: 'Contato' }],
      },
    },
    {
      method: 'POST',
      match: `${BASE}/search/apply`,
      data: { updated: ['home'] },
    },
    { match: `${BASE}/search`, data: options.settings ?? view() },
    { match: `${BASE}/pages`, data: PAGES },
    { match: `${BASE}/globals`, data: [] },
    { match: new RegExp(`${BASE}$`), data: fakeSite({ status: 'PUBLISHED' }) },
  ])
  renderWithQuery(
    <SiteSearchScreen workspaceId={WS} slug='acme' siteId={SITE_ID} />,
  )
  return spy
}

beforeEach(() => vi.clearAllMocks())

describe('SiteSearchScreen — Saúde', () => {
  it('shows averages, ranked issues and the pages', async () => {
    setup()
    const report = await screen.findByTestId('search-report')
    expect(
      within(report).getByRole('img', { name: /^AEO: 41 de 100/ }),
    ).toBeTruthy()
    expect(
      within(report).getByText('Respostas diretas (40–60 palavras)'),
    ).toBeTruthy()
    expect(within(report).getByText('Em 2 páginas: Início, Sobre')).toBeTruthy()
    expect(within(report).getByText('Em “Sobre”')).toBeTruthy()
    expect(
      within(report)
        .getByLabelText('Editar Sobre')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe(`/acme/crm/sites/${SITE_ID}?page=sobre`)
    expect(
      await screen.findByText('Buscadores · Clínica São Lucas'),
    ).toBeTruthy()
  })

  it('optimizes selected pages with AI and applies the reviewed suggestions', async () => {
    const spy = setup()
    await screen.findByTestId('search-report')
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Selecionar páginas' }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Descrições' }))
    fireEvent.click(screen.getByTestId('search-optimize'))
    const dialog = await screen.findByTestId('ai-suggestions')
    expect(fetchBody(spy, `${BASE}/search/ai/optimize`)).toEqual({
      pageIds: ['home', 'sobre'],
      fields: ['title', 'answers'],
    })
    expect(
      within(dialog).getByText('A IA não sugeriu mudanças para esta página.'),
    ).toBeTruthy()
    expect(within(dialog).getByText(/Sem sugestões para: Contato/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Dói?' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar (1)' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/search/apply`)).toEqual({
        items: [{ pageId: 'home', title: 'Clínica em São Paulo' }],
      }),
    )
    await waitFor(() => expect(notify.success).toHaveBeenCalled())
  })

  it('handles a failed report and an empty issue list', async () => {
    setup({ report: null })
    expect(
      await screen.findByText(/Não foi possível montar o relatório/),
    ).toBeTruthy()
  })

  it('celebrates a clean site', async () => {
    setup({ report: { ...REPORT, issues: [] } })
    expect(await screen.findByText(/Nenhum problema encontrado/)).toBeTruthy()
  })
})

describe('SiteSearchScreen — Perfil do negócio', () => {
  it('shows the prefilled draft and saves the profile', async () => {
    const spy = setup({ tab: 'perfil' })
    const form = await screen.findByTestId('business-profile')
    expect(within(form).getByText(/Rascunho montado/)).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Telefone'), {
      target: { value: '(11) 3333-4444' },
    })
    fireEvent.change(within(form).getByLabelText('Cidade'), {
      target: { value: 'São Paulo' },
    })
    fireEvent.change(within(form).getByLabelText(/Perfis oficiais/), {
      target: { value: 'https://instagram.com/clinica\n' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Horário' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Pessoa' }))
    fireEvent.change(within(form).getByLabelText('Nome'), {
      target: { value: 'Dra. Ana' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar perfil' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/search`, 'PUT')).toEqual({
        business: {
          name: 'Clínica São Lucas',
          phone: '(11) 3333-4444',
          address: { street: 'Rua A', city: 'São Paulo' },
          hours: [
            {
              days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
              opens: '08:00',
              closes: '18:00',
            },
          ],
          sameAs: ['https://instagram.com/clinica'],
          people: [{ name: 'Dra. Ana' }],
        },
      }),
    )
  })

  it('refuses an invalid profile with a pt-BR message', async () => {
    const spy = setup({ tab: 'perfil' })
    const form = await screen.findByTestId('business-profile')
    fireEvent.change(within(form).getByLabelText(/Perfis oficiais/), {
      target: { value: 'instagram.com/clinica' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar perfil' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.stringContaining('Perfis oficiais'),
      ),
    )
    expect(fetchBody(spy, `${BASE}/search`, 'PUT')).toBeUndefined()
  })
})

describe('SiteSearchScreen — Rastreadores e feeds', () => {
  it('blocks a training bot, previews robots.txt and toggles feeds', async () => {
    const spy = setup({ tab: 'rastreadores' })
    const box = await screen.findByTestId('crawlers-settings')
    fireEvent.click(within(box).getByRole('switch', { name: /^GPTBot/ }))
    expect(within(box).getByText(/User-agent: GPTBot/)).toBeTruthy()
    fireEvent.click(
      within(box).getByRole('button', { name: 'Salvar rastreadores' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/search`, 'PUT')).toEqual({
        crawlers: { GPTBot: false },
      }),
    )
    fireEvent.click(
      within(box).getByRole('switch', {
        name: 'Avisar o IndexNow ao publicar',
      }),
    )
    await waitFor(() =>
      expect(
        spy.mock.calls.filter(([, init]) => init?.method === 'PUT'),
      ).toHaveLength(2),
    )
    expect(within(box).getByRole('link', { name: /llms\.txt/ })).toBeTruthy()
  })

  it('saves the verification codes and the llms notes', async () => {
    const spy = setup({ tab: 'rastreadores' })
    const box = await screen.findByTestId('crawlers-settings')
    fireEvent.change(within(box).getByLabelText('Google Search Console'), {
      target: { value: ' abc123 ' },
    })
    fireEvent.click(
      within(box).getByRole('button', { name: 'Salvar verificação' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/search`, 'PUT')).toEqual({
        verification: { google: 'abc123' },
      }),
    )
    const notes = within(box).getByLabelText('Recado para as IAs')
    fireEvent.change(notes, { target: { value: 'Só com agendamento.' } })
    fireEvent.blur(notes)
    await waitFor(() =>
      expect(
        spy.mock.calls.filter(([, init]) => init?.method === 'PUT'),
      ).toHaveLength(2),
    )
  })

  it('switches tabs through the URL', async () => {
    setup()
    await screen.findByTestId('search-report')
    fireEvent.click(screen.getByRole('tab', { name: 'Perfil do negócio' }))
    expect(replace).toHaveBeenCalledWith(
      `/acme/crm/sites/${SITE_ID}/search?tab=perfil`,
      {
        scroll: false,
      },
    )
  })
})

describe('Buscadores helpers', () => {
  it('parses synonyms', () => {
    expect(parseSynonyms(' a, b ,a,, ')).toEqual(['a', 'b'])
    expect(parseSynonyms('  ')).toBeUndefined()
  })

  it('round-trips the business draft', () => {
    const profile = {
      type: 'Dentist' as const,
      name: 'X',
      geo: { latitude: -23.5, longitude: -46.6 },
      foundingYear: 2010,
      people: [{ name: 'Ana', role: 'CEO', url: 'https://l.in/a' }],
    }
    expect(fromDraft(toDraft(profile))).toMatchObject(profile)
  })

  it('cleans structured data items', () => {
    expect(
      cleanItem({
        type: 'HowTo',
        name: '',
        steps: [
          { text: ' Um ', name: ' ' },
          { text: '' },
          { text: 'Dois', name: 'Passo' },
        ],
      }),
    ).toEqual({
      type: 'HowTo',
      steps: [{ text: 'Um' }, { text: 'Dois', name: 'Passo' }],
    })
    expect(cleanItem({ type: 'Article', datePublished: 'ontem' })).toBeNull()
  })

  it('builds the apply payload from the chosen suggestions', () => {
    const result = {
      items: [
        {
          pageId: 'p',
          pageTitle: 'P',
          title: { current: 'a', suggested: 'b' },
          description: { current: '', suggested: 'd' },
          answers: [{ question: 'Q?', current: '', suggested: 'A' }],
        },
      ],
      failed: [],
    }
    const all = initialChoices(result)
    expect(applyPayload(result, all)).toEqual([
      {
        pageId: 'p',
        title: 'b',
        description: 'd',
        questions: [{ question: 'Q?', answer: 'A' }],
      },
    ])
    expect(applyPayload(result, new Set())).toEqual([])
  })

  it('sends the page keyword only when there is search data', () => {
    expect(searchPatch({}, '  ')).toEqual({})
    expect(searchPatch({}, 'implante')).toEqual({
      search: { focusKeyword: 'implante' },
    })
    expect(searchPatch({ search: { focusKeyword: 'x' } }, '')).toEqual({
      search: {},
    })
    expect(
      searchPatch({ search: { summary: 'S', focusKeyword: 'x' } }, 'y'),
    ).toEqual({
      search: { summary: 'S', focusKeyword: 'y' },
    })
  })
})
