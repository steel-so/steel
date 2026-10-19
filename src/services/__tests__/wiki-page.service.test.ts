import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auditMutation } from '@/lib/axiom/audit'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWikiPage } from '@/src/__tests__/factories/wiki-page.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import {
  removeKnowledgeSource,
  scheduleKnowledgeIndex,
  scheduleKnowledgeReindex,
} from '@/src/lib/ai/knowledge/index-hooks'
import { err, ok } from '@/src/lib/result'
import { publishWikiLockChange } from '@/src/lib/wiki-lock-channel'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WikiLabelRepository } from '@/src/repositories/wiki-label.repository'
import { WikiPageRepository } from '@/src/repositories/wiki-page.repository'
import { WikiPageFavoriteRepository } from '@/src/repositories/wiki-page-favorite.repository'
import { WikiPageService } from '../wiki-page.service'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/wiki-page.repository')
vi.mock('@/src/repositories/wiki-label.repository')
vi.mock('@/src/repositories/wiki-page-favorite.repository')
vi.mock('@/src/lib/wiki-lock-channel', () => ({
  publishWikiLockChange: vi.fn(async () => undefined),
}))
// The wiki is on for every case here; the off switch has its own suite.
vi.mock('@/src/repositories/wiki-settings.repository', () => ({
  WikiSettingsRepository: {
    isEnabled: vi.fn(async () => ({ ok: true, value: true })),
  },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

const mockedMembership = vi.mocked(MembershipRepository)
const mockedWikiPage = vi.mocked(WikiPageRepository)
const mockedLabels = vi.mocked(WikiLabelRepository)
const mockedFavorites = vi.mocked(WikiPageFavoriteRepository)

const memberMembership = createFakeMembership({
  userId: 'actor',
  workspaceId: 'ws1',
  role: 'MEMBER',
})

beforeEach(() => {
  vi.clearAllMocks()
  mockedMembership.findByUserAndWorkspace.mockResolvedValue(
    ok(memberMembership),
  )
  mockedFavorites.isFavorite.mockResolvedValue(ok(false))
  mockedFavorites.listPageIds.mockResolvedValue(ok(new Set<string>()))
})

describe('WikiPageService', () => {
  describe('list()', () => {
    it('should return the workspace pages as DTOs', async () => {
      mockedWikiPage.listByWorkspace.mockResolvedValue(
        ok([createFakeWikiPage({ workspaceId: 'ws1' })]),
      )

      const result = await WikiPageService.list('actor', 'ws1')

      expect(expectOk(result)).toHaveLength(1)
    })

    it('should return FORBIDDEN when actor is not a workspace member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(
        err(forbidden()),
      )

      const result = await WikiPageService.list('actor', 'ws1')

      expectErr(result, 'FORBIDDEN')
      expect(mockedWikiPage.listByWorkspace).not.toHaveBeenCalled()
    })

    it('should propagate the repository error', async () => {
      mockedWikiPage.listByWorkspace.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.list('actor', 'ws1')

      expectErr(result, 'DATABASE_ERROR')
    })
  })

  describe('getById()', () => {
    it('should return the page for a workspace member', async () => {
      const page = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })
      mockedWikiPage.findById.mockResolvedValue(ok(page))

      const result = await WikiPageService.getById('actor', 'ws1', 'w1')

      expectOk(result)
    })

    it('should return FORBIDDEN when actor is not a workspace member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WikiPageService.getById('stranger', 'ws1', 'w1')

      expectErr(result, 'FORBIDDEN')
      expect(mockedWikiPage.findById).not.toHaveBeenCalled()
    })

    it('should propagate the repository error', async () => {
      mockedWikiPage.findById.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.getById('actor', 'ws1', 'w1')

      expectErr(result, 'DATABASE_ERROR')
    })

    it('should return WIKI_PAGE_FORBIDDEN when the page belongs to another workspace', async () => {
      mockedWikiPage.findById.mockResolvedValue(
        ok(createFakeWikiPage({ id: 'w1', workspaceId: 'other-ws' })),
      )

      const result = await WikiPageService.getById('actor', 'ws1', 'w1')

      expectErr(result, 'WIKI_PAGE_FORBIDDEN')
    })
  })

  describe('create()', () => {
    it('should create a root page for a workspace member', async () => {
      const created = createFakeWikiPage({ workspaceId: 'ws1' })
      mockedWikiPage.create.mockResolvedValue(ok(created))

      const result = await WikiPageService.create('actor', 'ws1', {
        title: '',
      })

      const dto = expectOk(result)
      expect(dto.workspaceId).toBe('ws1')
      expect(mockedWikiPage.create).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        parentId: null,
        title: '',
        icon: undefined,
        createdById: 'actor',
      })
    })

    it('should reject a parent from another workspace', async () => {
      const parent = createFakeWikiPage({ id: 'p1', workspaceId: 'ws2' })
      mockedWikiPage.findById.mockResolvedValue(ok(parent))

      const result = await WikiPageService.create('actor', 'ws1', {
        title: '',
        parentId: 'p1',
      })

      expectErr(result, 'WIKI_PAGE_FORBIDDEN')
      expect(mockedWikiPage.create).not.toHaveBeenCalled()
    })

    it('should propagate the parent lookup repository error', async () => {
      mockedWikiPage.findById.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.create('actor', 'ws1', {
        title: '',
        parentId: 'p1',
      })

      expectErr(result, 'DATABASE_ERROR')
      expect(mockedWikiPage.create).not.toHaveBeenCalled()
    })

    it('should return FORBIDDEN when actor is not a workspace member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WikiPageService.create('actor', 'ws1', {
        title: '',
      })

      expectErr(result, 'FORBIDDEN')
    })

    it('should propagate repo error', async () => {
      mockedWikiPage.create.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.create('actor', 'ws1', {
        title: '',
      })

      expectErr(result, 'DATABASE_ERROR')
    })
  })

  describe('update()', () => {
    it('should update metadata fields and audit the mutation', async () => {
      const existing = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })
      const updated = createFakeWikiPage({
        id: 'w1',
        workspaceId: 'ws1',
        title: 'Novo título',
      })
      mockedWikiPage.findById.mockResolvedValue(ok(existing))
      mockedWikiPage.update.mockResolvedValue(ok(updated))

      const result = await WikiPageService.update('actor', 'ws1', 'w1', {
        title: 'Novo título',
      })

      expect(expectOk(result).title).toBe('Novo título')
    })

    it('should update content-only autosaves without throwing', async () => {
      const existing = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })
      mockedWikiPage.findById.mockResolvedValue(ok(existing))
      mockedWikiPage.update.mockResolvedValue(ok(existing))

      const result = await WikiPageService.update('actor', 'ws1', 'w1', {
        content: [{ type: 'p', children: [{ text: 'x' }] }] as never,
      })

      expectOk(result)
      expect(scheduleKnowledgeIndex).toHaveBeenCalledWith(
        'wiki-page',
        'ws1',
        'w1',
      )
    })

    it('should return FORBIDDEN when actor is not a workspace member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WikiPageService.update('actor', 'ws1', 'w1', {
        title: 'x',
      })

      expectErr(result, 'FORBIDDEN')
      expect(mockedWikiPage.findById).not.toHaveBeenCalled()
    })

    it('should propagate the findById repository error', async () => {
      mockedWikiPage.findById.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.update('actor', 'ws1', 'w1', {
        title: 'x',
      })

      expectErr(result, 'DATABASE_ERROR')
    })

    it('should return WIKI_PAGE_FORBIDDEN when the page belongs to another workspace', async () => {
      mockedWikiPage.findById.mockResolvedValue(
        ok(createFakeWikiPage({ id: 'w1', workspaceId: 'other-ws' })),
      )

      const result = await WikiPageService.update('actor', 'ws1', 'w1', {
        title: 'x',
      })

      expectErr(result, 'WIKI_PAGE_FORBIDDEN')
      expect(mockedWikiPage.update).not.toHaveBeenCalled()
    })

    it('should propagate the update repository error', async () => {
      mockedWikiPage.findById.mockResolvedValue(
        ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
      )
      mockedWikiPage.update.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.update('actor', 'ws1', 'w1', {
        title: 'x',
      })

      expectErr(result, 'DATABASE_ERROR')
    })
  })

  describe('move()', () => {
    it('should move the page to a valid parent in the same workspace', async () => {
      const page = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })
      const parent = createFakeWikiPage({ id: 'p1', workspaceId: 'ws1' })
      const moved = createFakeWikiPage({
        id: 'w1',
        workspaceId: 'ws1',
        parentId: 'p1',
      })
      mockedWikiPage.findById.mockImplementation(async (id: string) =>
        id === 'w1' ? ok(page) : ok(parent),
      )
      mockedWikiPage.move.mockResolvedValue(ok(moved))

      const result = await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: 'p1',
        position: 1,
      })

      expect(expectOk(result).parentId).toBe('p1')
    })

    it('should reject moving a page under itself', async () => {
      const page = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })
      mockedWikiPage.findById.mockResolvedValue(ok(page))

      const result = await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: 'w1',
        position: 0,
      })

      expectErr(result, 'WIKI_PAGE_FORBIDDEN')
      expect(mockedWikiPage.move).not.toHaveBeenCalled()
    })

    it('should reject a new parent from another workspace', async () => {
      const page = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })
      const parent = createFakeWikiPage({ id: 'p1', workspaceId: 'ws2' })
      mockedWikiPage.findById.mockImplementation(async (id: string) =>
        id === 'w1' ? ok(page) : ok(parent),
      )

      const result = await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: 'p1',
        position: 0,
      })

      expectErr(result, 'WIKI_PAGE_FORBIDDEN')
      expect(mockedWikiPage.move).not.toHaveBeenCalled()
    })

    it('should propagate the parent lookup repository error', async () => {
      const page = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })
      mockedWikiPage.findById.mockImplementation(async (id: string) =>
        id === 'w1' ? ok(page) : err(databaseError()),
      )

      const result = await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: 'p1',
        position: 0,
      })

      expectErr(result, 'DATABASE_ERROR')
    })

    it('should return FORBIDDEN when actor is not a workspace member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: null,
        position: 0,
      })

      expectErr(result, 'FORBIDDEN')
    })

    it('should propagate the findById repository error', async () => {
      mockedWikiPage.findById.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: null,
        position: 0,
      })

      expectErr(result, 'DATABASE_ERROR')
    })

    it('should return WIKI_PAGE_FORBIDDEN when the page belongs to another workspace', async () => {
      mockedWikiPage.findById.mockResolvedValue(
        ok(createFakeWikiPage({ id: 'w1', workspaceId: 'other-ws' })),
      )

      const result = await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: null,
        position: 0,
      })

      expectErr(result, 'WIKI_PAGE_FORBIDDEN')
    })

    it('should propagate the move repository error', async () => {
      mockedWikiPage.findById.mockResolvedValue(
        ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
      )
      mockedWikiPage.move.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: null,
        position: 0,
      })

      expectErr(result, 'DATABASE_ERROR')
    })
  })

  describe('archive()', () => {
    it('should archive when actor is a workspace member', async () => {
      const page = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })
      const archived = createFakeWikiPage({
        id: 'w1',
        workspaceId: 'ws1',
        archivedAt: new Date(),
      })
      mockedWikiPage.findById.mockResolvedValue(ok(page))
      mockedWikiPage.archive.mockResolvedValue(ok(archived))

      const result = await WikiPageService.archive('actor', 'ws1', 'w1')

      const dto = expectOk(result)
      expect(dto.archivedAt).not.toBeNull()
      expect(removeKnowledgeSource).toHaveBeenCalledWith(
        'wiki-page',
        'ws1',
        'w1',
      )
      // Sub-pages were archived too: the wiki part of the index is rebuilt.
      expect(scheduleKnowledgeReindex).toHaveBeenCalledWith('ws1', [
        'wiki-page',
      ])
    })

    it('should return FORBIDDEN when actor is not a workspace member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WikiPageService.archive('actor', 'ws1', 'w1')

      expectErr(result, 'FORBIDDEN')
      expect(mockedWikiPage.findById).not.toHaveBeenCalled()
    })

    it('should propagate the findById repository error', async () => {
      mockedWikiPage.findById.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.archive('actor', 'ws1', 'w1')

      expectErr(result, 'DATABASE_ERROR')
    })

    it('should return WIKI_PAGE_FORBIDDEN when the page belongs to another workspace', async () => {
      mockedWikiPage.findById.mockResolvedValue(
        ok(createFakeWikiPage({ id: 'w1', workspaceId: 'other-ws' })),
      )

      const result = await WikiPageService.archive('actor', 'ws1', 'w1')

      expectErr(result, 'WIKI_PAGE_FORBIDDEN')
      expect(mockedWikiPage.archive).not.toHaveBeenCalled()
    })

    it('should propagate the archive repository error', async () => {
      mockedWikiPage.findById.mockResolvedValue(
        ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
      )
      mockedWikiPage.archive.mockResolvedValue(err(databaseError()))

      const result = await WikiPageService.archive('actor', 'ws1', 'w1')

      expectErr(result, 'DATABASE_ERROR')
    })
  })

  describe('setLabels()', () => {
    const page = createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })

    it('should replace the labels and return the page with them', async () => {
      mockedWikiPage.findById
        .mockResolvedValueOnce(ok(page))
        .mockResolvedValueOnce(
          ok({ ...page, labels: [{ labelId: 'l1' }, { labelId: 'l2' }] }),
        )
      mockedLabels.countInWorkspace.mockResolvedValue(ok(2))
      mockedLabels.setPageLabels.mockResolvedValue(ok(undefined))

      const result = await WikiPageService.setLabels('actor', 'ws1', 'w1', {
        labelIds: ['l1', 'l2', 'l1'],
      })

      expect(expectOk(result).labelIds).toEqual(['l1', 'l2'])
      expect(mockedLabels.setPageLabels).toHaveBeenCalledWith('w1', [
        'l1',
        'l2',
      ])
    })

    it('should clear the labels without checking ownership', async () => {
      mockedWikiPage.findById.mockResolvedValue(ok(page))
      mockedLabels.setPageLabels.mockResolvedValue(ok(undefined))

      expectOk(
        await WikiPageService.setLabels('actor', 'ws1', 'w1', { labelIds: [] }),
      )
      expect(mockedLabels.countInWorkspace).not.toHaveBeenCalled()
    })

    it('should reject a label of another workspace', async () => {
      mockedWikiPage.findById.mockResolvedValue(ok(page))
      mockedLabels.countInWorkspace.mockResolvedValue(ok(0))

      expectErr(
        await WikiPageService.setLabels('actor', 'ws1', 'w1', {
          labelIds: ['foreign'],
        }),
        'WIKI_LABEL_NOT_FOUND',
      )
      expect(mockedLabels.setPageLabels).not.toHaveBeenCalled()
    })

    it('should return WIKI_PAGE_FORBIDDEN for a page of another workspace', async () => {
      mockedWikiPage.findById.mockResolvedValue(
        ok(createFakeWikiPage({ id: 'w1', workspaceId: 'other-ws' })),
      )

      expectErr(
        await WikiPageService.setLabels('actor', 'ws1', 'w1', { labelIds: [] }),
        'WIKI_PAGE_FORBIDDEN',
      )
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(
        err(forbidden()),
      )

      expectErr(
        await WikiPageService.setLabels('actor', 'ws1', 'w1', { labelIds: [] }),
        'FORBIDDEN',
      )
    })

    it('should propagate the page lookup error', async () => {
      mockedWikiPage.findById.mockResolvedValue(err(databaseError()))

      expectErr(
        await WikiPageService.setLabels('actor', 'ws1', 'w1', { labelIds: [] }),
        'DATABASE_ERROR',
      )
    })

    it('should propagate the ownership check error', async () => {
      mockedWikiPage.findById.mockResolvedValue(ok(page))
      mockedLabels.countInWorkspace.mockResolvedValue(err(databaseError()))

      expectErr(
        await WikiPageService.setLabels('actor', 'ws1', 'w1', {
          labelIds: ['l1'],
        }),
        'DATABASE_ERROR',
      )
    })

    it('should propagate the write error', async () => {
      mockedWikiPage.findById.mockResolvedValue(ok(page))
      mockedLabels.setPageLabels.mockResolvedValue(err(databaseError()))

      expectErr(
        await WikiPageService.setLabels('actor', 'ws1', 'w1', { labelIds: [] }),
        'DATABASE_ERROR',
      )
    })

    it('should propagate the reload error', async () => {
      mockedWikiPage.findById
        .mockResolvedValueOnce(ok(page))
        .mockResolvedValueOnce(err(databaseError()))
      mockedLabels.setPageLabels.mockResolvedValue(ok(undefined))

      expectErr(
        await WikiPageService.setLabels('actor', 'ws1', 'w1', { labelIds: [] }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listMentionableMembers()', () => {
    it('should search the workspace members', async () => {
      mockedWikiPage.listMembers.mockResolvedValue(
        ok([{ userId: 'u1', name: 'Ana', image: null }]),
      )

      const result = await WikiPageService.listMentionableMembers(
        'actor',
        'ws1',
        'an',
      )

      expect(expectOk(result)).toHaveLength(1)
      expect(mockedWikiPage.listMembers).toHaveBeenCalledWith('ws1', 'an')
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(
        err(forbidden()),
      )

      expectErr(
        await WikiPageService.listMentionableMembers('actor', 'ws1', ''),
        'FORBIDDEN',
      )
    })
  })
})

const adminMembership = createFakeMembership({
  userId: 'admin',
  workspaceId: 'ws1',
  role: 'ADMIN',
})

/** Page locked by its author `author`, in ws1. */
function lockedPage(overrides: Parameters<typeof createFakeWikiPage>[0] = {}) {
  return createFakeWikiPage({
    id: 'w1',
    workspaceId: 'ws1',
    createdById: 'author',
    lockedAt: new Date('2026-10-14T10:00:00.000Z'),
    lockedById: 'author',
    ...overrides,
  })
}

describe('WikiPageService — viewer fields', () => {
  it('list() should mark favorites and lock rights with one favorites query', async () => {
    mockedWikiPage.listByWorkspace.mockResolvedValue(
      ok([
        createFakeWikiPage({
          id: 'a',
          workspaceId: 'ws1',
          createdById: 'actor',
        }),
        createFakeWikiPage({ id: 'b', workspaceId: 'ws1', createdById: 'x' }),
      ]),
    )
    mockedFavorites.listPageIds.mockResolvedValue(ok(new Set(['b'])))

    const pages = expectOk(await WikiPageService.list('actor', 'ws1'))

    expect(pages.map((p) => [p.id, p.canManageLock, p.isFavorite])).toEqual([
      ['a', true, false],
      ['b', false, true],
    ])
    expect(mockedFavorites.listPageIds).toHaveBeenCalledTimes(1)
    expect(mockedFavorites.isFavorite).not.toHaveBeenCalled()
  })

  it('list() should propagate the favorites error', async () => {
    mockedWikiPage.listByWorkspace.mockResolvedValue(ok([]))
    mockedFavorites.listPageIds.mockResolvedValue(err(databaseError()))

    expectErr(await WikiPageService.list('actor', 'ws1'), 'DATABASE_ERROR')
  })

  it('getById() should let OWNER/ADMIN manage the lock of any page', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(adminMembership),
    )
    mockedWikiPage.findById.mockResolvedValue(ok(lockedPage()))
    mockedFavorites.isFavorite.mockResolvedValue(ok(true))

    const dto = expectOk(await WikiPageService.getById('admin', 'ws1', 'w1'))

    expect(dto.canManageLock).toBe(true)
    expect(dto.isFavorite).toBe(true)
  })

  it('getById() should propagate the favorite lookup error', async () => {
    mockedWikiPage.findById.mockResolvedValue(ok(lockedPage()))
    mockedFavorites.isFavorite.mockResolvedValue(err(databaseError()))

    expectErr(
      await WikiPageService.getById('actor', 'ws1', 'w1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WikiPageService — edit lock enforcement', () => {
  beforeEach(() => {
    mockedWikiPage.findById.mockResolvedValue(ok(lockedPage()))
  })

  it('update() should return WIKI_PAGE_LOCKED for a plain member', async () => {
    expectErr(
      await WikiPageService.update('actor', 'ws1', 'w1', { title: 'x' }),
      'WIKI_PAGE_LOCKED',
    )
    expect(mockedWikiPage.update).not.toHaveBeenCalled()
  })

  it('move(), archive() and setLabels() should be blocked too', async () => {
    expectErr(
      await WikiPageService.move('actor', 'ws1', 'w1', {
        parentId: null,
        position: 0,
      }),
      'WIKI_PAGE_LOCKED',
    )
    expectErr(
      await WikiPageService.archive('actor', 'ws1', 'w1'),
      'WIKI_PAGE_LOCKED',
    )
    expectErr(
      await WikiPageService.setLabels('actor', 'ws1', 'w1', { labelIds: [] }),
      'WIKI_PAGE_LOCKED',
    )
    expect(mockedWikiPage.move).not.toHaveBeenCalled()
    expect(mockedWikiPage.archive).not.toHaveBeenCalled()
    expect(mockedLabels.setPageLabels).not.toHaveBeenCalled()
  })

  it('update() should let the author edit a locked page', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          userId: 'author',
          workspaceId: 'ws1',
          role: 'MEMBER',
        }),
      ),
    )
    mockedWikiPage.update.mockResolvedValue(ok(lockedPage({ title: 'x' })))

    const dto = expectOk(
      await WikiPageService.update('author', 'ws1', 'w1', { title: 'x' }),
    )
    expect(dto.canManageLock).toBe(true)
  })

  it('update() should let an ADMIN edit a locked page', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(adminMembership),
    )
    mockedWikiPage.update.mockResolvedValue(ok(lockedPage()))

    expectOk(await WikiPageService.update('admin', 'ws1', 'w1', { title: 'x' }))
  })
})

describe('WikiPageService.publish() / unpublish()', () => {
  it('should create a 32-char URL-safe token and audit it', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
    )
    mockedWikiPage.setPublication.mockImplementation(async (_id, data) =>
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1', ...data })),
    )

    const dto = expectOk(await WikiPageService.publish('actor', 'ws1', 'w1'))

    expect(dto.publicToken).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(dto.publishedAt).not.toBeNull()
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publish', targetId: 'w1' }),
    )
  })

  it('should keep the link of an already published page', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          publicToken: 't'.repeat(32),
          publishedAt: new Date(),
        }),
      ),
    )

    const dto = expectOk(await WikiPageService.publish('actor', 'ws1', 'w1'))

    expect(dto.publicToken).toBe('t'.repeat(32))
    expect(mockedWikiPage.setPublication).not.toHaveBeenCalled()
  })

  it('should audit a failed publish', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
    )
    mockedWikiPage.setPublication.mockResolvedValue(err(databaseError()))

    expectErr(
      await WikiPageService.publish('actor', 'ws1', 'w1'),
      'DATABASE_ERROR',
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publish', outcome: 'failure' }),
    )
  })

  it('should block publishing a locked page for a plain member', async () => {
    mockedWikiPage.findById.mockResolvedValue(ok(lockedPage()))

    expectErr(
      await WikiPageService.publish('actor', 'ws1', 'w1'),
      'WIKI_PAGE_LOCKED',
    )
    expectErr(
      await WikiPageService.unpublish('actor', 'ws1', 'w1'),
      'WIKI_PAGE_LOCKED',
    )
  })

  it('should revoke the token on unpublish', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          publicToken: 't'.repeat(32),
          publishedAt: new Date(),
        }),
      ),
    )
    mockedWikiPage.setPublication.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
    )

    const dto = expectOk(await WikiPageService.unpublish('actor', 'ws1', 'w1'))

    expect(dto.publicToken).toBeNull()
    expect(mockedWikiPage.setPublication).toHaveBeenCalledWith('w1', {
      publicToken: null,
      publishedAt: null,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unpublish' }),
    )
  })

  it('should be a no-op to unpublish a page that is not published', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
    )

    expectOk(await WikiPageService.unpublish('actor', 'ws1', 'w1'))
    expect(mockedWikiPage.setPublication).not.toHaveBeenCalled()
  })

  it('should propagate the unpublish write error', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          publicToken: 't'.repeat(32),
        }),
      ),
    )
    mockedWikiPage.setPublication.mockResolvedValue(err(databaseError()))

    expectErr(
      await WikiPageService.unpublish('actor', 'ws1', 'w1'),
      'DATABASE_ERROR',
    )
  })

  it('should reject a page of another workspace and a non-member', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'other' })),
    )
    expectErr(
      await WikiPageService.publish('actor', 'ws1', 'w1'),
      'WIKI_PAGE_FORBIDDEN',
    )

    mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WikiPageService.unpublish('stranger', 'ws1', 'w1'),
      'FORBIDDEN',
    )
  })
})

describe('WikiPageService.setLock()', () => {
  it('should let the author lock, notify the realtime server and audit', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          createdById: 'actor',
        }),
      ),
    )
    const lockedAt = new Date('2026-10-14T10:00:00.000Z')
    mockedWikiPage.setLock.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          createdById: 'actor',
          lockedAt,
          lockedById: 'actor',
        }),
      ),
    )

    const dto = expectOk(
      await WikiPageService.setLock('actor', 'ws1', 'w1', true),
    )

    expect(dto.lockedAt).toBe(lockedAt.toISOString())
    expect(mockedWikiPage.setLock).toHaveBeenCalledWith('w1', {
      lockedAt: expect.any(Date),
      lockedById: 'actor',
    })
    expect(publishWikiLockChange).toHaveBeenCalledWith({
      wikiPageId: 'w1',
      lockedAt: lockedAt.toISOString(),
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lock', targetId: 'w1' }),
    )
  })

  it('should let an ADMIN unlock a page of someone else', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(adminMembership),
    )
    mockedWikiPage.findById.mockResolvedValue(ok(lockedPage()))
    mockedWikiPage.setLock.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          createdById: 'author',
        }),
      ),
    )

    const dto = expectOk(
      await WikiPageService.setLock('admin', 'ws1', 'w1', false),
    )

    expect(dto.lockedAt).toBeNull()
    expect(mockedWikiPage.setLock).toHaveBeenCalledWith('w1', {
      lockedAt: null,
      lockedById: null,
    })
    expect(publishWikiLockChange).toHaveBeenCalledWith({
      wikiPageId: 'w1',
      lockedAt: null,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unlock' }),
    )
  })

  it('should return WIKI_LOCK_FORBIDDEN for a member who is not the author', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          createdById: 'author',
        }),
      ),
    )

    expectErr(
      await WikiPageService.setLock('actor', 'ws1', 'w1', true),
      'WIKI_LOCK_FORBIDDEN',
    )
    expect(mockedWikiPage.setLock).not.toHaveBeenCalled()
  })

  it('should be idempotent when the state already matches', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(
      ok(adminMembership),
    )
    mockedWikiPage.findById.mockResolvedValue(ok(lockedPage()))

    expectOk(await WikiPageService.setLock('admin', 'ws1', 'w1', true))
    expect(mockedWikiPage.setLock).not.toHaveBeenCalled()
    expect(publishWikiLockChange).not.toHaveBeenCalled()
  })

  it('should audit a failed write and not notify', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          createdById: 'actor',
        }),
      ),
    )
    mockedWikiPage.setLock.mockResolvedValue(err(databaseError()))

    expectErr(
      await WikiPageService.setLock('actor', 'ws1', 'w1', true),
      'DATABASE_ERROR',
    )
    expect(publishWikiLockChange).not.toHaveBeenCalled()
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lock', outcome: 'failure' }),
    )
  })

  it('should propagate the page lookup error', async () => {
    mockedWikiPage.findById.mockResolvedValue(err(databaseError()))

    expectErr(
      await WikiPageService.setLock('actor', 'ws1', 'w1', true),
      'DATABASE_ERROR',
    )
  })
})

describe('WikiPageService.setFavorite()', () => {
  it('should favorite and unfavorite for the viewer', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
    )
    mockedFavorites.add.mockResolvedValue(ok(undefined))
    mockedFavorites.remove.mockResolvedValue(ok(undefined))

    expect(
      expectOk(await WikiPageService.setFavorite('actor', 'ws1', 'w1', true))
        .isFavorite,
    ).toBe(true)
    expect(mockedFavorites.add).toHaveBeenCalledWith('actor', 'w1')

    expect(
      expectOk(await WikiPageService.setFavorite('actor', 'ws1', 'w1', false))
        .isFavorite,
    ).toBe(false)
    expect(mockedFavorites.remove).toHaveBeenCalledWith('actor', 'w1')
  })

  it('should allow favoriting a locked page', async () => {
    mockedWikiPage.findById.mockResolvedValue(ok(lockedPage()))
    mockedFavorites.add.mockResolvedValue(ok(undefined))

    expectOk(await WikiPageService.setFavorite('actor', 'ws1', 'w1', true))
  })

  it('should propagate errors', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
    )
    mockedFavorites.add.mockResolvedValue(err(databaseError()))
    expectErr(
      await WikiPageService.setFavorite('actor', 'ws1', 'w1', true),
      'DATABASE_ERROR',
    )

    mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WikiPageService.setFavorite('stranger', 'ws1', 'w1', true),
      'FORBIDDEN',
    )
  })
})

describe('WikiPageService.duplicate()', () => {
  it('should copy the page with " (cópia)" and audit it', async () => {
    const source = lockedPage({ title: 'Manual' })
    mockedWikiPage.findById.mockResolvedValue(ok(source))
    mockedWikiPage.duplicate.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'copy',
          workspaceId: 'ws1',
          title: 'Manual (cópia)',
        }),
      ),
    )

    const dto = expectOk(await WikiPageService.duplicate('actor', 'ws1', 'w1'))

    expect(dto.id).toBe('copy')
    expect(dto.canManageLock).toBe(true)
    expect(mockedWikiPage.duplicate).toHaveBeenCalledWith(source, {
      title: 'Manual (cópia)',
      createdById: 'actor',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'duplicate',
        targetId: 'copy',
        meta: { workspaceId: 'ws1', sourceId: 'w1' },
      }),
    )
    expect(scheduleKnowledgeIndex).toHaveBeenCalledWith(
      'wiki-page',
      'ws1',
      'copy',
    )
  })

  it('should name an untitled copy and keep the title within 255 chars', async () => {
    mockedWikiPage.findById.mockResolvedValueOnce(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1', title: '  ' })),
    )
    mockedWikiPage.duplicate.mockResolvedValue(ok(createFakeWikiPage()))

    await WikiPageService.duplicate('actor', 'ws1', 'w1')
    expect(mockedWikiPage.duplicate.mock.calls[0][1].title).toBe(
      'Sem título (cópia)',
    )

    mockedWikiPage.findById.mockResolvedValueOnce(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          title: 'x'.repeat(255),
        }),
      ),
    )
    await WikiPageService.duplicate('actor', 'ws1', 'w1')
    const title = mockedWikiPage.duplicate.mock.calls[1][1].title
    expect(title).toHaveLength(255)
    expect(title.endsWith(' (cópia)')).toBe(true)
  })

  it('should not duplicate an archived page', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(
        createFakeWikiPage({
          id: 'w1',
          workspaceId: 'ws1',
          archivedAt: new Date(),
        }),
      ),
    )

    expectErr(
      await WikiPageService.duplicate('actor', 'ws1', 'w1'),
      'WIKI_PAGE_NOT_FOUND',
    )
  })

  it('should audit a failed copy', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'w1', workspaceId: 'ws1' })),
    )
    mockedWikiPage.duplicate.mockResolvedValue(err(databaseError()))

    expectErr(
      await WikiPageService.duplicate('actor', 'ws1', 'w1'),
      'DATABASE_ERROR',
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'duplicate',
        targetId: 'w1',
        outcome: 'failure',
      }),
    )
  })

  it('should reject a non-member', async () => {
    mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await WikiPageService.duplicate('stranger', 'ws1', 'w1'),
      'FORBIDDEN',
    )
  })
})

describe('WikiPageService.create() — sub-page', () => {
  it('should create under a parent of the same workspace', async () => {
    mockedWikiPage.findById.mockResolvedValue(
      ok(createFakeWikiPage({ id: 'p1', workspaceId: 'ws1' })),
    )
    mockedWikiPage.create.mockResolvedValue(
      ok(createFakeWikiPage({ workspaceId: 'ws1', parentId: 'p1' })),
    )

    const dto = expectOk(
      await WikiPageService.create('actor', 'ws1', {
        title: 'Filha',
        parentId: 'p1',
      }),
    )

    expect(dto.parentId).toBe('p1')
    expect(dto.canManageLock).toBe(true)
    expect(dto.isFavorite).toBe(false)
  })
})
