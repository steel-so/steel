import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestQueryClient,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { applySiteAiEvent } from '@/src/hooks/use-site-ai'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  heading,
  image,
  section,
  text,
  toDocument,
  toFragment,
} from '@/src/lib/canvas-site/presets/builder'
import { encodeSiteAiEvent } from '@/src/lib/site-ai/sse'
import type { SiteAiContextDTO, SiteAiEvent, SiteAiStep } from '@/types/site-ai'
import {
  applyChanges,
  imageChange,
  insertionIndex,
  SiteAiPanel,
} from '../ai/site-ai-panel'
import { AiCostLine, formatAiUsd } from '../ai/site-ai-shared'
import { toGenerateInput } from '../ai/site-ai-wizard'
import { NewSiteDialog } from '../new-site-dialog'
import { fakeSite, renderInEditor, SITE_ID, WS } from './harness'

const push = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = `/api/workspaces/${WS}/crm/sites`

/** Visible text with non-breaking spaces (currency) as plain spaces. */
const textOf = (element: Element) =>
  (element.textContent ?? '').replace(/\s+/g, ' ')

function context(overrides: Partial<SiteAiContextDTO> = {}): SiteAiContextDTO {
  return {
    available: true,
    unavailableReason: null,
    brand: {
      companyName: 'Padaria Pão & Cia',
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColor: '#AA3300',
      website: '',
    },
    products: [
      {
        id: 'p1',
        name: 'Pão de fermentação',
        description: '',
        price: 'R$ 18,00',
      },
      { id: 'p2', name: 'Bolo de cenoura', description: '', price: 'R$ 45,00' },
    ],
    testimonials: 2,
    forms: [{ id: 'f1', name: 'Contato do site', publicToken: 'tok1' }],
    canCreateForm: true,
    quota: { usedUsd: 1, quotaUsd: 50, remainingUsd: 49, exceeded: false },
    estimate: {
      planUsd: 0.02,
      pageUsd: 0.04,
      sectionUsd: 0.03,
      rewriteUsd: 0.05,
      imagesUsd: 0.002,
      model: 'Claude',
    },
    ...overrides,
  }
}

const STEPS: SiteAiStep[] = [
  { id: 'theme', label: 'Criando tema…', status: 'pending' },
  { id: 'page:home', label: 'Montando a página Início…', status: 'pending' },
  { id: 'save', label: 'Salvando o site…', status: 'pending' },
]

function stream(events: SiteAiEvent[]): Response {
  return new Response(events.map(encodeSiteAiEvent).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function setupDialog(
  ctx: SiteAiContextDTO = context(),
  generate: () => Response | Promise<Response> = () =>
    stream([
      { type: 'steps', steps: STEPS },
      { type: 'step', id: 'theme', label: 'Tema criado', status: 'done' },
      {
        type: 'done',
        site: fakeSite({ id: 'site_ai' }),
        costUsd: 0.1,
        warnings: ['Revise a seção Contato.'],
      },
    ]),
) {
  const spy = mockFetch([
    { method: 'POST', match: `${BASE}/ai/generate`, handler: generate },
    { match: `${BASE}/ai`, data: ctx },
  ])
  renderWithQuery(
    <NewSiteDialog open onOpenChange={vi.fn()} workspaceId={WS} slug='acme' />,
  )
  fireEvent.click(screen.getByTestId('site-template-ai'))
  return spy
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Gerar com IA', () => {
  it('prefills the brief, shows cost and quota and streams the generation', async () => {
    const spy = setupDialog()
    const name = await screen.findByLabelText('Nome da empresa')
    expect((name as HTMLInputElement).value).toBe('Padaria Pão & Cia')
    expect(textOf(screen.getByTestId('site-ai-cost'))).toContain(
      'Custo estimado ≈ US$ 0,18',
    )
    expect(textOf(screen.getByTestId('site-ai-cost'))).toContain(
      'Restam US$ 49,00 de US$ 50,00',
    )
    const submit = screen.getByTestId('site-ai-submit')
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('O que a empresa faz?'), {
      target: { value: 'Padaria artesanal com fermentação natural' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Perguntas/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Bolo de cenoura/ }))
    expect(textOf(screen.getByTestId('site-ai-cost'))).toContain('US$ 0,22')
    fireEvent.click(submit)

    expect(await screen.findByText('Site pronto!')).toBeTruthy()
    expect(screen.getByText('Tema criado')).toBeTruthy()
    expect(screen.getByText('Revise a seção Contato.')).toBeTruthy()
    const body = fetchBody(spy, '/ai/generate')
    expect(body).toMatchObject({
      name: 'Padaria Pão & Cia',
      business: 'Padaria artesanal com fermentação natural',
      goal: 'leads',
      tone: 'professional',
      pages: ['about', 'services', 'faq', 'contact'],
      primaryColor: '#AA3300',
      logoUrl: 'https://cdn.example.com/logo.png',
      productIds: ['p1'],
      useTestimonials: true,
      contactFormId: 'f1',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir o editor' }))
    expect(push).toHaveBeenCalledWith('/acme/crm/sites/site_ai')
  })

  it('opens the editor by itself when nothing needs attention', async () => {
    setupDialog(context(), () =>
      stream([
        { type: 'steps', steps: STEPS },
        {
          type: 'done',
          site: fakeSite({ id: 'site_ok' }),
          costUsd: 0.1,
          warnings: [],
        },
      ]),
    )
    fireEvent.change(await screen.findByLabelText('O que a empresa faz?'), {
      target: { value: 'Padaria artesanal com fermentação natural' },
    })
    fireEvent.click(screen.getByTestId('site-ai-submit'))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/sites/site_ok'),
    )
  })

  it('shows the error of a failed stream and goes back to the brief', async () => {
    setupDialog(context(), () =>
      stream([
        { type: 'steps', steps: STEPS },
        { type: 'step', id: 'theme', label: 'Criando tema…', status: 'failed' },
        {
          type: 'error',
          code: 'SITE_AI_FAILED',
          message: 'A IA não respondeu.',
        },
      ]),
    )
    fireEvent.change(await screen.findByLabelText('O que a empresa faz?'), {
      target: { value: 'Padaria artesanal com fermentação natural' },
    })
    fireEvent.click(screen.getByTestId('site-ai-submit'))
    expect(await screen.findByText('Não deu para gerar o site')).toBeTruthy()
    expect(screen.getByText('A IA não respondeu.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Voltar ao briefing/ }))
    expect(await screen.findByTestId('site-ai-form')).toBeTruthy()
  })

  it('shows the message of a request refused before the stream', async () => {
    setupDialog(
      context(),
      () =>
        new Response(
          JSON.stringify({
            success: false,
            message: 'A cota mensal de IA do workspace foi atingida.',
            error: { code: 'AI_QUOTA_EXCEEDED' },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
    )
    fireEvent.change(await screen.findByLabelText('O que a empresa faz?'), {
      target: { value: 'Padaria artesanal com fermentação natural' },
    })
    fireEvent.click(screen.getByTestId('site-ai-submit'))
    expect(
      await screen.findByText('A cota mensal de IA do workspace foi atingida.'),
    ).toBeTruthy()
  })

  it('reports a stream that ends early', async () => {
    setupDialog(context(), () => stream([{ type: 'steps', steps: STEPS }]))
    fireEvent.change(await screen.findByLabelText('O que a empresa faz?'), {
      target: { value: 'Padaria artesanal com fermentação natural' },
    })
    fireEvent.click(screen.getByTestId('site-ai-submit'))
    expect(await screen.findByText(/A conexão caiu/)).toBeTruthy()
  })

  it('blocks the generation when the AI is unavailable or the quota is over', async () => {
    setupDialog(
      context({
        available: false,
        unavailableReason: 'A IA do CRM não está incluída no plano.',
      }),
    )
    expect(textOf(await screen.findByRole('alert'))).toContain(
      'não está incluída no plano',
    )
    fireEvent.change(screen.getByLabelText('O que a empresa faz?'), {
      target: { value: 'Padaria artesanal com fermentação natural' },
    })
    expect(
      (screen.getByTestId('site-ai-submit') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('goes back to the templates', async () => {
    setupDialog()
    await screen.findByTestId('site-ai-form')
    fireEvent.click(screen.getByRole('button', { name: /Modelos/ }))
    expect(screen.getByTestId('site-template-ai')).toBeTruthy()
  })
})

describe('toGenerateInput', () => {
  const brief = {
    name: ' Pão ',
    business: ' Padaria artesanal ',
    audience: '',
    goal: 'event' as const,
    tone: 'formal' as const,
    pages: [],
    style: 'b2b' as const,
    primaryColor: 'zz',
    useLogo: false,
    productIds: [],
    useTestimonials: false,
    form: 'new',
    eventDate: '2026-12-01',
    extra: '',
  }

  it('maps the form choices to the API body', () => {
    expect(toGenerateInput(brief, context())).toEqual({
      name: 'Pão',
      business: 'Padaria artesanal',
      audience: '',
      goal: 'event',
      tone: 'formal',
      pages: [],
      style: 'b2b',
      productIds: [],
      useTestimonials: false,
      createContactForm: true,
      eventDate: '2026-12-01',
      extra: '',
    })
    expect(
      toGenerateInput({ ...brief, form: 'none', goal: 'leads' }, context()),
    ).not.toHaveProperty('contactFormId')
  })
})

describe('cost line', () => {
  it('formats small values and warns about a tight quota', () => {
    expect(formatAiUsd(0.004)).toBe('menos de US$ 0,01')
    expect(formatAiUsd(0)).toContain('0,00')
    const { rerender, container } = render(
      <AiCostLine
        estimateUsd={0.5}
        quota={{
          usedUsd: 9.8,
          quotaUsd: 10,
          remainingUsd: 0.2,
          exceeded: false,
        }}
      />,
    )
    expect(textOf(container)).toContain('passa do que resta da cota')
    rerender(
      <AiCostLine
        estimateUsd={null}
        quota={{ usedUsd: 10, quotaUsd: 10, remainingUsd: 0, exceeded: true }}
      />,
    )
    expect(textOf(container)).toContain(
      'A cota mensal de IA do workspace acabou.',
    )
    rerender(<AiCostLine estimateUsd={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('applySiteAiEvent', () => {
  it('ignores unknown events', () => {
    const state = { status: 'idle' as const }
    expect(
      applySiteAiEvent(state, { type: 'nope' } as unknown as SiteAiEvent),
    ).toBe(state)
  })
})

// ─── editor tab ──────────────────────────────────────────────────────────

function pageDoc(): CanvasDocument {
  return toDocument([
    section({}, [heading('h1', 'Título antigo'), image('/old.png', 'Antiga')]),
    section({}, [text('Rodapé da página')]),
  ])
}

function setupPanel(routes: Parameters<typeof mockFetch>[0] = []) {
  const spy = mockFetch([...routes, { match: `${BASE}/ai`, data: context() }])
  const doc = pageDoc()
  const store = createCanvasStore(siteCatalog, doc)
  renderInEditor(
    <SiteAiPanel store={store} />,
    {},
    {
      client: createTestQueryClient(),
    },
  )
  return { spy, store, doc }
}

describe('SiteAiPanel', () => {
  it('generates a section and inserts it after the selection', async () => {
    const fragment = toFragment(section({}, [heading('h2', 'Três serviços')]))
    const { spy, store, doc } = setupPanel([
      {
        method: 'POST',
        match: `${BASE}/${SITE_ID}/ai/section`,
        data: { reply: 'Três serviços em cartões.', fragment, costUsd: 0.02 },
      },
    ])
    const [first] = doc.nodes[doc.rootId].children as string[]
    act(() => store.select(first))

    expect(await screen.findAllByTestId('site-ai-cost')).not.toHaveLength(0)
    fireEvent.change(screen.getByLabelText('O que a seção deve ter?'), {
      target: { value: 'Três serviços da padaria' },
    })
    fireEvent.click(screen.getByTestId('site-ai-section-generate'))
    expect(await screen.findByText('Três serviços em cartões.')).toBeTruthy()
    expect(fetchBody(spy, '/ai/section')).toMatchObject({
      prompt: 'Três serviços da padaria',
      style: 'auto',
      pageTitle: 'Início',
      headings: ['Título antigo'],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Inserir na página' }))
    const children = store.getState().doc.nodes[doc.rootId].children as string[]
    expect(children).toHaveLength(3)
    const inserted = store.getState().doc.nodes[children[1]]
    expect(inserted.type).toBe(SITE_TYPES.section)
    expect(notify.success).toHaveBeenCalled()
  })

  it('rewrites the page copy as one undoable step', async () => {
    const { store, doc } = setupPanel()
    const headingId = Object.values(doc.nodes).find(
      (node) => node.type === SITE_TYPES.heading,
    )?.id as string
    mockFetch([
      {
        method: 'POST',
        match: `${BASE}/${SITE_ID}/ai/rewrite`,
        data: {
          changes: [
            { nodeId: headingId, set: { text: 'Título novo' } },
            { nodeId: 'gone', set: { text: 'x' } },
          ],
          rewritten: 1,
          costUsd: 0.03,
        },
      },
      { match: `${BASE}/ai`, data: context() },
    ])
    await screen.findAllByTestId('site-ai-cost')
    fireEvent.click(screen.getByTestId('site-ai-rewrite'))
    await waitFor(() =>
      expect(store.getState().doc.nodes[headingId].props.text).toBe(
        'Título novo',
      ),
    )
    expect(notify.success).toHaveBeenCalledWith(
      '1 texto(s) reescrito(s) — Ctrl+Z desfaz',
    )
    act(() => store.undo())
    expect(store.getState().doc.nodes[headingId].props.text).toBe(
      'Título antigo',
    )
  })

  it('suggests images and applies them', async () => {
    const { store, doc } = setupPanel()
    const imageId = Object.values(doc.nodes).find(
      (node) => node.type === SITE_TYPES.image,
    )?.id as string
    mockFetch([
      {
        method: 'POST',
        match: `${BASE}/${SITE_ID}/ai/images`,
        data: {
          suggestions: [
            {
              nodeId: imageId,
              currentSrc: '/old.png',
              src: '/landing-page-templates/b2b/content01-photo.png',
              alt: 'Equipe atendendo um cliente',
              idea: 'Foto da equipe no balcão',
              source: 'placeholder',
              dimensions: { width: 616, height: 421 },
            },
          ],
          costUsd: 0.01,
        },
      },
      { match: `${BASE}/ai`, data: context() },
    ])
    await screen.findAllByTestId('site-ai-cost')
    fireEvent.click(screen.getByTestId('site-ai-images'))
    expect(
      await screen.findByText('Foto ideal: Foto da equipe no balcão'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar todas' }))
    expect(store.getState().doc.nodes[imageId].props).toMatchObject({
      image: {
        src: '/landing-page-templates/b2b/content01-photo.png',
        alt: 'Equipe atendendo um cliente',
      },
      dimensions: { width: 616, height: 421 },
    })
    expect(screen.queryByTestId('site-ai-image-suggestion')).toBeNull()
  })

  it('reports failures of the actions', async () => {
    setupPanel([
      {
        method: 'POST',
        match: `${BASE}/${SITE_ID}/ai/images`,
        status: 502,
        error: 'A IA falhou',
      },
    ])
    await screen.findAllByTestId('site-ai-cost')
    fireEvent.click(screen.getByTestId('site-ai-images'))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })
})

describe('editor helpers', () => {
  it('finds where a section goes', () => {
    const doc = pageDoc()
    const [first, second] = doc.nodes[doc.rootId].children as string[]
    const inner = (doc.nodes[first].children as string[])[0]
    expect(insertionIndex(doc, [])).toBe(2)
    expect(insertionIndex(doc, [first])).toBe(1)
    expect(insertionIndex(doc, [inner])).toBe(1)
    expect(insertionIndex(doc, [second])).toBe(2)
    expect(insertionIndex(doc, ['ghost'])).toBe(2)
  })

  it('keeps the current file when only the alt text changes', () => {
    const base = {
      nodeId: 'n1',
      currentSrc: '/a.png',
      src: '/a.png',
      alt: 'Novo',
      idea: '',
      dimensions: null,
    }
    expect(imageChange({ ...base, source: 'current' }).set).toEqual({
      image: { src: '/a.png', alt: 'Novo' },
    })
    expect(
      imageChange({ ...base, source: 'library', src: '/b.png' }).set,
    ).toEqual({ image: { src: '/b.png', alt: 'Novo' }, dimensions: undefined })
  })

  it('applies nothing when no node is left', () => {
    const store = createCanvasStore(siteCatalog, pageDoc())
    expect(applyChanges(store, [{ nodeId: 'x', set: {} }], 'x')).toBe(0)
  })
})
