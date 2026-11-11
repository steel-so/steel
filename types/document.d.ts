// documents: DTOs of CRM > Documentos (ADR 0063). Dates are ISO strings,
// money is BRL as a number with two decimals.

import type { DocumentSettingsDTO } from '@/src/schemas/document.schema'

export type DocumentKindDTO =
  | 'PROPOSAL'
  | 'CONTRACT'
  | 'QUOTE'
  | 'PRESENTATION'
  | 'TERMS'
  | 'REPORT'
  | 'OTHER'

export type DocumentStatusDTO =
  | 'DRAFT'
  | 'SENT'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'ARCHIVED'

export type DocumentSourceDTO =
  | 'BLANK'
  | 'TEMPLATE'
  | 'DUPLICATE'
  | 'PDF_IMPORT'
  | 'AI_PROMPT'
  | 'LEGACY_PROPOSAL'

export type DocumentJobStatusDTO = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED'

export interface DocumentRefDTO {
  id: string
  name: string
}

export interface DocumentListItemDTO {
  id: string
  workspaceId: string
  title: string
  kind: DocumentKindDTO
  status: DocumentStatusDTO
  isTemplate: boolean
  source: DocumentSourceDTO
  owner: (DocumentRefDTO & { image: string | null }) | null
  company: DocumentRefDTO | null
  person: DocumentRefDTO | null
  opportunity: DocumentRefDTO | null
  lead: DocumentRefDTO | null
  totalValue: number | null
  validUntil: string | null
  sentAt: string | null
  firstViewedAt: string | null
  lastViewedAt: string | null
  acceptedAt: string | null
  /** Reading sessions of the public link (0 for drafts and templates). */
  viewCount: number
  createdAt: string
  updatedAt: string
}

export interface DocumentRecipientDTO {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: 'VIEWER' | 'APPROVER'
  status: 'PENDING' | 'VIEWED' | 'ACCEPTED' | 'DECLINED'
  channel: 'LINK' | 'EMAIL' | 'WHATSAPP'
  /** Personal link `/d/<token>` (absolute). */
  url: string
  sentAt: string | null
  firstViewedAt: string | null
  lastViewedAt: string | null
  respondedAt: string | null
}

export interface DocumentVersionDTO {
  id: string
  number: number
  sha256: string
  createdAt: string
  createdBy: DocumentRefDTO | null
}

export interface DocumentDTO extends DocumentListItemDTO {
  description: string | null
  /** Canvas document (catalog `document`). */
  content: Record<string, unknown>
  theme: Record<string, unknown>
  settings: DocumentSettingsDTO
  templateId: string | null
  currentVersion: DocumentVersionDTO | null
  /** The draft differs from the current version (needs "Atualizar versão"). */
  hasUnsentChanges: boolean
  publicToken: string
  /** Generic link `/d/<publicToken>` (absolute). */
  publicUrl: string
  linkEnabled: boolean
  acceptedByName: string | null
  acceptedByEmail: string | null
  declinedAt: string | null
  declineReason: string | null
  expiredAt: string | null
  paidAt: string | null
  recipients: DocumentRecipientDTO[]
}

export interface DocumentEventDTO {
  id: string
  type: string
  recipient: DocumentRefDTO | null
  actor: DocumentRefDTO | null
  data: Record<string, unknown>
  createdAt: string
}

export interface DocumentResponseDTO {
  id: string
  action: 'ACCEPT' | 'DECLINE' | 'SUBMIT'
  name: string | null
  email: string | null
  recipientId: string | null
  versionNumber: number
  fields: Record<string, unknown>
  selection: Record<string, { selected: boolean; quantity: number }>
  totalValue: number | null
  reason: string | null
  createdAt: string
}

export interface DocumentAnalyticsDTO {
  totals: {
    sessions: number
    uniqueVisitors: number
    totalActiveMs: number
    avgActiveMs: number
    avgScrollPct: number
    /** Share of sessions that reached the end (0–1). */
    completionRate: number
    revisits: number
    /** New visitors on a recipient's personal link. */
    forwards: number
  }
  sections: Array<{
    id: string
    name: string
    index: number
    totalActiveMs: number
    avgActiveMs: number
    /** Sessions that saw the section. */
    readers: number
    /** readers / sessions (0–1): where readers drop off. */
    reachRate: number
  }>
  devices: Record<'desktop' | 'tablet' | 'mobile' | 'unknown', number>
  readers: Array<{
    recipientId: string | null
    name: string | null
    visitorId: string
    sessions: number
    activeMs: number
    device: string | null
    lastSeenAt: string
  }>
  daily: Array<{ date: string; sessions: number; activeMs: number }>
}

export interface DocumentExportDTO {
  id: string
  status: DocumentJobStatusDTO
  versionNumber: number | null
  sizeBytes: number | null
  pageCount: number | null
  error: string | null
  /** Short-lived URL while READY. */
  downloadUrl: string | null
  createdAt: string
  finishedAt: string | null
}

export interface DocumentImportDTO {
  id: string
  mode: 'PDF' | 'DOCX' | 'PROMPT'
  status: DocumentJobStatusDTO
  kind: DocumentKindDTO
  fileName: string | null
  progress: { step?: string; message?: string; pct?: number }
  documentId: string | null
  error: string | null
  costUsd: number | null
  createdAt: string
  finishedAt: string | null
}

/** What the public link renders (`/d/<token>`). */
export interface DocumentPublicDTO {
  token: string
  document: {
    id: string
    title: string
    kind: DocumentKindDTO
    status: DocumentStatusDTO
    validUntil: string | null
    acceptedAt: string | null
    acceptedByName: string | null
    declinedAt: string | null
    settings: DocumentSettingsDTO
    theme: Record<string, unknown>
  }
  version: { id: string; number: number; content: Record<string, unknown> }
  recipient: {
    id: string
    name: string
    role: 'VIEWER' | 'APPROVER'
    status: 'PENDING' | 'VIEWED' | 'ACCEPTED' | 'DECLINED'
  } | null
  variables: Record<string, string>
  canAccept: boolean
  canDownload: boolean
  paymentEnabled: boolean
  brand: { name: string; logoUrl: string | null }
}
