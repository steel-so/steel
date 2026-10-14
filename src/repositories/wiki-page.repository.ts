import type { Prisma, WikiPage as WikiPageRow } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { wikiPageNotFound } from '../errors'
import { err, ok, type Result } from '../lib/result'
import { dbError } from './db-error'

const PERSON = { select: { id: true, name: true, image: true } } as const

// Every read and write carries the page's label ids and its author/editor,
// so the DTO a mutation returns never drops what the client already has.
const WIKI_PAGE_INCLUDE = {
  labels: { select: { labelId: true } },
  createdBy: PERSON,
  updatedBy: PERSON,
} satisfies Prisma.WikiPageInclude

export interface WikiPagePerson {
  id: string
  name: string
  image: string | null
}

export type WikiPage = WikiPageRow & {
  labels: { labelId: string }[]
  createdBy: WikiPagePerson | null
  updatedBy: WikiPagePerson | null
}

const EMPTY_CONTENT: Prisma.InputJsonValue = [
  { type: 'p', children: [{ text: '' }] },
]

export const WikiPageRepository = {
  async findById(id: string): Promise<Result<WikiPage>> {
    try {
      const wikiPage = await prisma.wikiPage.findUnique({
        where: { id },
        include: WIKI_PAGE_INCLUDE,
      })
      if (!wikiPage) return err(wikiPageNotFound())
      return ok(wikiPage)
    } catch (error) {
      return err(dbError('Failed to find wiki page by id', error))
    }
  },

  async listByWorkspace(workspaceId: string): Promise<Result<WikiPage[]>> {
    try {
      const wikiPages = await prisma.wikiPage.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: [{ parentId: 'asc' }, { position: 'asc' }],
        include: WIKI_PAGE_INCLUDE,
      })
      return ok(wikiPages)
    } catch (error) {
      return err(dbError('Failed to list wiki pages', error))
    }
  },

  async create(data: {
    workspaceId: string
    parentId: string | null
    title: string
    icon?: string
    createdById: string
  }): Promise<Result<WikiPage>> {
    try {
      const siblingCount = await prisma.wikiPage.count({
        where: {
          workspaceId: data.workspaceId,
          parentId: data.parentId,
          archivedAt: null,
        },
      })

      const wiki = await prisma.wikiPage.create({
        data: {
          workspaceId: data.workspaceId,
          parentId: data.parentId,
          title: data.title,
          icon: data.icon,
          content: EMPTY_CONTENT,
          position: siblingCount,
          createdById: data.createdById,
        },
        include: WIKI_PAGE_INCLUDE,
      })

      return ok(wiki)
    } catch (error) {
      return err(dbError('Failed to create wiki page', error))
    }
  },

  async update(
    id: string,
    data: {
      title?: string
      icon?: string | null
      coverImage?: string | null
      content?: Prisma.InputJsonValue
      updatedById: string
    },
  ): Promise<Result<WikiPage>> {
    try {
      const wikiPage = await prisma.wikiPage.update({
        where: { id },
        data,
        include: WIKI_PAGE_INCLUDE,
      })
      return ok(wikiPage)
    } catch (error) {
      return err(dbError('Failed to update wiki page', error))
    }
  },

  async move(
    id: string,
    data: { parentId: string | null; position: number; updatedById: string },
  ): Promise<Result<WikiPage>> {
    try {
      const wikiPage = await prisma.wikiPage.update({
        where: { id },
        data,
        include: WIKI_PAGE_INCLUDE,
      })
      return ok(wikiPage)
    } catch (error) {
      return err(dbError('Failed to move wiki page', error))
    }
  },

  // Archives the page and its whole subtree with one shared timestamp, so a
  // future restore can bring back exactly what went away together. Pages
  // already archived keep their own timestamp, but the walk still goes
  // through them to reach live descendants left behind by older archives.
  async archive(id: string, updatedById: string): Promise<Result<WikiPage>> {
    try {
      const archivedAt = new Date()
      const wikiPage = await prisma.$transaction(async (tx) => {
        const page = await tx.wikiPage.update({
          where: { id },
          data: { archivedAt, updatedById },
          include: WIKI_PAGE_INCLUDE,
        })

        let parentIds = [id]
        while (parentIds.length > 0) {
          const children = await tx.wikiPage.findMany({
            where: { parentId: { in: parentIds } },
            select: { id: true },
          })
          parentIds = children.map((child) => child.id)
          if (parentIds.length > 0) {
            await tx.wikiPage.updateMany({
              where: { id: { in: parentIds }, archivedAt: null },
              data: { archivedAt, updatedById },
            })
          }
        }

        return page
      })
      return ok(wikiPage)
    } catch (error) {
      return err(dbError('Failed to archive wiki page', error))
    }
  },

  async updateYjsState(
    id: string,
    data: { yjsState: Uint8Array; updatedById: string },
  ): Promise<Result<WikiPage>> {
    try {
      const wikiPage = await prisma.wikiPage.update({
        where: { id },
        // `Y.encodeStateAsUpdate()` types its result as
        // `Uint8Array<ArrayBufferLike>`, but Prisma's Bytes field wants
        // `Uint8Array<ArrayBuffer>` — copy into a plain ArrayBuffer-backed
        // array to satisfy it.
        data: { ...data, yjsState: new Uint8Array(data.yjsState) },
        include: WIKI_PAGE_INCLUDE,
      })
      return ok(wikiPage)
    } catch (error) {
      return err(dbError('Failed to persist wiki page yjs state', error))
    }
  },

  /** A live (not archived) page by its public link token. */
  async findPublishedByToken(publicToken: string): Promise<Result<WikiPage>> {
    try {
      const wikiPage = await prisma.wikiPage.findFirst({
        where: { publicToken, archivedAt: null },
        include: WIKI_PAGE_INCLUDE,
      })
      if (!wikiPage) return err(wikiPageNotFound())
      return ok(wikiPage)
    } catch (error) {
      return err(dbError('Failed to find published wiki page', error))
    }
  },

  /** Publishes (token + date) or unpublishes (both null) the page. */
  async setPublication(
    id: string,
    data: { publicToken: string | null; publishedAt: Date | null },
  ): Promise<Result<WikiPage>> {
    try {
      const wikiPage = await prisma.wikiPage.update({
        where: { id },
        data,
        include: WIKI_PAGE_INCLUDE,
      })
      return ok(wikiPage)
    } catch (error) {
      return err(dbError('Failed to set wiki page publication', error))
    }
  },

  /** Locks (date + who) or unlocks (both null) the page's editing. */
  async setLock(
    id: string,
    data: { lockedAt: Date | null; lockedById: string | null },
  ): Promise<Result<WikiPage>> {
    try {
      const wikiPage = await prisma.wikiPage.update({
        where: { id },
        data,
        include: WIKI_PAGE_INCLUDE,
      })
      return ok(wikiPage)
    } catch (error) {
      return err(dbError('Failed to set wiki page lock', error))
    }
  },

  /**
   * Copies a page right after it among its siblings: title, icon, cover,
   * content, the collaborative (Yjs) state — so the copy opens with the same
   * content in the realtime editor — and labels. The copy is never
   * published, locked or favorited, and sub-pages are not copied.
   */
  async duplicate(
    source: WikiPage,
    data: { title: string; createdById: string },
  ): Promise<Result<WikiPage>> {
    try {
      const copy = await prisma.$transaction(async (tx) => {
        await tx.wikiPage.updateMany({
          where: {
            workspaceId: source.workspaceId,
            parentId: source.parentId,
            archivedAt: null,
            position: { gt: source.position },
          },
          data: { position: { increment: 1 } },
        })

        const created = await tx.wikiPage.create({
          data: {
            workspaceId: source.workspaceId,
            parentId: source.parentId,
            title: data.title,
            icon: source.icon,
            coverImage: source.coverImage,
            content: source.content as Prisma.InputJsonValue,
            yjsState: source.yjsState ? new Uint8Array(source.yjsState) : null,
            position: source.position + 1,
            createdById: data.createdById,
            updatedById: data.createdById,
            labels: {
              create: source.labels.map((label) => ({
                labelId: label.labelId,
              })),
            },
          },
          include: WIKI_PAGE_INCLUDE,
        })
        return created
      })
      return ok(copy)
    } catch (error) {
      return err(dbError('Failed to duplicate wiki page', error))
    }
  },

  /** Workspace members for the editor's @mention, by name. */
  async listMembers(
    workspaceId: string,
    q: string,
    take = 8,
  ): Promise<Result<{ userId: string; name: string; image: string | null }[]>> {
    try {
      const rows = await prisma.membership.findMany({
        where: {
          workspaceId,
          ...(q
            ? { user: { name: { contains: q, mode: 'insensitive' } } }
            : {}),
        },
        select: { user: { select: { id: true, name: true, image: true } } },
        orderBy: { user: { name: 'asc' } },
        take,
      })
      return ok(
        rows.map((row) => ({
          userId: row.user.id,
          name: row.user.name,
          image: row.user.image,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list wiki mentionable members', error))
    }
  },
}
