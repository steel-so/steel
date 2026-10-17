import type {
  AiActionKind,
  AiActionLog,
  AiActionSource,
  ModuleKind,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Result of an AI write; the readable text goes in `summary`. `simulated`
 * = Teste mode / agent test run: previewed only, never executed.
 */
export type AiActionOutcome = 'success' | 'failure' | 'simulated'

export interface CreateAiActionLogInput {
  workspaceId: string
  source: AiActionSource
  actorId: string | null
  agentId?: string | null
  pendingActionId?: string | null
  toolName: string
  kind: AiActionKind
  module: ModuleKind | null
  targetType?: string | null
  targetId?: string | null
  args: Prisma.InputJsonValue
  outcome: AiActionOutcome
  /** pt-BR summary of what was done (success only). */
  summary?: string | null
  error?: string | null
  /** MCP writes: the OAuth client that called the tool. */
  oauthClientId?: string | null
}

/** Durable trail of every write executed by AI (assistant or agent). */
export const AiActionLogRepository = {
  async create(data: CreateAiActionLogInput): Promise<Result<AiActionLog>> {
    try {
      const log = await prisma.aiActionLog.create({ data })
      return ok(log)
    } catch (error) {
      return err(dbError('Failed to create AI action log', error))
    }
  },

  /** Newest first; optionally only the writes that touched one record. */
  async listByWorkspace(
    workspaceId: string,
    filter: { targetType?: string; targetId?: string; limit: number },
  ): Promise<Result<AiActionLog[]>> {
    try {
      const logs = await prisma.aiActionLog.findMany({
        where: {
          workspaceId,
          ...(filter.targetType ? { targetType: filter.targetType } : {}),
          ...(filter.targetId ? { targetId: filter.targetId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
      })
      return ok(logs)
    } catch (error) {
      return err(dbError('Failed to list AI action logs', error))
    }
  },
}
