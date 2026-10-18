import type {
  AiFeedback,
  AiFeedbackRating,
  AiFeedbackSurface,
  ModuleKind,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface UpsertAiFeedbackData {
  workspaceId: string
  userId: string
  surface: AiFeedbackSurface
  targetId: string
  variant: string
  rating: AiFeedbackRating
  reason: string | null
  comment: string | null
  modelKey: string | null
  module: ModuleKind | null
}

/** What the service needs to know about the target of a rating. */
export interface AiAssistantMessageTarget {
  id: string
  role: string
  modelKey: string | null
  conversationId: string
  conversationWorkspaceId: string
  conversationUserId: string
}

export interface AiAgentRunTarget {
  id: string
  agentId: string
  modelKey: string | null
}

export interface SdTicketTarget {
  id: string
  number: number
  aiTriage: Prisma.JsonValue | null
}

export interface SdKbDraftTarget {
  id: string
  sourceTicketId: string | null
}

export interface WhatsAppAiMessageTarget {
  id: string
  conversationId: string
  sentByAi: boolean
  direction: string
}

/**
 * Persistence of the thumbs up/down on AI answers (`ai_feedback`) and the
 * lookups the service uses to check that a rated answer exists in the
 * workspace. Access rules live in `AiFeedbackService`.
 */
export const AiFeedbackRepository = {
  /** One row per (user, surface, target, variant): rating again replaces. */
  async upsert(data: UpsertAiFeedbackData): Promise<Result<AiFeedback>> {
    try {
      const fields = {
        rating: data.rating,
        reason: data.reason,
        comment: data.comment,
        modelKey: data.modelKey,
        module: data.module,
      }
      const row = await prisma.aiFeedback.upsert({
        where: {
          userId_surface_targetId_variant: {
            userId: data.userId,
            surface: data.surface,
            targetId: data.targetId,
            variant: data.variant,
          },
        },
        create: {
          workspaceId: data.workspaceId,
          userId: data.userId,
          surface: data.surface,
          targetId: data.targetId,
          variant: data.variant,
          ...fields,
        },
        update: fields,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save AI feedback', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<AiFeedback | null>> {
    try {
      const row = await prisma.aiFeedback.findFirst({
        where: { id, workspaceId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find AI feedback', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.aiFeedback.deleteMany({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete AI feedback', error))
    }
  },

  /** The user's own ratings of a batch of answers of one surface. */
  async listMine(
    userId: string,
    workspaceId: string,
    surface: AiFeedbackSurface,
    targetIds: string[],
  ): Promise<Result<AiFeedback[]>> {
    try {
      const rows = await prisma.aiFeedback.findMany({
        where: { userId, workspaceId, surface, targetId: { in: targetIds } },
        orderBy: { createdAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list AI feedback', error))
    }
  },

  // ─── Targets ───────────────────────────────────────────────────────────

  async findAssistantMessage(
    messageId: string,
  ): Promise<Result<AiAssistantMessageTarget | null>> {
    try {
      const row = await prisma.aiMessage.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          role: true,
          modelKey: true,
          conversationId: true,
          conversation: {
            select: { workspaceId: true, userId: true, deletedAt: true },
          },
        },
      })
      if (!row || row.conversation.deletedAt) return ok(null)
      return ok({
        id: row.id,
        role: row.role,
        modelKey: row.modelKey,
        conversationId: row.conversationId,
        conversationWorkspaceId: row.conversation.workspaceId,
        conversationUserId: row.conversation.userId,
      })
    } catch (error) {
      return err(dbError('Failed to find the rated AI message', error))
    }
  },

  async findAgentRun(
    runId: string,
    workspaceId: string,
  ): Promise<Result<AiAgentRunTarget | null>> {
    try {
      const row = await prisma.steelAgentRun.findFirst({
        where: { id: runId, workspaceId },
        select: { id: true, agentId: true, modelKey: true },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find the rated agent run', error))
    }
  },

  async findTicket(
    ticketId: string,
    workspaceId: string,
  ): Promise<Result<SdTicketTarget | null>> {
    try {
      const row = await prisma.sdTicket.findFirst({
        where: { id: ticketId, workspaceId, deletedAt: null },
        select: { id: true, number: true, aiTriage: true },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find the rated ticket', error))
    }
  },

  async findKbDraft(
    articleId: string,
    workspaceId: string,
  ): Promise<Result<SdKbDraftTarget | null>> {
    try {
      const row = await prisma.sdKbArticle.findFirst({
        where: { id: articleId, workspaceId },
        select: { id: true, sourceTicketId: true },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find the rated article', error))
    }
  },

  async findWhatsAppMessage(
    messageId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAiMessageTarget | null>> {
    try {
      const row = await prisma.whatsAppMessage.findFirst({
        where: { id: messageId, workspaceId },
        select: {
          id: true,
          conversationId: true,
          sentByAi: true,
          direction: true,
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find the rated WhatsApp message', error))
    }
  },
}
