import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { DocumentRenderContext } from './context'

/**
 * React renderer of a document outside the editor (public link). Functional
 * elements read `useDocumentRuntime()`; sections carry the tracker
 * attributes (`DOC_SECTION_ATTR`...).
 * CONTRACT STUB (ADR 0063): the documents catalog slice implements it.
 */
export interface DocumentViewProps {
  content: CanvasDocument
  theme: Record<string, unknown>
  context: DocumentRenderContext
}

export function DocumentView(_props: DocumentViewProps) {
  return null
}
