import type { Document } from '@prisma/client'
import type { CrmDocumentSummaryDTO } from '@/types/crm-document-summary'

const iso = (date: Date | null): string | null => date?.toISOString() ?? null

/** Path of a document page, relative to the workspace (`/${slug}` first). */
export function crmDocumentPath(id: string): string {
  return `/crm/documents/${id}`
}

/** Public link path of a document token (`/d/<token>`). */
export function documentPublicPath(token: string): string {
  return `/d/${token}`
}

export function toCrmDocumentSummaryDTO(row: Document): CrmDocumentSummaryDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind,
    status: row.status,
    title: row.title,
    isTemplate: row.isTemplate,
    templateId: row.templateId,
    totalValue: row.totalValue === null ? null : Number(row.totalValue),
    validUntil: iso(row.validUntil),
    sentAt: iso(row.sentAt),
    acceptedAt: iso(row.acceptedAt),
    acceptedByName: row.acceptedByName,
    companyId: row.companyId,
    personId: row.personId,
    opportunityId: row.opportunityId,
    leadId: row.leadId,
    ownerId: row.ownerId,
    path: crmDocumentPath(row.id),
    publicPath: row.isTemplate ? null : documentPublicPath(row.publicToken),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
