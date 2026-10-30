import type {
  Prisma,
  SdInventorySoftware,
  SdInventorySource,
} from '@prisma/client'
import { sdInventoryDeviceNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { ok, type Result } from '@/src/lib/result'
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
  mergedInto: { select: { hostname: true } },
  mergedFrom: {
    select: { id: true, hostname: true, source: true },
    orderBy: { hostname: 'asc' as const },
  },
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

/** Só valem na criação: um "adotar" ou "mesclar" depois não é desfeito pelo relatório. */
export interface SdInventoryDeviceCreateOnly {
  managed: boolean
  discoveryRangeId: string | null
}

export interface SdInventoryDeviceFilters {
  search?: string
  source?: SdInventorySource
  hasAlert?: boolean
  stale?: boolean
  /** `true` = só os descobertos sem gestão; senão só os geridos. */
  discovered?: boolean
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
    'search' | 'source' | 'hasAlert' | 'stale' | 'discovered'
  >,
  staleBefore: Date,
): Prisma.SdInventoryDeviceWhereInput {
  const where: Prisma.SdInventoryDeviceWhereInput = {
    workspaceId,
    mergedIntoId: null,
    managed: !filters.discovered,
    ...(filters.discovered ? { ignored: false } : {}),
  }
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
    createOnly: SdInventoryDeviceCreateOnly = {
      managed: true,
      discoveryRangeId: null,
    },
  ): Promise<Result<SdInventoryDeviceRow>> {
    return sdDb('Failed to save ServiceDesk inventory device', () =>
      prisma.sdInventoryDevice.upsert({
        where: { workspaceId_externalKey: { workspaceId, externalKey } },
        create: { workspaceId, externalKey, ...data, ...createOnly },
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
      discovered: number
      stale: number
      openAlerts: number
    }>
  > {
    return sdDb('Failed to summarize ServiceDesk inventory', async () => {
      const live = { workspaceId, mergedIntoId: null, managed: true }
      const [total, agents, snmp, discovered, stale, openAlerts] =
        await Promise.all([
          prisma.sdInventoryDevice.count({ where: live }),
          prisma.sdInventoryDevice.count({
            where: { ...live, source: 'AGENT' },
          }),
          prisma.sdInventoryDevice.count({
            where: { ...live, source: 'SNMP' },
          }),
          prisma.sdInventoryDevice.count({
            where: {
              workspaceId,
              mergedIntoId: null,
              managed: false,
              ignored: false,
            },
          }),
          prisma.sdInventoryDevice.count({
            where: { ...live, lastSeenAt: { lt: staleBefore } },
          }),
          prisma.sdInventoryAlert.count({
            where: {
              workspaceId,
              status: 'OPEN',
              device: { mergedIntoId: null },
            },
          }),
        ])
      return { total, agents, snmp, discovered, stale, openAlerts }
    })
  },

  /** Qualquer ficha do workspace (principal, secundária ou descoberta). */
  async findRowById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdInventoryDeviceRow>> {
    return sdDbFind(
      'Failed to find ServiceDesk inventory device',
      () =>
        prisma.sdInventoryDevice.findFirst({
          where: { id, workspaceId },
          include: listInclude,
        }),
      sdInventoryDeviceNotFound(),
    )
  },

  /**
   * Fichas principais que podem ser a mesma máquina: série igual, algum MAC
   * em comum ou nome parecido. A decisão fina é de `findMergeMatch`.
   */
  async findMergeCandidates(
    workspaceId: string,
    probe: {
      id: string
      serialNumber: string | null
      macAddresses: string[]
      hostnameLabel: string | null
    },
  ): Promise<Result<SdInventoryDeviceRow[]>> {
    const or: Prisma.SdInventoryDeviceWhereInput[] = []
    if (probe.serialNumber) {
      or.push({
        serialNumber: { equals: probe.serialNumber, mode: 'insensitive' },
      })
    }
    if (probe.macAddresses.length > 0) {
      or.push({ macAddresses: { hasSome: probe.macAddresses } })
    }
    if (probe.hostnameLabel) {
      or.push({
        hostname: { startsWith: probe.hostnameLabel, mode: 'insensitive' },
      })
    }
    if (or.length === 0) return ok([])
    return sdDb('Failed to find ServiceDesk inventory merge candidates', () =>
      prisma.sdInventoryDevice.findMany({
        where: {
          workspaceId,
          id: { not: probe.id },
          mergedIntoId: null,
          OR: or,
        },
        include: listInclude,
        take: 25,
      }),
    )
  },

  /**
   * Já existe um equipamento gerido (agente ou SNMP) com este IP ou MAC?
   * Então a descoberta não cria uma ficha "descoberta" para ele.
   */
  async existsKnownAddress(
    workspaceId: string,
    address: { ip: string; mac: string | null },
  ): Promise<Result<boolean>> {
    return sdDb('Failed to look up ServiceDesk inventory address', async () => {
      const or: Prisma.SdInventoryDeviceWhereInput[] = [
        { ipAddresses: { has: address.ip } },
      ]
      if (address.mac) or.push({ macAddresses: { has: address.mac } })
      const found = await prisma.sdInventoryDevice.findFirst({
        where: { workspaceId, source: { not: 'DISCOVERY' }, OR: or },
        select: { id: true },
      })
      return found !== null
    })
  },

  /** Fichas que apontam para o principal. */
  async listMergedInto(
    workspaceId: string,
    primaryId: string,
  ): Promise<Result<SdInventoryDeviceRow[]>> {
    return sdDb('Failed to list merged ServiceDesk inventory devices', () =>
      prisma.sdInventoryDevice.findMany({
        where: { workspaceId, mergedIntoId: primaryId },
        include: listInclude,
      }),
    )
  },

  /**
   * Faz de `secondaryId` uma ficha secundária de `primaryId`, numa transação:
   * as fichas que já apontavam para a secundária passam para o principal e o
   * item da CMDB vai junto quando o principal ainda não tem um. Se os dois
   * têm item, o da secundária é só desligado (fica na CMDB para o admin
   * decidir) e o id volta em `orphanedConfigItemId`.
   */
  async mergeInto(
    workspaceId: string,
    secondaryId: string,
    primaryId: string,
    options: { lock: boolean },
  ): Promise<
    Result<{
      movedConfigItemId: string | null
      orphanedConfigItemId: string | null
    }>
  > {
    return sdDb('Failed to merge ServiceDesk inventory devices', () =>
      prisma.$transaction(async (tx) => {
        const [secondary, primary] = await Promise.all([
          tx.sdInventoryDevice.findFirst({
            where: { id: secondaryId, workspaceId },
            select: { configItemId: true },
          }),
          tx.sdInventoryDevice.findFirst({
            where: { id: primaryId, workspaceId },
            select: { configItemId: true },
          }),
        ])
        let movedConfigItemId: string | null = null
        let orphanedConfigItemId: string | null = null
        const itemId = secondary?.configItemId ?? null
        if (itemId) {
          // `configItemId` é único: solta da secundária antes de ligar.
          await tx.sdInventoryDevice.update({
            where: { id: secondaryId },
            data: { configItemId: null },
          })
          if (primary && !primary.configItemId) {
            await tx.sdInventoryDevice.update({
              where: { id: primaryId },
              data: { configItemId: itemId },
            })
            movedConfigItemId = itemId
          } else {
            orphanedConfigItemId = itemId
          }
        }
        await tx.sdInventoryDevice.updateMany({
          where: { workspaceId, mergedIntoId: secondaryId },
          data: { mergedIntoId: primaryId },
        })
        await tx.sdInventoryDevice.update({
          where: { id: secondaryId },
          data: { mergedIntoId: primaryId, mergeLocked: options.lock },
        })
        return { movedConfigItemId, orphanedConfigItemId }
      }),
    )
  },

  /** Desfaz a mescla e trava a automática para esta ficha. */
  async unmerge(
    workspaceId: string,
    deviceId: string,
  ): Promise<Result<SdInventoryDeviceRow>> {
    return sdDb('Failed to unmerge ServiceDesk inventory device', () =>
      prisma.sdInventoryDevice.update({
        where: { id: deviceId, workspaceId },
        data: { mergedIntoId: null, mergeLocked: true },
        include: listInclude,
      }),
    )
  },

  /** Preenche no principal o que a ficha secundária sabe a mais. */
  async updateFacts(
    id: string,
    data: {
      manufacturer?: string
      model?: string
      serialNumber?: string
      ipAddresses?: string[]
      macAddresses?: string[]
    },
  ): Promise<Result<void>> {
    return sdDb(
      'Failed to update ServiceDesk inventory device facts',
      async () => {
        await prisma.sdInventoryDevice.update({ where: { id }, data })
      },
    )
  },

  /** Adota um descoberto: passa a ser gerido (e a CMDB o acompanha). */
  async markManaged(id: string): Promise<Result<SdInventoryDeviceRow>> {
    return sdDb('Failed to adopt ServiceDesk inventory device', () =>
      prisma.sdInventoryDevice.update({
        where: { id },
        data: { managed: true },
        include: listInclude,
      }),
    )
  },

  /** Descarta um descoberto: some da lista e a descoberta não o recria. */
  async markIgnored(id: string, workspaceId: string): Promise<Result<void>> {
    return sdDb('Failed to dismiss ServiceDesk inventory device', async () => {
      await prisma.sdInventoryDevice.update({
        where: { id, workspaceId },
        data: { ignored: true },
      })
    })
  },

  /** Catálogo de software agrupado por nome/versão (base do S7). */
  async listSoftware(
    workspaceId: string,
    options: { search?: string; page: number; pageSize: number },
  ): Promise<Result<{ items: SdInventorySoftwareGroup[]; total: number }>> {
    return sdDb('Failed to list ServiceDesk inventory software', async () => {
      const where: Prisma.SdInventorySoftwareWhereInput = {
        device: { workspaceId, managed: true },
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
