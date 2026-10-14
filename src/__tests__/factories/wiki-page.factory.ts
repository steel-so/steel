import { createId } from '@paralleldrive/cuid2'
import type { Prisma } from '@prisma/client'
import type { Value } from 'platejs'
import { prisma } from '@/src/lib/prisma'
import type { WikiPage } from '@/src/repositories/wiki-page.repository'
import type { WikiPageDTO } from '@/types/wiki-page'

export function createFakeWikiPage(overrides?: Partial<WikiPage>): WikiPage {
  const now = new Date()
  const content: Prisma.JsonValue = [{ type: 'p', children: [{ text: '' }] }]
  return {
    id: createId(),
    workspaceId: createId(),
    parentId: null,
    title: 'Página de teste',
    icon: null,
    coverImage: null,
    content: content,
    yjsState: null,
    position: 0,
    labels: [],
    createdById: createId(),
    updatedById: null,
    archivedAt: null,
    publicToken: null,
    publishedAt: null,
    lockedAt: null,
    lockedById: null,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeWikiPageDTO(
  overrides?: Partial<WikiPageDTO>,
): WikiPageDTO {
  const now = new Date().toISOString()
  const content: Value = [{ type: 'p', children: [{ text: '' }] }]
  return {
    id: createId(),
    workspaceId: createId(),
    parentId: null,
    title: 'Página de teste',
    icon: null,
    coverImage: null,
    content,
    position: 0,
    labelIds: [],
    createdById: createId(),
    updatedById: null,
    archivedAt: null,
    publishedAt: null,
    publicToken: null,
    lockedAt: null,
    lockedById: null,
    canManageLock: true,
    isFavorite: false,
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedWikiPage(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<{
    parentId: string | null
    title: string
    icon: string | null
    content: Prisma.InputJsonValue
    position: number
    publicToken: string | null
    publishedAt: Date | null
    lockedAt: Date | null
    lockedById: string | null
    archivedAt: Date | null
    coverImage: string | null
    yjsState: Uint8Array<ArrayBuffer> | null
  }>,
) {
  const content: Prisma.InputJsonValue = [
    { type: 'p', children: [{ text: '' }] },
  ]
  return prisma.wikiPage.create({
    data: {
      workspaceId,
      createdById,
      title: 'Página de teste',
      content: content,
      ...overrides,
    },
  })
}

/** Turns the wiki on for the workspace of an e2e fixture (it starts off). */
export async function withWiki<T extends { workspace: { id: string } }>(
  fixture: Promise<T>,
): Promise<T> {
  const value = await fixture
  await prisma.workspace.update({
    where: { id: value.workspace.id },
    data: { wikiEnabled: true },
  })
  return value
}
