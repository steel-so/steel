import { stripsFor } from '../blueprint/references'
import type { ReferenceCapture } from '../types'

/**
 * Where each section is in a capture, and the strips that show it.
 */

export interface SectionRange {
  yStart: number
  yEnd: number
}

/**
 * Vertical range of the draft's sections in its capture. The preview page
 * renders `<main>` with one element per section, so the extractor's `main`
 * block has exactly `expected` children; when the count differs (a section
 * was hidden or merged) the positions cannot be trusted and this returns
 * `null`. Without header and footer the extractor unwraps `main` and the
 * top-level blocks are the sections themselves.
 */
export function draftSectionRanges(
  capture: ReferenceCapture,
  expected: number,
): SectionRange[] | null {
  const blocks = capture.desktop.blocks
  const main = blocks.find((block) => block.tag === 'main')
  const sections = main ? (main.children ?? []) : blocks
  if (sections.length !== expected) return null
  return sections.map((block) => ({
    yStart: block.y,
    yEnd: block.y + block.height,
  }))
}

export interface StripPick {
  images: string[]
  /** Page y (px) where the first picture starts. */
  firstY: number
  /** Page y (px) where the last picture ends. */
  lastY: number
}

/** The strips that cover `range`, with the page y of their first/last edge
 * (strips are consecutive equal-height slices of the page). */
export function pickStrips(
  capture: ReferenceCapture,
  range: { yStart: number; yEnd: number },
  max = 2,
): StripPick {
  const images = stripsFor(capture, range, max)
  const total = capture.desktop.strips.length
  const size = total > 0 ? capture.desktop.height / total : 0
  const index =
    images.length > 0 ? capture.desktop.strips.indexOf(images[0]) : 0
  const first = Math.max(0, index)
  return {
    images,
    firstY: Math.round(first * size),
    lastY: Math.round((first + images.length) * size),
  }
}

/** Short pt-BR sentence that tells the model which part of the pictures is
 * the section. */
export function describeRange(
  pick: StripPick,
  range: { yStart: number; yEnd: number } | null,
  width: number,
): string {
  if (!range) {
    return `As imagens mostram o início da página (${width}px de largura); compare a seção equivalente.`
  }
  return `As imagens cobrem a página de y=${pick.firstY}px a y=${pick.lastY}px (${width}px de largura); a seção ocupa de y=${Math.round(range.yStart)}px a y=${Math.round(range.yEnd)}px (altura ${Math.round(range.yEnd - range.yStart)}px).`
}
