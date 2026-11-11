import { describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { SearchDocumentInput } from '@/src/lib/search/search-document'
import { SEARCH_ENTITY_TYPES } from '@/src/lib/search/search-entities'

vi.mock('@/src/repositories/search-document.repository')
vi.mock('@/src/repositories/search-source.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { SearchDocumentRepository } from '@/src/repositories/search-document.repository'
import { SearchSourceRepository } from '@/src/repositories/search-source.repository'
import {
  SEARCH_REINDEX_BATCH,
  SearchIndexService,
} from '../search-index.service'

const docs = vi.mocked(SearchDocumentRepository)
const sources = vi.mocked(SearchSourceRepository)
const T = new Date('2026-10-07T00:00:00.000Z')

/** Every loader returns no rows unless a test says otherwise. */
function emptySources() {
  sources.sdTicketPrefixes.mockResolvedValue(ok(null))
  for (const key of [
    'sdTickets',
    'sdKbArticles',
    'sdCustomers',
    'sdContacts',
    'sdConfigItems',
    'crmLeads',
    'crmOpportunities',
    'crmPeople',
    'crmCompanies',
    'crmTasks',
    'crmProposals',
    'crmDocuments',
    'zapContacts',
    'zapConversations',
    'members',
    'whiteboards',
  ] as const) {
    sources[key].mockResolvedValue(ok([]) as never)
  }
  docs.upsertMany.mockImplementation(async (d) => ok(d.length))
  docs.removeMany.mockImplementation(async (_w, _t, ids) => ok(ids.length))
  docs.removeStale.mockResolvedValue(ok(0))
  docs.now.mockResolvedValue(ok(T))
}

function lead(id: string) {
  return {
    id,
    name: `Lead ${id}`,
    emails: [],
    phones: [],
    company: null,
    jobTitle: null,
    city: null,
    source: null,
    channel: null,
    stage: 'RECEIVED' as const,
    ownerId: null,
    updatedAt: T,
  }
}

describe('SearchIndexService.refresh()', () => {
  it('should upsert found records and remove missing (soft-deleted) ones', async () => {
    emptySources()
    sources.crmLeads.mockResolvedValue(ok([lead('a')]))

    const stats = expectOk(
      await SearchIndexService.refresh('crm-lead', 'ws1', ['a', 'b', 'a', '']),
    )

    expect(stats).toEqual({ indexed: 1, removed: 1 })
    expect(sources.crmLeads).toHaveBeenCalledWith('ws1', {
      ids: ['a', 'b'],
      take: 2,
    })
    const upserted = docs.upsertMany.mock.calls[0][0] as SearchDocumentInput[]
    expect(upserted.map((d) => d.entityId)).toEqual(['a'])
    expect(docs.removeMany).toHaveBeenCalledWith('ws1', 'crm-lead', ['b'])
  })

  it('should do nothing without ids', async () => {
    expectOk(await SearchIndexService.refresh('crm-lead', 'ws1', []))
    expect(sources.crmLeads).not.toHaveBeenCalled()
  })

  it('should build tickets with the workspace prefixes', async () => {
    emptySources()
    sources.sdTicketPrefixes.mockResolvedValue(ok({ INCIDENT: 'CHM' }))
    sources.sdTickets.mockResolvedValue(
      ok([
        {
          id: 't1',
          number: 5,
          type: 'INCIDENT',
          title: 'x',
          description: null,
          requesterId: null,
          assigneeId: null,
          updatedAt: T,
          phase: { name: 'Novo' },
          requester: null,
          customer: null,
          company: null,
          contact: null,
          participants: [],
        },
      ]),
    )

    expectOk(await SearchIndexService.refresh('sd-ticket', 'ws1', ['t1']))
    const upserted = docs.upsertMany.mock.calls[0][0] as SearchDocumentInput[]
    expect(upserted[0].codes).toContain('chm-5')
  })

  it('should propagate loader, prefix, upsert and remove errors', async () => {
    emptySources()
    sources.sdTicketPrefixes.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.refresh('sd-ticket', 'ws1', ['t']),
      'DATABASE_ERROR',
    )
    sources.sdTickets.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.refresh('sd-ticket', 'ws1', ['t']),
      'DATABASE_ERROR',
    )
    sources.members.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.refresh('member', 'ws1', ['u']),
      'DATABASE_ERROR',
    )
    docs.upsertMany.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.refresh('member', 'ws1', ['u']),
      'DATABASE_ERROR',
    )
    docs.removeMany.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.refresh('member', 'ws1', ['u']),
      'DATABASE_ERROR',
    )
  })

  it('should load every entity type through its loader', async () => {
    emptySources()
    for (const type of SEARCH_ENTITY_TYPES) {
      expectOk(await SearchIndexService.refresh(type, 'ws1', ['x']))
    }
    expect(docs.removeMany).toHaveBeenCalledTimes(SEARCH_ENTITY_TYPES.length)
  })
})

describe('SearchIndexService.remove()', () => {
  it('should delete the documents', async () => {
    emptySources()
    expect(
      expectOk(await SearchIndexService.remove('crm-task', 'ws1', ['a'])),
    ).toBe(1)
  })
})

describe('SearchIndexService.reindexWorkspace()', () => {
  it('should page through each source and drop stale documents', async () => {
    emptySources()
    const page = Array.from({ length: SEARCH_REINDEX_BATCH }, (_, i) =>
      lead(`l${String(i).padStart(4, '0')}`),
    )
    sources.crmLeads
      .mockResolvedValueOnce(ok(page))
      .mockResolvedValueOnce(ok([lead('zz')]))
    docs.removeStale.mockResolvedValue(ok(2))

    const stats = expectOk(
      await SearchIndexService.reindexWorkspace('ws1', ['crm-lead', 'member']),
    )

    expect(stats).toEqual({ indexed: SEARCH_REINDEX_BATCH + 1, removed: 4 })
    expect(sources.crmLeads).toHaveBeenNthCalledWith(2, 'ws1', {
      afterId: 'l0499',
      take: SEARCH_REINDEX_BATCH,
    })
    expect(docs.removeStale).toHaveBeenCalledWith('ws1', 'crm-lead', T)
  })

  it('should default to every type', async () => {
    emptySources()
    expectOk(await SearchIndexService.reindexWorkspace('ws1'))
    expect(docs.removeStale).toHaveBeenCalledTimes(SEARCH_ENTITY_TYPES.length)
  })

  it('should stop on clock, loader, upsert and stale errors', async () => {
    emptySources()
    docs.now.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.reindexWorkspace('ws1'),
      'DATABASE_ERROR',
    )
    sources.crmTasks.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.reindexWorkspace('ws1', ['crm-task']),
      'DATABASE_ERROR',
    )
    docs.upsertMany.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.reindexWorkspace('ws1', ['crm-task']),
      'DATABASE_ERROR',
    )
    docs.removeStale.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SearchIndexService.reindexWorkspace('ws1', ['crm-task']),
      'DATABASE_ERROR',
    )
  })
})

describe('SearchIndexService.reindexAll()', () => {
  it('should reindex every workspace in pages and count failures', async () => {
    emptySources()
    const firstPage = Array.from({ length: 100 }, (_, i) => `w${i}`)
    sources.workspaceIds
      .mockResolvedValueOnce(ok(firstPage))
      .mockResolvedValueOnce(ok(['last']))
    docs.now
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValue(ok(T))
    sources.members.mockResolvedValue(
      ok([
        {
          userId: 'u1',
          role: 'OWNER',
          updatedAt: T,
          user: { name: 'A', email: 'a@x.com', username: 'a', updatedAt: T },
        },
      ]),
    )

    const stats = expectOk(await SearchIndexService.reindexAll())

    expect(stats).toEqual({
      workspaces: 101,
      failed: 1,
      indexed: 100,
      removed: 0,
    })
    expect(sources.workspaceIds).toHaveBeenNthCalledWith(2, 'w99', 100)
    expect(logger.error).toHaveBeenCalledWith(
      'search.reindex.workspace_failed',
      expect.objectContaining({ workspaceId: 'w0' }),
    )
  })

  it('should fail when the workspaces cannot be listed', async () => {
    emptySources()
    sources.workspaceIds.mockResolvedValue(err(databaseError('x')))
    expectErr(await SearchIndexService.reindexAll(), 'DATABASE_ERROR')
  })
})
