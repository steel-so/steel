import type { CrmCompanyEnrichment, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type CrmCompanyEnrichmentData = Omit<
  Prisma.CrmCompanyEnrichmentUncheckedCreateInput,
  'id' | 'companyId' | 'workspaceId' | 'createdAt' | 'updatedAt'
>

/** Pure Prisma access to the Receita profile of a company. */
export const CrmCompanyEnrichmentRepository = {
  /** `null` (not an error) when the company was never enriched. */
  async findByCompany(
    companyId: string,
    workspaceId: string,
  ): Promise<Result<CrmCompanyEnrichment | null>> {
    try {
      return ok(
        await prisma.crmCompanyEnrichment.findFirst({
          where: { companyId, workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find CRM company enrichment', error))
    }
  },

  async upsert(
    companyId: string,
    workspaceId: string,
    data: CrmCompanyEnrichmentData,
  ): Promise<Result<CrmCompanyEnrichment>> {
    try {
      return ok(
        await prisma.crmCompanyEnrichment.upsert({
          where: { companyId },
          create: { ...data, companyId, workspaceId },
          update: { ...data, fetchedAt: new Date() },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save CRM company enrichment', error))
    }
  },
}
