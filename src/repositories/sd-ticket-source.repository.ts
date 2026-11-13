import type { Prisma, WhatsAppProvider } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import type { SdTicketSourceKind } from '@/src/schemas/sd-ticket-source.schema'
import { sdDb } from './sd-config-db'
import {
  type SdLinkedTicketRow,
  sdLinkedTicketSelect,
} from './sd-linked-ticket'

/**
 * Data access of "open a ticket from a conversation or CRM record": the
 * conversation facts (any connection module), the tickets already linked to a
 * source and the two-way links written on the ticket.
 */

export interface SourceConversationRow {
  id: string
  workspaceId: string
  clearedAt: Date | null
  assignedUserId: string | null
  teamId: string | null
  connection: {
    id: string
    module: 'COMMUNICATION' | 'SERVICE_DESK' | 'CRM'
    provider: WhatsAppProvider
  }
  contact: { id: string; name: string | null; waId: string }
}

export interface SourceMessageRow {
  direction: 'IN' | 'OUT'
  type: string
  text: string | null
  sentByAi: boolean
  createdAt: Date
}

export interface SourceLinks {
  whatsappConversationId?: string | null
  crmLeadId?: string | null
  crmPersonId?: string | null
  crmOpportunityId?: string | null
}

/** Where the linked-tickets listing looks, per kind of source. */
export function sourceTicketWhere(
  kind: SdTicketSourceKind,
  sourceId: string,
): Prisma.SdTicketWhereInput {
  switch (kind) {
    case 'conversation':
      return { whatsappConversationId: sourceId }
    case 'lead':
      return { crmLeadId: sourceId }
    case 'person':
      return { crmPersonId: sourceId }
    case 'opportunity':
      return { crmOpportunityId: sourceId }
  }
}

export const SdTicketSourceRepository = {
  /** Conversation of the workspace, whatever the module of its connection. */
  async findConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<SourceConversationRow | null>> {
    return sdDb('Failed to find the conversation of a ticket source', () =>
      prisma.whatsAppConversation.findFirst({
        where: { id: conversationId, workspaceId, deletedAt: null },
        select: {
          id: true,
          workspaceId: true,
          clearedAt: true,
          assignedUserId: true,
          teamId: true,
          connection: { select: { id: true, module: true, provider: true } },
          contact: { select: { id: true, name: true, waId: true } },
        },
      }),
    )
  },

  /** Last messages of the conversation, oldest first. */
  async listRecentMessages(
    conversationId: string,
    limit: number,
    after: Date | null,
  ): Promise<Result<SourceMessageRow[]>> {
    return sdDb('Failed to list messages of a ticket source', async () => {
      const rows = await prisma.whatsAppMessage.findMany({
        where: {
          conversationId,
          deletedAt: null,
          ...(after ? { createdAt: { gt: after } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          direction: true,
          type: true,
          text: true,
          sentByAi: true,
          createdAt: true,
        },
      })
      return rows.reverse()
    })
  },

  /** CRM company name and CNPJ (digits) for the requester match. */
  async findCrmCompany(
    workspaceId: string,
    companyId: string,
  ): Promise<Result<{ id: string; name: string; cnpj: string | null } | null>> {
    return sdDb('Failed to find the CRM company of a ticket source', () =>
      prisma.crmCompany.findFirst({
        where: { id: companyId, workspaceId, deletedAt: null },
        select: { id: true, name: true, cnpj: true },
      }),
    )
  },

  /** ServiceDesk customer with exactly this name (case-insensitive). */
  async findCustomerByName(
    workspaceId: string,
    name: string,
  ): Promise<Result<{ id: string; name: string } | null>> {
    return sdDb('Failed to find a ServiceDesk customer by name', () =>
      prisma.sdCustomer.findFirst({
        where: {
          workspaceId,
          deletedAt: null,
          active: true,
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
    )
  },

  /** Tickets (not deleted) linked to the source, newest first. */
  async listBySource(
    workspaceId: string,
    kind: SdTicketSourceKind,
    sourceId: string,
    take = 20,
  ): Promise<Result<SdLinkedTicketRow[]>> {
    return sdDb('Failed to list the tickets of a source', () =>
      prisma.sdTicket.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...sourceTicketWhere(kind, sourceId),
        },
        orderBy: { createdAt: 'desc' },
        take,
        select: sdLinkedTicketSelect,
      }),
    )
  },

  /** Writes the links of the source on the ticket. */
  async setLinks(ticketId: string, links: SourceLinks): Promise<Result<void>> {
    return sdDb('Failed to link a ticket to its source', async () => {
      await prisma.sdTicket.update({ where: { id: ticketId }, data: links })
    })
  },

  /** Ticket row for the response, after the links were written. */
  async findLinkedTicket(
    workspaceId: string,
    ticketId: string,
  ): Promise<Result<SdLinkedTicketRow | null>> {
    return sdDb('Failed to read a linked ticket', () =>
      prisma.sdTicket.findFirst({
        where: { id: ticketId, workspaceId, deletedAt: null },
        select: sdLinkedTicketSelect,
      }),
    )
  },

  /** Workspace slug, for the ticket path. */
  async findWorkspaceMeta(
    workspaceId: string,
  ): Promise<Result<{ slug: string } | null>> {
    return sdDb('Failed to read the workspace of a ticket source', () =>
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { slug: true },
      }),
    )
  },
}
