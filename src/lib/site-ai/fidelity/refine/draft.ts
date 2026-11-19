import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { Result } from '@/src/lib/result'
import type { ReferenceCapture } from '../types'
import type { PreviewDraft } from './preview-store'
import { draftSectionRanges } from './ranges'
import type { RefineDraft } from './refine'
import { swapSection } from './replace'

/**
 * The draft site as the refinement sees it: the page documents (mutated in
 * place as sections are swapped), the header/footer and the theme, rendered
 * through an injected renderer.
 */

export interface DocumentDraftInput {
  theme: unknown
  header: CanvasDocument | null
  footer: CanvasDocument | null
  pages: Array<{ title: string; document: CanvasDocument }>
  render: (
    draft: PreviewDraft,
    pageIndex: number,
  ) => Promise<Result<ReferenceCapture>>
  /** Runs on a document that just received a section (e.g. points the
   * contact form at the CRM form). */
  prepare?: (document: CanvasDocument) => void
}

export interface DocumentDraft extends RefineDraft {
  /** Number of top-level sections of a page right now. */
  sectionCount(pageIndex: number): number
  /** Current documents, in page order. */
  documents(): CanvasDocument[]
}

export function createDocumentDraft(input: DocumentDraftInput): DocumentDraft {
  const pages = input.pages.map((page) => ({ ...page }))
  const sectionCount = (pageIndex: number) =>
    pages[pageIndex]?.document.nodes[pages[pageIndex].document.rootId]?.children
      ?.length ?? 0
  return {
    sectionCount,
    documents: () => pages.map((page) => page.document),
    render: (pageIndex) =>
      input.render(
        {
          theme: input.theme,
          header: input.header,
          footer: input.footer,
          pages: pages.map((page) => ({
            title: page.title,
            document: page.document,
          })),
        },
        pageIndex,
      ),
    ranges: (capture, pageIndex) =>
      draftSectionRanges(capture, sectionCount(pageIndex)),
    swap: (pageIndex, sectionIndex, spec) => {
      const page = pages[pageIndex]
      if (!page) return { ok: false }
      const swapped = swapSection(page.document, sectionIndex, spec)
      if (!swapped.ok) return { ok: false }
      input.prepare?.(swapped.doc)
      page.document = swapped.doc
      return {
        ok: true,
        undo: () => {
          page.document = swapped.undo(page.document)
        },
      }
    },
  }
}
