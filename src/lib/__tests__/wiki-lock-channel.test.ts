import { beforeEach, describe, expect, it, vi } from 'vitest'

const publish = vi.fn()
vi.mock('@/src/lib/queue/connection', () => ({
  getQueueConnection: () => ({ publish }),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import {
  parseWikiLockMessage,
  publishWikiLockChange,
  WIKI_LOCK_CHANNEL,
  WIKI_LOCK_STATELESS_TYPE,
  wikiLockStatelessPayload,
} from '../wiki-lock-channel'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('wiki lock channel', () => {
  it('publishes the change on the lock channel', async () => {
    publish.mockResolvedValue(1)

    await publishWikiLockChange({ wikiPageId: 'w1', lockedAt: null })

    expect(publish).toHaveBeenCalledWith(
      WIKI_LOCK_CHANNEL,
      JSON.stringify({ wikiPageId: 'w1', lockedAt: null }),
    )
  })

  it('logs and swallows a publish failure', async () => {
    publish.mockRejectedValue(new Error('down'))

    await expect(
      publishWikiLockChange({ wikiPageId: 'w1', lockedAt: 'x' }),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      'wiki.lock.publish_failed',
      expect.objectContaining({ wikiPageId: 'w1', message: 'down' }),
    )
  })

  it('logs a non-Error rejection too', async () => {
    publish.mockRejectedValue('nope')

    await publishWikiLockChange({ wikiPageId: 'w1', lockedAt: null })

    expect(logger.error).toHaveBeenCalledWith(
      'wiki.lock.publish_failed',
      expect.objectContaining({ message: 'nope' }),
    )
  })

  it('parses valid messages and rejects malformed ones', () => {
    expect(
      parseWikiLockMessage(
        JSON.stringify({ wikiPageId: 'w1', lockedAt: '2026-10-14T00:00:00Z' }),
      ),
    ).toEqual({ wikiPageId: 'w1', lockedAt: '2026-10-14T00:00:00Z' })
    expect(parseWikiLockMessage(JSON.stringify({ wikiPageId: 'w1' }))).toEqual({
      wikiPageId: 'w1',
      lockedAt: null,
    })
    expect(parseWikiLockMessage('null')).toBeNull()
    expect(parseWikiLockMessage(JSON.stringify({ lockedAt: null }))).toBeNull()
    expect(parseWikiLockMessage('{')).toBeNull()
  })

  it('builds the stateless payload for the editors', () => {
    expect(
      JSON.parse(
        wikiLockStatelessPayload({ wikiPageId: 'w1', lockedAt: null }),
      ),
    ).toEqual({
      type: WIKI_LOCK_STATELESS_TYPE,
      wikiPageId: 'w1',
      lockedAt: null,
    })
  })
})
