import type { CrmDealsSettings } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { UpdateCrmDealsSettingsDTO } from '@/src/schemas/crm-deals.schema'
import { dbError } from './db-error'

export const CrmDealsSettingsRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<CrmDealsSettings | null>> {
    try {
      const row = await prisma.crmDealsSettings.findUnique({
        where: { workspaceId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to read CRM deals settings', error))
    }
  },

  async upsert(
    workspaceId: string,
    updatedById: string,
    data: UpdateCrmDealsSettingsDTO,
  ): Promise<Result<CrmDealsSettings>> {
    try {
      const row = await prisma.crmDealsSettings.upsert({
        where: { workspaceId },
        create: { workspaceId, updatedById, ...data },
        update: { updatedById, ...data },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save CRM deals settings', error))
    }
  },
}
