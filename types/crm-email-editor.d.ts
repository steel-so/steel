import type { CanvasFragment } from '@/src/lib/canvas/types'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'
import type { CrmEmailTemplateDTO } from './crm-email-marketing'

/** E-mail editor E2/E3 DTOs: saved blocks, template versions, AI. */

export interface CrmEmailSavedBlockDTO {
  id: string
  workspaceId: string
  name: string
  category: string
  /** What the fragment's root is. */
  kind: 'section' | 'block'
  /** Steel Canvas fragment (validated by the e-mail catalog). */
  fragment: CanvasFragment
  nodeCount: number
  thumbnail: string | null
  createdBy: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export type CrmEmailTemplateVersionReasonDTO =
  | 'SAVE'
  | 'TEST_SEND'
  | 'CAMPAIGN'
  | 'RESTORE'

export interface CrmEmailTemplateVersionDTO {
  id: string
  templateId: string
  reason: CrmEmailTemplateVersionReasonDTO
  label: string | null
  subject: string
  restoredFromId: string | null
  createdBy: { id: string; name: string } | null
  createdAt: string
}

export interface CrmEmailTemplateVersionDetailDTO
  extends CrmEmailTemplateVersionDTO {
  document: EmailCanvasDocument
}

export interface CrmEmailTemplateRestoreDTO {
  template: CrmEmailTemplateDTO
  version: CrmEmailTemplateVersionDTO
}

export interface CrmEmailAiRewriteResultDTO {
  /** Ready for the field (sanitized HTML for rich text). */
  value: string
}

export interface CrmEmailAiSectionResultDTO {
  /** Short note from the AI about what it built. */
  reply: string
  /** Validated section fragment, ready to insert (fresh ids). */
  fragment: CanvasFragment
}

export interface CrmEmailContactListsDTO {
  listIds: string[]
}
