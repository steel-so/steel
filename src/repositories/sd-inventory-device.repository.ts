import type {
  Prisma,
  SdInventorySoftware,
  SdInventorySource,
} from '@prisma/client'
import { sdInventoryDeviceNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb, sdDbFind } from './sd-config-db'

const listInclude = {
  _count: { select: { alerts: { where: { status: 'OPEN' as const } } } },
} satisfies Prisma.SdInventoryDeviceInclude

export type SdInventoryDeviceRow = Prisma.SdInventoryDeviceGetPayload<{
  include: typeof listInclude
}>

const detailInclude = {
  ...listInclude,
  software: { orderBy: { name: 'asc' as const } },
  alerts: { orderBy: { openedAt: 'desc' as const } },
  configItem: { select: { name: true } },
} satisfies Prisma.SdInventoryDeviceInclude

export type SdInventoryDeviceDetailRow = Prisma.SdInventoryDeviceGetPayload<{
  include: typeof detailInclude
}>

export interface SdInventoryDeviceWriteData {
  source: SdInventorySource
  hostname: string
  osName: string | null
  osVersion: string | null
  arch: string | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  cpuModel: string | null
  cpuCores: number | null
  ramTotalMb: number | null
  ramUsedMb: number | null
  ipAddresses: string[]
  macAddresses: string[]
  disks: Prisma.InputJsonValue
  agentVersion: string | null
  snmpTargetId: string | null
  tokenId: string | null
  lastSeenAt: Date
}

export interface SdInventoryDeviceFilters {
  search?: string
  source?: SdInventorySource
  hasAlert?: boolean
  stale?: boolean
  page: number
  pageSize: number
}

export interface SdInventorySoftwareInput {
  name: string
  version: string
  publisher: string | null
}

export interface SdInventorySoftwareGroup {
  name: string
  version: string
  publisher: string | null
  deviceCount: number
}

function buildWhere(
  workspaceId: string,
  filters: Pick<
    SdInventoryDeviceFilters,
    'search' | 'source' | 'hasAlert' | 'stale'
  >,
  staleBefore: Date,
): Prisma.SdInventoryDeviceWhereInput {
  const where: Prisma.SdInventoryDeviceWhereInput = { workspaceId }
  if (filters.source) where.source = filters.source
  if (filters.hasAlert) where.alerts = { some: { status: 'OPEN' } }
  if (filters.stale) where.lastSeenAt = { lt: staleBefore }
  if (filters.search) {
    const term = filters.search
    where.OR = [
      { hostname: { contains: term, mode: 'insensitive' } },
      { serialNumber: { contains: term, mode: 'insensitive' } },
      { osName: { contains: term, mode: 'insensitive' } },
      { ipAddresses: { has: term } },
    ]
  }
  return where
}

export const SdInventoryDeviceRepository = {
  async findByKey(
    workspaceId: string,
    externalKey: string,
  ): Promise<Result<SdInventoryDeviceRow | null>> {
    return sdDb('Failed to find ServiceDesk inventory device by key', () =>
      prisma.sdInventoryDevice.findUnique({
        where: { workspaceId_externalKey: { workspaceId, externalKey } },
        include: listInclude,
      }),
    )
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdInventoryDeviceDetailRow>> {
    return sdDbFind(
      'Failed to find ServiceDesk inventory device',
      () =>
        prisma.sdInventoryDevice.findFirst({
          where: { id, workspaceId },
          include: detailInclude,
        }),
      sdInventoryDeviceNotFound(),
    )
  },

  /** Cria ou atualiza pela identidade estável (`workspaceId + externalKey`). */
  async upsert(
    workspaceId: string,
    externalKey: string,
    data: SdInventoryDeviceWriteData,
  ): Promise<Result<SdInventoryDeviceRow>> {
    return sdDb('Failed to save ServiceDesk inventory device', () =>
      prisma.sdInventoryDevice.upsert({
        where: { workspaceId_externalKey: { workspaceId, externalKey } },
        create: { workspaceId, externalKey, ...data },
        update: data,
        include: listInclude,
      }),
    )
  },

  async linkConfigItem(
    id: string,
    configItemId: string | null,
  ): Promise<Result<void>> {
    return sdDb('Failed to link ServiceDesk inventory device', async () => {
      await prisma.sdInventoryDevice.update({
        where: { id },
        data: { configItemId },
      })
    })
  },

  /** Troca a lista de software inteira (o agente manda o estado atual). */
  async replaceSoftware(
    deviceId: string,
    items: SdInventorySoftwareInput[],
  ): Promise<Result<number>> {
    return sdDb('Failed to replace ServiceDesk inventory software', () =>
      prisma.$transaction(async (tx) => {
        await tx.sdInventorySoftware.deleteMany({ where: { deviceId } })
        if (items.length === 0) return 0
        const created = await tx.sdInventorySoftware.createMany({
          data: items.map((item) => ({ ...item, deviceId })),
          skipDuplicates: true,
        })
        return created.count
      }),
    )
  },

  /**
   * Item da CMDB cadastrado à mão com o mesmo número de série e que ainda
   * não está ligado a nenhum equipamento: o inventário adota em vez de criar
   * um duplicado.
   */
  async findAdoptableConfigItem(
    workspaceId: string,
    serialNumber: string,
  ): Promise<Result<{ id: string } | null>> {
    return sdDb('Failed to look up adoptable ServiceDesk config item', () =>
      prisma.sdConfigItem.findFirst({
        where: {
          workspaceId,
          deletedAt: null,
          serialNumber: { equals: serialNumber, mode: 'insensitive' },
          inventoryDevice: null,
        },
        select: { id: true },
      }),
    )
  },

  /** Tipo da CMDB pelo nome exato: acha ou cria (único por workspace). */
  async ensureConfigItemType(
    workspaceId: string,
    name: string,
  ): Promise<Result<{ id: string }>> {
    return sdDb('Failed to ensure ServiceDesk config item type', () =>
      prisma.sdConfigItemType.upsert({
        where: { workspaceId_name: { workspaceId, name } },
        create: { workspaceId, name },
        update: {},
        select: { id: true },
      }),
    )
  },

  async list(
    workspaceId: string,
    filters: SdInventoryDeviceFilters,
    staleBefore: Date,
  ): Promise<Result<{ items: SdInventoryDeviceRow[]; total: number }>> {
    return sdDb('Failed to list ServiceDesk inventory devices', async () => {
      const where = buildWhere(workspaceId, filters, staleBefore)
      const [items, total] = await Promise.all([
        prisma.sdInventoryDevice.findMany({
          where,
          include: listInclude,
          orderBy: { hostname: 'asc' },
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        prisma.sdInventoryDevice.count({ where }),
      ])
      return { items, total }
    })
  },

  async summary(
    workspaceId: string,
    staleBefore: Date,
  ): Promise<
    Result<{
      total: number
      agents: number
      snmp: number
      stale: number
      openAlerts: number
    }>
  > {
    return sdDb('Failed to summarize ServiceDesk inventory', async () => {
      const [total, agents, stale, openAlerts] = await Promise.all([
        prisma.sdInventoryDevice.count({ where: { workspaceId } }),
        prisma.sdInventoryDevice.count({
          where: { workspaceId, source: 'AGENT' },
        }),
        prisma.sdInventoryDevice.count({
          where: { workspaceId, lastSeenAt: { lt: staleBefore } },
        }),
        prisma.sdInventoryAlert.count({
          where: { workspaceId, status: 'OPEN' },
        }),
      ])
      return { total, agents, snmp: total - agents, stale, openAlerts }
    })
  },

  /** Catálogo de software agrupado por nome/versão (base do S7). */
  async listSoftware(
    workspaceId: string,
    options: { search?: string; page: number; pageSize: number },
  ): Promise<Result<{ items: SdInventorySoftwareGroup[]; total: number }>> {
    return sdDb('Failed to list ServiceDesk inventory software', async () => {
      const where: Prisma.SdInventorySoftwareWhereInput = {
        device: { workspaceId },
        ...(options.search
          ? { name: { contains: options.search, mode: 'insensitive' } }
          : {}),
      }
      const groups = await prisma.sdInventorySoftware.groupBy({
        by: ['name', 'version', 'publisher'],
        where,
        _count: { deviceId: true },
        orderBy: [{ name: 'asc' }, { version: 'asc' }],
      })
      const start = (options.page - 1) * options.pageSize
      return {
        total: groups.length,
        items: groups.slice(start, start + options.pageSize).map((group) => ({
          name: group.name,
          version: group.version,
          publisher: group.publisher,
          deviceCount: group._count.deviceId,
        })),
      }
    })
  },
}

export type { SdInventorySoftware }
