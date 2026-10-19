import type { CrmMailingList, CrmMailingListMember } from '@prisma/client'
import { crmMailingListMemberConflict, notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmMailingListRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<(CrmMailingList & { _count: { members: number } })[]>> {
    try {
      const lists = await prisma.crmMailingList.findMany({
        where: { workspaceId, deletedAt: null },
        include: { _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return ok(lists)
    } catch (error) {
      return err(dbError('Failed to list CRM mailing lists', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmMailingList>> {
    try {
      const list = await prisma.crmMailingList.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!list) return err(notFound('CrmMailingList'))
      return ok(list)
    } catch (error) {
      return err(dbError('Failed to find CRM mailing list by id', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    description?: string
  }): Promise<Result<CrmMailingList>> {
    try {
      const list = await prisma.crmMailingList.create({ data })
      return ok(list)
    } catch (error) {
      return err(dbError('Failed to create CRM mailing list', error))
    }
  },

  async update(
    id: string,
    data: { name?: string; description?: string },
  ): Promise<Result<CrmMailingList>> {
    try {
      const list = await prisma.crmMailingList.update({ where: { id }, data })
      return ok(list)
    } catch (error) {
      return err(dbError('Failed to update CRM mailing list', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmMailingList.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM mailing list', error))
    }
  },
}

export const CrmMailingListMemberRepository = {
  async listByList(
    mailingListId: string,
  ): Promise<Result<CrmMailingListMember[]>> {
    try {
      const members = await prisma.crmMailingListMember.findMany({
        where: { mailingListId },
        orderBy: { createdAt: 'desc' },
      })
      return ok(members)
    } catch (error) {
      return err(dbError('Failed to list CRM mailing list members', error))
    }
  },

  async add(data: {
    mailingListId: string
    email: string
    name?: string
    personId?: string
  }): Promise<Result<CrmMailingListMember>> {
    try {
      const member = await prisma.crmMailingListMember.create({ data })
      return ok(member)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(crmMailingListMemberConflict())
      }
      return err(dbError('Failed to add CRM mailing list member', error))
    }
  },

  /** Bulk add (imports): existing addresses are skipped, not an error. */
  async addMany(
    mailingListId: string,
    members: Array<{ email: string; name?: string }>,
  ): Promise<Result<number>> {
    if (members.length === 0) return ok(0)
    try {
      const result = await prisma.crmMailingListMember.createMany({
        data: members.map((m) => ({ mailingListId, ...m })),
        skipDuplicates: true,
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to add CRM mailing list members', error))
    }
  },

  async remove(id: string): Promise<Result<void>> {
    try {
      await prisma.crmMailingListMember.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to remove CRM mailing list member', error))
    }
  },
}
