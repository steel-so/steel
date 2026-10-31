import type {
  Prisma,
  WhatsAppCatalogOrder,
  WhatsAppCatalogProduct,
  WhatsAppCatalogSource,
  WhatsAppCommerceSettings,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppCommerceSettingsRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppCommerceSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppCommerceSettings.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp commerce settings', error))
    }
  },

  async upsert(
    workspaceId: string,
    data: Omit<
      Prisma.WhatsAppCommerceSettingsUncheckedCreateInput,
      'workspaceId'
    >,
  ): Promise<Result<WhatsAppCommerceSettings>> {
    try {
      return ok(
        await prisma.whatsAppCommerceSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to upsert whatsapp commerce settings', error))
    }
  },
}

export interface CatalogProductUpsert {
  externalId: string
  retailerId: string
  name: string
  description: string | null
  price: number
  currency: string
  imageUrl: string | null
  url: string | null
  available: boolean
}

export const WhatsAppCatalogProductRepository = {
  async list(
    workspaceId: string,
    filter: { available?: boolean; search?: string } = {},
  ): Promise<Result<WhatsAppCatalogProduct[]>> {
    try {
      return ok(
        await prisma.whatsAppCatalogProduct.findMany({
          where: {
            workspaceId,
            ...(filter.available === undefined
              ? {}
              : { available: filter.available }),
            ...(filter.search
              ? { name: { contains: filter.search, mode: 'insensitive' } }
              : {}),
          },
          orderBy: [{ available: 'desc' }, { name: 'asc' }],
          take: 500,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp catalog products', error))
    }
  },

  async findManyByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<WhatsAppCatalogProduct[]>> {
    try {
      return ok(
        await prisma.whatsAppCatalogProduct.findMany({
          where: { workspaceId, id: { in: ids } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp catalog products', error))
    }
  },

  async findManyByRetailerIds(
    workspaceId: string,
    retailerIds: string[],
  ): Promise<Result<WhatsAppCatalogProduct[]>> {
    try {
      return ok(
        await prisma.whatsAppCatalogProduct.findMany({
          where: { workspaceId, retailerId: { in: retailerIds } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp catalog products', error))
    }
  },

  async setAvailable(
    workspaceId: string,
    id: string,
    available: boolean,
  ): Promise<Result<WhatsAppCatalogProduct | null>> {
    try {
      const found = await prisma.whatsAppCatalogProduct.findFirst({
        where: { id, workspaceId },
        select: { id: true },
      })
      if (!found) return ok(null)
      return ok(
        await prisma.whatsAppCatalogProduct.update({
          where: { id },
          data: { available },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update whatsapp catalog product', error))
    }
  },

  /**
   * Mirrors one source: upserts the given products and marks every other
   * product of that source unavailable (it left the source or was archived).
   */
  async syncSource(
    workspaceId: string,
    source: WhatsAppCatalogSource,
    products: CatalogProductUpsert[],
  ): Promise<Result<{ created: number; updated: number; removed: number }>> {
    try {
      const now = new Date()
      return ok(
        await prisma.$transaction(async (tx) => {
          const existing = await tx.whatsAppCatalogProduct.findMany({
            where: { workspaceId, source },
            select: { retailerId: true },
          })
          const known = new Set(existing.map((row) => row.retailerId))
          let created = 0
          let updated = 0
          for (const product of products) {
            const data = { ...product, source, syncedAt: now }
            await tx.whatsAppCatalogProduct.upsert({
              where: {
                workspaceId_retailerId: {
                  workspaceId,
                  retailerId: product.retailerId,
                },
              },
              create: { workspaceId, ...data },
              update: data,
            })
            if (known.has(product.retailerId)) updated += 1
            else created += 1
          }
          const removed = await tx.whatsAppCatalogProduct.updateMany({
            where: {
              workspaceId,
              source,
              available: true,
              syncedAt: { lt: now },
            },
            data: { available: false },
          })
          return { created, updated, removed: removed.count }
        }),
      )
    } catch (error) {
      return err(dbError('Failed to sync whatsapp catalog products', error))
    }
  },
}

export const WhatsAppCatalogOrderRepository = {
  /** `null` when the provider message id was already stored (a retry). */
  async create(
    data: Prisma.WhatsAppCatalogOrderUncheckedCreateInput,
  ): Promise<Result<WhatsAppCatalogOrder | null>> {
    try {
      const duplicate = await prisma.whatsAppCatalogOrder.findUnique({
        where: { providerMessageId: data.providerMessageId },
        select: { id: true },
      })
      if (duplicate) return ok(null)
      return ok(await prisma.whatsAppCatalogOrder.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp catalog order', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppCatalogOrderUncheckedUpdateInput,
  ): Promise<Result<WhatsAppCatalogOrder>> {
    try {
      return ok(
        await prisma.whatsAppCatalogOrder.update({ where: { id }, data }),
      )
    } catch (error) {
      return err(dbError('Failed to update whatsapp catalog order', error))
    }
  },

  async list(
    workspaceId: string,
    take = 100,
  ): Promise<
    Result<
      (WhatsAppCatalogOrder & {
        contact: { name: string | null; waId: string }
      })[]
    >
  > {
    try {
      return ok(
        await prisma.whatsAppCatalogOrder.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          include: { contact: { select: { name: true, waId: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp catalog orders', error))
    }
  },
}
