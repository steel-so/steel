import type {
  CrmProposal,
  CrmProposalSection,
  CrmProposalSignature,
  CrmProposalTemplate,
  CrmProposalTemplateSection,
  CrmProposalView,
  DocumentEventType,
  DocumentStatus,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

/**
 * Data access of the legacy proposal migration (ADR 0063): reads the old
 * `crm_proposal*` tables and writes `documents` (+ version, response,
 * sessions, events) idempotently, keyed by `legacyProposalId` /
 * `legacyTemplateId`. No business rules here.
 */

export type LegacyTemplateRow = CrmProposalTemplate & {
  sections: CrmProposalTemplateSection[]
}

export type LegacyProposalRow = CrmProposal & {
  sections: CrmProposalSection[]
  views: CrmProposalView[]
  signatures: CrmProposalSignature[]
  template: { logoUrl: string | null } | null
}

/** Columns of a migrated document (content/theme as built by the converter). */
export interface LegacyDocumentData {
  workspaceId: string
  status: DocumentStatus
  title: string
  description: string | null
  isTemplate: boolean
  templateId: string | null
  content: Prisma.InputJsonValue
  theme: Prisma.InputJsonValue
  settings: Prisma.InputJsonValue
  publicToken: string
  validUntil: Date | null
  totalValue: number | null
  sentAt: Date | null
  firstViewedAt: Date | null
  lastViewedAt: Date | null
  acceptedAt: Date | null
  acceptedByName: string | null
  expiredAt: Date | null
  companyId: string | null
  personId: string | null
  opportunityId: string | null
  leadId: string | null
  ownerId: string
  createdById: string
  updatedById: string | null
  legacyProposalId: string | null
  legacyTemplateId: string | null
  position: number
  createdAt: Date
}

export interface LegacySessionData {
  sessionKey: string
  visitorId: string
  ipHash: string
  referrer: string | null
  startedAt: Date
  lastSeenAt: Date
  activeMs: number
  maxScrollPct: number
  reachedEnd: boolean
}

export interface LegacyEventData {
  type: DocumentEventType
  data: Prisma.InputJsonValue
  createdAt: Date
}

export interface LegacyProposalWrite {
  document: LegacyDocumentData
  /** Version 1 for proposals that left the draft. */
  version: { sha256: string; createdAt: Date } | null
  acceptance: { name: string; createdAt: Date } | null
  sessions: LegacySessionData[]
  events: LegacyEventData[]
}

const LEGACY_IP_HASH = 'legacy'

function documentCreateData(
  data: LegacyDocumentData,
): Prisma.DocumentUncheckedCreateInput {
  return {
    ...data,
    kind: 'PROPOSAL',
    source: 'LEGACY_PROPOSAL',
    linkEnabled: true,
  }
}

async function migratedIds(
  workspaceId: string,
  field: 'legacyProposalId' | 'legacyTemplateId',
): Promise<string[]> {
  const migrated =
    field === 'legacyProposalId'
      ? { legacyProposalId: { not: null } }
      : { legacyTemplateId: { not: null } }
  const rows = await prisma.document.findMany({
    where: { workspaceId, ...migrated },
    select: { legacyProposalId: true, legacyTemplateId: true },
  })
  return rows.flatMap((row) => {
    const id = row[field]
    return id ? [id] : []
  })
}

export const DocumentLegacyRepository = {
  /** Workspaces that still have live legacy templates or proposals. */
  async legacyWorkspaceIds(): Promise<Result<string[]>> {
    try {
      const [templates, proposals] = await Promise.all([
        prisma.crmProposalTemplate.findMany({
          where: { deletedAt: null },
          select: { workspaceId: true },
          distinct: ['workspaceId'],
        }),
        prisma.crmProposal.findMany({
          where: { deletedAt: null },
          select: { workspaceId: true },
          distinct: ['workspaceId'],
        }),
      ])
      const rows = [...templates, ...proposals]
      const ids = new Set(rows.map((row) => row.workspaceId))
      return ok([...ids].sort())
    } catch (error) {
      return err(dbError('Failed to list legacy proposal workspaces', error))
    }
  },

  /** Live templates of the workspace not migrated yet, oldest first. */
  async pendingTemplateIds(
    workspaceId: string,
    take: number,
  ): Promise<Result<string[]>> {
    try {
      const done = await migratedIds(workspaceId, 'legacyTemplateId')
      const rows = await prisma.crmProposalTemplate.findMany({
        where: { workspaceId, deletedAt: null, id: { notIn: done } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take,
      })
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(dbError('Failed to list pending legacy templates', error))
    }
  },

  /** Live proposals of the workspace not migrated yet, oldest first. */
  async pendingProposalIds(
    workspaceId: string,
    take: number,
  ): Promise<Result<string[]>> {
    try {
      const done = await migratedIds(workspaceId, 'legacyProposalId')
      const rows = await prisma.crmProposal.findMany({
        where: { workspaceId, deletedAt: null, id: { notIn: done } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take,
      })
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(dbError('Failed to list pending legacy proposals', error))
    }
  },

  async findTemplate(id: string): Promise<Result<LegacyTemplateRow | null>> {
    try {
      const template = await prisma.crmProposalTemplate.findFirst({
        where: { id, deletedAt: null },
        include: { sections: { orderBy: { order: 'asc' } } },
      })
      return ok(template)
    } catch (error) {
      return err(dbError('Failed to read legacy proposal template', error))
    }
  },

  async findProposal(id: string): Promise<Result<LegacyProposalRow | null>> {
    try {
      const proposal = await prisma.crmProposal.findFirst({
        where: { id, deletedAt: null },
        include: {
          sections: { orderBy: { order: 'asc' } },
          views: { orderBy: { createdAt: 'asc' } },
          signatures: { orderBy: { signedAt: 'asc' } },
          template: { select: { logoUrl: true } },
        },
      })
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to read legacy proposal', error))
    }
  },

  /** Live legacy proposal of a workspace (`/crm/proposals/<id>`). */
  async findProposalRef(
    id: string,
    workspaceId: string,
  ): Promise<Result<{ id: string } | null>> {
    try {
      const proposal = await prisma.crmProposal.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true },
      })
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to find legacy proposal', error))
    }
  },

  /** Live legacy proposal behind an old public link `/p/<token>`. */
  async findProposalRefByShareToken(
    shareToken: string,
  ): Promise<Result<{ id: string } | null>> {
    try {
      const proposal = await prisma.crmProposal.findFirst({
        where: { shareToken, deletedAt: null },
        select: { id: true },
      })
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to find legacy proposal by token', error))
    }
  },

  async documentIdByLegacyProposal(
    proposalId: string,
  ): Promise<Result<string | null>> {
    try {
      const doc = await prisma.document.findUnique({
        where: { legacyProposalId: proposalId },
        select: { id: true },
      })
      return ok(doc?.id ?? null)
    } catch (error) {
      return err(dbError('Failed to find migrated proposal document', error))
    }
  },

  async documentIdByLegacyTemplate(
    templateId: string,
  ): Promise<Result<string | null>> {
    try {
      const doc = await prisma.document.findUnique({
        where: { legacyTemplateId: templateId },
        select: { id: true },
      })
      return ok(doc?.id ?? null)
    } catch (error) {
      return err(dbError('Failed to find migrated template document', error))
    }
  },

  async documentIdByPublicToken(token: string): Promise<Result<string | null>> {
    try {
      const doc = await prisma.document.findUnique({
        where: { publicToken: token },
        select: { id: true },
      })
      return ok(doc?.id ?? null)
    } catch (error) {
      return err(dbError('Failed to find document by public token', error))
    }
  },

  /**
   * Creates the template document. `null` when another run already
   * migrated it (unique `legacyTemplateId`): the caller re-reads the id.
   */
  async createTemplateDocument(
    data: LegacyDocumentData,
  ): Promise<Result<{ id: string } | null>> {
    try {
      const doc = await prisma.document.create({
        data: documentCreateData(data),
        select: { id: true },
      })
      return ok(doc)
    } catch (error) {
      if (isUniqueViolation(error)) return ok(null)
      return err(dbError('Failed to create migrated template document', error))
    }
  },

  /**
   * Creates the proposal document with its history in one transaction and
   * points the lead presentations and deal rooms of the proposal at it.
   * `null` when another run already migrated it.
   */
  async createProposalDocument(
    write: LegacyProposalWrite,
  ): Promise<Result<{ id: string } | null>> {
    const proposalId = write.document.legacyProposalId
    try {
      const doc = await prisma.$transaction(async (tx) => {
        const created = await tx.document.create({
          data: documentCreateData(write.document),
          select: { id: true, workspaceId: true },
        })
        const base = {
          documentId: created.id,
          workspaceId: created.workspaceId,
        }

        let version: { id: string; sha256: string } | null = null
        if (write.version) {
          version = await tx.documentVersion.create({
            data: {
              ...base,
              number: 1,
              content: write.document.content,
              theme: write.document.theme,
              settings: write.document.settings,
              sha256: write.version.sha256,
              createdById: write.document.ownerId,
              createdAt: write.version.createdAt,
            },
            select: { id: true, sha256: true },
          })
          await tx.document.update({
            where: { id: created.id },
            data: { currentVersionId: version.id },
          })
        }

        if (version && write.acceptance) {
          await tx.documentResponse.create({
            data: {
              ...base,
              versionId: version.id,
              action: 'ACCEPT',
              name: write.acceptance.name,
              totalValue: write.document.totalValue,
              versionSha256: version.sha256,
              ipHash: LEGACY_IP_HASH,
              createdAt: write.acceptance.createdAt,
            },
          })
        }

        if (write.sessions.length > 0) {
          await tx.documentSession.createMany({
            data: write.sessions.map((session) => ({
              ...base,
              ...session,
              versionId: version?.id ?? null,
            })),
          })
        }

        if (write.events.length > 0) {
          await tx.documentEvent.createMany({
            data: write.events.map((event) => ({ ...base, ...event })),
          })
        }

        if (proposalId) {
          await tx.crmLeadProposalPresentation.updateMany({
            where: { proposalId, documentId: null },
            data: { documentId: created.id },
          })
          await tx.crmDealRoom.updateMany({
            where: { proposalId, documentId: null },
            data: { documentId: created.id },
          })
        }

        return { id: created.id }
      })
      return ok(doc)
    } catch (error) {
      if (isUniqueViolation(error)) return ok(null)
      return err(dbError('Failed to create migrated proposal document', error))
    }
  },
}
