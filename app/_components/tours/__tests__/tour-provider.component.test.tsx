import '@/src/__tests__/helpers/dom-matchers'
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiSuccess,
  renderWithProviders,
} from '@/src/__tests__/helpers/component'
import type { TourDefinition } from '@/src/lib/tours/types'
import type { TourProgressDTO } from '@/types/tour-progress'

const nav = vi.hoisted(() => ({ pathname: '/acme/crm/leads' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}))

const registry = vi.hoisted(() => ({ tours: [] as TourDefinition[] }))
vi.mock('@/src/lib/tours/registry', () => ({
  get TOURS() {
    return registry.tours
  },
}))

import { TourProvider, useTours } from '../tour-provider'
import { TourReplayButton } from '../tour-replay-button'

const leadsTour: TourDefinition = {
  key: 'crm.leads',
  version: 2,
  module: 'crm',
  title: 'Leads',
  description: 'Como trabalhar os leads no quadro.',
  route: '/crm/leads',
  docsHref: '/docs/crm/leads',
  steps: [
    { title: 'Quadro de leads', body: 'Cada coluna é uma etapa.' },
    { target: 'leads-board', title: 'Colunas', body: 'Arraste os cartões.' },
    { target: 'leads-missing', title: 'Oculto', body: 'Não aparece.' },
    { target: 'leads-new', title: 'Novo lead', body: 'Crie um lead aqui.' },
  ],
}

const funnelTour: TourDefinition = {
  key: 'crm.pipelines',
  version: 1,
  module: 'crm',
  title: 'Funis',
  description: 'Crie funis e etapas.',
  route: '/crm/pipelines',
  audience: 'admin',
  steps: [
    { title: 'Funis', body: 'Organize suas etapas.' },
    { target: 'pipelines-list', title: 'Lista', body: 'Seus funis.' },
    { target: 'pipelines-new', title: 'Novo', body: 'Crie um funil.' },
  ],
}

const editorTour: TourDefinition = {
  key: 'crm.sites.editor',
  version: 1,
  module: 'crm',
  title: 'Editor de site',
  description: 'Monte páginas arrastando blocos.',
  route: '/crm/sites/:siteId',
  openFrom: '/crm/sites',
  desktopOnly: true,
  mobileSummary: 'Arraste blocos, edite no painel e publique.',
  steps: [
    { title: 'Editor', body: 'Monte a página.' },
    { target: 'site-canvas', title: 'Página', body: 'Arraste blocos.' },
    { target: 'site-publish', title: 'Publicar', body: 'Publique.' },
  ],
}

let seen: TourProgressDTO[] = []

function mockApi() {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_input, init) => {
      if (init?.method === 'PUT') {
        return apiSuccess({
          ...JSON.parse(String(init.body)),
          seenAt: '2026-11-13T12:00:00.000Z',
        })
      }
      return apiSuccess(seen)
    })
}

function putBodies(spy: ReturnType<typeof mockApi>) {
  return spy.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

function ListOpener() {
  const tours = useTours()
  return (
    <button type='button' onClick={() => tours?.openList()}>
      abrir lista
    </button>
  )
}

function renderApp({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  return renderWithProviders(
    <TourProvider slug='acme' isAdmin={isAdmin}>
      <TourReplayButton />
      <ListOpener />
      <div data-tour='leads-board'>quadro</div>
      <button type='button' data-tour='leads-new'>
        novo lead
      </button>
      <div data-tour='pipelines-list'>funis</div>
      <div data-tour='pipelines-new'>novo funil</div>
      <div data-tour='site-canvas'>canvas</div>
      <div data-tour='site-publish'>publicar</div>
    </TourProvider>,
  )
}

const settle = (ms = 1000) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

const findCard = () => screen.findByRole('dialog', undefined, { timeout: 4000 })

beforeEach(() => {
  seen = []
  nav.pathname = '/acme/crm/leads'
  registry.tours = [leadsTour, funnelTour, editorTour]
  window.history.replaceState(null, '', '/acme/crm/leads')
  window.localStorage.clear()
  // jsdom has no layout: every anchor is "visible" with a fixed box.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    left: 100,
    width: 200,
    height: 40,
    right: 300,
    bottom: 140,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  })
})

describe('<TourProvider />', () => {
  it('should open by itself on the first visit and record the tour as completed', async () => {
    const api = mockApi()
    const { user } = renderApp()

    const card = await findCard()
    expect(card).toHaveTextContent('Quadro de leads')
    // The step whose element is not on the page is dropped: 3 of 4 remain.
    expect(card).toHaveTextContent('1 de 3')

    await user.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Colunas')
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Quadro de leads')
    await user.click(screen.getByRole('button', { name: 'Próximo' }))
    await user.click(screen.getByRole('button', { name: 'Próximo' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Novo lead')
    expect(screen.getByRole('link', { name: 'Ver no manual' })).toHaveAttribute(
      'href',
      '/docs/crm/leads',
    )
    expect(
      screen.queryByRole('button', { name: 'Pular tour' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Concluir' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(putBodies(api)).toEqual([
      { key: 'crm.leads', version: 2, status: 'COMPLETED' },
    ])
  })

  it('should record a skipped tour, by the button or by Escape', async () => {
    const api = mockApi()
    const { user } = renderApp()

    await findCard()
    await user.click(screen.getByRole('button', { name: 'Pular tour' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(putBodies(api)).toEqual([
      { key: 'crm.leads', version: 2, status: 'SKIPPED' },
    ])

    // Seen now: only the header button brings it back.
    await user.click(
      screen.getByRole('button', { name: 'Ver tour desta tela' }),
    )
    await findCard()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(putBodies(api)).toHaveLength(2)
  })

  it('should stay closed when the user already saw this version', async () => {
    seen = [
      {
        key: 'crm.leads',
        version: 2,
        status: 'COMPLETED',
        seenAt: '2026-11-01T12:00:00.000Z',
      },
    ]
    mockApi()
    renderApp()

    await settle()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Ver tour desta tela' }),
    ).toBeInTheDocument()
  })

  it('should open again when the tour has a newer version', async () => {
    seen = [
      {
        key: 'crm.leads',
        version: 1,
        status: 'COMPLETED',
        seenAt: '2026-11-01T12:00:00.000Z',
      },
    ]
    mockApi()
    renderApp()

    expect(await findCard()).toHaveTextContent('Quadro de leads')
  })

  it('should not open by itself in an automated browser or with the switch off', async () => {
    mockApi()
    window.localStorage.setItem('steel.tours.off', '1')
    renderApp()

    await settle()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should open from a ?tour= link even when already seen, and clean the address', async () => {
    seen = [
      {
        key: 'crm.leads',
        version: 2,
        status: 'SKIPPED',
        seenAt: '2026-11-01T12:00:00.000Z',
      },
    ]
    mockApi()
    window.history.replaceState(
      null,
      '',
      '/acme/crm/leads?tour=crm.leads&view=board',
    )
    renderApp()

    expect(await findCard()).toHaveTextContent('Quadro de leads')
    expect(window.location.search).toBe('?view=board')
  })

  it('should hide admin-only tours from members', async () => {
    nav.pathname = '/acme/crm/pipelines'
    mockApi()
    renderApp({ isAdmin: false })

    await settle()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Ver tour desta tela' }),
    ).not.toBeInTheDocument()
  })

  it('should show admin-only tours to admins', async () => {
    nav.pathname = '/acme/crm/pipelines'
    mockApi()
    renderApp({ isAdmin: true })

    expect(await findCard()).toHaveTextContent('Funis')
  })

  it('should show only the summary of a desktop-only tour on a phone', async () => {
    nav.pathname = '/acme/crm/sites/site_1'
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(max-width: 767px)',
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    )
    const api = mockApi()
    const { user } = renderApp()

    const card = await findCard()
    expect(card).toHaveTextContent(
      'Arraste blocos, edite no painel e publique.',
    )
    expect(card).toHaveTextContent('aparece no computador')
    await user.click(screen.getByRole('button', { name: 'Entendi' }))

    await waitFor(() =>
      expect(putBodies(api)).toEqual([
        { key: 'crm.sites.editor', version: 1, status: 'COMPLETED' },
      ]),
    )
  })

  it('should list the tours the user can see, with where to open each', async () => {
    seen = [
      {
        key: 'crm.leads',
        version: 2,
        status: 'COMPLETED',
        seenAt: '2026-11-01T12:00:00.000Z',
      },
    ]
    mockApi()
    const { user } = renderApp()
    await settle(200)

    await user.click(screen.getByRole('button', { name: 'abrir lista' }))

    const list = await screen.findByRole('dialog', { name: 'Tours guiados' })
    expect(list).toHaveTextContent('CRM')
    expect(list).toHaveTextContent('Leads')
    expect(list).toHaveTextContent('Visto')
    expect(list).toHaveTextContent('Editor de site')
    expect(list).toHaveTextContent('O tour abre ao entrar em um item.')
    // Admin-only tour is not offered to a member.
    expect(list).not.toHaveTextContent('Funis')
    expect(
      screen.getByRole('link', { name: 'Ir para a tela' }),
    ).toHaveAttribute('href', '/acme/crm/sites')

    // The tour of the screen on display starts right away.
    await user.click(screen.getByRole('button', { name: 'Ver agora' }))
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent('Quadro de leads'),
    )
  })
})

describe('<TourReplayButton />', () => {
  it('should render nothing outside the provider or on a screen without tour', async () => {
    mockApi()
    const { container } = renderWithProviders(<TourReplayButton />)
    expect(container).toBeEmptyDOMElement()

    nav.pathname = '/acme/crm/products'
    renderApp()
    await settle(200)
    expect(
      screen.queryByRole('button', { name: 'Ver tour desta tela' }),
    ).not.toBeInTheDocument()
  })
})
