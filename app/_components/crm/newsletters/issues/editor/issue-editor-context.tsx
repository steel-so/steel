'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type {
  CrmNewsletterIssueDTO,
  CrmNewsletterIssueStatusValue,
  UpdateCrmNewsletterIssueDTO,
} from '@/src/schemas/crm-newsletter-issue.schema'

/** What the issue editor's own chrome (envelope, test, send) needs. */
export interface IssueEditorContext {
  workspaceId: string
  slug: string
  newsletterId: string
  issueId: string
  /** Address of the web version (`/n/<ws>/<newsletter>/<slug>`). */
  initialSlug: string
  status: CrmNewsletterIssueStatusValue
  scheduledAt: string | null
  /** False while the From domain is not verified: sending is blocked. */
  senderVerified: boolean
  save: (input: UpdateCrmNewsletterIssueDTO) => Promise<CrmNewsletterIssueDTO>
}

const Context = createContext<IssueEditorContext | null>(null)

export function IssueEditorProvider({
  value,
  children,
}: {
  value: IssueEditorContext
  children: ReactNode
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useIssueEditor(): IssueEditorContext {
  const value = useContext(Context)
  if (!value) throw new Error('useIssueEditor outside IssueEditorProvider')
  return value
}
