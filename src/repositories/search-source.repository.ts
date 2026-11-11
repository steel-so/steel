import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Reads the source records the global search indexes, one loader per
 * entity type. Loaders already drop soft-deleted rows, so "not returned"
 * means "remove from the index". Pagination is keyset on the document key
 * (`afterId`), and `ids` restricts the load to specific records (the
 * fire-and-forget refresh after a write).
 */

export interface SearchSourceOptions {
  ids?: string[]
  afterId?: string
  take: number
}

function idFilter(opts: SearchSourceOptions) {
  if (opts.ids) return { in: opts.ids }
  if (opts.afterId) return { gt: opts.afterId }
  return undefined
}

const sdTicketSelect = {
  id: true,
  number: true,
  type: true,
  title: true,
  description: true,
  requesterId: true,
  assigneeId: true,
  updatedAt: true,
  phase: { select: { name: true } },
  requester: { select: { name: true } },
  customer: { select: { name: true } },
  company: { select: { name: true } },
  contact: { select: { name: true, userId: true } },
  participants: { select: { userId: true } },
} satisfies Prisma.SdTicketSelect
export type SdTicketSearchRow = Prisma.SdTicketGetPayload<{
  select: typeof sdTicketSelect
}>

const sdKbArticleSelect = {
  id: true,
  title: true,
  plainText: true,
  status: true,
  visibility: true,
  archivedAt: true,
  tags: true,
  createdById: true,
  updatedAt: true,
  category: { select: { name: true } },
} satisfies Prisma.SdKbArticleSelect
export type SdKbArticleSearchRow = Prisma.SdKbArticleGetPayload<{
  select: typeof sdKbArticleSelect
}>

const sdCustomerSelect = {
  id: true,
  kind: true,
  name: true,
  tradeName: true,
  document: true,
  email: true,
  phone: true,
  whatsapp: true,
  city: true,
  state: true,
  notes: true,
  createdById: true,
  updatedAt: true,
} satisfies Prisma.SdCustomerSelect
export type SdCustomerSearchRow = Prisma.SdCustomerGetPayload<{
  select: typeof sdCustomerSelect
}>

const sdContactSelect = {
  id: true,
  name: true,
  jobTitle: true,
  email: true,
  phone: true,
  whatsapp: true,
  notes: true,
  userId: true,
  updatedAt: true,
  customers: { select: { customer: { select: { name: true } } } },
} satisfies Prisma.SdContactSelect
export type SdContactSearchRow = Prisma.SdContactGetPayload<{
  select: typeof sdContactSelect
}>

const sdConfigItemSelect = {
  id: true,
  name: true,
  code: true,
  serialNumber: true,
  ipAddress: true,
  manufacturer: true,
  model: true,
  location: true,
  notes: true,
  ownerId: true,
  updatedAt: true,
  type: { select: { name: true } },
  customer: { select: { name: true } },
} satisfies Prisma.SdConfigItemSelect
export type SdConfigItemSearchRow = Prisma.SdConfigItemGetPayload<{
  select: typeof sdConfigItemSelect
}>

const crmLeadSelect = {
  id: true,
  name: true,
  emails: true,
  phones: true,
  company: true,
  jobTitle: true,
  city: true,
  source: true,
  channel: true,
  stage: true,
  ownerId: true,
  updatedAt: true,
} satisfies Prisma.CrmLeadSelect
export type CrmLeadSearchRow = Prisma.CrmLeadGetPayload<{
  select: typeof crmLeadSelect
}>

const crmOpportunitySelect = {
  id: true,
  name: true,
  source: true,
  ownerId: true,
  createdById: true,
  updatedAt: true,
  stage: { select: { name: true } },
  company: { select: { name: true } },
  pointOfContact: { select: { name: true } },
} satisfies Prisma.CrmOpportunitySelect
export type CrmOpportunitySearchRow = Prisma.CrmOpportunityGetPayload<{
  select: typeof crmOpportunitySelect
}>

const crmPersonSelect = {
  id: true,
  name: true,
  emails: true,
  phones: true,
  jobTitle: true,
  city: true,
  createdById: true,
  updatedAt: true,
  company: { select: { name: true } },
} satisfies Prisma.CrmPersonSelect
export type CrmPersonSearchRow = Prisma.CrmPersonGetPayload<{
  select: typeof crmPersonSelect
}>

const crmCompanySelect = {
  id: true,
  name: true,
  cnpj: true,
  domain: true,
  accountOwnerId: true,
  createdById: true,
  updatedAt: true,
} satisfies Prisma.CrmCompanySelect
export type CrmCompanySearchRow = Prisma.CrmCompanyGetPayload<{
  select: typeof crmCompanySelect
}>

const crmTaskSelect = {
  id: true,
  title: true,
  body: true,
  status: true,
  assigneeId: true,
  createdById: true,
  updatedAt: true,
  company: { select: { name: true } },
  person: { select: { name: true } },
  opportunity: { select: { name: true } },
} satisfies Prisma.CrmTaskSelect
export type CrmTaskSearchRow = Prisma.CrmTaskGetPayload<{
  select: typeof crmTaskSelect
}>

const crmProposalSelect = {
  id: true,
  name: true,
  status: true,
  responsibleId: true,
  updatedAt: true,
  company: { select: { name: true } },
  contact: { select: { name: true } },
  lead: { select: { name: true } },
} satisfies Prisma.CrmProposalSelect
export type CrmProposalSearchRow = Prisma.CrmProposalGetPayload<{
  select: typeof crmProposalSelect
}>

const crmDocumentSelect = {
  id: true,
  title: true,
  kind: true,
  status: true,
  isTemplate: true,
  ownerId: true,
  updatedAt: true,
  company: { select: { name: true } },
  person: { select: { name: true } },
  lead: { select: { name: true } },
  opportunity: { select: { name: true } },
} satisfies Prisma.DocumentSelect
export type CrmDocumentSearchRow = Prisma.DocumentGetPayload<{
  select: typeof crmDocumentSelect
}>

/**
 * Legacy proposals already migrated to documents (ADR 0063): their
 * document is indexed instead, so the proposal leaves the index.
 */
async function migratedProposalIds(workspaceId: string): Promise<string[]> {
  const rows = await prisma.document.findMany({
    where: { workspaceId, legacyProposalId: { not: null } },
    select: { legacyProposalId: true },
  })
  return rows.flatMap((row) =>
    row.legacyProposalId ? [row.legacyProposalId] : [],
  )
}

const zapContactSelect = {
  id: true,
  name: true,
  waId: true,
  description: true,
  updatedAt: true,
} satisfies Prisma.WhatsAppContactSelect
export type ZapContactSearchRow = Prisma.WhatsAppContactGetPayload<{
  select: typeof zapContactSelect
}>

const zapConversationSelect = {
  id: true,
  status: true,
  assignedUserId: true,
  archivedAt: true,
  clearedAt: true,
  lastMessageAt: true,
  updatedAt: true,
  contact: { select: { name: true, waId: true } },
  messages: {
    where: { deletedAt: null, text: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { text: true, createdAt: true },
  },
} satisfies Prisma.WhatsAppConversationSelect
export type ZapConversationSearchRow = Prisma.WhatsAppConversationGetPayload<{
  select: typeof zapConversationSelect
}>

const memberSelect = {
  userId: true,
  role: true,
  updatedAt: true,
  user: {
    select: { name: true, email: true, username: true, updatedAt: true },
  },
} satisfies Prisma.MembershipSelect
export type MemberSearchRow = Prisma.MembershipGetPayload<{
  select: typeof memberSelect
}>

const whiteboardSelect = {
  id: true,
  title: true,
  scene: true,
  createdById: true,
  updatedById: true,
  editedAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.WhiteboardSelect
export type WhiteboardSearchRow = Prisma.WhiteboardGetPayload<{
  select: typeof whiteboardSelect
}>

async function load<T>(
  label: string,
  run: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return ok(await run())
  } catch (error) {
    return err(dbError(`Failed to load ${label} for the search index`, error))
  }
}

export const SearchSourceRepository = {
  async sdTicketPrefixes(workspaceId: string): Promise<Result<unknown>> {
    return load('ticket prefixes', async () => {
      const settings = await prisma.sdSettings.findUnique({
        where: { workspaceId },
        select: { ticketPrefixes: true },
      })
      return settings?.ticketPrefixes ?? null
    })
  },

  sdTickets(workspaceId: string, opts: SearchSourceOptions) {
    return load('tickets', () =>
      prisma.sdTicket.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: sdTicketSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  sdKbArticles(workspaceId: string, opts: SearchSourceOptions) {
    return load('kb articles', () =>
      prisma.sdKbArticle.findMany({
        where: { workspaceId, archivedAt: null, id: idFilter(opts) },
        select: sdKbArticleSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  sdCustomers(workspaceId: string, opts: SearchSourceOptions) {
    return load('sd customers', () =>
      prisma.sdCustomer.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: sdCustomerSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  sdContacts(workspaceId: string, opts: SearchSourceOptions) {
    return load('sd contacts', () =>
      prisma.sdContact.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: sdContactSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  sdConfigItems(workspaceId: string, opts: SearchSourceOptions) {
    return load('config items', () =>
      prisma.sdConfigItem.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: sdConfigItemSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  crmLeads(workspaceId: string, opts: SearchSourceOptions) {
    return load('crm leads', () =>
      prisma.crmLead.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: crmLeadSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  crmOpportunities(workspaceId: string, opts: SearchSourceOptions) {
    return load('crm opportunities', () =>
      prisma.crmOpportunity.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: crmOpportunitySelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  crmPeople(workspaceId: string, opts: SearchSourceOptions) {
    return load('crm people', () =>
      prisma.crmPerson.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: crmPersonSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  crmCompanies(workspaceId: string, opts: SearchSourceOptions) {
    return load('crm companies', () =>
      prisma.crmCompany.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: crmCompanySelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  crmTasks(workspaceId: string, opts: SearchSourceOptions) {
    return load('crm tasks', () =>
      prisma.crmTask.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: crmTaskSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  crmProposals(workspaceId: string, opts: SearchSourceOptions) {
    return load('crm proposals', async () => {
      const migrated = await migratedProposalIds(workspaceId)
      return prisma.crmProposal.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          AND: [{ id: idFilter(opts) }, { id: { notIn: migrated } }],
        },
        select: crmProposalSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      })
    })
  },

  crmDocuments(workspaceId: string, opts: SearchSourceOptions) {
    return load('crm documents', () =>
      prisma.document.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: crmDocumentSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  zapContacts(workspaceId: string, opts: SearchSourceOptions) {
    return load('whatsapp contacts', () =>
      prisma.whatsAppContact.findMany({
        where: { workspaceId, id: idFilter(opts) },
        select: zapContactSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  zapConversations(workspaceId: string, opts: SearchSourceOptions) {
    return load('whatsapp conversations', () =>
      prisma.whatsAppConversation.findMany({
        where: { workspaceId, deletedAt: null, id: idFilter(opts) },
        select: zapConversationSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  /** Members are keyed by `userId` (one document per user per workspace). */
  members(workspaceId: string, opts: SearchSourceOptions) {
    return load('members', () =>
      prisma.membership.findMany({
        where: { workspaceId, userId: idFilter(opts) },
        select: memberSelect,
        orderBy: { userId: 'asc' },
        take: opts.take,
      }),
    )
  },

  /** Live (not archived) whiteboards. */
  whiteboards(workspaceId: string, opts: SearchSourceOptions) {
    return load('whiteboards', () =>
      prisma.whiteboard.findMany({
        where: { workspaceId, archivedAt: null, id: idFilter(opts) },
        select: whiteboardSelect,
        orderBy: { id: 'asc' },
        take: opts.take,
      }),
    )
  },

  /** Workspaces to reindex, keyset by id. */
  workspaceIds(afterId: string | undefined, take: number) {
    return load('workspaces', async () => {
      const rows = await prisma.workspace.findMany({
        where: afterId ? { id: { gt: afterId } } : {},
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
      })
      return rows.map((r) => r.id)
    })
  },
}
