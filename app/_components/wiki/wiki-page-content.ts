import type { Value } from 'platejs'

/**
 * Pure readers over a wiki page's Plate value — the side panel's numbers,
 * outline and resources come from here, so they are testable without an
 * editor and stay in sync with whatever the editor holds.
 */

interface ContentNode {
  type?: string
  id?: string
  text?: string
  children?: ContentNode[]
  [key: string]: unknown
}

const WORDS_PER_MINUTE = 200
const HEADING_LEVEL: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
}
const MEDIA_TYPES = new Set(['img', 'file', 'video', 'audio'])

/** Plain text of a node (and its descendants), like Slate's `Node.string`. */
export function nodeText(node: ContentNode): string {
  if (typeof node.text === 'string') return node.text
  return (node.children ?? []).map(nodeText).join('')
}

function walk(
  nodes: readonly ContentNode[],
  visit: (node: ContentNode) => void,
) {
  for (const node of nodes) {
    visit(node)
    if (node.children) walk(node.children, visit)
  }
}

/** Text of each block on its own, so words never glue across blocks. */
function blockTexts(value: Value): string[] {
  const texts: string[] = []
  walk(value as ContentNode[], (node) => {
    // Slate keeps text leaves only in blocks that hold inline content;
    // containers (tables, columns, quotes of blocks) hold elements only.
    if (node.children?.some((child) => typeof child.text === 'string')) {
      texts.push(nodeText(node))
    }
  })
  return texts
}

export interface WikiPageStats {
  words: number
  characters: number
  paragraphs: number
  readingMinutes: number
}

export function pageStats(value: Value): WikiPageStats {
  const texts = blockTexts(value)
  const words = texts.reduce(
    (total, text) =>
      total + (text.trim() ? text.trim().split(/\s+/).length : 0),
    0,
  )
  const characters = texts.reduce((total, text) => total + text.length, 0)
  let paragraphs = 0
  walk(value as ContentNode[], (node) => {
    if (node.type === 'p' && nodeText(node).trim()) paragraphs += 1
  })
  const readingMinutes =
    words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))
  return { words, characters, paragraphs, readingMinutes }
}

export function readingTimeLabel(minutes: number): string {
  return minutes === 0 ? 'Sem texto para ler' : `${minutes} min de leitura`
}

export interface WikiOutlineItem {
  id: string
  level: number
  text: string
}

/** Headings in document order, for the side panel's "Estrutura" tab. */
export function pageOutline(value: Value): WikiOutlineItem[] {
  const items: WikiOutlineItem[] = []
  walk(value as ContentNode[], (node) => {
    const level = node.type ? HEADING_LEVEL[node.type] : undefined
    if (!level || !node.id) return
    const text = nodeText(node).trim()
    if (text) items.push({ id: node.id, level, text })
  })
  return items
}

export type WikiResourceKind = 'image' | 'file' | 'video' | 'audio'

export interface WikiResource {
  id: string
  kind: WikiResourceKind
  url: string
  name: string
}

const RESOURCE_KIND: Record<string, WikiResourceKind> = {
  img: 'image',
  file: 'file',
  video: 'video',
  audio: 'audio',
}

function fileNameFromUrl(url: string): string {
  const last = url.split('?')[0]?.split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** Images, files and media on the page, for the "Recursos" tab. */
export function pageResources(value: Value): WikiResource[] {
  const resources: WikiResource[] = []
  walk(value as ContentNode[], (node) => {
    if (!node.type || !MEDIA_TYPES.has(node.type) || !node.id) return
    const url = typeof node.url === 'string' ? node.url : ''
    if (!url) return
    const name =
      (typeof node.name === 'string' && node.name) ||
      nodeText(node).trim() ||
      fileNameFromUrl(url) ||
      'Arquivo'
    resources.push({
      id: node.id,
      kind: RESOURCE_KIND[node.type] as WikiResourceKind,
      url,
      name,
    })
  })
  return resources
}

/** Selector of a rendered block by its Plate id. */
export function blockSelector(id: string) {
  return `[data-block-id="${id.replace(/["\\]/g, '\\$&')}"]`
}

/** Scrolls the page to a block by its Plate id and flashes it briefly. */
export function scrollToBlock(id: string) {
  const element = document.querySelector<HTMLElement>(blockSelector(id))
  if (!element) return false
  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}
