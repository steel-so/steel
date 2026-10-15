import type { CanvasDocument } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  heading,
  type NodeSpec,
  section,
  spec,
  text,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import { escapeHtml, safeSrc } from '@/src/lib/canvas-site/sanitize'
import type { SiteSettingsDTO } from '@/src/schemas/site.schema'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'
import { analyzeSearchPage } from '../search/analyze'
import type { SearchPageAnalysis } from '../search/types'
import { isPlateValue, nodeText, type PlateNode } from './plate'
import { blogPath } from './routes'

/**
 * A blog post seen by the "Buscadores" checks: the checks read a canvas
 * document, so the post (title as the page's H1, then its blocks) is
 * mapped to one — headings, paragraphs, lists, quotes and images keep
 * their meaning, everything else becomes text.
 */

const LIST_TYPES = new Set(['disc', 'circle', 'square', 'todo', 'decimal'])

function textBlock(node: PlateNode): NodeSpec | null {
  const value = nodeText(node).trim()
  return value ? text(`<p>${escapeHtml(value)}</p>`) : null
}

export function postSearchDocument(
  title: string,
  content: unknown,
): CanvasDocument {
  const children: NodeSpec[] = [heading('h1', title || 'Sem título')]
  const blocks = isPlateValue(content) ? content : []
  const usesH1 = blocks.some((block) => block.type === 'h1')
  for (const block of blocks) {
    const type = block.type ?? 'p'
    if (/^h[1-6]$/.test(type)) {
      const value = nodeText(block).trim()
      if (!value) continue
      const level = Math.min(6, Number(type.slice(1)) + (usesH1 ? 1 : 0))
      children.push(heading(`h${level}` as 'h2', value))
      continue
    }
    if (type === 'img') {
      const src = safeSrc(typeof block.url === 'string' ? block.url : '')
      if (src) {
        children.push(
          spec(SITE_TYPES.image, {
            image: {
              src,
              alt: typeof block.alt === 'string' ? block.alt : '',
            },
          }),
        )
      }
      continue
    }
    if (
      typeof block.listStyleType === 'string' &&
      LIST_TYPES.has(block.listStyleType)
    ) {
      const value = nodeText(block).trim()
      if (value) {
        const tag = block.listStyleType === 'decimal' ? 'ol' : 'ul'
        children.push(text(`<${tag}><li>${escapeHtml(value)}</li></${tag}>`))
      }
      continue
    }
    const node = textBlock(block)
    if (node) children.push(node)
  }
  return toDocument([section({}, children)])
}

/** "Buscadores" scores of a post (same checks as a page). */
export function analyzePost(input: {
  post: {
    id: string
    title: string
    slug: string
    seo: SitePageSeoDTO
    content: unknown
    updatedAt?: string
  }
  site: { name: string; settings: SiteSettingsDTO; url: string }
  siblings?: Array<{ id: string; title: string; seo: SitePageSeoDTO }>
  now?: Date
}): SearchPageAnalysis {
  const { post, site } = input
  return analyzeSearchPage({
    page: {
      id: post.id,
      title: post.title,
      slug: post.slug,
      isHome: false,
      seo: post.seo,
      updatedAt: post.updatedAt,
    },
    document: postSearchDocument(post.title, post.content),
    site: {
      name: site.name,
      settings: site.settings,
      pageUrl: `${site.url}${blogPath({ kind: 'post', slug: post.slug || 'post' })}`,
    },
    siblings: input.siblings ?? [],
    now: input.now ?? new Date(),
  })
}
