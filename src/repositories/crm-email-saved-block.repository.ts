import type { Prisma, CrmEmailSavedBlock as Row } from '@prisma/client'
import { crmEmailSavedBlockNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const AUTHOR = { select: { id: true, name: true } } as const

export type CrmEmailSavedBlock = Row & {
  createdBy: { id: string; name: string } | null
}

/** "Salvos" lists at most this many blocks, newest first. */
const LIST_LIMIT = 200

export interface NewCrmEmailSavedBlock {
  workspaceId: string
  name: string
  category: string
  kind: string
  fragment: Prisma.InputJsonValue
  nodeCount: number
  thumbnail?: string | null
  createdById: string
}

/** Reusable sections/blocks of the e-mail editor (workspace-wide). */
export const CrmEmailSavedBlockRepository = {
  async list(
    workspaceId: string,
    query?: string,
  ): Promise<Result<CrmEmailSavedBlock[]>> {
    const term = query?.trim()
    try {
      const blocks = await prisma.crmEmailSavedBlock.findMany({
        where: {
          workspaceId,
          ...(term
            ? {
                OR: [
                  { name: { contains: term, mode: 'insensitive' } },
                  { category: { contains: term, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: { createdBy: AUTHOR },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIST_LIMIT,
      })
      return ok(blocks)
    } catch (error) {
      return err(dbError('Failed to list CRM email saved blocks', error))
    }
  },

  async count(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(
        await prisma.crmEmailSavedBlock.count({ where: { workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to count CRM email saved blocks', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailSavedBlock>> {
    try {
      const block = await prisma.crmEmailSavedBlock.findFirst({
        where: { id, workspaceId },
        include: { createdBy: AUTHOR },
      })
      if (!block) return err(crmEmailSavedBlockNotFound())
      return ok(block)
    } catch (error) {
      return err(dbError('Failed to find CRM email saved block', error))
    }
  },

  async create(
    data: NewCrmEmailSavedBlock,
  ): Promise<Result<CrmEmailSavedBlock>> {
    try {
      const block = await prisma.crmEmailSavedBlock.create({
        data,
        include: { createdBy: AUTHOR },
      })
      return ok(block)
    } catch (error) {
      return err(dbError('Failed to create CRM email saved block', error))
    }
  },

  async update(
    id: string,
    data: { name?: string; category?: string },
  ): Promise<Result<CrmEmailSavedBlock>> {
    try {
      const block = await prisma.crmEmailSavedBlock.update({
        where: { id },
        data,
        include: { createdBy: AUTHOR },
      })
      return ok(block)
    } catch (error) {
      return err(dbError('Failed to update CRM email saved block', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmEmailSavedBlock.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM email saved block', error))
    }
  },
}
