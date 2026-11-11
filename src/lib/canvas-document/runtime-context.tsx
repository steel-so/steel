'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { DocumentRuntime } from './context'

const DocumentRuntimeContext = createContext<DocumentRuntime | null>(null)

/** Provided by the public link page; absent in the editor and in print. */
export function DocumentRuntimeProvider({
  runtime,
  children,
}: {
  runtime: DocumentRuntime
  children: ReactNode
}) {
  return (
    <DocumentRuntimeContext.Provider value={runtime}>
      {children}
    </DocumentRuntimeContext.Provider>
  )
}

/** Runtime of the public link, or `null` in editor and print modes. */
export function useDocumentRuntime(): DocumentRuntime | null {
  return useContext(DocumentRuntimeContext)
}
