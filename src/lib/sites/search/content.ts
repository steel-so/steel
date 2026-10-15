import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import type { CanvasLink } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { richTextToPlain } from '@/src/lib/canvas-site/sanitize'
import { countWords } from './text'

/**
 * What a search engine reads from a page document: headings in order, text
 * blocks, images, links, lists and Q&A, with the node ids the one-click
 * fixes act on. Hidden nodes are skipped (they never reach the output).
 * Pure; reads through `getNode`, so it works on the editor's live overlay
 * documents too.
 */

export interface ContentHeading {
  id: string
  level: number
  text: string
}

/** A run of readable text (a rich text, a list, an accordion answer). */
export interface ContentBlock {
  id: string
  kind: 'text' | 'list' | 'answer' | 'other'
  text: string
  words: number
}

export interface ContentImage {
  id: string
  src: string
  alt: string
}

export interface ContentLink {
  href: string
  internal: boolean
}

/** One element in reading order (headings and blocks interleaved). */
export type ContentFlowItem =
  | ({ type: 'heading' } & ContentHeading)
  | ({ type: 'block' } & ContentBlock)

export interface PageContent {
  headings: ContentHeading[]
  blocks: ContentBlock[]
  flow: ContentFlowItem[]
  images: ContentImage[]
  links: ContentLink[]
  /** Lists (list elements and `<ul>/<ol>` in rich text). */
  lists: number
  numberedLists: number
  /** Table-like blocks (pricing, stats). */
  tables: number
  /** Accordion items with a title and an answer. */
  faq: Array<{ question: string; answer: string }>
  /** All readable text, in order. */
  text: string
  words: number
}

function linkOf(link: unknown): ContentLink | null {
  const value = link as CanvasLink | undefined
  const target = value?.value?.trim()
  if (!value || !target) return null
  switch (value.type) {
    case 'page':
    case 'anchor':
      return { href: target, internal: true }
    case 'url':
    case 'file':
      return { href: target, internal: !/^(https?:)?\/\//i.test(target) }
    default:
      return null
  }
}

function hrefLinks(html: string): ContentLink[] {
  const out: ContentLink[] = []
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)) {
    const href = match[1].trim()
    if (!href || /^(mailto|tel|javascript):/i.test(href)) continue
    out.push({ href, internal: !/^(https?:)?\/\//i.test(href) })
  }
  return out
}

function stringProp(node: CanvasNode, key: string): string {
  const value = node.props[key]
  return typeof value === 'string' ? value.trim() : ''
}

function arrayProp(node: CanvasNode, key: string): Record<string, unknown>[] {
  const value = node.props[key]
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
      )
    : []
}

/** Plain text of a subtree (accordion answers). */
function subtreeText(doc: CanvasDocument, id: string): string {
  const node = getNode(doc, id)
  if (!node || node.meta?.hidden) return ''
  const own: string[] = []
  if (node.type === SITE_TYPES.text) {
    own.push(richTextToPlain(stringProp(node, 'html')))
  } else if (node.type === SITE_TYPES.heading) {
    own.push(stringProp(node, 'text'))
  } else if (node.type === SITE_TYPES.list) {
    for (const item of arrayProp(node, 'items')) {
      if (typeof item.text === 'string') own.push(item.text.trim())
    }
  }
  for (const child of node.children ?? []) own.push(subtreeText(doc, child))
  return own.filter(Boolean).join(' ')
}

export function extractPageContent(doc: CanvasDocument): PageContent {
  const content: PageContent = {
    headings: [],
    blocks: [],
    flow: [],
    images: [],
    links: [],
    lists: 0,
    numberedLists: 0,
    tables: 0,
    faq: [],
    text: '',
    words: 0,
  }
  const texts: string[] = []

  const block = (id: string, kind: ContentBlock['kind'], text: string) => {
    if (!text) return
    const item = { id, kind, text, words: countWords(text) }
    content.blocks.push(item)
    content.flow.push({ type: 'block', ...item })
    texts.push(text)
  }
  const addLink = (link: unknown) => {
    const resolved = linkOf(link)
    if (resolved) content.links.push(resolved)
  }

  const visit = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = getNode(doc, id)
    if (!node || node.meta?.hidden) return

    switch (node.type) {
      case SITE_TYPES.heading: {
        const text = stringProp(node, 'text')
        const level = Number(String(node.props.level ?? 'h2').slice(1)) || 2
        if (text) {
          const heading = { id, level, text }
          content.headings.push(heading)
          content.flow.push({ type: 'heading', ...heading })
          texts.push(text)
        }
        addLink(node.props.link)
        break
      }
      case SITE_TYPES.text: {
        const html = stringProp(node, 'html')
        block(id, 'text', richTextToPlain(html))
        const lists = html.match(/<(ul|ol)\b/gi) ?? []
        content.lists += lists.length
        content.numberedLists += lists.filter((tag) => /ol/i.test(tag)).length
        content.links.push(...hrefLinks(html))
        break
      }
      case SITE_TYPES.list: {
        const items = arrayProp(node, 'items')
          .map((item) =>
            typeof item.text === 'string' ? item.text.trim() : '',
          )
          .filter(Boolean)
        if (items.length) {
          content.lists += 1
          if (node.props.marker === 'number') content.numberedLists += 1
          block(id, 'list', items.join('. '))
        }
        break
      }
      case SITE_TYPES.image: {
        const image = node.props.image as { src?: string; alt?: string }
        if (image?.src) {
          content.images.push({
            id,
            src: image.src,
            alt: (image.alt ?? '').trim(),
          })
        }
        addLink(node.props.link)
        break
      }
      case SITE_TYPES.gallery:
      case SITE_TYPES.logos: {
        for (const item of arrayProp(node, 'items')) {
          const image = item.image as { src?: string; alt?: string } | undefined
          if (image?.src) {
            content.images.push({
              id,
              src: image.src,
              alt: (image.alt ?? '').trim(),
            })
          }
          addLink(item.link)
        }
        break
      }
      case SITE_TYPES.button:
      case SITE_TYPES.icon:
        addLink(node.props.link)
        break
      case SITE_TYPES.menu:
        for (const item of arrayProp(node, 'items')) addLink(item.link)
        break
      case SITE_TYPES.social:
        for (const item of arrayProp(node, 'items')) {
          if (typeof item.url === 'string' && item.url.trim()) {
            addLink({ type: 'url', value: item.url })
          }
        }
        break
      case SITE_TYPES.testimonials:
        block(
          id,
          'other',
          arrayProp(node, 'items')
            .map((item) => (typeof item.quote === 'string' ? item.quote : ''))
            .filter(Boolean)
            .join(' '),
        )
        break
      case SITE_TYPES.pricing:
      case SITE_TYPES.stats: {
        content.tables += 1
        const parts = arrayProp(node, 'items').map((item) =>
          [
            item.name,
            item.price,
            item.prefix,
            item.value,
            item.suffix,
            item.label,
            item.description,
          ]
            .filter(
              (part) => typeof part === 'string' || typeof part === 'number',
            )
            .join(' '),
        )
        block(id, 'other', parts.filter(Boolean).join('. '))
        for (const item of arrayProp(node, 'items')) addLink(item.link)
        break
      }
      case SITE_TYPES.accordionItem: {
        const question = stringProp(node, 'title')
        const answer = (node.children ?? [])
          .map((child) => subtreeText(doc, child))
          .filter(Boolean)
          .join(' ')
        if (question) {
          const heading = { id, level: 0, text: question }
          content.flow.push({ type: 'heading', ...heading })
          texts.push(question)
        }
        if (question && answer) content.faq.push({ question, answer })
        block(id, 'answer', answer)
        return
      }
    }
    for (const child of node.children ?? []) visit(child, seen)
  }

  visit(doc.rootId, new Set())
  content.text = texts.join(' ')
  content.words = countWords(content.text)
  return content
}
