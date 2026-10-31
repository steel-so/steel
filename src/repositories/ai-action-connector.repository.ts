import type { AiActionConnector, Prisma } from '@prisma/client'
import { aiActionConnectorKeyTaken } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

function isUnique(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'P2002'
}

export const AiActionConnectorRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<AiActionConnector[]>> {
    try {
      return ok(
        await prisma.aiActionConnector.findMany({
          where: { workspaceId },
          orderBy: { name: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list AI action connectors', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<AiActionConnector | null>> {
    try {
      return ok(
        await prisma.aiActionConnector.findFirst({ where: { id, workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find AI action connector', error))
    }
  },

  async findByKey(
    workspaceId: string,
    key: string,
  ): Promise<Result<AiActionConnector | null>> {
    try {
      return ok(
        await prisma.aiActionConnector.findUnique({
          where: { workspaceId_key: { workspaceId, key } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find AI action connector by key', error))
    }
  },

  async count(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.aiActionConnector.count({ where: { workspaceId } }))
    } catch (error) {
      return err(dbError('Failed to count AI action connectors', error))
    }
  },

  async create(
    data: Prisma.AiActionConnectorUncheckedCreateInput,
  ): Promise<Result<AiActionConnector>> {
    try {
      return ok(await prisma.aiActionConnector.create({ data }))
    } catch (error) {
      if (isUnique(error)) return err(aiActionConnectorKeyTaken())
      return err(dbError('Failed to create AI action connector', error))
    }
  },

  async update(
    id: string,
    data: Prisma.AiActionConnectorUncheckedUpdateInput,
  ): Promise<Result<AiActionConnector>> {
    try {
      return ok(await prisma.aiActionConnector.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update AI action connector', error))
    }
  },

  async delete(id: string): Promise<Result<true>> {
    try {
      await prisma.aiActionConnector.delete({ where: { id } })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to delete AI action connector', error))
    }
  },
}
