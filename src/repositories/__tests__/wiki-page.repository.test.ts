import { afterAll, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWikiPage } from '@/src/__tests__/factories/wiki-page.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WikiPageRepository } from '../wiki-page.repository'

afterAll(() => {
  vi.restoreAllMocks()
})

describe('WikiPageRepository', () => {
  describe('findById()', () => {
    it('should return the wiki page when it exists', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const seeded = await seedWikiPage(workspace.id, user.id, {
        title: 'Onboarding',
      })

      const result = await WikiPageRepository.findById(seeded.id)

      const page = expectOk(result)
      expect(page.title).toBe('Onboarding')
    })

    it('should return WIKI_PAGE_NOT_FOUND when it does not exist', async () => {
      const result = await WikiPageRepository.findById('nonexistent')
      expectErr(result, 'WIKI_PAGE_NOT_FOUND')
    })

    it('should return DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.wikiPage, 'findUnique').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(await WikiPageRepository.findById('x'), 'DATABASE_ERROR')
    })
  })

  describe('listByWorkspace()', () => {
    it('should list only non-archived pages of the workspace, ordered by position', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      await seedWikiPage(workspace.id, user.id, {
        title: 'B',
        position: 1,
      })
      await seedWikiPage(workspace.id, user.id, {
        title: 'A',
        position: 0,
      })

      const archived = await seedWikiPage(workspace.id, user.id, {
        title: 'Arquivada',
      })
      await prisma.wikiPage.update({
        where: { id: archived.id },
        data: { archivedAt: new Date() },
      })

      const result = await WikiPageRepository.listByWorkspace(workspace.id)

      const pages = expectOk(result)
      expect(pages.map((p) => p.title)).toEqual(['A', 'B'])
    })
  })

  describe('create()', () => {
    it('should create a root page with position based on sibling count', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      await seedWikiPage(workspace.id, user.id, { position: 0 })

      const result = await WikiPageRepository.create({
        workspaceId: workspace.id,
        parentId: null,
        title: 'Nova página',
        createdById: user.id,
      })

      const page = expectOk(result)
      expect(page.position).toBe(1)
      expect(page.content).toEqual([{ type: 'p', children: [{ text: '' }] }])
    })
  })

  describe('archive()', () => {
    it('should set archivedAt and updatedById', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const seeded = await seedWikiPage(workspace.id, user.id)

      const result = await WikiPageRepository.archive(seeded.id, user.id)

      const page = expectOk(result)
      expect(page.archivedAt).not.toBeNull()
      expect(page.updatedById).toBe(user.id)
    })

    it('should archive every descendant with the same timestamp', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const root = await seedWikiPage(workspace.id, user.id)
      const child = await seedWikiPage(workspace.id, user.id, {
        parentId: root.id,
      })
      const grandchild = await seedWikiPage(workspace.id, user.id, {
        parentId: child.id,
      })
      const sibling = await seedWikiPage(workspace.id, user.id)

      const page = expectOk(await WikiPageRepository.archive(root.id, user.id))

      const [archivedChild, archivedGrandchild, untouched] = await Promise.all(
        [child, grandchild, sibling].map((p) =>
          prisma.wikiPage.findUniqueOrThrow({ where: { id: p.id } }),
        ),
      )
      expect(archivedChild.archivedAt).toEqual(page.archivedAt)
      expect(archivedGrandchild.archivedAt).toEqual(page.archivedAt)
      expect(archivedGrandchild.updatedById).toBe(user.id)
      expect(untouched.archivedAt).toBeNull()
    })

    it('should keep the original timestamp of an already archived child', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const root = await seedWikiPage(workspace.id, user.id)
      const child = await seedWikiPage(workspace.id, user.id, {
        parentId: root.id,
      })
      const earlier = new Date('2026-01-01T00:00:00.000Z')
      await prisma.wikiPage.update({
        where: { id: child.id },
        data: { archivedAt: earlier },
      })

      expectOk(await WikiPageRepository.archive(root.id, user.id))

      const stored = await prisma.wikiPage.findUniqueOrThrow({
        where: { id: child.id },
      })
      expect(stored.archivedAt).toEqual(earlier)
    })
  })

  describe('updateYjsState()', () => {
    it('should persist the yjs snapshot and updatedById', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const seeded = await seedWikiPage(workspace.id, user.id)

      const result = await WikiPageRepository.updateYjsState(seeded.id, {
        yjsState: new Uint8Array([1, 2, 3]),
        updatedById: user.id,
      })

      const page = expectOk(result)
      expect(page.updatedById).toBe(user.id)
      expect(Buffer.from(page.yjsState as Uint8Array)).toEqual(
        Buffer.from([1, 2, 3]),
      )
    })
  })
})

describe('WikiPageRepository — revamp', () => {
  describe('author/editor include', () => {
    it('should carry createdBy and updatedBy people', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const seeded = await seedWikiPage(workspace.id, user.id)

      const updated = expectOk(
        await WikiPageRepository.update(seeded.id, {
          title: 'x',
          updatedById: user.id,
        }),
      )

      expect(updated.createdBy).toEqual({
        id: user.id,
        name: user.name,
        image: user.image,
      })
      expect(updated.updatedBy?.id).toBe(user.id)
    })
  })

  describe('setPublication() / findPublishedByToken()', () => {
    it('should publish, find by token and revoke', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const seeded = await seedWikiPage(workspace.id, user.id)
      const token = 'p'.repeat(32)

      const published = expectOk(
        await WikiPageRepository.setPublication(seeded.id, {
          publicToken: token,
          publishedAt: new Date(),
        }),
      )
      expect(published.publicToken).toBe(token)

      const found = expectOk(
        await WikiPageRepository.findPublishedByToken(token),
      )
      expect(found.id).toBe(seeded.id)

      expectOk(
        await WikiPageRepository.setPublication(seeded.id, {
          publicToken: null,
          publishedAt: null,
        }),
      )
      expectErr(
        await WikiPageRepository.findPublishedByToken(token),
        'WIKI_PAGE_NOT_FOUND',
      )
    })

    it('should not find an archived published page', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const token = 'q'.repeat(32)
      await seedWikiPage(workspace.id, user.id, {
        publicToken: token,
        publishedAt: new Date(),
        archivedAt: new Date(),
      })

      expectErr(
        await WikiPageRepository.findPublishedByToken(token),
        'WIKI_PAGE_NOT_FOUND',
      )
    })

    it('should return DATABASE_ERROR when the queries throw', async () => {
      vi.spyOn(prisma.wikiPage, 'findFirst').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WikiPageRepository.findPublishedByToken('t'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WikiPageRepository.setPublication('missing', {
          publicToken: null,
          publishedAt: null,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('setLock()', () => {
    it('should lock and unlock', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const seeded = await seedWikiPage(workspace.id, user.id)

      const locked = expectOk(
        await WikiPageRepository.setLock(seeded.id, {
          lockedAt: new Date(),
          lockedById: user.id,
        }),
      )
      expect(locked.lockedAt).not.toBeNull()
      expect(locked.lockedById).toBe(user.id)

      const unlocked = expectOk(
        await WikiPageRepository.setLock(seeded.id, {
          lockedAt: null,
          lockedById: null,
        }),
      )
      expect(unlocked.lockedAt).toBeNull()
    })

    it('should return DATABASE_ERROR for a missing page', async () => {
      expectErr(
        await WikiPageRepository.setLock('missing', {
          lockedAt: null,
          lockedById: null,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('duplicate()', () => {
    it('should copy content, yjs state and labels right after the original', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const other = await seedUser()
      const parent = await seedWikiPage(workspace.id, user.id)
      const first = await seedWikiPage(workspace.id, user.id, {
        parentId: parent.id,
        position: 0,
        title: 'Manual',
        icon: '📘',
        coverImage: 'https://example.com/c.png',
        content: [{ type: 'p', children: [{ text: 'olá' }] }],
        yjsState: new Uint8Array([9, 8, 7]),
        publicToken: 'r'.repeat(32),
        publishedAt: new Date(),
        lockedAt: new Date(),
        lockedById: user.id,
      })
      const second = await seedWikiPage(workspace.id, user.id, {
        parentId: parent.id,
        position: 1,
      })
      const label = await prisma.wikiLabel.create({
        data: { workspaceId: workspace.id, name: 'RH', color: 'blue' },
      })
      await prisma.wikiPageLabel.create({
        data: { wikiPageId: first.id, labelId: label.id },
      })
      const source = expectOk(await WikiPageRepository.findById(first.id))

      const copy = expectOk(
        await WikiPageRepository.duplicate(source, {
          title: 'Manual (cópia)',
          createdById: other.id,
        }),
      )

      expect(copy).toMatchObject({
        parentId: parent.id,
        position: 1,
        title: 'Manual (cópia)',
        icon: '📘',
        coverImage: 'https://example.com/c.png',
        content: [{ type: 'p', children: [{ text: 'olá' }] }],
        createdById: other.id,
        publicToken: null,
        lockedAt: null,
      })
      expect(Buffer.from(copy.yjsState as Uint8Array)).toEqual(
        Buffer.from([9, 8, 7]),
      )
      expect(copy.labels).toEqual([{ labelId: label.id }])
      const shifted = await prisma.wikiPage.findUniqueOrThrow({
        where: { id: second.id },
      })
      expect(shifted.position).toBe(2)
    })

    it('should copy a page without yjs state', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const seeded = await seedWikiPage(workspace.id, user.id)
      const source = expectOk(await WikiPageRepository.findById(seeded.id))

      const copy = expectOk(
        await WikiPageRepository.duplicate(source, {
          title: 'c',
          createdById: user.id,
        }),
      )

      expect(copy.yjsState).toBeNull()
      expect(copy.parentId).toBeNull()
    })

    it('should return DATABASE_ERROR when the transaction fails', async () => {
      const workspace = await seedWorkspace()
      const user = await seedUser()
      const seeded = await seedWikiPage(workspace.id, user.id)
      const source = expectOk(await WikiPageRepository.findById(seeded.id))

      expectErr(
        await WikiPageRepository.duplicate(source, {
          title: 'c',
          createdById: 'no-such-user',
        }),
        'DATABASE_ERROR',
      )
    })
  })
})

describe('WikiPageRepository — move, members and failures', () => {
  it('move() should change parent and position', async () => {
    const workspace = await seedWorkspace()
    const user = await seedUser()
    const parent = await seedWikiPage(workspace.id, user.id)
    const page = await seedWikiPage(workspace.id, user.id)

    const moved = expectOk(
      await WikiPageRepository.move(page.id, {
        parentId: parent.id,
        position: 3,
        updatedById: user.id,
      }),
    )

    expect(moved.parentId).toBe(parent.id)
    expect(moved.position).toBe(3)
  })

  it('listMembers() should search members by name', async () => {
    const workspace = await seedWorkspace()
    const ana = await seedUser({ name: 'Ana Lima' })
    const bruno = await seedUser({ name: 'Bruno Melo' })
    await prisma.membership.createMany({
      data: [
        { userId: ana.id, workspaceId: workspace.id, role: 'MEMBER' },
        { userId: bruno.id, workspaceId: workspace.id, role: 'MEMBER' },
      ],
    })

    const all = expectOk(await WikiPageRepository.listMembers(workspace.id, ''))
    expect(all.map((m) => m.name)).toEqual(['Ana Lima', 'Bruno Melo'])

    const found = expectOk(
      await WikiPageRepository.listMembers(workspace.id, 'brU'),
    )
    expect(found).toEqual([
      { userId: bruno.id, name: 'Bruno Melo', image: bruno.image },
    ])
  })

  it('should return DATABASE_ERROR when writes and reads throw', async () => {
    vi.spyOn(prisma.wikiPage, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(await WikiPageRepository.listByWorkspace('ws'), 'DATABASE_ERROR')

    expectErr(
      await WikiPageRepository.create({
        workspaceId: 'missing-ws',
        parentId: null,
        title: 'x',
        createdById: 'missing-user',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WikiPageRepository.update('missing', { updatedById: 'u' }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WikiPageRepository.move('missing', {
        parentId: null,
        position: 0,
        updatedById: 'u',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WikiPageRepository.archive('missing', 'u'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WikiPageRepository.updateYjsState('missing', {
        yjsState: new Uint8Array([1]),
        updatedById: 'u',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.membership, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(await WikiPageRepository.listMembers('ws', ''), 'DATABASE_ERROR')
  })
})
