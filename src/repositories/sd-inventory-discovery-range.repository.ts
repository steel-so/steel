import type {
  SdInventoryDiscoveryRange,
  SdInventoryScanStatus,
} from '@prisma/client'
import { sdInventoryDiscoveryRangeNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb, sdDbFind } from './sd-config-db'

export interface SdInventoryDiscoveryRangeData {
  name?: string
  cidr?: string
  enabled?: boolean
  intervalMinutes?: number
  customerId?: string | null
  nextRunAt?: Date | null
}

/** Faixas de descoberta por ping/ARP. Exclusão lógica. */
export const SdInventoryDiscoveryRangeRepository = {
  async list(
    workspaceId: string,
  ): Promise<Result<SdInventoryDiscoveryRange[]>> {
    return sdDb('Failed to list ServiceDesk discovery ranges', () =>
      prisma.sdInventoryDiscoveryRange.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    )
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdInventoryDiscoveryRange>> {
    return sdDbFind(
      'Failed to find ServiceDesk discovery range',
      () =>
        prisma.sdInventoryDiscoveryRange.findFirst({
          where: { id, workspaceId, deletedAt: null },
        }),
      sdInventoryDiscoveryRangeNotFound(),
    )
  },

  /** Para o worker, que só tem o id do job. */
  async findByIdUnscoped(
    id: string,
  ): Promise<Result<SdInventoryDiscoveryRange | null>> {
    return sdDb('Failed to load ServiceDesk discovery range', () =>
      prisma.sdInventoryDiscoveryRange.findFirst({
        where: { id, deletedAt: null },
      }),
    )
  },

  /** Só faixas com opt-in ligado e a hora chegada. */
  async listDue(
    now: Date,
    limit: number,
  ): Promise<Result<SdInventoryDiscoveryRange[]>> {
    return sdDb('Failed to list due ServiceDesk discovery ranges', () =>
      prisma.sdInventoryDiscoveryRange.findMany({
        where: {
          enabled: true,
          deletedAt: null,
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
        orderBy: { nextRunAt: 'asc' },
        take: limit,
      }),
    )
  },

  async create(
    data: SdInventoryDiscoveryRangeData & {
      workspaceId: string
      name: string
      cidr: string
      createdById: string
    },
  ): Promise<Result<SdInventoryDiscoveryRange>> {
    return sdDb('Failed to create ServiceDesk discovery range', () =>
      prisma.sdInventoryDiscoveryRange.create({ data }),
    )
  },

  async update(
    id: string,
    workspaceId: string,
    data: SdInventoryDiscoveryRangeData,
  ): Promise<Result<SdInventoryDiscoveryRange>> {
    return sdDb('Failed to update ServiceDesk discovery range', () =>
      prisma.sdInventoryDiscoveryRange.update({
        where: { id, workspaceId },
        data,
      }),
    )
  },

  async softDelete(id: string, workspaceId: string): Promise<Result<void>> {
    return sdDb('Failed to delete ServiceDesk discovery range', async () => {
      await prisma.sdInventoryDiscoveryRange.update({
        where: { id, workspaceId },
        data: { deletedAt: new Date(), enabled: false },
      })
    })
  },

  async markRun(
    id: string,
    data: {
      lastRunAt: Date
      nextRunAt: Date
      lastStatus: SdInventoryScanStatus
      lastProbed: number
      lastFound: number
      lastError: string | null
    },
  ): Promise<Result<void>> {
    return sdDb('Failed to record ServiceDesk discovery run', async () => {
      await prisma.sdInventoryDiscoveryRange.update({ where: { id }, data })
    })
  },
}
