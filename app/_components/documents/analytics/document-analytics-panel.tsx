'use client'

/**
 * Reading analytics of a document (owned by the documents analytics slice):
 * total and per-section time, readers, revisits, devices, drop-off.
 * CONTRACT STUB: the props are the contract used by the document page.
 */
export interface DocumentAnalyticsPanelProps {
  workspaceId: string
  documentId: string
  /** Templates show the aggregate of the documents created from them. */
  isTemplate?: boolean
}

export function DocumentAnalyticsPanel(_props: DocumentAnalyticsPanelProps) {
  return null
}
