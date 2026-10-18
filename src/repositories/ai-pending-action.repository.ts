import type {
  AiActionKind,
  AiPendingAction,
  AiPendingActionStatus,
  ModuleKind,
  Prisma,
} from '@prisma/client'
import { aiPendingActionNotFound } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const LIST_LIMIT = 100

export interface CreateAiPendingActionInput {
  workspaceId: string
  requestedById: string | null
  conversationId: string | null
  agentRunId?: string | null
  toolName: string
  toolCallId: string | null
  kind: AiActionKind
  module: ModuleKind | null
  args: Prisma.InputJsonValue
  preview: Prisma.InputJsonValue
  requiresDoubleConfirm: boolean
  expiresAt: Date
  /** AUTOPILOT: created already claimed (see `proposeWriteTool`). */
  status?: 'PENDING' | 'EXECUTED'
  decidedById?: string | null
  decidedAt?: Date | null
  autoExecuted?: boolean
  /** MCP: grant of the external client that proposed it (ADR 0032). */
  integrationGrantId?: string | null
}

/** Writes proposed by Steel AI that wait for a human decision. */
export const AiPendingActionRepository = {
  async create(
    data: CreateAiPendingActionInput,
  ): Promise<Result<AiPendingAction>> {
    try {
      const action = await prisma.aiPendingAction.create({ data })
      return ok(action)
    } catch (error) {
      return err(dbError('Failed to create AI pending action', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<AiPendingAction>> {
    try {
      const action = await prisma.aiPendingAction.findFirst({
        where: { id, workspaceId },
      })
      if (!action) return err(aiPendingActionNotFound())
      return ok(action)
    } catch (error) {
      return err(dbError('Failed to find AI pending action', error))
    }
  },

  /** Actions requested by a user, newest first. */
  async listByRequester(filter: {
    workspaceId: string
    requestedById: string
    status?: AiPendingActionStatus
    conversationId?: string
  }): Promise<Result<AiPendingAction[]>> {
    try {
      const actions = await prisma.aiPendingAction.findMany({
        where: {
          workspaceId: filter.workspaceId,
          requestedById: filter.requestedById,
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.conversationId
            ? { conversationId: filter.conversationId }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      })
      return ok(actions)
    } catch (error) {
      return err(dbError('Failed to list AI pending actions', error))
    }
  },

  /** Every action of a conversation, oldest first (folded into messages). */
  async listByConversation(
    conversationId: string,
  ): Promise<Result<AiPendingAction[]>> {
    try {
      const actions = await prisma.aiPendingAction.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
      })
      return ok(actions)
    } catch (error) {
      return err(dbError('Failed to list conversation pending actions', error))
    }
  },

  /**
   * Conditional transition `PENDING → <status>`: only one caller can win it,
   * which is what makes confirm/cancel idempotent under double clicks.
   * Returns the updated row, or `null` when the action was no longer pending.
   */
  async transitionFromPending(
    id: string,
    data: {
      status: Exclude<AiPendingActionStatus, 'PENDING'>
      decidedById?: string | null
      decidedAt?: Date | null
    },
  ): Promise<Result<AiPendingAction | null>> {
    try {
      const { count } = await prisma.aiPendingAction.updateMany({
        where: { id, status: 'PENDING' },
        data,
      })
      if (count === 0) return ok(null)
      const action = await prisma.aiPendingAction.findUnique({ where: { id } })
      return ok(action)
    } catch (error) {
      return err(dbError('Failed to transition AI pending action', error))
    }
  },

  /**
   * Replaces the preview of a still PENDING action (the records changed
   * since it was proposed). Returns the updated row, or `null` when the
   * action was decided in the meantime.
   */
  async refreshPreview(
    id: string,
    preview: Prisma.InputJsonValue,
  ): Promise<Result<AiPendingAction | null>> {
    try {
      const { count } = await prisma.aiPendingAction.updateMany({
        where: { id, status: 'PENDING' },
        data: { preview },
      })
      if (count === 0) return ok(null)
      const action = await prisma.aiPendingAction.findUnique({ where: { id } })
      return ok(action)
    } catch (error) {
      return err(dbError('Failed to refresh AI pending action preview', error))
    }
  },

  /** Outcome of an already claimed action. */
  async complete(
    id: string,
    data: {
      status: 'EXECUTED' | 'FAILED'
      result?: Prisma.InputJsonValue
      error?: string | null
      executedAt?: Date | null
    },
  ): Promise<Result<AiPendingAction>> {
    try {
      const action = await prisma.aiPendingAction.update({
        where: { id },
        data,
      })
      return ok(action)
    } catch (error) {
      return err(dbError('Failed to complete AI pending action', error))
    }
  },

  /** Lazy expiry: flips overdue PENDING rows of a workspace to EXPIRED. */
  async expireOverdue(
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<Result<number>> {
    try {
      const { count } = await prisma.aiPendingAction.updateMany({
        where: { workspaceId, status: 'PENDING', expiresAt: { lt: now } },
        data: { status: 'EXPIRED' },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to expire AI pending actions', error))
    }
  },
}
