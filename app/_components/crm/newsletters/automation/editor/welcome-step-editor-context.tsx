'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type {
  CrmNewsletterDelayUnitValue,
  CrmNewsletterWelcomeStepDTO,
  UpdateCrmNewsletterWelcomeStepDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'

/** What the welcome step editor's own chrome (envelope) needs. */
export interface WelcomeStepEditorContext {
  workspaceSlug: string
  newsletterId: string
  stepId: string
  position: number
  initialDelay: { value: number; unit: CrmNewsletterDelayUnitValue }
  save: (
    input: UpdateCrmNewsletterWelcomeStepDTO,
  ) => Promise<CrmNewsletterWelcomeStepDTO>
}

const Context = createContext<WelcomeStepEditorContext | null>(null)

export function WelcomeStepEditorProvider({
  value,
  children,
}: {
  value: WelcomeStepEditorContext
  children: ReactNode
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useWelcomeStepEditor(): WelcomeStepEditorContext {
  const value = useContext(Context)
  if (!value) {
    throw new Error('useWelcomeStepEditor outside WelcomeStepEditorProvider')
  }
  return value
}
