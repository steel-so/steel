import type { ModuleKind, Prisma, WhatsAppConversation } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type {
  ConversationVisibilityTarget,
  WhatsAppConversationVisibility,
} from '@/src/lib/whatsapp/conversation-scope'
import { dbError } from './db-error'

const conversationListInclude = {
  contact: true,
  team: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.WhatsAppConversationInclude

/**
 * Prisma form of the Equipes visibility rule for a scoped viewer — must
 * match `canSeeConversation` in `src/lib/whatsapp/conversation-scope.ts`.
 */
export function conversationVisibilityWhere(
  visibility: WhatsAppConversationVisibility,
): Prisma.WhatsAppConversationWhereInput {
  const or: Prisma.WhatsAppConversationWhereInput[] = [
    { assignedUserId: visibility.userId },
    { assignedUserId: null, teamId: null },
  ]
  if (visibility.ledAgentIds.length > 0) {
    or.push({ assignedUserId: { in: visibility.ledAgentIds } })
  }
  if (visibility.leadsTeamIds.length > 0) {
    or.push({ teamId: { in: visibility.leadsTeamIds } })
  }
  if (visibility.memberTeamIds.length > 0) {
    or.push({ assignedUserId: null, teamId: { in: visibility.memberTeamIds } })
  }
  return { OR: or }
}

export type WhatsAppConversationWithPreview =
  Prisma.WhatsAppConversationGetPayload<{
    include: typeof conversationListInclude
  }>

export type WhatsAppConversationWithConnection =
  Prisma.WhatsAppConversationGetPayload<{ include: { connection: true } }>

/**
 * Escopo das buscas de conversa por contato: as conversas de uma conexão
 * (ServiceDesk) ou de todas as conexões de um módulo (zap).
 */
export type WhatsAppConversationScope =
  | { connectionId: string }
  | { module: ModuleKind }

/** Só as conversas do zap: as das conexões do ServiceDesk ficam de fora. */
const ZAP_ONLY = {
  connection: { module: 'COMMUNICATION' as const },
} satisfies Prisma.WhatsAppConversationWhereInput

function scopeWhere(
  scope: WhatsAppConversationScope,
): Prisma.WhatsAppConversationWhereInput {
  return 'connectionId' in scope
    ? { connectionId: scope.connectionId }
    : { connection: { module: scope.module } }
}

/** Filtro de status da listagem: um status exato ou `OPEN` (não fechadas —
 * a caixa de entrada ativa). */
export type WhatsAppConversationStatusFilter =
  | 'NEW'
  | 'IN_PROGRESS'
  | 'CLOSED'
  | 'OPEN'

export const WhatsAppConversationRepository = {
  async listByWorkspace(
    workspaceId: string,
    filters: {
      status?: WhatsAppConversationStatusFilter
      assignedUserId?: string
      archived?: boolean
      connectionId?: string
      /** Only the queue: conversations with no assignee. */
      unassigned?: boolean
      teamId?: string
    } = {},
    /** Scoped viewer (Equipes); `undefined` = every conversation. */
    visibility?: WhatsAppConversationVisibility,
  ): Promise<Result<WhatsAppConversationWithPreview[]>> {
    try {
      const conversations = await prisma.whatsAppConversation.findMany({
        where: {
          workspaceId,
          ...ZAP_ONLY,
          ...(visibility ? conversationVisibilityWhere(visibility) : {}),
          deletedAt: null,
          archivedAt: filters.archived ? { not: null } : null,
          ...(filters.status === 'OPEN'
            ? { status: { in: ['NEW' as const, 'IN_PROGRESS' as const] } }
            : filters.status
              ? { status: filters.status }
              : {}),
          ...(filters.assignedUserId
            ? { assignedUserId: filters.assignedUserId }
            : {}),
          ...(filters.connectionId
            ? { connectionId: filters.connectionId }
            : {}),
          ...(filters.unassigned ? { assignedUserId: null } : {}),
          ...(filters.teamId ? { teamId: filters.teamId } : {}),
        },
        include: conversationListInclude,
        orderBy: [
          { pinnedAt: { sort: 'desc', nulls: 'last' } },
          { lastMessageAt: 'desc' },
        ],
      })
      return ok(conversations)
    } catch (error) {
      return err(dbError('Failed to list whatsapp conversations', error))
    }
  },

  /** Conversa do zap (as do ServiceDesk não aparecem por aqui). */
  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppConversationWithPreview | null>> {
    try {
      const conversation = await prisma.whatsAppConversation.findFirst({
        where: { id, workspaceId, ...ZAP_ONLY },
        include: conversationListInclude,
      })
      return ok(conversation)
    } catch (error) {
      return err(dbError('Failed to find whatsapp conversation', error))
    }
  },

  /** Assignee and team of zap conversations — what the visibility rule
   * needs (realtime fan-out, search). Missing ids are left out. */
  async listVisibilityTargets(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<(ConversationVisibilityTarget & { id: string })[]>> {
    if (ids.length === 0) return ok([])
    try {
      const rows = await prisma.whatsAppConversation.findMany({
        where: { workspaceId, id: { in: ids }, ...ZAP_ONLY },
        select: { id: true, assignedUserId: true, teamId: true },
      })
      return ok(rows)
    } catch (error) {
      return err(
        dbError('Failed to list whatsapp conversation visibility', error),
      )
    }
  },

  async findByIdRaw(id: string): Promise<Result<WhatsAppConversation | null>> {
    try {
      const conversation = await prisma.whatsAppConversation.findUnique({
        where: { id },
      })
      return ok(conversation)
    } catch (error) {
      return err(dbError('Failed to find whatsapp conversation', error))
    }
  },

  /** Sem escopo de workspace: uso exclusivo de jobs em background, que só
   * recebem o id da conversa no payload. */
  async findByIdWithConnection(
    id: string,
  ): Promise<Result<WhatsAppConversationWithConnection | null>> {
    try {
      const conversation = await prisma.whatsAppConversation.findUnique({
        where: { id },
        include: { connection: true },
      })
      return ok(conversation)
    } catch (error) {
      return err(dbError('Failed to find whatsapp conversation', error))
    }
  },

  async findActiveByContact(
    workspaceId: string,
    contactId: string,
    scope: WhatsAppConversationScope = { module: 'COMMUNICATION' },
  ): Promise<Result<WhatsAppConversation | null>> {
    try {
      const conversation = await prisma.whatsAppConversation.findFirst({
        where: {
          workspaceId,
          contactId,
          ...scopeWhere(scope),
          deletedAt: null,
          status: { in: ['NEW', 'IN_PROGRESS'] },
        },
        orderBy: { createdAt: 'desc' },
      })
      return ok(conversation)
    } catch (error) {
      return err(dbError('Failed to find active whatsapp conversation', error))
    }
  },

  /** Conversa fechada mais recente do contato (não excluída) — reaberta
   * quando o contato volta a escrever. */
  async findLatestClosedByContact(
    workspaceId: string,
    contactId: string,
    scope: WhatsAppConversationScope = { module: 'COMMUNICATION' },
  ): Promise<Result<WhatsAppConversation | null>> {
    try {
      const conversation = await prisma.whatsAppConversation.findFirst({
        where: {
          workspaceId,
          contactId,
          status: 'CLOSED',
          deletedAt: null,
          ...scopeWhere(scope),
        },
        orderBy: { updatedAt: 'desc' },
      })
      return ok(conversation)
    } catch (error) {
      return err(dbError('Failed to find closed whatsapp conversation', error))
    }
  },

  /**
   * Conversas abertas (NEW/IN_PROGRESS, não excluídas) sem mensagem desde
   * `cutoff`. Conversa limpa (`lastMessageAt` nulo) usa `updatedAt`.
   * `workspaceIds` restringe (`in`) ou exclui (`notIn`) workspaces.
   */
  async listInactiveOpen(input: {
    cutoff: Date
    workspaceIds: { in: string[] } | { notIn: string[] }
    limit: number
  }): Promise<Result<WhatsAppConversation[]>> {
    try {
      const conversations = await prisma.whatsAppConversation.findMany({
        where: {
          workspaceId: input.workspaceIds,
          ...ZAP_ONLY,
          deletedAt: null,
          status: { in: ['NEW', 'IN_PROGRESS'] },
          // The AI and AI campaigns keep their conversations open: people
          // follow them in "Ativas" and only a manual close ends them.
          aiActive: false,
          aiCampaignId: null,
          OR: [
            { lastMessageAt: { lt: input.cutoff } },
            { lastMessageAt: null, updatedAt: { lt: input.cutoff } },
          ],
        },
        orderBy: { lastMessageAt: 'asc' },
        take: input.limit,
      })
      return ok(conversations)
    } catch (error) {
      return err(
        dbError('Failed to list inactive whatsapp conversations', error),
      )
    }
  },

  /**
   * Reserva o alerta de sentimento da conversa: grava `sentimentAlertedAt`
   * só se não houve alerta desde `cutoff`. Escrita condicional para dois
   * jobs concorrentes não alertarem duas vezes. true = reservado.
   */
  async claimSentimentAlert(
    id: string,
    cutoff: Date,
    now: Date,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppConversation.updateMany({
        where: {
          id,
          OR: [
            { sentimentAlertedAt: null },
            { sentimentAlertedAt: { lt: cutoff } },
          ],
        },
        data: { sentimentAlertedAt: now },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to claim whatsapp sentiment alert', error))
    }
  },

  /**
   * Open conversations (not closed, archived or deleted) per assignee — the
   * load the least-loaded distribution balances. Users with none are absent.
   */
  async countOpenByAssignees(
    workspaceId: string,
    userIds: string[],
  ): Promise<Result<Map<string, number>>> {
    if (userIds.length === 0) return ok(new Map())
    try {
      const rows = await prisma.whatsAppConversation.groupBy({
        by: ['assignedUserId'],
        where: {
          workspaceId,
          ...ZAP_ONLY,
          assignedUserId: { in: userIds },
          status: { not: 'CLOSED' },
          deletedAt: null,
          archivedAt: null,
        },
        _count: { _all: true },
      })
      const counts = new Map<string, number>()
      for (const row of rows) {
        if (row.assignedUserId) counts.set(row.assignedUserId, row._count._all)
      }
      return ok(counts)
    } catch (error) {
      return err(dbError('Failed to count open whatsapp conversations', error))
    }
  },

  /**
   * The queue the distribution drains: open, unassigned, not answered by the
   * AI, not archived or deleted — oldest in the queue first.
   */
  async listAwaitingDistribution(
    workspaceId: string,
    limit: number,
  ): Promise<Result<WhatsAppConversation[]>> {
    try {
      const rows = await prisma.whatsAppConversation.findMany({
        where: {
          workspaceId,
          ...ZAP_ONLY,
          assignedUserId: null,
          aiActive: false,
          status: { not: 'CLOSED' },
          deletedAt: null,
          archivedAt: null,
        },
        orderBy: [
          { queuedAt: { sort: 'asc', nulls: 'first' } },
          { createdAt: 'asc' },
        ],
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(
        dbError('Failed to list whatsapp conversations to distribute', error),
      )
    }
  },

  /**
   * Gives an unassigned open conversation to `userId` — conditional write,
   * so a manual assignment (or another worker) that got there first wins.
   * true = assigned by this call.
   */
  async claimForAssignment(
    id: string,
    workspaceId: string,
    userId: string,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppConversation.updateMany({
        where: {
          id,
          workspaceId,
          assignedUserId: null,
          aiActive: false,
          status: { not: 'CLOSED' },
          deletedAt: null,
          archivedAt: null,
        },
        data: {
          assignedUserId: userId,
          status: 'IN_PROGRESS',
          queuedAt: null,
        },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to claim whatsapp conversation', error))
    }
  },

  /**
   * Conversations that waited without an assignee since before `cutoff`
   * (the queue clock is `queuedAt`, else the creation date), got no
   * reminder in this streak and are younger than `notBefore`.
   */
  async listUnattendedForReminder(input: {
    workspaceIds: { in: string[] } | { notIn: string[] }
    cutoff: Date
    notBefore: Date
    limit: number
  }): Promise<Result<WhatsAppConversationWithPreview[]>> {
    const window = { lt: input.cutoff, gt: input.notBefore }
    try {
      const rows = await prisma.whatsAppConversation.findMany({
        where: {
          workspaceId: input.workspaceIds,
          ...ZAP_ONLY,
          assignedUserId: null,
          aiActive: false,
          status: { not: 'CLOSED' },
          deletedAt: null,
          archivedAt: null,
          unassignedReminderAt: null,
          OR: [{ queuedAt: window }, { queuedAt: null, createdAt: window }],
        },
        include: conversationListInclude,
        orderBy: { createdAt: 'asc' },
        take: input.limit,
      })
      return ok(rows)
    } catch (error) {
      return err(
        dbError('Failed to list unattended whatsapp conversations', error),
      )
    }
  },

  /**
   * Reserves the reminder of the current unassigned streak: conditional
   * write so two ticks never remind twice. true = reserved by this call.
   */
  async claimUnassignedReminder(
    id: string,
    now: Date,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppConversation.updateMany({
        where: { id, assignedUserId: null, unassignedReminderAt: null },
        data: { unassignedReminderAt: now },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to claim whatsapp unassigned reminder', error))
    }
  },

  async create(
    data: Prisma.WhatsAppConversationUncheckedCreateInput,
  ): Promise<Result<WhatsAppConversation>> {
    try {
      const conversation = await prisma.whatsAppConversation.create({ data })
      return ok(conversation)
    } catch (error) {
      return err(dbError('Failed to create whatsapp conversation', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppConversationUncheckedUpdateInput,
  ): Promise<Result<WhatsAppConversation>> {
    try {
      const conversation = await prisma.whatsAppConversation.update({
        where: { id },
        data,
      })
      return ok(conversation)
    } catch (error) {
      return err(dbError('Failed to update whatsapp conversation', error))
    }
  },
}
