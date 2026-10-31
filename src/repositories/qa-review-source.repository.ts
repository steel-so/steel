import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Messages read per review (the most recent ones). */
export const QA_MESSAGE_CAP = 150

export interface QaConversationSource {
  id: string
  assignedUserId: string | null
  assignedUserName: string | null
  customerName: string | null
  endedAt: Date | null
  messages: {
    direction: 'IN' | 'OUT'
    text: string
    senderUserId: string | null
    sentByAi: boolean
  }[]
}

export interface QaTicketSource {
  id: string
  label: string
  description: string | null
  assigneeId: string | null
  assigneeName: string | null
  customerName: string | null
  endedAt: Date | null
  messages: {
    authorKind: 'AGENT' | 'REQUESTER' | 'CONTACT' | 'AI' | 'SYSTEM'
    visibility: 'PUBLIC' | 'INTERNAL'
    body: string
    authorUserId: string | null
  }[]
}

export const QaReviewSourceRepository = {
  async loadConversation(
    workspaceId: string,
    id: string,
  ): Promise<Result<QaConversationSource | null>> {
    try {
      const conversation = await prisma.whatsAppConversation.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: {
          id: true,
          assignedUserId: true,
          closedAt: true,
          lastMessageAt: true,
          assignedUser: { select: { name: true } },
          contact: { select: { name: true, waId: true } },
        },
      })
      if (!conversation) return ok(null)
      const rows = await prisma.whatsAppMessage.findMany({
        where: {
          conversationId: id,
          deletedAt: null,
          reactionEmoji: null,
          text: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: QA_MESSAGE_CAP,
        select: {
          direction: true,
          text: true,
          senderUserId: true,
          sentByAi: true,
        },
      })
      return ok({
        id: conversation.id,
        assignedUserId: conversation.assignedUserId,
        assignedUserName: conversation.assignedUser?.name ?? null,
        customerName: conversation.contact.name ?? conversation.contact.waId,
        endedAt: conversation.closedAt ?? conversation.lastMessageAt,
        messages: rows
          .reverse()
          .filter((row) => (row.text ?? '').trim().length > 0)
          .map((row) => ({
            direction: row.direction,
            text: row.text as string,
            senderUserId: row.senderUserId,
            sentByAi: row.sentByAi,
          })),
      })
    } catch (error) {
      return err(dbError('Failed to load the conversation for QA', error))
    }
  },

  async loadTicket(
    workspaceId: string,
    id: string,
  ): Promise<Result<QaTicketSource | null>> {
    try {
      const ticket = await prisma.sdTicket.findFirst({
        where: { id, workspaceId },
        select: {
          id: true,
          number: true,
          title: true,
          description: true,
          assigneeId: true,
          resolvedAt: true,
          closedAt: true,
          assignee: { select: { name: true } },
          company: { select: { name: true, tradeName: true } },
          customer: { select: { name: true, tradeName: true } },
          contact: { select: { name: true } },
        },
      })
      if (!ticket) return ok(null)
      const rows = await prisma.sdTicketMessage.findMany({
        where: { ticketId: id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: QA_MESSAGE_CAP,
        select: {
          authorKind: true,
          visibility: true,
          body: true,
          authorUserId: true,
        },
      })
      const customer = ticket.company ?? ticket.customer
      return ok({
        id: ticket.id,
        label: `#${ticket.number} ${ticket.title}`.slice(0, 160),
        description: ticket.description,
        assigneeId: ticket.assigneeId,
        assigneeName: ticket.assignee?.name ?? null,
        customerName:
          customer?.tradeName ?? customer?.name ?? ticket.contact?.name ?? null,
        endedAt: ticket.closedAt ?? ticket.resolvedAt,
        messages: rows.reverse(),
      })
    } catch (error) {
      return err(dbError('Failed to load the ticket for QA', error))
    }
  },
}
