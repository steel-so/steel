import {
  escapeHtml,
  safeHref,
  safeSrc,
  videoEmbedUrl,
  vimeoId,
  youtubeId,
} from '@/src/lib/canvas-site/sanitize'
import { slugify } from '@/src/lib/sites/slug'

/**
 * Blog post bodies are edited with the Plate editor (same kits as the Wiki
 * and the knowledge base) and stored as its JSON value. The public site
 * never loads the editor: this module turns the value into semantic,
 * escaped HTML (allowlisted nodes and marks, checked URLs), plain text and
 * reading stats on the server, and builds a value back from the Markdown
 * the AI writes. Pure and DOM-free.
 */

export interface PlateNode {
  type?: string
  text?: string
  children?: PlateNode[]
  [key: string]: unknown
}

export type PlateValue = PlateNode[]

/** Words per minute used for the reading time. */
export const READING_WPM = 200
/** Plain text kept per post (search, feeds, AI context). */
export const PLAIN_TEXT_MAX = 20_000

const MARKS: Array<[string, string]> = [
  ['code', 'code'],
  ['bold', 'strong'],
  ['italic', 'em'],
  ['underline', 'u'],
  ['strikethrough', 's'],
  ['subscript', 'sub'],
  ['superscript', 'sup'],
  ['highlight', 'mark'],
  ['kbd', 'kbd'],
]

const UNORDERED = new Set(['disc', 'circle', 'square', 'todo'])

const ALIGNS = new Set(['center', 'right', 'justify'])

const CALLOUT_VARIANTS = new Set(['info', 'warning', 'success', 'error'])

export function isPlateValue(value: unknown): value is PlateValue {
  return (
    Array.isArray(value) &&
    value.every((node) => typeof node === 'object' && node !== null)
  )
}

function childrenOf(node: PlateNode): PlateNode[] {
  return Array.isArray(node.children) ? node.children : []
}

/** Plain text of a node (leaves joined without separators). */
export function nodeText(node: PlateNode): string {
  if (typeof node.text === 'string') return node.text
  return childrenOf(node).map(nodeText).join('')
}

function stringProp(node: PlateNode, key: string): string | undefined {
  const value = node[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function renderLeaf(leaf: PlateNode): string {
  let html = escapeHtml(leaf.text ?? '').replace(/\n/g, '<br>')
  if (!html) return ''
  for (const [mark, tag] of MARKS) {
    if (leaf[mark] === true) html = `<${tag}>${html}</${tag}>`
  }
  return html
}

function renderInline(nodes: PlateNode[]): string {
  return nodes
    .map((node) => {
      if (typeof node.text === 'string') return renderLeaf(node)
      const inner = renderInline(childrenOf(node))
      switch (node.type) {
        case 'a': {
          const href = safeHref(stringProp(node, 'url'))
          if (!href) return inner
          const external = /^https?:\/\//i.test(href)
          return `<a href="${escapeHtml(href)}"${external ? ' rel="noopener"' : ''}${node.target === '_blank' ? ' target="_blank"' : ''}>${inner}</a>`
        }
        case 'mention':
          return escapeHtml(stringProp(node, 'value') ?? nodeText(node))
        case 'inline_equation':
          return `<code>${escapeHtml(stringProp(node, 'texExpression') ?? '')}</code>`
        case 'date':
          return escapeHtml(stringProp(node, 'date') ?? '')
        default:
          return inner
      }
    })
    .join('')
}

/** Heading ids for anchors and the table of contents (unique per post). */
function headingIds(value: PlateValue): Map<PlateNode, string> {
  const ids = new Map<PlateNode, string>()
  const used = new Set<string>()
  const visit = (nodes: PlateNode[]) => {
    for (const node of nodes) {
      if (node.type && /^h[1-6]$/.test(node.type)) {
        if (!nodeText(node).trim()) continue
        const base = slugify(nodeText(node), 60) || 'secao'
        let id = base
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`
        used.add(id)
        ids.set(node, id)
      } else {
        visit(childrenOf(node))
      }
    }
  }
  visit(value)
  return ids
}

interface RenderState {
  ids: Map<PlateNode, string>
  /** The post title is the page's only `h1`: body headings move down one
   * level when the body uses `h1`. */
  shift: number
  headings: Array<{ id: string; text: string; level: number }>
}

function alignClass(node: PlateNode): string {
  const align = stringProp(node, 'align') ?? stringProp(node, 'textAlign')
  return align && ALIGNS.has(align) ? ` class="s-al-${align}"` : ''
}

function headingLevel(type: string, shift: number): number {
  return Math.min(6, Number(type.slice(1)) + shift)
}

function renderMedia(node: PlateNode): string {
  const url = stringProp(node, 'url')
  if (!url) return ''
  const youtube = youtubeId(url)
  const vimeo = youtube ? null : vimeoId(url)
  if (youtube || vimeo) {
    const src = videoEmbedUrl(youtube ? 'youtube' : 'vimeo', url, {
      autoplay: false,
      muted: false,
      loop: false,
      controls: true,
    })
    const title = escapeHtml(captionOf(node) || 'Vídeo')
    return `<figure class="s-post-embed"><iframe src="${escapeHtml(src ?? '')}" title="${title}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></figure>`
  }
  if (node.type === 'video') {
    const src = safeSrc(url)
    return src
      ? `<figure class="s-post-embed"><video src="${escapeHtml(src)}" controls preload="metadata"></video></figure>`
      : ''
  }
  const href = safeHref(url)
  return href
    ? `<p><a href="${escapeHtml(href)}" rel="noopener">${escapeHtml(url)}</a></p>`
    : ''
}

function captionOf(node: PlateNode): string {
  const caption = node.caption
  if (Array.isArray(caption)) {
    return (caption as PlateNode[]).map(nodeText).join(' ').trim()
  }
  return typeof caption === 'string' ? caption.trim() : ''
}

function renderImage(node: PlateNode): string {
  const src = safeSrc(stringProp(node, 'url'))
  if (!src) return ''
  const caption = captionOf(node)
  const alt = stringProp(node, 'alt') ?? caption
  return `<figure class="s-post-figure"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`
}

function renderTable(node: PlateNode, state: RenderState): string {
  const rows = childrenOf(node)
    .filter((row) => row.type === 'tr')
    .map((row) => {
      const cells = childrenOf(row)
        .map((cell) => {
          const tag = cell.type === 'th' ? 'th' : 'td'
          const span = (key: string, attr: string) => {
            const value = Number(cell[key])
            return Number.isInteger(value) && value > 1
              ? ` ${attr}="${Math.min(value, 50)}"`
              : ''
          }
          return `<${tag}${span('colSpan', 'colspan')}${span('rowSpan', 'rowspan')}>${renderBlocks(childrenOf(cell), state)}</${tag}>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  return `<div class="s-post-table"><table><tbody>${rows}</tbody></table></div>`
}

function renderBlock(node: PlateNode, state: RenderState): string {
  const type = node.type ?? 'p'
  if (/^h[1-6]$/.test(type)) {
    const level = headingLevel(type, state.shift)
    const id = state.ids.get(node) ?? ''
    const text = nodeText(node).trim()
    if (!text) return ''
    state.headings.push({ id, text, level })
    return `<h${level} id="${escapeHtml(id)}"${alignClass(node)}>${renderInline(childrenOf(node))}</h${level}>`
  }
  switch (type) {
    case 'blockquote':
      return `<blockquote>${blockOrInline(node, state)}</blockquote>`
    case 'hr':
      return '<hr>'
    case 'code_block': {
      const lang = stringProp(node, 'lang')
      const code = childrenOf(node).map(nodeText).join('\n')
      const cls =
        lang && /^[\w+-]{1,30}$/.test(lang)
          ? ` class="language-${escapeHtml(lang)}"`
          : ''
      return `<pre><code${cls}>${escapeHtml(code)}</code></pre>`
    }
    case 'img':
      return renderImage(node)
    case 'media_embed':
    case 'video':
      return renderMedia(node)
    case 'file':
    case 'audio': {
      const href = safeHref(stringProp(node, 'url'))
      const name = stringProp(node, 'name') ?? 'Baixar arquivo'
      return href
        ? `<p><a href="${escapeHtml(href)}" rel="noopener">${escapeHtml(name)}</a></p>`
        : ''
    }
    case 'table':
      return renderTable(node, state)
    case 'callout': {
      const variant = stringProp(node, 'variant')
      const kind = variant && CALLOUT_VARIANTS.has(variant) ? variant : 'info'
      const icon = stringProp(node, 'icon')
      return `<aside class="s-callout s-callout-${kind}">${icon ? `<span class="s-callout-icon" aria-hidden="true">${escapeHtml(icon)}</span>` : ''}<div>${blockOrInline(node, state)}</div></aside>`
    }
    case 'column_group':
      return `<div class="s-post-cols">${childrenOf(node)
        .map(
          (column) => `<div>${renderBlocks(childrenOf(column), state)}</div>`,
        )
        .join('')}</div>`
    case 'column':
      return `<div>${renderBlocks(childrenOf(node), state)}</div>`
    case 'toc':
      return '<!--toc-->'
    case 'equation':
      return `<p><code>${escapeHtml(stringProp(node, 'texExpression') ?? '')}</code></p>`
    case 'code_drawing':
    case 'excalidraw':
      return ''
    default: {
      const inner = renderInline(childrenOf(node))
      return inner.trim() ? `<p${alignClass(node)}>${inner}</p>` : ''
    }
  }
}

/** Container blocks (quote, callout) hold either blocks or inline text. */
function blockOrInline(node: PlateNode, state: RenderState): string {
  const children = childrenOf(node)
  const hasBlocks = children.some(
    (child) => typeof child.text !== 'string' && isBlockType(child.type),
  )
  return hasBlocks
    ? renderBlocks(children, state)
    : renderInline(children) || ''
}

function isBlockType(type: string | undefined): boolean {
  return (
    type === undefined ||
    !['a', 'mention', 'inline_equation', 'date', 'emoji_input'].includes(type)
  )
}

interface OpenList {
  tag: 'ul' | 'ol'
  todo: boolean
  indent: number
  liOpen: boolean
}

/** Blocks with Plate's indent lists (`listStyleType` + `indent`) grouped
 * into nested `<ul>`/`<ol>`. */
function renderBlocks(nodes: PlateNode[], state: RenderState): string {
  const out: string[] = []
  const stack: OpenList[] = []
  const closeTop = () => {
    const top = stack.pop() as OpenList
    if (top.liOpen) out.push('</li>')
    out.push(`</${top.tag}>`)
  }
  for (const node of nodes) {
    const listType = stringProp(node, 'listStyleType')
    if (!listType) {
      while (stack.length) closeTop()
      out.push(renderBlock(node, state))
      continue
    }
    const tag = UNORDERED.has(listType) ? 'ul' : 'ol'
    const todo = listType === 'todo'
    const indent = Math.max(1, Number(node.indent) || 1)
    while (stack.length && stack[stack.length - 1].indent > indent) closeTop()
    const top = stack[stack.length - 1]
    if (
      top &&
      top.indent === indent &&
      (top.tag !== tag || top.todo !== todo)
    ) {
      closeTop()
    }
    const current = stack[stack.length - 1]
    if (!current || current.indent < indent) {
      const start = Number(node.listStart)
      const startAttr =
        tag === 'ol' && Number.isInteger(start) && start > 1
          ? ` start="${start}"`
          : ''
      out.push(`<${tag}${startAttr}${todo ? ' class="s-todo"' : ''}>`)
      stack.push({ tag, todo, indent, liOpen: false })
    } else if (current.liOpen) {
      out.push('</li>')
    }
    const open = stack[stack.length - 1]
    const body =
      node.type && /^h[1-6]$/.test(node.type)
        ? renderBlock(node, state)
        : renderInline(childrenOf(node))
    const check = todo
      ? `<input type="checkbox" disabled${node.checked === true ? ' checked' : ''} aria-label="${node.checked === true ? 'Concluído' : 'Pendente'}"> `
      : ''
    out.push(`<li>${check}${body}`)
    open.liOpen = true
  }
  while (stack.length) closeTop()
  return out.join('')
}

function tocHtml(headings: RenderState['headings']): string {
  if (headings.length === 0) return ''
  const items = headings
    .map(
      (heading) =>
        `<li class="s-toc-${heading.level}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join('')
  return `<nav class="s-post-toc" aria-label="Neste artigo"><ol>${items}</ol></nav>`
}

export interface PlateHtml {
  html: string
  headings: Array<{ id: string; text: string; level: number }>
}

/** Sanitized HTML of a Plate value (unknown nodes keep their text). */
export function plateToHtml(value: unknown): PlateHtml {
  if (!isPlateValue(value)) return { html: '', headings: [] }
  const ids = headingIds(value)
  const usesH1 = [...ids.keys()].some((node) => node.type === 'h1')
  const state: RenderState = { ids, shift: usesH1 ? 1 : 0, headings: [] }
  const html = renderBlocks(value, state)
  // The table of contents lists every heading, so it is filled in last.
  return {
    html: html.replaceAll('<!--toc-->', tocHtml(state.headings)),
    headings: state.headings,
  }
}

/** Plain text of a Plate value: one line per block. */
export function plateToPlainText(value: unknown, max = PLAIN_TEXT_MAX): string {
  if (!isPlateValue(value)) return ''
  const lines: string[] = []
  const visit = (nodes: PlateNode[]) => {
    for (const node of nodes) {
      if (node.type === 'table' || node.type === 'tr') {
        visit(childrenOf(node))
        continue
      }
      if (
        node.type === 'td' ||
        node.type === 'th' ||
        node.type === 'column_group' ||
        node.type === 'column'
      ) {
        visit(childrenOf(node))
        continue
      }
      const text = node.type === 'img' ? captionOf(node) : nodeText(node).trim()
      if (text) lines.push(text)
    }
  }
  visit(value)
  return lines.join('\n').slice(0, max)
}

export interface ReadingStats {
  wordCount: number
  readingMinutes: number
}

export function readingStats(plainText: string): ReadingStats {
  const wordCount = plainText.split(/\s+/).filter(Boolean).length
  return {
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / READING_WPM)),
  }
}

/** First `max` characters of the text, cut at a word boundary with "…". */
export function excerptOf(plainText: string, max = 200): string {
  const text = plainText.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`
}

// ─── Markdown → Plate (AI drafts) ─────────────────────────────────────────

const INLINE =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g

/** Inline Markdown (bold, italic, code, links) as Plate leaves. */
export function markdownInline(text: string): PlateNode[] {
  const nodes: PlateNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) nodes.push({ text: text.slice(last, index) })
    const token = match[0]
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push({ text: token.slice(2, -2), bold: true })
    } else if (token.startsWith('`')) {
      nodes.push({ text: token.slice(1, -1), code: true })
    } else if (token.startsWith('[')) {
      const link = token.match(
        /^\[([^\]]+)\]\(([^)\s]+)\)$/,
      ) as RegExpMatchArray
      const url = safeHref(link[2])
      nodes.push(
        url
          ? { type: 'a', url, children: [{ text: link[1] }] }
          : { text: link[1] },
      )
    } else {
      nodes.push({ text: token.slice(1, -1), italic: true })
    }
    last = index + token.length
  }
  if (last < text.length) nodes.push({ text: text.slice(last) })
  return nodes.length ? nodes : [{ text: '' }]
}

/** Block Markdown (headings, paragraphs, lists, quotes, code, rules) as a
 * Plate value. Anything else becomes a paragraph. */
export function markdownToPlate(markdown: string): PlateValue {
  const value: PlateValue = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) {
      value.push({
        type: 'p',
        children: markdownInline(paragraph.join(' ').trim()),
      })
    }
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    if (trimmed.startsWith('```')) {
      flush()
      const lang = trimmed.slice(3).trim()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) {
        code.push(lines[i])
      }
      value.push({
        type: 'code_block',
        ...(lang ? { lang } : {}),
        children: (code.length ? code : ['']).map((text) => ({
          type: 'code_line',
          children: [{ text }],
        })),
      })
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flush()
      value.push({
        type: `h${heading[1].length}`,
        children: markdownInline(heading[2].trim()),
      })
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush()
      value.push({ type: 'hr', children: [{ text: '' }] })
      continue
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
    const numbered = line.match(/^(\s*)\d+[.)]\s+(.*)$/)
    const item = bullet ?? numbered
    if (item) {
      flush()
      value.push({
        type: 'p',
        listStyleType: bullet ? 'disc' : 'decimal',
        indent: Math.floor(item[1].replace(/\t/g, '  ').length / 2) + 1,
        children: markdownInline(item[2].trim()),
      })
      continue
    }
    if (trimmed.startsWith('>')) {
      flush()
      value.push({
        type: 'blockquote',
        children: markdownInline(trimmed.replace(/^>\s?/, '')),
      })
      continue
    }
    paragraph.push(trimmed)
  }
  flush()
  return value.length ? value : [{ type: 'p', children: [{ text: '' }] }]
}
