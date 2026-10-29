import type {
  CanvasDocument,
  CanvasFragment,
  CanvasNode,
  CanvasNodeId,
  CanvasProps,
} from '@/src/lib/canvas/types'
import { ROOT_ID } from '@/src/lib/canvas/types'
import { spacing } from '@/src/lib/canvas/values'
import { plainToParagraphs } from '@/src/lib/canvas-email/ai-blocks'
import {
  EMAIL_CATALOG_ID,
  EMAIL_CATALOG_VERSION,
  emailCatalog,
} from '@/src/lib/canvas-email/catalog'
import { POSTS_BLOCK } from '@/src/lib/canvas-email/components/content'
import {
  BODY,
  COLUMN,
  defaultBodyProps,
  defaultColumnProps,
  defaultFooterProps,
  defaultSectionProps,
  FOOTER,
  SECTION,
} from '@/src/lib/canvas-email/components/layout'
import { openEmailDocument } from '@/src/lib/canvas-email/convert-v1'
import type { EmailPostItem } from '@/src/lib/canvas-email/schemas'
import {
  isEmailBuilderImage,
  isEmailBuilderLink,
} from '@/src/schemas/crm-email-builder.schema'

/**
 * Canvas documents built by the server for the newsletter (newsletter2
 * nl2-digest-ai): the digest issue (logo, title, intro and the "Lista de
 * posts"), and the posts section the AI draft appends for the blog posts
 * the member picked — the links and images come from the posts, never
 * from the model.
 */

export type DigestPost = {
  title: string
  excerpt: string
  url: string
  imageUrl: string | null
}

const cap = (value: string, max: number) => value.trim().slice(0, max).trimEnd()

/** Posts as block items; a post without an http(s) link is dropped. */
export function toPostItems(posts: DigestPost[]): EmailPostItem[] {
  return posts
    .filter(
      (post) =>
        post.title.trim() &&
        /^https?:\/\//i.test(post.url.trim()) &&
        isEmailBuilderLink(post.url),
    )
    .slice(0, 12)
    .map((post) => {
      const src =
        post.imageUrl &&
        post.imageUrl.length <= 2000 &&
        isEmailBuilderImage(post.imageUrl)
          ? post.imageUrl.trim()
          : ''
      return {
        title: cap(post.title, 200),
        excerpt: cap(post.excerpt, 400),
        image: { src, alt: src ? cap(post.title, 300) : '' },
        link: { type: 'url' as const, value: post.url.trim() },
      }
    })
}

function node(
  id: CanvasNodeId,
  type: string,
  props: CanvasProps,
  children?: CanvasNodeId[],
): CanvasNode {
  return children ? { id, type, props, children } : { id, type, props }
}

function defaults(type: string): CanvasProps {
  return emailCatalog.components[type].defaultProps()
}

/** A one-column section holding `blocks` (ids prefixed with `prefix`). */
function section(
  prefix: string,
  blocks: { type: string; props: CanvasProps }[],
): CanvasFragment {
  const nodes: Record<CanvasNodeId, CanvasNode> = {}
  const ids = blocks.map((block, index) => {
    const id = `${prefix}-b${index + 1}`
    nodes[id] = node(id, block.type, {
      ...defaults(block.type),
      ...block.props,
    })
    return id
  })
  nodes[`${prefix}-col`] = node(
    `${prefix}-col`,
    COLUMN,
    defaultColumnProps(),
    ids,
  )
  nodes[prefix] = node(prefix, SECTION, defaultSectionProps(), [
    `${prefix}-col`,
  ])
  return { rootId: prefix, nodes }
}

/** Section with the "Lista de posts" (null when no post is usable). */
export function postsSection(
  posts: DigestPost[],
  options: { prefix?: string; heading?: string; linkLabel?: string } = {},
): CanvasFragment | null {
  const items = toPostItems(posts)
  if (items.length === 0) return null
  const blocks: { type: string; props: CanvasProps }[] = []
  if (options.heading) {
    blocks.push({
      type: 'email.heading',
      props: { text: cap(options.heading, 300), level: 'h2' },
    })
  }
  blocks.push({
    type: POSTS_BLOCK,
    props: {
      items,
      linkLabel: options.linkLabel ?? 'Ler mais',
      padding: spacing(8, 0),
    },
  })
  return section(options.prefix ?? 'posts', blocks)
}

/** Body and footer props of the newsletter template, when it has them. */
function templateChrome(template: unknown): {
  body: CanvasProps
  footer: CanvasProps
} {
  const doc = template ? openEmailDocument(template) : null
  const root = doc?.nodes[doc.rootId]
  const footerId = root?.children?.find((id) => doc?.nodes[id]?.type === FOOTER)
  return {
    body:
      root?.type === BODY
        ? { ...defaultBodyProps(), ...root.props }
        : defaultBodyProps(),
    footer:
      footerId && doc
        ? { ...defaultFooterProps(), ...doc.nodes[footerId].props }
        : defaultFooterProps(),
  }
}

/**
 * The digest issue: logo, title and intro, then the posts; body styles and
 * footer from the newsletter template when there is one.
 */
export function buildDigestDocument(input: {
  title: string
  intro: string | null
  posts: DigestPost[]
  preheader: string
  template?: unknown
}): CanvasDocument {
  const chrome = templateChrome(input.template)
  const headerBlocks: { type: string; props: CanvasProps }[] = [
    { type: 'email.logo', props: {} },
    {
      type: 'email.heading',
      props: { text: cap(input.title, 300), level: 'h1' },
    },
  ]
  if (input.intro?.trim()) {
    headerBlocks.push({
      type: 'email.text',
      props: { html: plainToParagraphs(cap(input.intro, 4000)) },
    })
  }
  const header = section('digest-header', headerBlocks)
  const posts = postsSection(input.posts, { prefix: 'digest-posts' })
  const footer = node('footer', FOOTER, chrome.footer)
  const children = [header.rootId, ...(posts ? [posts.rootId] : []), 'footer']
  return {
    catalog: EMAIL_CATALOG_ID,
    version: EMAIL_CATALOG_VERSION,
    rootId: ROOT_ID,
    nodes: {
      [ROOT_ID]: node(
        ROOT_ID,
        BODY,
        { ...chrome.body, preheader: cap(input.preheader, 150) },
        children,
      ),
      ...header.nodes,
      ...(posts?.nodes ?? {}),
      footer,
    },
  }
}

/** Text of a rich-text value (tags stripped, entities kept simple). */
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/(p|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const TEXT_PROPS = [
  'text',
  'html',
  'label',
  'heading',
  'question',
  'name',
  'description',
  'title',
  'excerpt',
  'closing',
]

/**
 * Plain text of an e-mail document in reading order — what "Sugerir
 * assuntos" sends to the AI (the issue's own copy; no recipient data:
 * variables stay as `{{…}}`). Capped at `max` characters.
 */
export function documentText(doc: unknown, max = 6000): string {
  const opened = openEmailDocument(doc)
  if (!opened) return ''
  const parts: string[] = []
  const visit = (id: CanvasNodeId) => {
    const current = opened.nodes[id]
    if (!current || current.type === FOOTER) return
    for (const key of TEXT_PROPS) {
      const value = (current.props as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) {
        parts.push(stripTags(value).trim())
      }
    }
    const items = (current.props as { items?: unknown }).items
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        for (const key of ['title', 'text', 'excerpt']) {
          const value = (item as Record<string, unknown>)[key]
          if (typeof value === 'string' && value.trim())
            parts.push(value.trim())
        }
      }
    }
    for (const child of current.children ?? []) visit(child)
  }
  visit(opened.rootId)
  return parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, max)
}
