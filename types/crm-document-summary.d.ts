// documents docs-migration: compact view of a CRM document (ADR 0063) used
// where the CRM creates or links a proposal outside CRM > Documentos (lead
// pipeline, deal room, Steel AI). Dates are ISO strings, money BRL.

import type { DocumentKindDTO, DocumentStatusDTO } from './document'

export interface CrmDocumentSummaryDTO {
  id: string
  workspaceId: string
  kind: DocumentKindDTO
  status: DocumentStatusDTO
  title: string
  isTemplate: boolean
  templateId: string | null
  totalValue: number | null
  validUntil: string | null
  sentAt: string | null
  acceptedAt: string | null
  acceptedByName: string | null
  companyId: string | null
  personId: string | null
  opportunityId: string | null
  leadId: string | null
  ownerId: string
  /** Page of the document inside the workspace (`/crm/documents/<id>`). */
  path: string
  /** Public link path (`/d/<token>`); null for templates. */
  publicPath: string | null
  createdAt: string
  updatedAt: string
}
