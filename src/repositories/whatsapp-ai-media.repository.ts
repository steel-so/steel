import type { Prisma, WhatsAppAiMedia } from '@prisma/client'
import { conflict, notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppAiMediaRepository = {
  async listByWorkspace(
    workspaceId: string,
    options: { onlyActive?: boolean } = {},
  ): Promise<Result<WhatsAppAiMedia[]>> {
    try {
      const rows = await prisma.whatsAppAiMedia.findMany({
        where: { workspaceId, ...(options.onlyActive ? { active: true } : {}) },
        orderBy: { createdAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list AI media', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAiMedia | null>> {
    try {
      return ok(
        await prisma.whatsAppAiMedia.findFirst({ where: { id, workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find AI media', error))
    }
  },

  async create(
    data: Prisma.WhatsAppAiMediaUncheckedCreateInput,
  ): Promise<Result<WhatsAppAiMedia>> {
    try {
      return ok(await prisma.whatsAppAiMedia.create({ data }))
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        return err(conflict('Já existe um arquivo com esse nome'))
      }
      return err(dbError('Failed to create AI media', error))
    }
  },

  async update(
    id: string,
    workspaceId: string,
    data: { whenToSend?: string; active?: boolean },
  ): Promise<Result<WhatsAppAiMedia>> {
    try {
      const result = await prisma.whatsAppAiMedia.updateMany({
        where: { id, workspaceId },
        data,
      })
      if (result.count === 0) return err(notFound('Arquivo'))
      const row = await prisma.whatsAppAiMedia.findUniqueOrThrow({
        where: { id },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to update AI media', error))
    }
  },

  async delete(id: string, workspaceId: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppAiMedia.deleteMany({ where: { id, workspaceId } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete AI media', error))
    }
  },
}
