import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import { SITE_TEMPLATES } from '@/src/lib/canvas-site/presets'
import type { SiteSummaryDTO } from '@/types/site'
import { formatSiteRelative } from '../format'
import { SitesList } from '../sites-list'
import { fakeGlobal, fakeSite, PAGES, WS } from './harness'

const push = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/notify', () => ({ notify }))

const SITES: SiteSummaryDTO[] = [
  {
    id: 'site_1',
    name: 'Clínica São Lucas',
    slug: 'clinica',
    status: 'PUBLISHED',
    url: 'https://clinica.sites.example.com',
    pageCount: 4,
    publishedAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
  },
  {
    id: 'site_2',
    name: 'Campanha de verão',
    slug: 'verao',
    status: 'DRAFT',
    url: 'https://verao.sites.example.com',
    pageCount: 1,
    publishedAt: null,
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
]

const BASE = `/api/workspaces/${WS}/crm/sites`

function setup({
  sites = SITES,
  landingPages = 0,
}: {
  sites?: SiteSummaryDTO[]
  landingPages?: number
} = {}) {
  const spy = mockFetch([
    { match: new RegExp(`${BASE}$`), data: sites },
    { match: /\/crm\/landing-pages$/, data: Array(landingPages).fill({}) },
    {
      match: /\/sites\/site_\d\/pages\/home$/,
      data: { ...PAGES[0], document: createSiteDocument('Bem-vindo') },
    },
    { match: /\/sites\/site_\d\/pages$/, data: PAGES },
    { match: /\/sites\/site_\d\/globals$/, data: [fakeGlobal('HEADER')] },
    { match: /\/sites\/site_\d$/, data: fakeSite() },
    {
      method: 'POST',
      match: `${BASE}/from-template`,
      status: 201,
      data: fakeSite({ id: 'site_9' }),
    },
    {
      method: 'POST',
      match: `${BASE}/site_1/duplicate`,
      status: 201,
      data: fakeSite({ id: 'site_8', name: 'Clínica São Lucas (cópia)' }),
    },
    {
      method: 'POST',
      match: `${BASE}/migrate-landing-pages`,
      data: { created: 2, skipped: 0, failed: 0 },
    },
    {
      method: 'POST',
      match: new RegExp(`${BASE}$`),
      status: 201,
      data: fakeSite({ id: 'site_7' }),
    },
    { method: 'DELETE', match: `${BASE}/site_2`, data: null },
  ])
  renderWithQuery(<SitesList workspaceId={WS} slug='acme' />)
  return spy
}

const ORIGINAL_OBSERVER = globalThis.IntersectionObserver

afterEach(() => {
  globalThis.IntersectionObserver = ORIGINAL_OBSERVER
})

/** Every observed element is on screen right away. */
class VisibleObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.IntersectionObserver =
    VisibleObserver as unknown as typeof IntersectionObserver
  window.localStorage?.clear?.()
})

describe('formatSiteRelative', () => {
  it('reads like a person', () => {
    const now = Date.parse('2026-10-15T12:00:00Z')
    expect(formatSiteRelative('2026-10-15T11:59:40Z', now)).toBe('agora')
    expect(formatSiteRelative('2026-10-15T11:55:00Z', now)).toBe('há 5 min')
    expect(formatSiteRelative('2026-10-15T09:00:00Z', now)).toBe('há 3 h')
    expect(formatSiteRelative('2026-10-14T09:00:00Z', now)).toBe('há 1 dia')
    expect(formatSiteRelative('2026-10-12T09:00:00Z', now)).toBe('há 3 dias')
    // Older: the date in São Paulo time, whatever the runner's zone.
    expect(formatSiteRelative('2026-10-01T02:00:00Z', now)).toContain(
      '30 de set',
    )
  })
})

describe('<SitesList />', () => {
  it('shows each site with status, address, pages and a live thumbnail', async () => {
    setup()
    const card = await screen.findByTestId('site-card-site_1')
    expect(within(card).getByText('Clínica São Lucas')).toBeTruthy()
    expect(within(card).getByText('Publicado')).toBeTruthy()
    expect(within(card).getByText('clinica.sites.example.com')).toBeTruthy()
    expect(within(card).getByText(/4 páginas · Editado/)).toBeTruthy()
    const draft = screen.getByTestId('site-card-site_2')
    expect(within(draft).getByText('Rascunho')).toBeTruthy()
    expect(within(draft).getByText(/1 página · Editado/)).toBeTruthy()
    // The thumbnail is the home page with the header, drawn small.
    await waitFor(() =>
      expect(within(card).getByTestId('site-snapshot')).toBeTruthy(),
    )
    expect(
      within(card)
        .getByRole('link', { name: 'Abrir o editor de Clínica São Lucas' })
        .getAttribute('href'),
    ).toBe('/acme/crm/sites/site_1')
  })

  it('offers the first site on an empty workspace', async () => {
    setup({ sites: [] })
    expect(await screen.findByText('Crie seu primeiro site')).toBeTruthy()
  })

  it('creates a site from a template and opens the editor', async () => {
    const spy = setup()
    fireEvent.click(await screen.findByTestId('new-site'))
    const dialog = await screen.findByTestId('new-site-dialog')
    expect(within(dialog).getByTestId('site-template-blank')).toBeTruthy()
    for (const template of SITE_TEMPLATES) {
      expect(
        within(dialog).getByTestId(`site-template-${template.id}`).textContent,
      ).toContain(template.label)
    }
    const template = SITE_TEMPLATES[0]
    fireEvent.click(within(dialog).getByTestId(`site-template-${template.id}`))
    const name = within(
      await screen.findByTestId('new-site-dialog'),
    ).getByLabelText('Nome') as HTMLInputElement
    expect(name.value).toBe(template.label)
    fireEvent.change(name, { target: { value: 'Estúdio Norte' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Criar e abrir o editor' }),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/sites/site_9'),
    )
    expect(fetchBody(spy, `${BASE}/from-template`)).toEqual({
      name: 'Estúdio Norte',
      templateId: template.id,
    })
  })

  it('creates a blank site', async () => {
    const spy = setup()
    fireEvent.click(await screen.findByTestId('new-site'))
    fireEvent.click(await screen.findByTestId('site-template-blank'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Criar e abrir o editor' }),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/sites/site_7'),
    )
    expect(fetchBody(spy, new RegExp(`${BASE}$`))).toEqual({ name: 'Meu site' })
  })

  it('goes back from the name step to the templates', async () => {
    setup()
    fireEvent.click(await screen.findByTestId('new-site'))
    fireEvent.click(await screen.findByTestId('site-template-blank'))
    fireEvent.click(screen.getByRole('button', { name: 'Modelos' }))
    expect(
      await screen.findByTestId(`site-template-${SITE_TEMPLATES[1].id}`),
    ).toBeTruthy()
  })

  it('duplicates and deletes from the card menu', async () => {
    const spy = setup()
    const card = await screen.findByTestId('site-card-site_1')
    fireEvent.click(
      within(card).getByRole('button', { name: 'Ações de Clínica São Lucas' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicar' }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/sites/site_8'),
    )

    const draft = screen.getByTestId('site-card-site_2')
    fireEvent.click(
      within(draft).getByRole('button', { name: 'Ações de Campanha de verão' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir site' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(`${BASE}/site_2`) && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
    expect(notify.success).toHaveBeenCalledWith('“Campanha de verão” excluído.')
  })

  it('brings old landing pages over and hides the banner', async () => {
    const spy = setup({ landingPages: 2 })
    expect(
      await screen.findByText('Landing pages agora são Sites'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trazer para Sites' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        '2 landing pages agora são sites.',
      ),
    )
    expect(
      spy.mock.calls.some(([url]) => String(url).includes('migrate')),
    ).toBe(true)
    expect(screen.queryByText('Landing pages agora são Sites')).toBeNull()
  })
})
