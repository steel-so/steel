import type { SiteSeoKeyword, SiteSeoSnapshot } from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

export interface SnapshotInput {
  siteId: string
  day: Date
  seo: number
  aeo: number
  geo: number
  pages: number
  issues: number
}

export const SiteSeoRepository = {
  async listKeywords(siteId: string): Promise<Result<SiteSeoKeyword[]>> {
    try {
      return ok(
        await prisma.siteSeoKeyword.findMany({
          where: { siteId },
          orderBy: { createdAt: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list site SEO keywords', error))
    }
  },

  async countKeywords(siteId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.siteSeoKeyword.count({ where: { siteId } }))
    } catch (error) {
      return err(dbError('Failed to count site SEO keywords', error))
    }
  },

  async createKeyword(data: {
    siteId: string
    term: string
    normalized: string
    createdById: string
  }): Promise<Result<SiteSeoKeyword>> {
    try {
      return ok(await prisma.siteSeoKeyword.create({ data }))
    } catch (error) {
      if (isUniqueViolation(error)) {
        return err(
          appError(
            'SEO_KEYWORD_DUPLICATE',
            'Esta palavra-chave já está sendo acompanhada',
          ),
        )
      }
      return err(dbError('Failed to create site SEO keyword', error))
    }
  },

  async deleteKeyword(id: string, siteId: string): Promise<Result<void>> {
    try {
      const { count } = await prisma.siteSeoKeyword.deleteMany({
        where: { id, siteId },
      })
      if (!count) {
        return err(
          appError('SEO_KEYWORD_NOT_FOUND', 'Palavra-chave não encontrada'),
        )
      }
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete site SEO keyword', error))
    }
  },

  /** Snapshots of the given sites since `since` (inclusive), oldest first. */
  async listSnapshots(
    siteIds: string[],
    since: Date,
  ): Promise<Result<SiteSeoSnapshot[]>> {
    try {
      return ok(
        await prisma.siteSeoSnapshot.findMany({
          where: { siteId: { in: siteIds }, day: { gte: since } },
          orderBy: { day: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list site SEO snapshots', error))
    }
  },

  /** One snapshot per site and day: a later run of the day overwrites it. */
  async upsertSnapshot(data: SnapshotInput): Promise<Result<void>> {
    try {
      const { siteId, day, ...scores } = data
      await prisma.siteSeoSnapshot.upsert({
        where: { siteId_day: { siteId, day } },
        create: { siteId, day, ...scores },
        update: scores,
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to save site SEO snapshot', error))
    }
  },

  /** Sites that get a daily snapshot: not deleted and with pages. */
  async listSiteIdsForSnapshot(): Promise<
    Result<Array<{ id: string; workspaceId: string }>>
  > {
    try {
      return ok(
        await prisma.site.findMany({
          where: { deletedAt: null, pages: { some: {} } },
          select: { id: true, workspaceId: true },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list sites for SEO snapshots', error))
    }
  },

  /** Drops snapshots older than `before`. */
  async pruneSnapshots(before: Date): Promise<Result<number>> {
    try {
      const { count } = await prisma.siteSeoSnapshot.deleteMany({
        where: { day: { lt: before } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to prune site SEO snapshots', error))
    }
  },
}
