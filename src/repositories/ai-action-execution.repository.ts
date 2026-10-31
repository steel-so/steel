import type { AiActionExecution, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type ExecutionClaim =
  | { kind: 'claimed'; id: string }
  | { kind: 'existing'; row: AiActionExecution }

export const AiActionExecutionRepository = {
  /**
   * Reserves the idempotency key. A fresh key is claimed (PENDING). A key
   * that exists is returned as is, unless its previous attempt FAILED or is
   * a PENDING one older than `staleBefore` or a SUCCESS older than
   * `replayBefore` — those are taken over, so a
   * retry after a failure really calls the system again.
   */
  async claim(
    workspaceId: string,
    idempotencyKey: string,
    connectorKey: string,
    windows: { staleBefore: Date; replayBefore: Date },
  ): Promise<Result<ExecutionClaim>> {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const row = await prisma.aiActionExecution.create({
            data: { workspaceId, idempotencyKey, connectorKey },
          })
          return ok({ kind: 'claimed', id: row.id })
        } catch (error) {
          const unique =
            error instanceof Error && 'code' in error && error.code === 'P2002'
          if (!unique) throw error
        }
        const existing = await prisma.aiActionExecution.findUnique({
          where: {
            workspaceId_idempotencyKey: { workspaceId, idempotencyKey },
          },
        })
        // Deleted between the two queries: try to claim again.
        if (!existing) continue
        const retryable =
          existing.status === 'FAILURE' ||
          (existing.status === 'PENDING' &&
            existing.updatedAt < windows.staleBefore) ||
          (existing.status === 'SUCCESS' &&
            existing.updatedAt < windows.replayBefore)
        if (!retryable) return ok({ kind: 'existing', row: existing })
        const taken = await prisma.aiActionExecution.updateMany({
          where: { id: existing.id, updatedAt: existing.updatedAt },
          data: { status: 'PENDING', httpStatus: null },
        })
        if (taken.count === 1) return ok({ kind: 'claimed', id: existing.id })
        const current = await prisma.aiActionExecution.findUnique({
          where: { id: existing.id },
        })
        if (current) return ok({ kind: 'existing', row: current })
      }
      return err(dbError('Failed to claim AI action execution', 'contention'))
    } catch (error) {
      return err(dbError('Failed to claim AI action execution', error))
    }
  },

  async complete(
    id: string,
    data: {
      status: 'SUCCESS' | 'FAILURE'
      httpStatus: number | null
      response: Prisma.InputJsonValue | null
    },
  ): Promise<Result<true>> {
    try {
      await prisma.aiActionExecution.update({
        where: { id },
        data: {
          status: data.status,
          httpStatus: data.httpStatus,
          response: data.response ?? undefined,
        },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to complete AI action execution', error))
    }
  },
}
