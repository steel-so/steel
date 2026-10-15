import type { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import {
  CanvasEditorContextProvider,
  type CanvasEditorContextValue,
} from '@/app/_components/canvas/editor-context'
import { createDragStore } from '@/app/_components/canvas/lib/drag-store'
import { createFrameHandle } from '@/app/_components/canvas/lib/frame-handle'
import type { CanvasEditorProps } from '@/app/_components/canvas/types'
import { CanvasStoreProvider } from '@/app/_components/canvas/use-canvas'
import { renderWithQuery } from '@/src/__tests__/component-utils'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import { crmSitesApi } from '@/src/hooks/use-crm-sites'
import { createCanvasStore } from '@/src/lib/canvas/store'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import { defaultSiteTheme } from '@/src/lib/canvas-site/theme'
import type { SiteDTO, SiteGlobalDTO, SitePageSummaryDTO } from '@/types/site'
import {
  type SiteEditorContextValue,
  SiteEditorProvider,
  toPageLinks,
} from '../site-editor-context'

export const WS = 'ws_1'
export const SITE_ID = 'site_1'

export function fakeSite(overrides: Partial<SiteDTO> = {}): SiteDTO {
  return {
    id: SITE_ID,
    workspaceId: WS,
    name: 'Clínica São Lucas',
    slug: 'clinica',
    status: 'DRAFT',
    theme: {},
    settings: {
      seo: {},
      tracking: {},
      cookieBanner: { enabled: false },
    },
    homePageId: 'home',
    publishedVersionId: null,
    publishedAt: null,
    url: 'https://clinica.sites.example.com',
    sourceLandingPageId: null,
    createdById: 'u1',
    updatedById: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    ...overrides,
  }
}

export function fakePage(
  overrides: Partial<SitePageSummaryDTO> & { id: string },
): SitePageSummaryDTO {
  return {
    siteId: SITE_ID,
    parentId: null,
    title: overrides.id,
    slug: overrides.id,
    path: overrides.id,
    position: 0,
    isHome: false,
    seo: {},
    updatedAt: '2026-10-10T12:00:00.000Z',
    ...overrides,
  }
}

export const PAGES: SitePageSummaryDTO[] = [
  fakePage({
    id: 'home',
    title: 'Início',
    slug: 'inicio',
    path: 'inicio',
    isHome: true,
  }),
  fakePage({ id: 'sobre', title: 'Sobre', position: 1 }),
  fakePage({
    id: 'equipe',
    title: 'Equipe',
    parentId: 'sobre',
    path: 'sobre/equipe',
    slug: 'equipe',
  }),
  fakePage({ id: 'contato', title: 'Contato', position: 2 }),
]

export function fakeGlobal(kind: 'HEADER' | 'FOOTER'): SiteGlobalDTO {
  return {
    id: kind === 'HEADER' ? 'g_header' : 'g_footer',
    siteId: SITE_ID,
    kind,
    name: kind === 'HEADER' ? 'Cabeçalho' : 'Rodapé',
    document: createSiteDocument(kind),
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  }
}

/**
 * Renders a site editor panel inside the two contexts it reads — the
 * canvas shell (only `save` is used) and the site editor — with spies for
 * every callback.
 */
export function renderInEditor(
  ui: ReactElement,
  overrides: Partial<SiteEditorContextValue> = {},
  options: { save?: () => Promise<boolean>; client?: QueryClient } = {},
) {
  const save = vi.fn(options.save ?? (async () => true))
  const pages = overrides.pages ?? PAGES
  const ctx: SiteEditorContextValue = {
    workspaceId: WS,
    slug: 'acme',
    site: fakeSite(),
    pages,
    globals: [],
    pageLinks: toPageLinks(pages),
    target: { kind: 'page', id: 'home' },
    lastPageId: 'home',
    theme: defaultSiteTheme(),
    canEdit: true,
    canDelete: true,
    api: crmSitesApi(WS),
    open: vi.fn(async () => {}),
    setTheme: vi.fn(),
    flushTheme: vi.fn(async () => true),
    setSite: vi.fn(),
    setPages: vi.fn(),
    setGlobals: vi.fn(),
    reload: vi.fn(async () => {}),
    previewHref: (pageId?: string) =>
      `/acme/crm/sites/${SITE_ID}/preview${pageId ? `?page=${pageId}` : ''}`,
    ...overrides,
  }
  const editor: CanvasEditorContextValue = {
    catalog: siteCatalog,
    store: createCanvasStore(siteCatalog, createSiteDocument()),
    drag: createDragStore(),
    frame: createFrameHandle(),
    props: {} as CanvasEditorProps,
    save,
    clipboard: { current: null },
  }
  const rendered = renderWithQuery(
    <CanvasStoreProvider store={editor.store}>
      <CanvasEditorContextProvider value={editor}>
        <SiteEditorProvider value={ctx}>{ui}</SiteEditorProvider>
      </CanvasEditorContextProvider>
    </CanvasStoreProvider>,
    { client: options.client },
  )
  return { ...rendered, ctx, save, editor }
}
