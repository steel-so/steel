import type { Prisma, SdStatusComponentState } from '@prisma/client'
import { sdStatusComponentNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type SdStatusComponentRow = Prisma.SdStatusComponentGetPayload<object>

export interface SdStatusComponentCreateInput {
  workspaceId: string
  pageId: string
  name: string
  serviceId: string | null
  state: SdStatusComponentState
}

export interface SdStatusComponentUpdateInput {
  name?: string
  serviceId?: string | null
  state?: SdStatusComponentState
  position?: number
}

/** Per-service components of a status page (their state is set by agents). */
export const SdStatusComponentRepository = {
  async listByPage(
    pageId: string,
    workspaceId: string,
  ): Promise<Result<SdStatusComponentRow[]>> {
    try {
      return ok(
        await prisma.sdStatusComponent.findMany({
          where: { pageId, workspaceId },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list status components', error))
    }
  },

  async create(
    input: SdStatusComponentCreateInput,
  ): Promise<Result<SdStatusComponentRow>> {
    try {
      const last = await prisma.sdStatusComponent.aggregate({
        where: { pageId: input.pageId },
        _max: { position: true },
      })
      return ok(
        await prisma.sdStatusComponent.create({
          data: { ...input, position: (last._max.position ?? -1) + 1 },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to create status component', error))
    }
  },

  async update(
    id: string,
    pageId: string,
    workspaceId: string,
    data: SdStatusComponentUpdateInput,
  ): Promise<Result<SdStatusComponentRow>> {
    try {
      const current = await prisma.sdStatusComponent.findFirst({
        where: { id, pageId, workspaceId },
      })
      if (!current) return err(sdStatusComponentNotFound())
      return ok(
        await prisma.sdStatusComponent.update({
          where: { id },
          data: {
            ...data,
            ...(data.state !== undefined && data.state !== current.state
              ? { stateChangedAt: new Date() }
              : {}),
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update status component', error))
    }
  },

  async remove(
    id: string,
    pageId: string,
    workspaceId: string,
  ): Promise<Result<true>> {
    try {
      const result = await prisma.sdStatusComponent.deleteMany({
        where: { id, pageId, workspaceId },
      })
      return result.count === 0 ? err(sdStatusComponentNotFound()) : ok(true)
    } catch (error) {
      return err(dbError('Failed to delete status component', error))
    }
  },
}
