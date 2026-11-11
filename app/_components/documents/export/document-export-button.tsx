'use client'

/**
 * "Exportar PDF" (owned by the documents PDF slice): asks the worker for a
 * PDF, waits for it and downloads it.
 * CONTRACT STUB: the props are the contract used by the document pages.
 */
export interface DocumentExportButtonProps {
  workspaceId: string
  documentId: string
  /** Without a sent version the draft is exported. */
  hasVersion: boolean
  variant?: 'default' | 'outline' | 'ghost'
}

export function DocumentExportButton(_props: DocumentExportButtonProps) {
  return null
}
