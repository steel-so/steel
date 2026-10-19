import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

// setup.unit.ts mocks the hooks for every other suite; test the real ones.
vi.unmock('@/src/lib/ai/knowledge/index-hooks')
vi.mock('@/src/services/ai-knowledge-index.service')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const add = vi.fn(async () => ({}))
vi.mock('@/src/lib/queue/queues', () => ({
  getAiIndexQueue: vi.fn(() => ({ add })),
}))

import { logger } from '@/lib/axiom/logger'
import {
  KNOWLEDGE_INDEX_DEBOUNCE_MS,
  knowledgeSourceOfSearchEntity,
  onWorkspaceAiSwitch,
  removeKnowledgeSource,
  scheduleKnowledgeIndex,
  scheduleKnowledgeReindex,
} from '@/src/lib/ai/knowledge/index-hooks'
import { processAiIndex } from '@/src/lib/queue/processors/ai-index'
import { AiKnowledgeIndexService } from '@/src/services/ai-knowledge-index.service'

const service = vi.mocked(AiKnowledgeIndexService)
const stats = { indexed: 1, removed: 0, embedded: 1 }

beforeEach(() => {
  add.mockReset()
  add.mockResolvedValue({})
})

describe('knowledge index hooks', () => {
  it('should map the global-search types that feed the index', () => {
    expect(knowledgeSourceOfSearchEntity('sd-kb-article')).toBe('sd-kb-article')
    expect(knowledgeSourceOfSearchEntity('sd-ticket')).toBe('sd-ticket')
    expect(knowledgeSourceOfSearchEntity('crm-proposal')).toBe('crm-proposal')
    expect(knowledgeSourceOfSearchEntity('crm-lead')).toBeNull()
  })

  it('should enqueue one debounced refresh per source', async () => {
    await scheduleKnowledgeIndex('wiki-page', 'ws1', ['p1', 'p2', 'p1', ''])
    expect(add).toHaveBeenCalledTimes(2)
    expect(add).toHaveBeenCalledWith(
      'refresh',
      { workspaceId: 'ws1', sourceType: 'wiki-page', sourceIds: ['p1'] },
      {
        delay: KNOWLEDGE_INDEX_DEBOUNCE_MS,
        deduplication: {
          id: 'ai-index-ws1-wiki-page-p1',
          ttl: KNOWLEDGE_INDEX_DEBOUNCE_MS,
          extend: true,
          replace: true,
        },
      },
    )
    await scheduleKnowledgeIndex('wiki-page', 'ws1', [])
    expect(add).toHaveBeenCalledTimes(2)
  })

  it('should log instead of throwing when the queue is down', async () => {
    add.mockRejectedValueOnce(new Error('redis down'))
    await expect(
      scheduleKnowledgeIndex('crm-note', 'ws1', 'n1'),
    ).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.knowledge.hook_failed',
      expect.objectContaining({ op: 'schedule', error: 'redis down' }),
    )
  })

  it('should delete the chunks of removed sources right away', async () => {
    service.remove.mockResolvedValue(ok(1))
    await removeKnowledgeSource('crm-note', 'ws1', 'n1')
    expect(service.remove).toHaveBeenCalledWith('crm-note', 'ws1', ['n1'])

    service.remove.mockResolvedValue(err(databaseError()))
    await removeKnowledgeSource('crm-note', 'ws1', ['n2'])
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.knowledge.hook_failed',
      expect.objectContaining({ op: 'remove', error: 'DATABASE_ERROR' }),
    )

    service.remove.mockRejectedValue('crash')
    await removeKnowledgeSource('crm-note', 'ws1', 'n3')
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.knowledge.hook_failed',
      expect.objectContaining({ op: 'remove', error: 'crash' }),
    )

    service.remove.mockClear()
    await removeKnowledgeSource('crm-note', 'ws1', [])
    expect(service.remove).not.toHaveBeenCalled()
  })

  it('should schedule a (scoped) rebuild', async () => {
    await scheduleKnowledgeReindex('ws1', ['wiki-page'])
    expect(add).toHaveBeenLastCalledWith(
      'reindex-workspace',
      { workspaceId: 'ws1', sourceTypes: ['wiki-page'] },
      {
        deduplication: {
          id: 'ai-index-reindex-ws1-wiki-page',
          ttl: KNOWLEDGE_INDEX_DEBOUNCE_MS,
        },
      },
    )
    await scheduleKnowledgeReindex('ws1')
    expect(add).toHaveBeenLastCalledWith(
      'reindex-workspace',
      { workspaceId: 'ws1' },
      expect.objectContaining({
        deduplication: expect.objectContaining({
          id: 'ai-index-reindex-ws1-all',
        }),
      }),
    )
    add.mockRejectedValueOnce(new Error('down'))
    await scheduleKnowledgeReindex('ws1')
    expect(logger.warn).toHaveBeenLastCalledWith(
      'ai.knowledge.hook_failed',
      expect.not.objectContaining({ sourceType: expect.anything() }),
    )
    add.mockRejectedValueOnce(new Error('down'))
    await scheduleKnowledgeReindex('ws1', ['crm-note'])
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.knowledge.hook_failed',
      expect.objectContaining({ op: 'reindex', sourceType: 'crm-note' }),
    )
  })

  it('should purge when Steel AI is switched off and rebuild when on', async () => {
    service.purgeWorkspace.mockResolvedValue(
      ok({ indexed: 0, removed: 3, embedded: 0, purged: true }),
    )
    await onWorkspaceAiSwitch('ws1', false)
    expect(service.purgeWorkspace).toHaveBeenCalledWith('ws1')
    expect(add).not.toHaveBeenCalled()

    service.purgeWorkspace.mockResolvedValue(err(databaseError()))
    await onWorkspaceAiSwitch('ws1', false)
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.knowledge.hook_failed',
      expect.objectContaining({ op: 'purge' }),
    )
    service.purgeWorkspace.mockRejectedValue(new Error('crash'))
    await expect(onWorkspaceAiSwitch('ws1', false)).resolves.toBeUndefined()

    await onWorkspaceAiSwitch('ws1', true)
    expect(add).toHaveBeenCalledWith(
      'reindex-workspace',
      { workspaceId: 'ws1' },
      expect.any(Object),
    )
  })
})

function job(name: string, data: unknown): Job {
  return { id: 'j1', name, data } as Job
}

describe('processAiIndex', () => {
  it('should refresh the sources of a job', async () => {
    service.refresh.mockResolvedValue(ok(stats))
    await expect(
      processAiIndex(
        job('refresh', {
          workspaceId: 'ws1',
          sourceType: 'wiki-page',
          sourceIds: ['p1'],
        }),
      ),
    ).resolves.toEqual(stats)
    expect(service.refresh).toHaveBeenCalledWith('wiki-page', 'ws1', ['p1'])
  })

  it('should skip an unknown source type and throw on failures (retry)', async () => {
    await expect(
      processAiIndex(
        job('refresh', { workspaceId: 'ws1', sourceType: 'x', sourceIds: [] }),
      ),
    ).resolves.toEqual({ skipped: true })
    service.refresh.mockResolvedValue(err(databaseError()))
    await expect(
      processAiIndex(
        job('refresh', {
          workspaceId: 'ws1',
          sourceType: 'crm-note',
          sourceIds: ['n'],
        }),
      ),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('should reindex a workspace, all of it or some source types', async () => {
    service.reindexWorkspace.mockResolvedValue(ok(stats))
    await processAiIndex(job('reindex-workspace', { workspaceId: 'ws1' }))
    expect(service.reindexWorkspace).toHaveBeenLastCalledWith('ws1', undefined)
    await processAiIndex(
      job('reindex-workspace', {
        workspaceId: 'ws1',
        sourceTypes: ['wiki-page', 'bogus'],
      }),
    )
    expect(service.reindexWorkspace).toHaveBeenLastCalledWith('ws1', [
      'wiki-page',
    ])
    await processAiIndex(
      job('reindex-workspace', { workspaceId: 'ws1', sourceTypes: ['bogus'] }),
    )
    expect(service.reindexWorkspace).toHaveBeenLastCalledWith('ws1', undefined)
    service.reindexWorkspace.mockResolvedValue(err(databaseError()))
    await expect(
      processAiIndex(job('reindex-workspace', { workspaceId: 'ws1' })),
    ).rejects.toThrow('ws1')
  })

  it('should run the nightly rebuild', async () => {
    const all = {
      workspaces: 2,
      failed: 0,
      indexed: 3,
      removed: 0,
      embedded: 3,
      vectorIndexReady: true,
    }
    service.reindexAll.mockResolvedValue(ok(all))
    await expect(processAiIndex(job('reindex-all', {}))).resolves.toEqual(all)
    service.reindexAll.mockResolvedValue(err(databaseError()))
    await expect(processAiIndex(job('reindex-all', {}))).rejects.toThrow(
      'DATABASE_ERROR',
    )
  })

  it('should reject an unknown job name', async () => {
    await expect(processAiIndex(job('nope', {}))).rejects.toThrow('nope')
    await expect(
      processAiIndex({ name: 'nope', data: {} } as Job),
    ).rejects.toThrow('id=unknown')
  })
})
