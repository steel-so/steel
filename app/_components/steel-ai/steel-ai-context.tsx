'use client'

import { createContext, type ReactNode, useContext } from 'react'

export interface SteelAiWorkspace {
  workspaceId: string
  slug: string
  /** First name of the signed-in user, for the greeting. */
  firstName: string
  /** OWNER/ADMIN: may save chat turns as eval cases (ADR 0039). */
  isAdmin?: boolean
}

const SteelAiContext = createContext<SteelAiWorkspace | null>(null)

export function SteelAiProvider({
  value,
  children,
}: {
  value: SteelAiWorkspace
  children: ReactNode
}) {
  return (
    <SteelAiContext.Provider value={value}>{children}</SteelAiContext.Provider>
  )
}

export function useSteelAiWorkspace(): SteelAiWorkspace {
  const value = useContext(SteelAiContext)
  if (!value) throw new Error('useSteelAiWorkspace outside SteelAiProvider')
  return value
}

/** Like `useSteelAiWorkspace`, but `null` outside the provider. */
export function useOptionalSteelAiWorkspace(): SteelAiWorkspace | null {
  return useContext(SteelAiContext)
}
