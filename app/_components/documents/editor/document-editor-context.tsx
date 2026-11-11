'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { UpdateDocumentBody } from '@/src/hooks/use-documents'
import type { DocumentSettingsDTO } from '@/src/schemas/document.schema'
import type { DocumentDTO } from '@/types/document'

/** Fields of the row the editor changes outside the canvas. */
export type DocumentEditorMeta = Pick<
  UpdateDocumentBody,
  'title' | 'kind' | 'validUntil'
>

/**
 * State of the document editor shared by the top bar, the settings panel
 * (inspector without selection) and the dialogs: the row as last saved,
 * the live settings and theme, and the savers (debounced PATCH; `flush`
 * saves the pending row changes and the canvas now).
 */
export interface DocumentEditorContextValue {
  workspaceId: string
  slug: string
  document: DocumentDTO
  settings: DocumentSettingsDTO
  theme: Record<string, unknown>
  canEdit: boolean
  updateSettings: (patch: Partial<DocumentSettingsDTO>) => void
  updateTheme: (theme: Record<string, unknown>) => void
  updateMeta: (patch: DocumentEditorMeta) => void
  /** Saves pending row changes (the canvas is saved by the shell). */
  flushMeta: () => Promise<boolean>
  /** The server returned a newer row (send, restore). */
  setDocument: (document: DocumentDTO) => void
}

const DocumentEditorContext = createContext<DocumentEditorContextValue | null>(
  null,
)

export function DocumentEditorProvider({
  value,
  children,
}: {
  value: DocumentEditorContextValue
  children: ReactNode
}) {
  return (
    <DocumentEditorContext.Provider value={value}>
      {children}
    </DocumentEditorContext.Provider>
  )
}

export function useDocumentEditor(): DocumentEditorContextValue {
  const value = useContext(DocumentEditorContext)
  if (!value) {
    throw new Error('useDocumentEditor must be used inside the editor')
  }
  return value
}
