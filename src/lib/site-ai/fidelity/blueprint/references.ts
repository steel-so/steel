import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'
import type { CaptureBlock, ReferenceCapture } from '../types'

/**
 * A reference the analysis and the blueprints look at: a page capture
 * (link) or a picture the user sent. This module turns captures into what
 * goes to the model — the page strips that cover a section, and a compact
 * text view of the DOM blocks with their computed styles.
 *
 * Strips are consecutive, equal-height slices of the desktop page: strip
 * `i` of `n` covers `[i * H / n, (i + 1) * H / n)` px (`H` = page height).
 */

export interface ReferenceSource {
  /** `ref1`, `ref2`… (stable, used in prompts and plans). */
  id: string
  /** Shown to the model and the user: origin + path, or "Imagem 2". */
  label: string
  kind: 'link' | 'image'
  /** Pictures of the whole reference (strips of the capture, or the image). */
  images: string[]
  capture: ReferenceCapture | null
  /** Text summary of a link that was read but not captured. */
  summary: string | null
}

/** Most pictures shown to the analysis of one reference. */
export const MAX_ANALYSIS_IMAGES = 8
/** Most strips shown with one section blueprint. */
export const MAX_SECTION_STRIPS = 2
/** Most characters of DOM description sent per call. */
export const MAX_BLOCKS_CHARS = 14_000
export const MAX_SECTION_BLOCKS_CHARS = 5_000

const STYLE_KEYS_MAX = 14

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function describeBlock(block: CaptureBlock, depth: number): string[] {
  const style = Object.entries(block.style)
    .slice(0, STYLE_KEYS_MAX)
    .map(([key, value]) => `${key}:${clip(value, 40)}`)
    .join('; ')
  const text = block.text ? ` "${clip(block.text, 60)}"` : ''
  const line = `${'  '.repeat(depth)}<${block.tag}> y=${Math.round(block.y)} h=${Math.round(block.height)}${style ? ` {${style}}` : ''}${text}`
  const lines = [line]
  if (depth < 2) {
    for (const child of block.children ?? []) {
      lines.push(...describeBlock(child, depth + 1))
    }
  }
  return lines
}

/** Compact text of the blocks overlapping `[yStart, yEnd]` (whole page when
 * omitted), cut at `maxChars`. */
export function describeBlocks(
  capture: ReferenceCapture,
  range: { yStart?: number | null; yEnd?: number | null } = {},
  maxChars = MAX_BLOCKS_CHARS,
): string {
  const from = range.yStart ?? Number.NEGATIVE_INFINITY
  const to = range.yEnd ?? Number.POSITIVE_INFINITY
  const lines: string[] = []
  for (const block of capture.desktop.blocks) {
    if (block.y + block.height < from || block.y > to) continue
    lines.push(...describeBlock(block, 0))
  }
  return lines.join('\n').slice(0, maxChars)
}

/** The blocks as an untrusted-data block for the prompt (page text and
 * styles come from a third-party site). */
export function blocksPrompt(
  capture: ReferenceCapture,
  range: { yStart?: number | null; yEnd?: number | null } = {},
  maxChars = MAX_BLOCKS_CHARS,
): string[] {
  const body = describeBlocks(capture, range, maxChars)
  if (!body) return []
  return [
    `Blocos do DOM da referência (de cima para baixo; y e h em px na janela de ${capture.desktop.width}px; estilos computados):`,
    wrapUntrusted(body, 'web_inspiration'),
  ]
}

/** Strips that cover `[yStart, yEnd]` (at most `max`), or the first ones
 * when the range is unknown. */
export function stripsFor(
  capture: ReferenceCapture,
  range: { yStart?: number | null; yEnd?: number | null },
  max = MAX_SECTION_STRIPS,
): string[] {
  const strips = capture.desktop.strips
  if (strips.length === 0) return []
  const { yStart, yEnd } = range
  if (
    yStart === null ||
    yStart === undefined ||
    yEnd === null ||
    yEnd === undefined ||
    capture.desktop.height <= 0
  ) {
    return strips.slice(0, max)
  }
  const size = capture.desktop.height / strips.length
  const first = Math.max(0, Math.floor(Math.min(yStart, yEnd) / size))
  const last = Math.min(
    strips.length - 1,
    Math.floor(Math.max(yStart, yEnd) / size),
  )
  const picked: string[] = []
  for (let index = first; index <= last && picked.length < max; index++) {
    picked.push(strips[index])
  }
  return picked.length > 0 ? picked : strips.slice(0, max)
}

/** Builds the sources: links first (captured or not), then the images. */
export function buildReferenceSources(input: {
  links: Array<{
    url: string
    capture: ReferenceCapture | null
    summary: string | null
  }>
  images: string[]
}): ReferenceSource[] {
  const sources: ReferenceSource[] = []
  for (const link of input.links) {
    sources.push({
      id: `ref${sources.length + 1}`,
      label: link.url,
      kind: 'link',
      images: link.capture
        ? link.capture.desktop.strips.slice(0, MAX_ANALYSIS_IMAGES)
        : [],
      capture: link.capture,
      summary: link.summary,
    })
  }
  for (const [index, image] of input.images.entries()) {
    sources.push({
      id: `ref${sources.length + 1}`,
      label: `Imagem ${index + 1}`,
      kind: 'image',
      images: [image],
      capture: null,
      summary: null,
    })
  }
  return sources
}

/** A link with neither capture nor summary has nothing to analyze. */
export function isAnalyzable(source: ReferenceSource): boolean {
  return source.images.length > 0 || source.summary !== null
}
