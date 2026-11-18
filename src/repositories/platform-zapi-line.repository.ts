import type { PlatformZapiLine, PlatformZapiLineStatus } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** The platform line table holds a single row with this id. */
export const PLATFORM_ZAPI_LINE_ID = 'default'

export interface PlatformZapiLineCredentialsInput {
  instanceId: string
  encryptedToken: string
  encryptedClientToken: string | null
  label: string | null
  updatedById: string
}

export interface PlatformZapiLineStatusInput {
  status: PlatformZapiLineStatus
  statusError?: string | null
  /** Pass null to clear (disconnected); undefined keeps the saved value. */
  phone?: string | null
  connectedAt?: Date | null
}

export const PlatformZapiLineRepository = {
  async find(): Promise<Result<PlatformZapiLine | null>> {
    try {
      return ok(
        await prisma.platformZapiLine.findUnique({
          where: { id: PLATFORM_ZAPI_LINE_ID },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find the platform Z-API line', error))
    }
  },

  /** Saves new credentials and resets the connection state. */
  async upsertCredentials(
    data: PlatformZapiLineCredentialsInput,
  ): Promise<Result<PlatformZapiLine>> {
    const reset = {
      status: 'DISCONNECTED' as const,
      statusError: null,
      phone: null,
      connectedAt: null,
      statusCheckedAt: null,
    }
    try {
      return ok(
        await prisma.platformZapiLine.upsert({
          where: { id: PLATFORM_ZAPI_LINE_ID },
          create: { id: PLATFORM_ZAPI_LINE_ID, ...data, ...reset },
          update: { ...data, ...reset },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save the platform Z-API line', error))
    }
  },

  /** Null when there is no line to update. */
  async updateStatus(
    data: PlatformZapiLineStatusInput,
    updatedById?: string,
  ): Promise<Result<PlatformZapiLine | null>> {
    try {
      const result = await prisma.platformZapiLine.updateMany({
        where: { id: PLATFORM_ZAPI_LINE_ID },
        data: {
          status: data.status,
          statusError: data.statusError ?? null,
          statusCheckedAt: new Date(),
          ...(data.phone !== undefined && { phone: data.phone }),
          ...(data.connectedAt !== undefined && {
            connectedAt: data.connectedAt,
          }),
          ...(updatedById && { updatedById }),
        },
      })
      if (result.count === 0) return ok(null)
      return PlatformZapiLineRepository.find()
    } catch (error) {
      return err(dbError('Failed to update the platform Z-API line', error))
    }
  },

  async remove(): Promise<Result<void>> {
    try {
      await prisma.platformZapiLine.deleteMany({
        where: { id: PLATFORM_ZAPI_LINE_ID },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to remove the platform Z-API line', error))
    }
  },
}
