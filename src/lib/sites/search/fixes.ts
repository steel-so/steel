import { getNode, parentOf } from '@/src/lib/canvas/ops'
import type {
  CanvasDocument,
  CanvasFragment,
  CanvasLocation,
} from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  box,
  heading,
  named,
  section,
  spec,
  text,
  toFragment,
} from '@/src/lib/canvas-site/presets/builder'
import type { SearchQuestionDTO } from '@/src/schemas/site-search.schema'
import { extractPageContent } from './content'

/**
 * Canvas building blocks of the one-click fixes: the "Perguntas que este
 * conteúdo responde" section (an accordion, so the page also publishes a
 * FAQPage) and the quotable summary below the H1. Pure; the editor inserts
 * them through the canvas store (undoable).
 */

/** Layer name of the inserted questions section (found again to replace
 * it on the next insert). */
export const SEARCH_FAQ_SECTION_NAME = 'Perguntas que este conteúdo responde'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Answer text as rich text paragraphs (blank lines split them). */
function paragraphs(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Section with a heading and one accordion item per answered question. */
export function faqSectionFragment(
  questions: SearchQuestionDTO[],
  title = 'Perguntas frequentes',
): CanvasFragment | null {
  const answered = questions.filter(
    (item) => item.question.trim() && item.answer.trim(),
  )
  if (answered.length === 0) return null
  return toFragment(
    named(
      SEARCH_FAQ_SECTION_NAME,
      section({ anchor: 'perguntas' }, [
        box(
          {
            maxWidth: { value: 820, unit: 'px' },
            width: { value: 100, unit: '%' },
          },
          [
            heading('h2', title),
            spec(
              SITE_TYPES.accordion,
              { headingLevel: 'h3' },
              answered.map((item, index) =>
                spec(
                  SITE_TYPES.accordionItem,
                  { title: item.question.trim(), open: index === 0 },
                  [text(paragraphs(item.answer), { color: 'token:muted' })],
                ),
              ),
            ),
          ],
        ),
      ]),
    ),
  )
}

/** Top-level section inserted earlier by `faqSectionFragment`, if any. */
export function findFaqSection(doc: CanvasDocument): string | null {
  const root = getNode(doc, doc.rootId)
  for (const id of root?.children ?? []) {
    if (getNode(doc, id)?.meta?.name === SEARCH_FAQ_SECTION_NAME) return id
  }
  return null
}

/** Where the questions section goes: in place of the previous one, else
 * at the end of the page. */
export function faqSectionLocation(doc: CanvasDocument): {
  at: CanvasLocation
  replaces: string | null
} {
  const root = getNode(doc, doc.rootId)
  const children = root?.children ?? []
  const previous = findFaqSection(doc)
  return {
    at: {
      parentId: doc.rootId,
      index: previous ? children.indexOf(previous) : children.length,
    },
    replaces: previous,
  }
}

/** Lead paragraph with the summary. */
export function summaryFragment(summary: string): CanvasFragment {
  return toFragment(text(paragraphs(summary), { preset: 'lead' }))
}

/** Right after the H1 (same parent), or `null` without one. */
export function summaryLocation(doc: CanvasDocument): CanvasLocation | null {
  const h1 = extractPageContent(doc).headings.find((item) => item.level === 1)
  if (!h1) return null
  // A heading always sits inside a section or container.
  const parentId = parentOf(doc, h1.id) as string
  const siblings = getNode(doc, parentId)?.children as string[]
  return { parentId, index: siblings.indexOf(h1.id) + 1 }
}
