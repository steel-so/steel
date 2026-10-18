import type { PlatformAiSettings } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** The platform settings table holds a single row with this id. */
export const PLATFORM_AI_SETTINGS_ID = 'default'

export const PlatformAiSettingsRepository = {
  async find(): Promise<Result<PlatformAiSettings | null>> {
    try {
      const row = await prisma.platformAiSettings.findUnique({
        where: { id: PLATFORM_AI_SETTINGS_ID },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find platform AI settings', error))
    }
  },

  async upsert(data: {
    costMargin: number
    embeddingsEnabled?: boolean
    updatedById: string
  }): Promise<Result<PlatformAiSettings>> {
    try {
      const row = await prisma.platformAiSettings.upsert({
        where: { id: PLATFORM_AI_SETTINGS_ID },
        create: { id: PLATFORM_AI_SETTINGS_ID, ...data },
        update: data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to upsert platform AI settings', error))
    }
  },
}
