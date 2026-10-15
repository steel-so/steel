import z from 'zod'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import {
  parseSiteSettings,
  type SiteSettingsDTO,
} from '@/src/schemas/site.schema'
import {
  parseSitePageSeo,
  type SitePageSeoDTO,
} from '@/src/schemas/site-page.schema'

/**
 * The immutable publication of a site (`SiteVersion.snapshot`): everything
 * the public runtime needs, so it never reads the draft rows. Restoring a
 * version copies it back into the draft.
 */

export const SITE_SNAPSHOT_VERSION = 1

export interface SiteSnapshotPage {
  id: string
  parentId: string | null
  title: string
  slug: string
  path: string
  position: number
  isHome: boolean
  seo: SitePageSeoDTO
  document: CanvasDocument
}

export interface SiteSnapshotGlobal {
  id: string
  kind: 'HEADER' | 'FOOTER' | 'SYMBOL'
  name: string
  document: CanvasDocument
}

export interface SiteSnapshot {
  snapshotVersion: number
  name: string
  theme: Record<string, unknown>
  settings: SiteSettingsDTO
  homePageId: string | null
  pages: SiteSnapshotPage[]
  globals: SiteSnapshotGlobal[]
}

const DocumentShape = z.custom<CanvasDocument>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { nodes?: unknown }).nodes === 'object',
)

const SnapshotSchema = z.object({
  snapshotVersion: z.literal(SITE_SNAPSHOT_VERSION),
  name: z.string(),
  theme: z.record(z.string(), z.unknown()),
  settings: z.unknown(),
  homePageId: z.string().nullable(),
  pages: z.array(
    z.object({
      id: z.string(),
      parentId: z.string().nullable(),
      title: z.string(),
      slug: z.string(),
      path: z.string(),
      position: z.number(),
      isHome: z.boolean(),
      seo: z.unknown(),
      document: DocumentShape,
    }),
  ),
  globals: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['HEADER', 'FOOTER', 'SYMBOL']),
      name: z.string(),
      document: DocumentShape,
    }),
  ),
})

/** Rows the snapshot is built from (Prisma models or plain objects). */
export interface SnapshotSource {
  name: string
  theme: unknown
  settings: unknown
  homePageId: string | null
  pages: Array<{
    id: string
    parentId: string | null
    title: string
    slug: string
    path: string
    position: number
    isHome: boolean
    seo: unknown
    document: unknown
  }>
  globals: Array<{
    id: string
    kind: 'HEADER' | 'FOOTER' | 'SYMBOL'
    name: string
    document: unknown
  }>
}

export function buildSiteSnapshot(source: SnapshotSource): SiteSnapshot {
  return {
    snapshotVersion: SITE_SNAPSHOT_VERSION,
    name: source.name,
    theme: (source.theme ?? {}) as Record<string, unknown>,
    settings: parseSiteSettings(source.settings),
    homePageId: source.homePageId,
    pages: [...source.pages]
      .sort((a, b) => a.position - b.position)
      .map((page) => ({
        id: page.id,
        parentId: page.parentId,
        title: page.title,
        slug: page.slug,
        path: page.path,
        position: page.position,
        isHome: page.isHome,
        seo: parseSitePageSeo(page.seo),
        document: page.document as CanvasDocument,
      })),
    globals: source.globals.map((global) => ({
      id: global.id,
      kind: global.kind,
      name: global.name,
      document: global.document as CanvasDocument,
    })),
  }
}

/** Reads a stored snapshot back; `null` when it is not one we wrote. */
export function parseSiteSnapshot(value: unknown): Result<SiteSnapshot, null> {
  const parsed = SnapshotSchema.safeParse(value)
  if (!parsed.success) return err(null)
  return ok({
    ...parsed.data,
    settings: parseSiteSettings(parsed.data.settings),
    pages: parsed.data.pages.map((page) => ({
      ...page,
      seo: parseSitePageSeo(page.seo),
    })),
  })
}

/** Page served at `segments` (`[]` is the home page). */
export function findSnapshotPage(
  snapshot: SiteSnapshot,
  segments: string[],
): SiteSnapshotPage | null {
  if (segments.length === 0) {
    return (
      snapshot.pages.find((page) => page.id === snapshot.homePageId) ??
      snapshot.pages.find((page) => page.isHome) ??
      snapshot.pages[0] ??
      null
    )
  }
  const path = segments.map((segment) => segment.toLowerCase()).join('/')
  return snapshot.pages.find((page) => page.path === path) ?? null
}

/** Path the page is served at: the home page lives at the root. */
export function publicPathOf(
  snapshot: SiteSnapshot,
  page: SiteSnapshotPage,
): string {
  const home = findSnapshotPage(snapshot, [])
  return home?.id === page.id ? '' : page.path
}

export function globalOf(
  snapshot: SiteSnapshot,
  kind: 'HEADER' | 'FOOTER',
): SiteSnapshotGlobal | null {
  return snapshot.globals.find((global) => global.kind === kind) ?? null
}

/** Pages listed in the sitemap: every page not marked noindex, on a site
 * not marked noindex. */
export function indexablePages(snapshot: SiteSnapshot): SiteSnapshotPage[] {
  if (snapshot.settings.seo.noindex) return []
  return snapshot.pages.filter((page) => !page.seo.noindex)
}

/** `<title>` of a page with the site's template (`%s | Site`). */
export function pageTitle(
  snapshot: SiteSnapshot,
  page: SiteSnapshotPage,
): string {
  const title = page.seo.title || page.title
  const template = snapshot.settings.seo.titleTemplate
  if (!template?.includes('%s')) return title
  return template.replace('%s', title)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** `sitemap.xml` of a published site. */
export function renderSitemapXml(
  urls: Array<{ loc: string; lastModified: Date }>,
): string {
  const entries = urls
    .map(
      (url) =>
        `  <url><loc>${escapeXml(url.loc)}</loc><lastmod>${url.lastModified.toISOString()}</lastmod></url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
}

/** `robots.txt` of a site: everything allowed plus the sitemap, or
 * everything blocked when the site is noindex. */
export function renderRobotsTxt(options: {
  noindex: boolean
  sitemapUrl: string
}): string {
  if (options.noindex) return 'User-agent: *\nDisallow: /\n'
  return `User-agent: *\nAllow: /\n\nSitemap: ${options.sitemapUrl}\n`
}
