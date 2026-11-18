import type { CaptureBlock } from '../types'
import { parseColor } from './color'

/** Raw block as returned by the in-page extractor (colors not normalized). */
export interface RawBlock {
  y: number
  height: number
  tag: string
  style: Record<string, string>
  text: string
  children?: RawBlock[]
}

const COLOR_PROPS = ['color', 'background-color'] as const
const DEFAULTS: Record<string, string[]> = {
  'border-radius': ['0px'],
  padding: ['0px'],
  gap: ['normal', '0px', 'normal normal', '0px 0px'],
  'max-width': ['none'],
  'box-shadow': ['none'],
  'grid-template-columns': ['none'],
  'text-align': ['start'],
  display: ['inline'],
}
const MAX_VALUE_CHARS = 120
export const MAX_TEXT_CHARS = 120

export function shortText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_TEXT_CHARS
    ? `${collapsed.slice(0, MAX_TEXT_CHARS - 1)}…`
    : collapsed
}

/** Colors to #rrggbb, defaults and empty values dropped, values clamped. */
export function cleanStyle(
  raw: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    const text = value.trim()
    if (!text) continue
    if ((COLOR_PROPS as readonly string[]).includes(key)) {
      const color = parseColor(text)
      if (!color) continue
      if (key === 'background-color' && color.hex === 'transparent') continue
      out[key] = color.hex
      if (color.alpha < 1 && color.hex !== 'transparent') {
        out[`${key}-alpha`] = String(color.alpha)
      }
      continue
    }
    if (DEFAULTS[key]?.includes(text)) continue
    out[key] =
      text.length > MAX_VALUE_CHARS ? text.slice(0, MAX_VALUE_CHARS) : text
  }
  return out
}

export function cleanBlock(raw: RawBlock): CaptureBlock {
  const block: CaptureBlock = {
    y: Math.round(raw.y),
    height: Math.round(raw.height),
    tag: raw.tag.toLowerCase(),
    style: cleanStyle(raw.style),
    text: shortText(raw.text),
  }
  if (raw.children?.length) block.children = raw.children.map(cleanBlock)
  return block
}

/** First family of each stack, generics and empties dropped, de-duplicated. */
export function fontFamiliesFromStacks(
  stacks: ReadonlyArray<readonly [string, number]>,
): string[] {
  const generic = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-sans-serif',
    'ui-serif',
    'ui-monospace',
    '-apple-system',
    'blinkmacsystemfont',
  ])
  const counts = new Map<string, number>()
  for (const [stack, count] of stacks) {
    const first = stack
      .split(',')
      .map((part) => part.trim().replace(/^["']|["']$/g, ''))
      .find((part) => part && !generic.has(part.toLowerCase()))
    if (!first) continue
    counts.set(first, (counts.get(first) ?? 0) + count)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 12)
}
