import { type CrmCompany, Prisma } from '@prisma/client'
import { crmCompanyConflict, notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmCompanyRepository = {
  async listByWorkspace(
    workspaceId: string,
    filters?: { icp?: boolean },
  ): Promise<Result<CrmCompany[]>> {
    try {
      const companies = await prisma.crmCompany.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(filters?.icp !== undefined ? { icp: filters.icp } : {}),
        },
        orderBy: { position: 'asc' },
      })
      return ok(companies)
    } catch (error) {
      return err(dbError('Failed to list CRM companies', error))
    }
  },

  /** Natural-language search (C10): a prebuilt `where`/`orderBy`, capped. */
  async search(
    where: Prisma.CrmCompanyWhereInput,
    orderBy: Prisma.CrmCompanyOrderByWithRelationInput[],
    take: number,
  ): Promise<Result<CrmCompany[]>> {
    try {
      return ok(await prisma.crmCompany.findMany({ where, orderBy, take }))
    } catch (error) {
      return err(dbError('Failed to search CRM companies', error))
    }
  },

  async findById(id: string, workspaceId: string): Promise<Result<CrmCompany>> {
    try {
      const company = await prisma.crmCompany.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })

      if (!company) return err(notFound('CrmCompany'))

      return ok(company)
    } catch (error) {
      return err(dbError('Failed to find CRM company by id', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    cnpj?: string
    domain?: string
    employees?: number
    linkedin?: string
    address?: Prisma.InputJsonValue
    arr?: number
    icp?: boolean
    accountOwnerId?: string
  }): Promise<Result<CrmCompany>> {
    try {
      const position = await prisma.crmCompany.count({
        where: { workspaceId: data.workspaceId, deletedAt: null },
      })

      const company = await prisma.crmCompany.create({
        data: { ...data, position },
      })
      return ok(company)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(crmCompanyConflict())
      }
      return err(dbError('Failed to create CRM company', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      cnpj?: string | null
      domain?: string | null
      employees?: number | null
      linkedin?: string | null
      address?: Prisma.InputJsonValue | null
      arr?: number | null
      icp?: boolean
      accountOwnerId?: string | null
      updatedById?: string
    },
  ): Promise<Result<CrmCompany>> {
    try {
      const { address, ...rest } = data
      const company = await prisma.crmCompany.update({
        where: { id },
        data: {
          ...rest,
          // null limpa o endereço (coluna Json exige o sentinela DbNull).
          ...(address === undefined
            ? {}
            : { address: address === null ? Prisma.DbNull : address }),
        },
      })
      return ok(company)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(crmCompanyConflict())
      }
      return err(dbError('Failed to update CRM company', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      // Zera cnpj/domain junto com o soft delete: como são únicos por
      // workspace e o soft delete não é filtrado pela constraint do banco,
      // uma empresa apagada continuaria bloqueando esses valores para
      // sempre. O snapshot com os valores originais já fica no audit log
      // (recordCrmActivity captura o DTO antes de chamar softDelete).
      await prisma.crmCompany.update({
        where: { id },
        data: { deletedAt: new Date(), cnpj: null, domain: null },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM company', error))
    }
  },

  async reorder(
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmCompany.update({
            where: { id, workspaceId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder CRM companies', error))
    }
  },
}
