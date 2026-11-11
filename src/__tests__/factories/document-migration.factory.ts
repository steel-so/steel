import { createId } from '@paralleldrive/cuid2'
import type { Document, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { CrmDocumentSummaryDTO } from '@/types/crm-document-summary'

/** A `documents` row (ADR 0063) for unit tests: a PROPOSAL draft. */
export function createFakeDocument(overrides?: Partial<Document>): Document {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    kind: 'PROPOSAL',
    status: 'DRAFT',
    title: 'Proposta comercial',
    description: null,
    isTemplate: false,
    templateId: null,
    source: 'BLANK',
    content: { version: 1, rootId: 'root', nodes: {} },
    theme: {},
    settings: {},
    currentVersionId: null,
    publicToken: createId(),
    linkEnabled: true,
    validUntil: null,
    totalValue: null,
    sentAt: null,
    firstViewedAt: null,
    lastViewedAt: null,
    acceptedAt: null,
    acceptedByName: null,
    acceptedByEmail: null,
    declinedAt: null,
    declineReason: null,
    expiredAt: null,
    paidAt: null,
    companyId: null,
    personId: null,
    opportunityId: null,
    leadId: null,
    ownerId: createId(),
    createdById: createId(),
    updatedById: null,
    legacyProposalId: null,
    legacyTemplateId: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeCrmDocumentSummaryDTO(
  overrides?: Partial<CrmDocumentSummaryDTO>,
): CrmDocumentSummaryDTO {
  const now = new Date().toISOString()
  const id = overrides?.id ?? createId()
  return {
    id,
    workspaceId: createId(),
    kind: 'PROPOSAL',
    status: 'DRAFT',
    title: 'Proposta comercial',
    isTemplate: false,
    templateId: null,
    totalValue: null,
    validUntil: null,
    sentAt: null,
    acceptedAt: null,
    acceptedByName: null,
    companyId: null,
    personId: null,
    opportunityId: null,
    leadId: null,
    ownerId: createId(),
    path: `/crm/documents/${id}`,
    publicPath: '/d/token',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** Inserts a document of the workspace (integration tests). */
export async function seedDocument(
  workspaceId: string,
  ownerId: string,
  overrides?: Partial<Prisma.DocumentUncheckedCreateInput>,
): Promise<Document> {
  return prisma.document.create({
    data: {
      workspaceId,
      ownerId,
      createdById: ownerId,
      kind: 'PROPOSAL',
      title: 'Proposta seed',
      content: { version: 1, rootId: 'root', nodes: {} },
      publicToken: createId(),
      ...overrides,
    },
  })
}
