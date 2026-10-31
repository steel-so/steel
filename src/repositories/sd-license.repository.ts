import type { Prisma, SdSoftwareLicense } from '@prisma/client'
import { sdLicenseNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { ok, type Result } from '@/src/lib/result'
import { sdDb, sdDbFind } from './sd-config-db'

const listInclude = {
  _count: { select: { assignments: true } },
} satisfies Prisma.SdSoftwareLicenseInclude

export type SdLicenseRow = Prisma.SdSoftwareLicenseGetPayload<{
  include: typeof listInclude
}>

const detailInclude = {
  ...listInclude,
  assignments: {
    include: { configItem: { select: { id: true, name: true, code: true } } },
    orderBy: { configItem: { name: 'asc' as const } },
  },
} satisfies Prisma.SdSoftwareLicenseInclude

export type SdLicenseDetailRow = Prisma.SdSoftwareLicenseGetPayload<{
  include: typeof detailInclude
}>

export interface SdLicenseWriteData {
  name?: string
  vendor?: string | null
  matchPattern?: string
  seats?: number
  unitCostCents?: number | null
  purchasedAt?: Date | null
  expiresAt?: Date | null
  renewalNoticeDays?: number
  notes?: string | null
  lastNoticeKind?: string | null
  lastNoticeAt?: Date | null
  archivedAt?: Date | null
}

export interface SdInstalledDeviceRow {
  id: string
  hostname: string
  configItemId: string | null
  configItem: { name: string } | null
  software: { name: string; version: string }[]
}

/** Equipamentos vivos (geridos, não mesclados) com o software instalado. */
function installedWhere(
  workspaceId: string,
  pattern: string,
): Prisma.SdInventoryDeviceWhereInput {
  return {
    workspaceId,
    managed: true,
    ignored: false,
    mergedIntoId: null,
    software: { some: { name: { contains: pattern, mode: 'insensitive' } } },
  }
}

export const SdLicenseRepository = {
  async list(
    workspaceId: string,
    options: { search?: string; includeArchived?: boolean },
  ): Promise<Result<SdLicenseRow[]>> {
    return sdDb('Failed to list ServiceDesk licenses', () =>
      prisma.sdSoftwareLicense.findMany({
        where: {
          workspaceId,
          ...(options.includeArchived ? {} : { archivedAt: null }),
          ...(options.search
            ? {
                OR: [
                  { name: { contains: options.search, mode: 'insensitive' } },
                  { vendor: { contains: options.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: listInclude,
        orderBy: [{ name: 'asc' }],
      }),
    )
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdLicenseDetailRow>> {
    return sdDbFind(
      'Failed to find ServiceDesk license',
      () =>
        prisma.sdSoftwareLicense.findFirst({
          where: { id, workspaceId },
          include: detailInclude,
        }),
      sdLicenseNotFound(),
    )
  },

  async create(
    workspaceId: string,
    createdById: string,
    data: Required<
      Pick<SdLicenseWriteData, 'name' | 'matchPattern' | 'seats'>
    > &
      SdLicenseWriteData,
  ): Promise<Result<SdSoftwareLicense>> {
    return sdDb('Failed to create ServiceDesk license', () =>
      prisma.sdSoftwareLicense.create({
        data: { ...data, workspaceId, createdById },
      }),
    )
  },

  async update(
    id: string,
    workspaceId: string,
    data: SdLicenseWriteData,
  ): Promise<Result<SdSoftwareLicense>> {
    return sdDb('Failed to update ServiceDesk license', () =>
      prisma.sdSoftwareLicense.update({
        where: { id, workspaceId },
        data,
      }),
    )
  },

  /** Troca o conjunto de ativos atribuídos por inteiro. */
  async replaceAssets(
    licenseId: string,
    configItemIds: string[],
  ): Promise<Result<void>> {
    return sdDb('Failed to assign ServiceDesk license assets', async () => {
      await prisma.$transaction([
        prisma.sdSoftwareLicenseAsset.deleteMany({ where: { licenseId } }),
        prisma.sdSoftwareLicenseAsset.createMany({
          data: configItemIds.map((configItemId) => ({
            licenseId,
            configItemId,
          })),
          skipDuplicates: true,
        }),
      ])
    })
  },

  /** Quantos dos ids existem (vivos) no workspace. */
  async countConfigItems(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<number>> {
    return sdDb('Failed to count ServiceDesk config items', () =>
      prisma.sdConfigItem.count({
        where: { workspaceId, deletedAt: null, id: { in: ids } },
      }),
    )
  },

  async countInstalled(
    workspaceId: string,
    pattern: string,
  ): Promise<Result<number>> {
    return sdDb('Failed to count installed software', () =>
      prisma.sdInventoryDevice.count({
        where: installedWhere(workspaceId, pattern),
      }),
    )
  },

  async listInstalledDevices(
    workspaceId: string,
    pattern: string,
    limit: number,
  ): Promise<Result<SdInstalledDeviceRow[]>> {
    return sdDb('Failed to list devices with installed software', () =>
      prisma.sdInventoryDevice.findMany({
        where: installedWhere(workspaceId, pattern),
        select: {
          id: true,
          hostname: true,
          configItemId: true,
          configItem: { select: { name: true } },
          software: {
            where: { name: { contains: pattern, mode: 'insensitive' } },
            select: { name: true, version: true },
            orderBy: { name: 'asc' },
            take: 1,
          },
        },
        orderBy: { hostname: 'asc' },
        take: limit,
      }),
    )
  },

  /** Licenças (vivas) atribuídas a um ativo da CMDB. */
  async listForConfigItem(
    workspaceId: string,
    configItemId: string,
  ): Promise<Result<SdSoftwareLicense[]>> {
    return sdDb('Failed to list licenses of a config item', () =>
      prisma.sdSoftwareLicense.findMany({
        where: {
          workspaceId,
          archivedAt: null,
          assignments: { some: { configItemId } },
        },
        orderBy: { name: 'asc' },
      }),
    )
  },

  /** Licenças vivas com vencimento nos workspaces informados (para o aviso). */
  async listWithExpiry(
    workspaceIds: string[],
  ): Promise<Result<SdSoftwareLicense[]>> {
    if (workspaceIds.length === 0) return ok([])
    return sdDb('Failed to list expiring ServiceDesk licenses', () =>
      prisma.sdSoftwareLicense.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          archivedAt: null,
          expiresAt: { not: null },
        },
        orderBy: [{ workspaceId: 'asc' }, { expiresAt: 'asc' }],
      }),
    )
  },

  /**
   * Reserva o aviso: só vale (`true`) se este tipo ainda não foi enviado para
   * o vencimento atual, então dois ciclos nunca repetem a mensagem.
   */
  async claimNotice(
    id: string,
    kind: 'NOTICE' | 'EXPIRED',
    at: Date,
  ): Promise<Result<boolean>> {
    return sdDb('Failed to claim ServiceDesk license notice', async () => {
      const claimed = await prisma.sdSoftwareLicense.updateMany({
        where: {
          id,
          OR: [{ lastNoticeKind: null }, { lastNoticeKind: { not: kind } }],
        },
        data: { lastNoticeKind: kind, lastNoticeAt: at },
      })
      return claimed.count === 1
    })
  },

  /** Donos e administradores do workspace (destino dos avisos). */
  async listAdminUserIds(workspaceId: string): Promise<Result<string[]>> {
    return sdDb('Failed to list workspace admins', async () => {
      const rows = await prisma.membership.findMany({
        where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } },
        select: { userId: true },
      })
      return rows.map((row) => row.userId)
    })
  },
}
