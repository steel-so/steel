import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Reads the records the Steel AI knowledge index covers (ADR 0037), one
 * loader per source type. Loaders return only what is indexable — a draft
 * or archived article, an archived page, a ticket that is not resolved or
 * has no solution, a document still processing, a soft-deleted note or
 * proposal is "not returned", which the indexer turns into "remove its
 * chunks". Keyset pagination on the id (`afterId`); `ids` restricts the
 * load to the records a write just touched.
 */

export interface KnowledgeSourceOptions {
  ids?: string[]
  afterId?: string
  take: number
}

function idFilter(opts: KnowledgeSourceOptions) {
  if (opts.ids) return { in: opts.ids }
  if (opts.afterId) return { gt: opts.afterId }
  return undefined
}

async function load<T>(
  label: string,
  run: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return ok(await run())
  } catch (error) {
    return err(
      dbError(`Failed to load ${label} for the knowledge index`, error),
    )
  }
}

const kbArticleSelect = {
  id: true,
  title: true,
  plainText: true,
  visibility: true,
  tags: true,
  updatedAt: true,
  category: { select: { name: true } },
} satisfies Prisma.SdKbArticleSelect
export type KnowledgeKbArticleRow = Prisma.SdKbArticleGetPayload<{
  select: typeof kbArticleSelect
}>

const wikiPageSelect = {
  id: true,
  title: true,
  content: true,
  updatedAt: true,
} satisfies Prisma.WikiPageSelect
export type KnowledgeWikiPageRow = Prisma.WikiPageGetPayload<{
  select: typeof wikiPageSelect
}>

const ticketSelect = {
  id: true,
  number: true,
  type: true,
  title: true,
  description: true,
  solution: true,
  requesterId: true,
  updatedAt: true,
  contact: { select: { userId: true } },
  participants: { select: { userId: true } },
} satisfies Prisma.SdTicketSelect
export type KnowledgeTicketRow = Prisma.SdTicketGetPayload<{
  select: typeof ticketSelect
}>

const zapDocumentSelect = {
  id: true,
  filename: true,
  extractedText: true,
  updatedAt: true,
} satisfies Prisma.WhatsAppAiKnowledgeDocumentSelect
export type KnowledgeZapDocumentRow =
  Prisma.WhatsAppAiKnowledgeDocumentGetPayload<{
    select: typeof zapDocumentSelect
  }>

const crmNoteSelect = {
  id: true,
  title: true,
  body: true,
  companyId: true,
  personId: true,
  opportunityId: true,
  leadId: true,
  updatedAt: true,
  company: { select: { name: true } },
  person: { select: { name: true } },
  opportunity: { select: { name: true } },
  lead: { select: { name: true } },
} satisfies Prisma.CrmNoteSelect
export type KnowledgeCrmNoteRow = Prisma.CrmNoteGetPayload<{
  select: typeof crmNoteSelect
}>

const crmProposalSelect = {
  id: true,
  name: true,
  status: true,
  updatedAt: true,
  company: { select: { name: true } },
  lead: { select: { name: true } },
  sections: {
    where: { enabled: true },
    select: { type: true, content: true },
    orderBy: { order: 'asc' },
  },
} satisfies Prisma.CrmProposalSelect
export type KnowledgeCrmProposalRow = Prisma.CrmProposalGetPayload<{
  select: typeof crmProposalSelect
}>

export const AiKnowledgeSourceRepository = {
  /** Raw `SdSettings.ticketPrefixes` (codes like INC-000123). */
  ticketPrefixes(workspaceId: string): Promise<Result<unknown>> {
    return load('ticket prefixes', async () => {
      const settings = await prisma.sdSettings.findUnique({
        where: { workspaceId },
        select: { ticketPrefixes: true },
      })
      return settings?.ticketPrefixes ?? null
    })
  },

  /** Published, not archived (internal and portal). */
  kbArticles(workspaceId: string, opts: KnowledgeSourceOptions) {
    return load('kb articles', () =>
      prisma.sdKbArticle.findMany({
        where: {
          workspaceId,
          status: 'PUBLISHED',
          archivedAt: null,
          id: idFilter(opts),
        },
        select: kbArticleSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  wikiPages(workspaceId: string, opts: KnowledgeSourceOptions) {
    return load('wiki pages', () =>
      prisma.wikiPage.findMany({
        where: { workspaceId, archivedAt: null, id: idFilter(opts) },
        select: wikiPageSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  /** Resolved (or closed) tickets that carry a solution. */
  resolvedTickets(workspaceId: string, opts: KnowledgeSourceOptions) {
    return load('resolved tickets', () =>
      prisma.sdTicket.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          resolvedAt: { not: null },
          solution: { not: null },
          NOT: { solution: '' },
          id: idFilter(opts),
        },
        select: ticketSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  zapDocuments(workspaceId: string, opts: KnowledgeSourceOptions) {
    return load('whatsapp ai documents', () =>
      prisma.whatsAppAiKnowledgeDocument.findMany({
        where: {
          workspaceId,
          status: 'READY',
          extractedText: { not: null },
          id: idFilter(opts),
        },
        select: zapDocumentSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  crmNotes(workspaceId: string, opts: KnowledgeSourceOptions) {
    return load('crm notes', () =>
      prisma.crmNote.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: crmNoteSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  crmProposals(workspaceId: string, opts: KnowledgeSourceOptions) {
    return load('crm proposals', () =>
      prisma.crmProposal.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: crmProposalSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  /** Workspaces with Steel AI on (no settings row = default on). */
  aiEnabledWorkspaceIds(afterId: string | undefined, take: number) {
    return load('workspaces', async () => {
      const rows = await prisma.workspace.findMany({
        where: {
          ...(afterId && { id: { gt: afterId } }),
          NOT: { aiSettings: { is: { aiEnabled: false } } },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
      })
      return rows.map((r) => r.id)
    })
  },
}
