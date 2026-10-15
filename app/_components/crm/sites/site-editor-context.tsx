'use client'

import { createContext, useContext } from 'react'
import type { CrmSitesApi } from '@/src/hooks/use-crm-sites'
import type { SitePageLink } from '@/src/lib/canvas-site/context'
import type { SiteTheme } from '@/src/lib/canvas-site/theme'
import type { SiteDTO, SiteGlobalDTO, SitePageSummaryDTO } from '@/types/site'

/** What the canvas is editing: a page or a header/footer global. */
export type SiteEditorTarget =
  | { kind: 'page'; id: string }
  | { kind: 'global'; id: string }

/**
 * Shared state of the site editor for its panels (Páginas, Tema, Globais,
 * Mídia), the top bar and the dialogs. Lives above `CanvasEditor`, which
 * remounts whenever the target changes.
 */
export interface SiteEditorContextValue {
  workspaceId: string
  slug: string
  site: SiteDTO
  pages: SitePageSummaryDTO[]
  globals: SiteGlobalDTO[]
  pageLinks: SitePageLink[]
  target: SiteEditorTarget
  /** Last page opened (where "Voltar para a página" goes from a global). */
  lastPageId: string
  theme: SiteTheme
  canEdit: boolean
  canDelete: boolean
  api: CrmSitesApi
  /** Switches the canvas to a page/global (after saving the current one). */
  open: (target: SiteEditorTarget) => Promise<void>
  setTheme: (theme: SiteTheme) => void
  /** Saves pending theme edits now (before publishing). */
  flushTheme: () => Promise<boolean>
  /** Merges server data into the cache after a mutation. */
  setSite: (site: SiteDTO) => void
  setPages: (pages: SitePageSummaryDTO[]) => void
  setGlobals: (globals: SiteGlobalDTO[]) => void
  /** Reloads everything and remounts the canvas (version restored). */
  reload: () => Promise<void>
  /** Preview URL of the draft (optionally of one page). */
  previewHref: (pageId?: string) => string
}

const SiteEditorContext = createContext<SiteEditorContextValue | null>(null)

export const SiteEditorProvider = SiteEditorContext.Provider

export function useSiteEditor(): SiteEditorContextValue {
  const value = useContext(SiteEditorContext)
  if (!value) throw new Error('useSiteEditor must be used inside SiteEditor')
  return value
}

/** Public path of a page (`/` for the home page). */
export function pagePublicPath(page: SitePageSummaryDTO): string {
  return page.isHome ? '/' : `/${page.path}`
}

/** Page links for `site.menu` and link pickers, in tree order. */
export function toPageLinks(pages: SitePageSummaryDTO[]): SitePageLink[] {
  return pages.map((page) => ({
    id: page.id,
    title: page.title,
    path: pagePublicPath(page),
    parentId: page.parentId,
    showInMenu: !page.seo.noindex,
  }))
}

/** Pages as a depth-first tree order (siblings by position). */
export function orderPages(
  pages: SitePageSummaryDTO[],
): Array<SitePageSummaryDTO & { depth: number }> {
  const byParent = new Map<string | null, SitePageSummaryDTO[]>()
  const ids = new Set(pages.map((page) => page.id))
  for (const page of pages) {
    // A dangling parent shows the page at the top level.
    const parent =
      page.parentId && ids.has(page.parentId) ? page.parentId : null
    byParent.set(parent, [...(byParent.get(parent) ?? []), page])
  }
  const out: Array<SitePageSummaryDTO & { depth: number }> = []
  const visit = (parent: string | null, depth: number) => {
    const children = [...(byParent.get(parent) ?? [])].sort(
      (a, b) => a.position - b.position,
    )
    for (const page of children) {
      out.push({ ...page, depth })
      visit(page.id, depth + 1)
    }
  }
  visit(null, 0)
  return out
}
