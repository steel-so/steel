import type { CanvasFragment } from '@/src/lib/canvas/types'
import type { CrmEmailSavedBlock } from '@/src/repositories/crm-email-saved-block.repository'
import type {
  CrmEmailTemplateVersion,
  CrmEmailTemplateVersionListItem,
} from '@/src/repositories/crm-email-template-version.repository'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'
import type {
  CrmEmailSavedBlockDTO,
  CrmEmailTemplateVersionDetailDTO,
  CrmEmailTemplateVersionDTO,
} from '@/types/crm-email-editor'

export function toCrmEmailSavedBlockDTO(
  block: CrmEmailSavedBlock,
): CrmEmailSavedBlockDTO {
  return {
    id: block.id,
    workspaceId: block.workspaceId,
    name: block.name,
    category: block.category,
    kind: block.kind === 'section' ? 'section' : 'block',
    fragment: block.fragment as unknown as CanvasFragment,
    nodeCount: block.nodeCount,
    thumbnail: block.thumbnail,
    createdBy: block.createdBy,
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
  }
}

export function toCrmEmailTemplateVersionDTO(
  version: CrmEmailTemplateVersionListItem,
): CrmEmailTemplateVersionDTO {
  return {
    id: version.id,
    templateId: version.templateId,
    reason: version.reason,
    label: version.label,
    subject: version.subject,
    restoredFromId: version.restoredFromId,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
  }
}

export function toCrmEmailTemplateVersionDetailDTO(
  version: CrmEmailTemplateVersion,
): CrmEmailTemplateVersionDetailDTO {
  return {
    ...toCrmEmailTemplateVersionDTO(version),
    document: version.document as unknown as EmailCanvasDocument,
  }
}
