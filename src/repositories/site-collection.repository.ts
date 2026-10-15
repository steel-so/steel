import type {
  Prisma,
  SiteCollection,
  SiteCollectionItem,
  SiteCollectionItemStatus,
} from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

/** Collections (custom content types) of a site and their items. */

export type SiteCollectionWithCount = SiteCollection & {
  _count: { items: number }
}

const withCount = { _count: { select: { items: true } } } as const

const collectionNotFound = () =>
  appError('SITE_COLLECTION_NOT_FOUND', 'Coleção não encontrada')
const itemNotFound = () =>
  appError('SITE_COLLECTION_ITEM_NOT_FOUND', 'Item não encontrado')
const collectionSlugTaken = () =>
  appError(
    'SITE_COLLECTION_SLUG_TAKEN',
    'Já existe uma coleção com este endereço',
  )
const itemSlugTaken = () =>
  appError(
    'SITE_COLLECTION_ITEM_SLUG_TAKEN',
    'Já existe um item com este endereço nesta coleção',
  )

export interface SiteCollectionItemFilters {
  status?: SiteCollectionItemStatus
  search?: string
}

export const SiteCollectionRepository = {
  async list(siteId: string): Promise<Result<SiteCollectionWithCount[]>> {
    try {
      return ok(
        await prisma.siteCollection.findMany({
          where: { siteId },
          include: withCount,
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list site collections', error))
    }
  },

  async findById(
    id: string,
    siteId: string,
  ): Promise<Result<SiteCollectionWithCount>> {
    try {
      const collection = await prisma.siteCollection.findFirst({
        where: { id, siteId },
        include: withCount,
      })
      return collection ? ok(collection) : err(collectionNotFound())
    } catch (error) {
      return err(dbError('Failed to find site collection', error))
    }
  },

  async count(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.siteCollection.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count site collections', error))
    }
  },

  async create(data: {
    siteId: string
    name: string
    itemName: string
    slug: string
    fields: Prisma.InputJsonValue
    position: number
  }): Promise<Result<SiteCollectionWithCount>> {
    try {
      return ok(
        await prisma.siteCollection.create({ data, include: withCount }),
      )
    } catch (error) {
      if (isUniqueViolation(error)) return err(collectionSlugTaken())
      return err(dbError('Failed to create site collection', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      itemName?: string
      slug?: string
      fields?: Prisma.InputJsonValue
      templateGlobalId?: string | null
    },
  ): Promise<Result<SiteCollectionWithCount>> {
    try {
      return ok(
        await prisma.siteCollection.update({
          where: { id },
          data,
          include: withCount,
        }),
      )
    } catch (error) {
      if (isUniqueViolation(error)) return err(collectionSlugTaken())
      return err(dbError('Failed to update site collection', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.siteCollection.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site collection', error))
    }
  },

  // ─── items ──────────────────────────────────────────────────────────────

  async listItems(
    collectionId: string,
    filters: SiteCollectionItemFilters = {},
  ): Promise<Result<SiteCollectionItem[]>> {
    try {
      return ok(
        await prisma.siteCollectionItem.findMany({
          where: {
            collectionId,
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.search
              ? { title: { contains: filters.search, mode: 'insensitive' } }
              : {}),
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          take: 1000,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list collection items', error))
    }
  },

  async findItem(
    id: string,
    collectionId: string,
  ): Promise<Result<SiteCollectionItem>> {
    try {
      const item = await prisma.siteCollectionItem.findFirst({
        where: { id, collectionId },
      })
      return item ? ok(item) : err(itemNotFound())
    } catch (error) {
      return err(dbError('Failed to find collection item', error))
    }
  },

  /** Items among `ids` of the site's collections (reference checks). */
  async findItemsInSite(
    siteId: string,
    ids: string[],
  ): Promise<
    Result<Array<SiteCollectionItem & { collection: { id: string } }>>
  > {
    try {
      return ok(
        await prisma.siteCollectionItem.findMany({
          where: { id: { in: ids }, collection: { siteId } },
          include: { collection: { select: { id: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find collection items', error))
    }
  },

  async countItems(collectionId: string): Promise<Result<number>> {
    try {
      return ok(
        await prisma.siteCollectionItem.count({ where: { collectionId } }),
      )
    } catch (error) {
      return err(dbError('Failed to count collection items', error))
    }
  },

  async itemSlugsLike(
    collectionId: string,
    base: string,
    excludeId?: string,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.siteCollectionItem.findMany({
        where: {
          collectionId,
          slug: { startsWith: base },
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { slug: true },
      })
      return ok(rows.map((row) => row.slug))
    } catch (error) {
      return err(dbError('Failed to list collection item slugs', error))
    }
  },

  async createItem(data: {
    collectionId: string
    title: string
    slug: string
    data: Prisma.InputJsonValue
    status: SiteCollectionItemStatus
    position: number
    publishedAt: Date | null
  }): Promise<Result<SiteCollectionItem>> {
    try {
      return ok(await prisma.siteCollectionItem.create({ data }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(itemSlugTaken())
      return err(dbError('Failed to create collection item', error))
    }
  },

  async updateItem(
    id: string,
    data: {
      title?: string
      slug?: string
      data?: Prisma.InputJsonValue
      status?: SiteCollectionItemStatus
      publishedAt?: Date | null
    },
  ): Promise<Result<SiteCollectionItem>> {
    try {
      return ok(await prisma.siteCollectionItem.update({ where: { id }, data }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(itemSlugTaken())
      return err(dbError('Failed to update collection item', error))
    }
  },

  async deleteItem(id: string): Promise<Result<void>> {
    try {
      await prisma.siteCollectionItem.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete collection item', error))
    }
  },

  /** Positions follow `orderedIds` (ids of other collections are ignored). */
  async reorderItems(
    collectionId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.siteCollectionItem.updateMany({
            where: { id, collectionId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder collection items', error))
    }
  },

  // ─── public runtime ─────────────────────────────────────────────────────

  /** Collections of a site with their published items (runtime). */
  async listPublished(
    siteId: string,
    collectionIds?: string[],
  ): Promise<Result<Array<SiteCollection & { items: SiteCollectionItem[] }>>> {
    try {
      return ok(
        await prisma.siteCollection.findMany({
          where: {
            siteId,
            ...(collectionIds ? { id: { in: collectionIds } } : {}),
          },
          include: {
            items: {
              where: { status: 'PUBLISHED' },
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
              take: 1000,
            },
          },
          orderBy: { position: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list published collections', error))
    }
  },
}
