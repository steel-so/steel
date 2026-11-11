import type { DocumentKindDTO } from '@/src/schemas/document.schema'
import type { OutlineToDocumentResult } from './outline'

/**
 * Built-in starters of the "Novo documento" gallery (proposal, contract,
 * quote, presentation, terms, report...).
 * CONTRACT STUB (ADR 0063): the documents catalog slice fills the list.
 */
export interface DocumentStarterMeta {
  id: string
  title: string
  description: string
  kind: DocumentKindDTO
  /** Preview image under `public/`, optional. */
  thumbnail?: string
}

export const DOCUMENT_STARTERS: DocumentStarterMeta[] = []

/** Content + theme of a starter, or null when the id is unknown. */
export function getDocumentStarter(
  _id: string,
): (OutlineToDocumentResult & { meta: DocumentStarterMeta }) | null {
  return null
}
