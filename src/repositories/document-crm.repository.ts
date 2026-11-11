import type {
  Document,
  DocumentKind,
  DocumentSource,
  DocumentStatus,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Documents as the rest of the CRM sees them (ADR 0063): the proposal the
 * lead pipeline, the opportunity, renewals and Steel AI create, and the
 * reads the deal room and the lead stage gate need. CRM > Documentos itself
 * lives in the documents repositories; this one only covers those paths.
 */

export interface CrmDocumentCreateData {
  workspaceId: string
  kind: DocumentKind
  title: string
  description?: string | null
  templateId: string | null
  source: DocumentSource
  content: Prisma.InputJsonValue
  theme: Prisma.InputJsonValue
  settings: Prisma.InputJsonValue
  companyId: string | null
  personId: string | null
  opportunityId: string | null
  leadId: string | null
  ownerId: string
  createdById: string
  validUntil: Date | null
  publicToken: string
  totalValue: number | null
}

export interface CrmDocumentListFilter {
  kind?: DocumentKind
  status?: DocumentStatus
  isTemplate?: boolean
  leadId?: string
  opportunityId?: string
  take: number
}

export const DocumentCrmRepository = {
  async create(data: CrmDocumentCreateData): Promise<Result<Document>> {
    try {
      const doc = await prisma.document.create({ data })
      return ok(doc)
    } catch (error) {
      return err(dbError('Failed to create CRM document', error))
    }
  },

  /** Live (not deleted) document of the workspace, template or not. */
  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<Document | null>> {
    try {
      const doc = await prisma.document.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      return ok(doc)
    } catch (error) {
      return err(dbError('Failed to find CRM document', error))
    }
  },

  /** Newest live proposal of a lead (the lead pipeline's "Proposta"). */
  async latestProposalByLead(
    leadId: string,
    workspaceId: string,
  ): Promise<Result<Document | null>> {
    try {
      const doc = await prisma.document.findFirst({
        where: {
          leadId,
          workspaceId,
          kind: 'PROPOSAL',
          isTemplate: false,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      })
      return ok(doc)
    } catch (error) {
      return err(dbError('Failed to find lead proposal document', error))
    }
  },

  async list(
    workspaceId: string,
    filter: CrmDocumentListFilter,
  ): Promise<Result<Document[]>> {
    try {
      const docs = await prisma.document.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          isTemplate: filter.isTemplate ?? false,
          ...(filter.kind ? { kind: filter.kind } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.leadId ? { leadId: filter.leadId } : {}),
          ...(filter.opportunityId
            ? { opportunityId: filter.opportunityId }
            : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: filter.take,
      })
      return ok(docs)
    } catch (error) {
      return err(dbError('Failed to list CRM documents', error))
    }
  },
}
