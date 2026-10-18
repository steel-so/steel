import { createHash } from 'node:crypto'

/**
 * Splits a source's text into the chunks the knowledge index stores. Pure.
 *
 * A chunk holds about `CHUNK_TARGET_CHARS` characters (~350 tokens), cut at
 * a paragraph, line or sentence boundary when there is one, and repeats
 * the last `CHUNK_OVERLAP_CHARS` of the previous chunk so an answer that
 * straddles a cut is still found. A source keeps at most
 * `MAX_CHUNKS_PER_SOURCE` chunks: past that the tail is not indexed, which
 * bounds the embedding cost of one huge page.
 */

export const CHUNK_TARGET_CHARS = 1_400
export const CHUNK_OVERLAP_CHARS = 200
export const MAX_CHUNKS_PER_SOURCE = 40

/** Collapses runs of spaces and blank lines; keeps single line breaks. */
export function normalizeKnowledgeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Best cut in `text` at or before `max`: paragraph > line > sentence > space. */
function cutPoint(text: string, max: number): number {
  if (text.length <= max) return text.length
  const window = text.slice(0, max)
  const floor = Math.floor(max * 0.5)
  for (const separator of ['\n\n', '\n', '. ', '? ', '! ', '; ', ' ']) {
    const at = window.lastIndexOf(separator)
    if (at >= floor) return at + separator.length
  }
  return max
}

export function chunkKnowledgeText(
  raw: string,
  opts: { target?: number; overlap?: number; maxChunks?: number } = {},
): string[] {
  const target = opts.target ?? CHUNK_TARGET_CHARS
  const overlap = Math.min(opts.overlap ?? CHUNK_OVERLAP_CHARS, target / 2)
  const maxChunks = opts.maxChunks ?? MAX_CHUNKS_PER_SOURCE
  const text = normalizeKnowledgeText(raw)
  if (!text) return []

  const chunks: string[] = []
  let start = 0
  while (start < text.length && chunks.length < maxChunks) {
    const rest = text.slice(start)
    const end = cutPoint(rest, target)
    const chunk = rest.slice(0, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= rest.length) break
    // Step back by the overlap, but always move forward, and start the
    // next chunk at a word boundary.
    let next = start + Math.max(1, end - overlap)
    const space = text.indexOf(' ', next)
    if (space !== -1 && space < start + end) next = space + 1
    start = next
  }
  return chunks
}

/** Hash that decides whether a chunk's embedding must be redone. */
export function knowledgeContentHash(title: string, content: string): string {
  return createHash('sha256').update(`${title}\n${content}`).digest('hex')
}

/**
 * Plain text out of any JSON (Plate documents, proposal sections): every
 * string leaf except ids, URLs, colors and other non-prose keys, one per
 * line. Depth and size are bounded.
 */
const NON_PROSE_KEYS = new Set([
  'id',
  'type',
  'url',
  'src',
  'href',
  'image',
  'imageUrl',
  'logo',
  'logoUrl',
  'color',
  'backgroundColor',
  'icon',
  'align',
  'width',
  'height',
  'key',
  'token',
  'mimeType',
])

export function jsonToKnowledgeText(value: unknown, maxChars = 60_000): string {
  const out: string[] = []
  let size = 0
  const visit = (node: unknown, depth: number) => {
    if (size >= maxChars || depth > 40 || node === null) return
    if (typeof node === 'string') {
      const text = node.trim()
      if (!text || /^(https?:|data:|#[0-9a-f]{3,8}$)/i.test(text)) return
      out.push(text)
      size += text.length
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1)
      return
    }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (NON_PROSE_KEYS.has(key)) continue
        visit(child, depth + 1)
      }
    }
  }
  visit(value, 0)
  return out.join('\n').slice(0, maxChars)
}
