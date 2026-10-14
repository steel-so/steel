import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '../lib/result'
import { dbError } from './db-error'

/** Per-user favorite wiki pages. Idempotent writes. */
export const WikiPageFavoriteRepository = {
  async add(userId: string, wikiPageId: string): Promise<Result<void>> {
    try {
      await prisma.wikiPageFavorite.upsert({
        where: { userId_wikiPageId: { userId, wikiPageId } },
        create: { userId, wikiPageId },
        update: {},
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to favorite wiki page', error))
    }
  },

  async remove(userId: string, wikiPageId: string): Promise<Result<void>> {
    try {
      await prisma.wikiPageFavorite.deleteMany({
        where: { userId, wikiPageId },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to unfavorite wiki page', error))
    }
  },

  async isFavorite(
    userId: string,
    wikiPageId: string,
  ): Promise<Result<boolean>> {
    try {
      const row = await prisma.wikiPageFavorite.findUnique({
        where: { userId_wikiPageId: { userId, wikiPageId } },
        select: { id: true },
      })
      return ok(row !== null)
    } catch (error) {
      return err(dbError('Failed to read wiki page favorite', error))
    }
  },

  /** Ids of the user's favorite pages in a workspace — one query per list. */
  async listPageIds(
    userId: string,
    workspaceId: string,
  ): Promise<Result<Set<string>>> {
    try {
      const rows = await prisma.wikiPageFavorite.findMany({
        where: { userId, wikiPage: { workspaceId } },
        select: { wikiPageId: true },
      })
      return ok(new Set(rows.map((row) => row.wikiPageId)))
    } catch (error) {
      return err(dbError('Failed to list wiki page favorites', error))
    }
  },
}
