'use client'

import type { DocumentPublicDTO } from '@/types/document'

/**
 * Client side of the public link `/d/<token>` (owned by the documents UI
 * slice): runtime provider (accept, decline, fields, pricing selection,
 * download), the tracker and `DocumentView`.
 * CONTRACT STUB: the page (`app/(public)/d/[token]/page.tsx`) renders it.
 */
export interface DocumentViewerProps {
  data: DocumentPublicDTO
}

export function DocumentViewer(_props: DocumentViewerProps) {
  return null
}
