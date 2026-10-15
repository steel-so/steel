import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import { SITE_PRESETS } from '@/src/lib/canvas-site/presets'
import { fragmentDocument, SiteEditor } from '../site-editor'
import { fakeGlobal, fakeSite, PAGES, SITE_ID, WS } from './harness'

// jsdom has no layout: ProseMirror measures ranges when it scrolls.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const BASE = `/crm/sites/${SITE_ID}`

function setup() {
  const spy = mockFetch([
    {
      match: `${BASE}/pages/home`,
      data: { ...PAGES[0], document: createSiteDocument('Bem-vindo') },
    },
    { match: `${BASE}/pages`, data: PAGES },
    {
      match: `${BASE}/globals`,
      data: [fakeGlobal('HEADER'), fakeGlobal('FOOTER')],
    },
    { match: /\/crm\/forms$/, data: [] },
    { match: /\/crm\/sites\/media$/, data: [] },
    { match: new RegExp(`${BASE}$`), data: fakeSite() },
    {
      method: 'PATCH',
      match: new RegExp(`${BASE}$`),
      data: fakeSite(),
    },
  ])
  renderWithQuery(<SiteEditor workspaceId={WS} slug='acme' siteId={SITE_ID} />)
  return spy
}

async function frameDoc(): Promise<Document> {
  const frame = (await screen.findByTestId('canvas-frame')) as HTMLIFrameElement
  await waitFor(() =>
    expect(
      frame.contentDocument?.querySelector('[data-canvas-id="h1"]'),
    ).toBeTruthy(),
  )
  return frame.contentDocument as Document
}

beforeEach(() => vi.clearAllMocks())

describe('fragmentDocument', () => {
  it('wraps every preset in a page root for its thumbnail', () => {
    for (const preset of SITE_PRESETS.slice(0, 5)) {
      const fragment = preset.fragment()
      const doc = fragmentDocument(fragment)
      expect(doc.nodes[doc.rootId].children).toEqual(
        fragment.roots ?? [fragment.rootId],
      )
    }
  })
})

describe('<SiteEditor />', () => {
  it('opens the home page with the header and footer around it', async () => {
    setup()
    const doc = await frameDoc()
    expect(screen.getByText('Clínica São Lucas')).toBeTruthy()
    expect(doc.querySelector('[data-site-global="header"]')).toBeTruthy()
    expect(doc.querySelector('[data-site-global="footer"]')).toBeTruthy()
    // The site stylesheet covers the page and the globals.
    expect(
      doc.head.querySelector('style[data-site-css]')?.textContent,
    ).toContain('.s-site')
    for (const tab of [
      'Páginas',
      'Tema',
      'Globais',
      'Mídia',
      'Seções prontas',
    ]) {
      expect(screen.getByRole('tab', { name: tab })).toBeTruthy()
    }
  })

  it('edits the header from the band drawn on the canvas', async () => {
    setup()
    const doc = await frameDoc()
    const band = doc.querySelector('[data-site-global="header"]') as HTMLElement
    // Shown on hover; jsdom applies the `display:none` of the band CSS.
    const edit = band.querySelector(':scope > button') as HTMLButtonElement
    expect(edit.textContent).toBe('Editar cabeçalho global')
    fireEvent.click(edit)
    await waitFor(() =>
      expect(
        (screen.getByTestId('site-target-switcher') as HTMLElement).textContent,
      ).toContain('Cabeçalho'),
    )
  })

  it('saves theme edits shortly after the change', async () => {
    const spy = setup()
    await frameDoc()
    fireEvent.click(screen.getByRole('tab', { name: 'Tema' }))
    const field = (await screen.findByLabelText('Primária')) as HTMLInputElement
    fireEvent.change(field, { target: { value: '#112233' } })
    fireEvent.blur(field)
    await waitFor(
      () =>
        expect(
          fetchBody(spy, new RegExp(`${BASE}$`), 'PATCH')?.theme?.colors
            ?.primary,
        ).toBe('#112233'),
      { timeout: 3000 },
    )
  })
})
