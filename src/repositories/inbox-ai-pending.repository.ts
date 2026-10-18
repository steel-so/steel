import type { AiPendingAction, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const LIST_LIMIT = 50

export type InboxAssistantPendingRow = AiPendingAction & {
  conversation: { id: string; title: string | null } | null
  /** MCP actions: the external client that proposed it. */
  integrationGrant: { client: { clientId: string; name: string | null } } | null
}

export type InboxAgentPendingRow = AiPendingAction & {
  agentRun: {
    id: string
    agentId: string
    agent: { id: string; name: string; ownerId: string | null }
  } | null
}

export interface ExpiringAssistantActionRow {
  id: string
  workspaceId: string
  requestedById: string | null
  preview: Prisma.JsonValue
  expiresAt: Date
}

/**
 * Read side of the inbox "Pendências da IA": PENDING actions that did not
 * expire yet. Decisions go through the assistant and agent services, never
 * through here.
 */
export const InboxAiPendingRepository = {
  /** Assistant (Build mode) actions the user must confirm, soonest first. */
  async listAssistant(
    workspaceId: string,
    userId: string,
    now: Date,
  ): Promise<Result<InboxAssistantPendingRow[]>> {
    try {
      const rows = await prisma.aiPendingAction.findMany({
        where: {
          workspaceId,
          requestedById: userId,
          agentRunId: null,
          status: 'PENDING',
          expiresAt: { gt: now },
        },
        include: {
          conversation: { select: { id: true, title: true } },
          integrationGrant: {
            select: { client: { select: { clientId: true, name: true } } },
          },
        },
        orderBy: { expiresAt: 'asc' },
        take: LIST_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list pending assistant actions', error))
    }
  },

  /**
   * Steel Agent writes waiting for approval. `ownerId` narrows to the agents
   * a given person owns (a non-manager only decides on their own agents).
   */
  async listAgent(
    workspaceId: string,
    now: Date,
    ownerId?: string,
  ): Promise<Result<InboxAgentPendingRow[]>> {
    try {
      const rows = await prisma.aiPendingAction.findMany({
        where: {
          workspaceId,
          agentRunId: { not: null },
          status: 'PENDING',
          expiresAt: { gt: now },
          ...(ownerId ? { agentRun: { agent: { ownerId } } } : {}),
        },
        include: {
          agentRun: {
            select: {
              id: true,
              agentId: true,
              agent: { select: { id: true, name: true, ownerId: true } },
            },
          },
        },
        orderBy: { expiresAt: 'asc' },
        take: LIST_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list pending agent approvals', error))
    }
  },

  /**
   * Assistant actions (every workspace) still pending and expiring within
   * `(now, until]` — the ~5-minute warning of the notifications tick.
   */
  async listExpiringAssistant(
    now: Date,
    until: Date,
  ): Promise<Result<ExpiringAssistantActionRow[]>> {
    try {
      const rows = await prisma.aiPendingAction.findMany({
        where: {
          requestedById: { not: null },
          agentRunId: null,
          status: 'PENDING',
          expiresAt: { gt: now, lte: until },
        },
        select: {
          id: true,
          workspaceId: true,
          requestedById: true,
          preview: true,
          expiresAt: true,
        },
        orderBy: { expiresAt: 'asc' },
        take: 500,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list expiring assistant actions', error))
    }
  },
}
