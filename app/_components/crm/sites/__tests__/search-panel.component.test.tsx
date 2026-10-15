import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'
import { getNode } from '@/src/lib/canvas/ops'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'
import { DEFAULT_SITE_SEARCH_SETTINGS } from '@/src/schemas/site-search.schema'
import type { SiteSearchSettingsViewDTO } from '@/types/site-search'
import { SearchPanel } from '../search/search-panel'
import { fakePage, PAGES, renderInEditor, SITE_ID, WS } from './harness'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = `/api/workspaces/${WS}/crm/sites/${SITE_ID}`

const VIEW: SiteSearchSettingsViewDTO = {
  settings: {
    ...DEFAULT_SITE_SEARCH_SETTINGS,
    business: { name: 'Clínica São Lucas', phone: '(11) 3333-4444' },
  },
  prefilled: false,
  completeness: { percent: 40, missing: ['descrição'] },
  published: false,
  urls: {
    robots: 'https://x/robots.txt',
    sitemap: 'https://x/sitemap.xml',
    llms: 'https://x/llms.txt',
    llmsFull: 'https://x/llms-full.txt',
    indexNowKey: null,
  },
}

function setup(
  seo: SitePageSeoDTO = {},
  extra: Parameters<typeof mockFetch>[0] = [],
) {
  const pages = [{ ...PAGES[0], seo }, ...PAGES.slice(1)]
  const spy = mockFetch([
    ...extra,
    { match: `${BASE}/search`, data: VIEW },
    {
      method: 'PATCH',
      match: `${BASE}/pages/home`,
      handler: (_url, init) => ({
        ...pages[0],
        seo: JSON.parse(String(init?.body)).seo,
        document: {},
        createdAt: '2026-10-01T00:00:00.000Z',
      }),
    },
    {
      method: 'POST',
      match: `${BASE}/search/apply`,
      data: { updated: ['home'] },
    },
    { match: `${BASE}/pages`, data: pages },
  ])
  const rendered = renderInEditor(<SearchPanel />, { pages })
  return { spy, ...rendered }
}

beforeEach(() => vi.clearAllMocks())

describe('SearchPanel', () => {
  it('shows the three scores and the checks of the live document', async () => {
    setup()
    expect(screen.getByTestId('search-panel')).toBeTruthy()
    expect(screen.getByRole('img', { name: /^SEO: \d+ de 100/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /^AEO: \d+ de 100/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /^GEO: \d+ de 100/ })).toBeTruthy()
    expect(
      screen
        .getByRole('list', { name: 'Verificações de SEO' })
        .querySelector('[data-check="seo.keyword"][data-status="fail"]'),
    ).toBeTruthy()
    expect(screen.getByTestId('serp-preview')).toBeTruthy()
    expect(screen.getByTestId('social-preview')).toBeTruthy()
    // Device toggle of the preview.
    fireEvent.click(screen.getByRole('button', { name: 'Celular' }))
    expect(
      screen
        .getByRole('button', { name: 'Celular' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('asks to open a page when a global is being edited', () => {
    renderInEditor(<SearchPanel />, { target: { kind: 'global', id: 'g' } })
    expect(screen.getByText(/Abra uma página/)).toBeTruthy()
  })

  it('saves the focus keyword and synonyms into seo.search', async () => {
    const { spy, ctx } = setup({ title: 'Início' })
    fireEvent.change(screen.getByLabelText('Palavra-chave principal'), {
      target: { value: 'clínica em São Paulo' },
    })
    fireEvent.change(screen.getByLabelText('Variações e sinônimos'), {
      target: { value: 'clínica sp, clínica sp, consultório' },
    })
    fireEvent.blur(screen.getByLabelText('Variações e sinônimos'))
    await waitFor(() => expect(ctx.setPages).toHaveBeenCalled())
    expect(fetchBody(spy, `${BASE}/pages/home`, 'PATCH')).toEqual({
      seo: {
        title: 'Início',
        search: {
          focusKeyword: 'clínica em São Paulo',
          synonyms: ['clínica sp', 'consultório'],
        },
      },
    })
  })

  it('applies a canvas fix (H1) and selects nodes', async () => {
    const { editor } = setup()
    editor.store.dispatch({ kind: 'update', id: 'h1', set: { level: 'h2' } })
    const fix = await screen.findByRole('button', {
      name: 'Transformar o primeiro título em H1',
    })
    fireEvent.click(fix)
    expect(getNode(editor.store.getState().doc, 'h1')?.props.level).toBe('h1')
    expect(notify.success).toHaveBeenCalled()
  })

  it('edits the questions and inserts them as an accordion section', async () => {
    const { spy, editor } = setup({
      search: {
        questions: [{ question: 'Dói?', answer: 'Não, usamos anestesia.' }],
      },
    })
    fireEvent.click(screen.getByRole('tab', { name: /AEO/ }))
    const editorBox = await screen.findByTestId('questions-editor')
    fireEvent.click(
      within(editorBox).getByRole('button', {
        name: 'Inserir como seção na página',
      }),
    )
    const accordion = Object.values(editor.store.getState().doc.nodes).find(
      (node) => node.type === SITE_TYPES.accordion,
    )
    expect(accordion).toBeTruthy()

    fireEvent.click(within(editorBox).getByRole('button', { name: 'Pergunta' }))
    fireEvent.change(within(editorBox).getByLabelText('Pergunta 2'), {
      target: { value: 'Quanto custa?' },
    })
    fireEvent.change(within(editorBox).getByLabelText('Resposta 2'), {
      target: { value: 'A partir de R$ 200.' },
    })
    expect(
      within(editorBox).getAllByText(/palavras · curta/).length,
    ).toBeGreaterThan(0)
    fireEvent.click(
      within(editorBox).getByRole('button', { name: 'Salvar perguntas' }),
    )
    await waitFor(() =>
      expect(
        fetchBody(spy, `${BASE}/pages/home`, 'PATCH')?.seo.search.questions,
      ).toEqual([
        { question: 'Dói?', answer: 'Não, usamos anestesia.' },
        { question: 'Quanto custa?', answer: 'A partir de R$ 200.' },
      ]),
    )
    fireEvent.click(
      within(editorBox).getByRole('button', { name: 'Remover pergunta 2' }),
    )
  })

  it('saves the summary and the switches', async () => {
    const { spy } = setup({ search: { summary: 'Antigo' } })
    fireEvent.click(screen.getByRole('tab', { name: /AEO/ }))
    const fields = await screen.findByTestId('summary-fields')
    const summary = within(fields).getByLabelText('Resumo citável')
    fireEvent.change(summary, {
      target: { value: 'Clínica com 20 anos de experiência.' },
    })
    fireEvent.blur(summary)
    await waitFor(() =>
      expect(
        fetchBody(spy, `${BASE}/pages/home`, 'PATCH')?.seo.search.summary,
      ).toBe('Clínica com 20 anos de experiência.'),
    )
    fireEvent.click(within(fields).getByRole('switch', { name: /falável/ }))
    await waitFor(() =>
      expect(
        spy.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
      ).toHaveLength(2),
    )
  })

  it('applies a SEO patch fix from the first paragraph', async () => {
    const { spy, editor } = setup()
    const sectionId = getNode(editor.store.getState().doc, 'root')
      ?.children?.[0] as string
    editor.store.insertType(SITE_TYPES.text, { parentId: sectionId, index: 1 })
    const fix = await screen.findByRole('button', {
      name: 'Usar o primeiro parágrafo',
    })
    fireEvent.click(fix)
    await waitFor(() =>
      expect(
        fetchBody(spy, `${BASE}/pages/home`, 'PATCH')?.seo.description,
      ).toBeTruthy(),
    )
  })

  it('asks the AI for a description and applies the reviewed suggestion', async () => {
    const { spy } = setup({}, [
      {
        method: 'POST',
        match: `${BASE}/search/ai/optimize`,
        data: {
          items: [
            {
              pageId: 'home',
              pageTitle: 'Início',
              description: { current: '', suggested: 'Clínica em São Paulo.' },
            },
          ],
          failed: [],
        },
      },
    ])
    const button = (
      await screen.findAllByRole('button', { name: 'Sugerir descrição com IA' })
    )[0]
    fireEvent.click(button)
    const dialog = await screen.findByTestId('ai-suggestions')
    expect(within(dialog).getByText('Clínica em São Paulo.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aplicar (1)' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/search/apply`)).toEqual({
        items: [{ pageId: 'home', description: 'Clínica em São Paulo.' }],
      }),
    )
    expect(fetchBody(spy, `${BASE}/search/ai/optimize`)).toEqual({
      pageIds: ['home'],
      fields: ['description'],
    })
  })

  it('shows how an AI would summarize the page', async () => {
    setup({}, [
      {
        method: 'POST',
        match: `${BASE}/search/ai/summary`,
        data: {
          summary: 'A Clínica São Lucas atende em São Paulo.',
          entities: ['Clínica São Lucas'],
          questions: ['Onde fica?'],
          suggestions: ['Informe o horário'],
        },
      },
    ])
    fireEvent.click(screen.getByRole('tab', { name: /GEO/ }))
    const card = await screen.findByTestId('ai-summary')
    fireEvent.click(
      within(card).getByRole('button', { name: 'Ver resumo da IA' }),
    )
    expect(
      await within(card).findByText('A Clínica São Lucas atende em São Paulo.'),
    ).toBeTruthy()
    expect(within(card).getByText('Informe o horário')).toBeTruthy()
    expect(within(card).getByText('Onde fica?')).toBeTruthy()
  })

  it('reports AI failures', async () => {
    setup({}, [
      {
        method: 'POST',
        match: `${BASE}/search/ai/summary`,
        status: 502,
        error: 'A IA falhou',
      },
    ])
    fireEvent.click(screen.getByRole('tab', { name: /GEO/ }))
    const card = await screen.findByTestId('ai-summary')
    fireEvent.click(
      within(card).getByRole('button', { name: 'Ver resumo da IA' }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('edits structured data with validation and a JSON-LD preview', async () => {
    const { spy } = setup({}, [
      {
        match: /\/crm\/products/,
        data: [
          {
            id: 'prod1',
            name: 'Clareamento',
            sku: 'CL1',
            description: 'Clareamento a laser',
            unitPrice: 450,
            currency: 'BRL',
          },
        ],
      },
    ])
    fireEvent.click(screen.getByRole('tab', { name: /GEO/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: /Dados estruturados \(0\)/ }),
    )
    const dialog = await screen.findByTestId('structured-data-dialog')
    expect(
      within(dialog).getByText('Adicione um tipo para começar.'),
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Serviço' }))
    expect(
      await within(dialog).findByText(/Para virar resultado rico falta/),
    ).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Implante' },
    })
    fireEvent.change(within(dialog).getByLabelText('Tipo de serviço'), {
      target: { value: 'Odontologia' },
    })
    fireEvent.change(within(dialog).getByLabelText('Descrição'), {
      target: { value: 'Implantes com garantia.' },
    })
    expect(
      await within(dialog).findByText(
        'Tudo o que o Google pede está preenchido.',
      ),
    ).toBeTruthy()
    expect(within(dialog).getByText(/"@type": "Service"/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(
        fetchBody(spy, `${BASE}/pages/home`, 'PATCH')?.seo.search
          .structuredData,
      ).toEqual([
        {
          type: 'Service',
          name: 'Implante',
          serviceType: 'Odontologia',
          description: 'Implantes com garantia.',
        },
      ]),
    )
  })

  it('opens the page settings from a fix', async () => {
    setup({ noindex: true })
    const button = (
      await screen.findAllByRole('button', { name: 'Abrir configurações' })
    )[0]
    fireEvent.click(button)
    expect(await screen.findByTestId('page-settings')).toBeTruthy()
  })

  it('keeps the panel read-only for viewers', () => {
    renderInEditor(<SearchPanel />, {
      canEdit: false,
      pages: [fakePage({ id: 'home', isHome: true })],
    })
    expect(
      screen.getByLabelText('Palavra-chave principal').matches(':disabled'),
    ).toBe(true)
  })
})
