'use client'

/**
 * "Importar PDF" / "Gerar com IA" (owned by the documents AI slice): uploads a
 * PDF/DOCX or takes a prompt, follows the AI build and opens the editor of
 * the new document.
 * CONTRACT STUB: the props are the contract used by the documents list.
 */
export interface DocumentImportDialogProps {
  workspaceId: string
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMode?: 'PDF' | 'PROMPT'
}

export function DocumentImportDialog(_props: DocumentImportDialogProps) {
  return null
}
