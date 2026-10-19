import { describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

// setup.unit.ts mocks the hooks for every other suite; test the real ones.
vi.unmock('@/src/lib/search/index-hooks')
vi.mock('@/src/services/search-index.service')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import {
  knowledgeSourceOfSearchEntity,
  removeKnowledgeSource,
  scheduleKnowledgeIndex,
} from '@/src/lib/ai/knowledge/index-hooks'
import { SearchIndexService } from '@/src/services/search-index.service'
import {
  indexSearchDocument,
  removeSearchDocument,
} from '../search/index-hooks'

const service = vi.mocked(SearchIndexService)

describe('search index hooks', () => {
  it('should refresh one record and stay quiet on success', async () => {
    service.refresh.mockResolvedValue(ok({ indexed: 1, removed: 0 }))

    await indexSearchDocument('crm-lead', 'ws1', 'l1')

    expect(service.refresh).toHaveBeenCalledWith('crm-lead', 'ws1', ['l1'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should accept a list of ids and remove records', async () => {
    service.remove.mockResolvedValue(ok(2))

    await removeSearchDocument('sd-contact', 'ws1', ['a', 'b'])

    expect(service.remove).toHaveBeenCalledWith('sd-contact', 'ws1', ['a', 'b'])
  })

  it('should log a failed result without throwing', async () => {
    service.refresh.mockResolvedValue(err(databaseError('boom')))

    await expect(
      indexSearchDocument('sd-ticket', 'ws1', 't1'),
    ).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith(
      'search.index.failed',
      expect.objectContaining({
        op: 'index',
        entityType: 'sd-ticket',
        code: 'DATABASE_ERROR',
      }),
    )
  })

  it('should log a crash (Error or not) without throwing', async () => {
    service.remove.mockRejectedValueOnce(new Error('down'))
    await removeSearchDocument('member', 'ws1', 'u1')
    expect(logger.error).toHaveBeenCalledWith(
      'search.index.crashed',
      expect.objectContaining({ op: 'remove', error: 'down' }),
    )

    service.refresh.mockRejectedValueOnce('weird')
    await indexSearchDocument('member', 'ws1', 'u1')
    expect(logger.error).toHaveBeenLastCalledWith(
      'search.index.crashed',
      expect.objectContaining({ op: 'index', error: 'weird' }),
    )
  })

  it('should forward KB, ticket and proposal writes to the knowledge index', async () => {
    service.refresh.mockResolvedValue(ok({ indexed: 1, removed: 0 }))
    service.remove.mockResolvedValue(ok(1))
    vi.mocked(knowledgeSourceOfSearchEntity).mockReturnValue('sd-ticket')

    await indexSearchDocument('sd-ticket', 'ws1', 't1')
    expect(scheduleKnowledgeIndex).toHaveBeenCalledWith(
      'sd-ticket',
      'ws1',
      't1',
    )
    await removeSearchDocument('sd-ticket', 'ws1', ['t2'])
    expect(removeKnowledgeSource).toHaveBeenCalledWith('sd-ticket', 'ws1', [
      't2',
    ])

    vi.mocked(knowledgeSourceOfSearchEntity).mockReturnValue(null)
    vi.mocked(scheduleKnowledgeIndex).mockClear()
    await indexSearchDocument('crm-lead', 'ws1', 'l1')
    expect(scheduleKnowledgeIndex).not.toHaveBeenCalled()
  })
})
