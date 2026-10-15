import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'
import type { SiteSnapshot, SiteSnapshotPage } from '../snapshot'
import {
  type BlogTemplateKey,
  defaultBlogTemplate,
  isBlogTemplateKey,
  TEMPLATE_FALLBACK,
} from './templates'

/**
 * Glue between the published snapshot and the dynamic pages: which
 * template a route renders and the "virtual page" the runtime hands to the
 * page code (metadata, JSON-LD, render) as if it were a snapshot page.
 */

/** Names (template keys) of the TEMPLATE globals of a snapshot. */
export function snapshotTemplateKeys(snapshot: SiteSnapshot): Set<string> {
  return new Set(
    snapshot.globals
      .filter((global) => global.kind === 'TEMPLATE')
      .map((global) => global.name),
  )
}

function ownTemplate(
  snapshot: SiteSnapshot,
  key: string,
): CanvasDocument | undefined {
  return snapshot.globals.find(
    (global) => global.kind === 'TEMPLATE' && global.name === key,
  )?.document
}

/** Document of a template: the published one, else the template it falls
 * back to (archives → blog index), else the built-in default. A
 * collection without its template has no item page (`null`). */
export function templateDocument(
  snapshot: SiteSnapshot,
  key: string,
): CanvasDocument | null {
  const own = ownTemplate(snapshot, key)
  if (own) return own
  if (!isBlogTemplateKey(key)) return null
  const fallback = TEMPLATE_FALLBACK[key]
  const shared = fallback ? ownTemplate(snapshot, fallback) : undefined
  return shared ?? defaultBlogTemplate(key as BlogTemplateKey)
}

/** A dynamic page shaped like a snapshot page. */
export function virtualPage(input: {
  id: string
  title: string
  /** Site path without the leading slash (`blog/meu-post`). */
  path: string
  seo?: SitePageSeoDTO
  document: CanvasDocument
}): SiteSnapshotPage {
  const segments = input.path.split('/')
  return {
    id: input.id,
    parentId: null,
    title: input.title,
    slug: segments[segments.length - 1] ?? '',
    path: input.path,
    position: 0,
    isHome: false,
    seo: input.seo ?? {},
    document: input.document,
  }
}
