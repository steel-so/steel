import type {
  SdInventoryScanStatus,
  SdInventorySnmpTarget,
} from '@prisma/client'
import { sdInventoryTargetNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb, sdDbFind } from './sd-config-db'

export interface SdInventoryTargetData {
  name?: string
  ranges?: string[]
  port?: number
  communityEnc?: string
  intervalMinutes?: number
  active?: boolean
  customerId?: string | null
  nextRunAt?: Date | null
}

/** Alvos de varredura SNMP. Exclusão lógica, como as demais coleções. */
export const SdInventoryTargetRepository = {
  async list(workspaceId: string): Promise<Result<SdInventorySnmpTarget[]>> {
    return sdDb('Failed to list ServiceDesk inventory targets', () =>
      prisma.sdInventorySnmpTarget.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    )
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdInventorySnmpTarget>> {
    return sdDbFind(
      'Failed to find ServiceDesk inventory target',
      () =>
        prisma.sdInventorySnmpTarget.findFirst({
          where: { id, workspaceId, deletedAt: null },
        }),
      sdInventoryTargetNotFound(),
    )
  },

  /** Para o worker, que só tem o id do job (sem workspace). */
  async findByIdUnscoped(
    id: string,
  ): Promise<Result<SdInventorySnmpTarget | null>> {
    return sdDb('Failed to load ServiceDesk inventory target', () =>
      prisma.sdInventorySnmpTarget.findFirst({
        where: { id, deletedAt: null },
      }),
    )
  },

  /** Ativos com a hora de rodar chegada (ou nunca rodados). */
  async listDue(
    now: Date,
    limit: number,
  ): Promise<Result<SdInventorySnmpTarget[]>> {
    return sdDb('Failed to list due ServiceDesk inventory targets', () =>
      prisma.sdInventorySnmpTarget.findMany({
        where: {
          active: true,
          deletedAt: null,
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
        orderBy: { nextRunAt: 'asc' },
        take: limit,
      }),
    )
  },

  async create(
    data: SdInventoryTargetData & {
      workspaceId: string
      name: string
      ranges: string[]
      communityEnc: string
      createdById: string
    },
  ): Promise<Result<SdInventorySnmpTarget>> {
    return sdDb('Failed to create ServiceDesk inventory target', () =>
      prisma.sdInventorySnmpTarget.create({ data }),
    )
  },

  async update(
    id: string,
    workspaceId: string,
    data: SdInventoryTargetData,
  ): Promise<Result<SdInventorySnmpTarget>> {
    return sdDb('Failed to update ServiceDesk inventory target', () =>
      prisma.sdInventorySnmpTarget.update({
        where: { id, workspaceId },
        data,
      }),
    )
  },

  async softDelete(id: string, workspaceId: string): Promise<Result<void>> {
    return sdDb('Failed to delete ServiceDesk inventory target', async () => {
      await prisma.sdInventorySnmpTarget.update({
        where: { id, workspaceId },
        data: { deletedAt: new Date(), active: false },
      })
    })
  },

  /** Resultado da varredura e a próxima execução. */
  async markRun(
    id: string,
    data: {
      lastRunAt: Date
      nextRunAt: Date
      lastStatus: SdInventoryScanStatus
      lastFound: number
      lastError: string | null
    },
  ): Promise<Result<void>> {
    return sdDb('Failed to record ServiceDesk inventory scan', async () => {
      await prisma.sdInventorySnmpTarget.update({ where: { id }, data })
    })
  },
}
