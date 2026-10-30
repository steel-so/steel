import type { SdInventorySettings } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb } from './sd-config-db'

export interface SdInventorySettingsData {
  diskThresholdPercent?: number
  ramThresholdPercent?: number
  staleAfterDays?: number
  syncConfigItems?: boolean
  defaultTypeId?: string | null
  agentAutoUpdate?: boolean
}

/** Uma linha por workspace; `null` = ainda nos padrões do banco. */
export const SdInventorySettingsRepository = {
  async find(workspaceId: string): Promise<Result<SdInventorySettings | null>> {
    return sdDb('Failed to find ServiceDesk inventory settings', () =>
      prisma.sdInventorySettings.findUnique({ where: { workspaceId } }),
    )
  },

  async upsert(
    workspaceId: string,
    data: SdInventorySettingsData,
  ): Promise<Result<SdInventorySettings>> {
    return sdDb('Failed to save ServiceDesk inventory settings', () =>
      prisma.sdInventorySettings.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data,
      }),
    )
  },
}
