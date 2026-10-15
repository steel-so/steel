import type { CanvasDocument } from '@/src/lib/canvas/types'
import { usedSymbolIds } from '@/src/lib/canvas-site'
import { collectFormTokens } from '@/src/lib/sites/document'
import { sitePageUrl } from '@/src/lib/sites/host'
import {
  globalOf,
  publicPathOf,
  type SiteSnapshot,
  type SiteSnapshotPage,
} from '@/src/lib/sites/snapshot'

/**
 * Site pages as campaign destinations (ADR 0025 + Sites). Pure: the site's
 * public base URL comes from `publicSiteUrl` (subdomain under
 * `SITES_ROOT_DOMAIN`, else `/s/<slug>`), so a custom domain later only
 * changes that helper. Only the **published** snapshot counts — a link
 * never points to a page the visitor cannot open.
 */

export interface CampaignSitePage {
  id: string
  title: string
  /** Public path (`''` for the home page). */
  path: string
  url: string
  isHome: boolean
  /** Public tokens of the CRM forms shown on the page (with header, footer
   * and reusable blocks). */
  formTokens: string[]
}

function documentsOf(
  snapshot: SiteSnapshot,
  page: SiteSnapshotPage,
): CanvasDocument[] {
  const shown = [
    globalOf(snapshot, 'HEADER')?.document,
    page.document,
    globalOf(snapshot, 'FOOTER')?.document,
  ].filter((doc): doc is CanvasDocument => doc !== undefined)
  const used = new Set(usedSymbolIds(shown))
  const symbols = snapshot.globals
    .filter((global) => global.kind === 'SYMBOL' && used.has(global.id))
    .map((global) => global.document)
  return [...shown, ...symbols]
}

/** Published pages of a site, in menu order, with their public URLs. */
export function publishedSitePages(
  snapshot: SiteSnapshot,
  baseUrl: string,
): CampaignSitePage[] {
  return [...snapshot.pages]
    .sort((a, b) => a.position - b.position)
    .map((page) => {
      const path = publicPathOf(snapshot, page)
      return {
        id: page.id,
        title: page.title,
        path,
        url: sitePageUrl(baseUrl, path),
        isHome: path === '',
        formTokens: collectFormTokens(documentsOf(snapshot, page)),
      }
    })
}

/** The published page `pageId` of a site, or `null` when it is not live. */
export function findPublishedSitePage(
  snapshot: SiteSnapshot,
  baseUrl: string,
  pageId: string,
): CampaignSitePage | null {
  return (
    publishedSitePages(snapshot, baseUrl).find((page) => page.id === pageId) ??
    null
  )
}
