import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  DOCUMENT_ANALYTICS_BUFFER_KEY,
  DOCUMENT_ANALYTICS_FLUSHING_KEY,
  DOCUMENT_EVENTS_PER_SESSION_HOUR,
  DocumentAnalyticsCache,
  type DocumentReadIncrement,
  parseReadBuffer,
} from '@/src/cache/document-analytics.cache'
import * as redisModule from '@/src/lib/redis'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

const SEEN = new Date('2026-11-11T15:00:00Z')

function increment(
  overrides: Partial<DocumentReadIncrement> = {},
): DocumentReadIncrement {
  return {
    sessionId: 'sess-1',
    activeMs: 10_000,
    sections: { 'sec-a': 6_000, 'sec-b': 4_000 },
    entered: ['sec-a'],
    scrollPct: 30,
    reachedEnd: false,
    seenAt: SEEN,
    ...overrides,
  }
}

async function clean() {
  const keys = await redis.keys('doc:analytics:*')
  if (keys.length > 0) await redis.del(keys)
}

beforeAll(async () => {
  await ensureRedisConnected()
  await clean()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await clean()
})

afterAll(async () => {
  if (redis.isOpen) await redis.disconnect()
})

describe('parseReadBuffer', () => {
  it('groups the fields per session and per section', () => {
    expect(
      parseReadBuffer({
        's|sess-1|ms': '1500',
        's|sess-1|scroll': '80',
        's|sess-1|end': '1',
        's|sess-1|seen': String(SEEN.getTime()),
        'x|sess-1|sec|with|pipes|ms': '900',
        'x|sess-1|sec|with|pipes|v': '2',
        'x|sess-1|sec|with|pipes|at': String(SEEN.getTime()),
        'x|sess-2|sec-a|ms': '100',
      }),
    ).toEqual({
      sessions: [
        {
          sessionId: 'sess-1',
          activeMs: 1500,
          maxScrollPct: 80,
          reachedEnd: true,
          lastSeenAt: SEEN,
        },
        {
          sessionId: 'sess-2',
          activeMs: 0,
          maxScrollPct: 0,
          reachedEnd: false,
          lastSeenAt: null,
        },
      ],
      sections: [
        {
          sessionId: 'sess-1',
          sectionId: 'sec|with|pipes',
          activeMs: 900,
          views: 2,
          firstSeenAt: SEEN,
        },
        {
          sessionId: 'sess-2',
          sectionId: 'sec-a',
          activeMs: 100,
          views: 0,
          firstSeenAt: null,
        },
      ],
    })
  })

  it('ignores malformed fields and values', () => {
    expect(
      parseReadBuffer({
        junk: '1',
        's||ms': '1',
        's|sess-1|ms|extra': '5',
        's|sess-1|unknown': '5',
        's|sess-1|scroll': 'abc',
        's|sess-1|seen': '0',
        'x|sess-1|ms': '1',
        'x|sess-1||ms': '1',
        'y|sess-1|a|ms': '1',
        'x|sess-1|sec-a|other': '1',
      }),
    ).toEqual({
      sessions: [
        {
          sessionId: 'sess-1',
          activeMs: 0,
          maxScrollPct: 0,
          reachedEnd: false,
          lastSeenAt: null,
        },
      ],
      sections: [
        {
          sessionId: 'sess-1',
          sectionId: 'sec-a',
          activeMs: 0,
          views: 0,
          firstSeenAt: null,
        },
      ],
    })
  })
})

describe('DocumentAnalyticsCache', () => {
  it('maps a session key to its session id', async () => {
    expect(await DocumentAnalyticsCache.getSessionId('doc-1', 'k1')).toBeNull()
    await DocumentAnalyticsCache.rememberSession('doc-1', 'k1', 'sess-1')
    expect(await DocumentAnalyticsCache.getSessionId('doc-1', 'k1')).toBe(
      'sess-1',
    )
    expect(await redis.ttl('doc:analytics:session:doc-1:k1')).toBeGreaterThan(0)
  })

  it('buffers beacons and hands them over in one batch', async () => {
    expect(await DocumentAnalyticsCache.bufferRead(increment())).toBe(true)
    expect(
      await DocumentAnalyticsCache.bufferRead(
        increment({
          activeMs: 0,
          sections: { 'sec-b': 2_000, 'sec-c': 0 },
          entered: ['sec-a', 'sec-b'],
          scrollPct: 55,
          reachedEnd: true,
          seenAt: new Date(SEEN.getTime() + 15_000),
        }),
      ),
    ).toBe(true)

    const batch = await DocumentAnalyticsCache.takeBatch()
    expect(batch.ok && batch.value).toEqual({
      sessions: [
        {
          sessionId: 'sess-1',
          activeMs: 10_000,
          maxScrollPct: 55,
          reachedEnd: true,
          lastSeenAt: new Date(SEEN.getTime() + 15_000),
        },
      ],
      sections: expect.arrayContaining([
        {
          sessionId: 'sess-1',
          sectionId: 'sec-a',
          activeMs: 6_000,
          views: 2,
          firstSeenAt: SEEN,
        },
        {
          sessionId: 'sess-1',
          sectionId: 'sec-b',
          activeMs: 6_000,
          views: 1,
          firstSeenAt: SEEN,
        },
      ]),
    })
    expect(batch.ok && batch.value?.sections).toHaveLength(2)
    expect(await redis.exists(DOCUMENT_ANALYTICS_BUFFER_KEY)).toBe(0)
  })

  it('keeps new beacons out of a batch being flushed', async () => {
    await DocumentAnalyticsCache.bufferRead(increment())
    const first = await DocumentAnalyticsCache.takeBatch()
    expect(first.ok && first.value?.sessions).toHaveLength(1)

    await DocumentAnalyticsCache.bufferRead(increment({ sessionId: 'sess-2' }))
    // Another worker while the lock is held: skips.
    const locked = await DocumentAnalyticsCache.takeBatch()
    expect(locked.ok && locked.value).toBeNull()

    expect((await DocumentAnalyticsCache.ackBatch()).ok).toBe(true)
    expect(await redis.exists(DOCUMENT_ANALYTICS_FLUSHING_KEY)).toBe(0)

    const second = await DocumentAnalyticsCache.takeBatch()
    expect(
      second.ok && second.value?.sessions.map((s) => s.sessionId),
    ).toEqual(['sess-2'])
  })

  it('retries a batch whose write failed before taking new beacons', async () => {
    await DocumentAnalyticsCache.bufferRead(increment())
    await DocumentAnalyticsCache.takeBatch()
    await DocumentAnalyticsCache.releaseBatch()

    await DocumentAnalyticsCache.bufferRead(increment({ sessionId: 'sess-2' }))
    const retry = await DocumentAnalyticsCache.takeBatch()
    expect(retry.ok && retry.value?.sessions.map((s) => s.sessionId)).toEqual([
      'sess-1',
    ])
    await DocumentAnalyticsCache.ackBatch()

    const next = await DocumentAnalyticsCache.takeBatch()
    expect(next.ok && next.value?.sessions.map((s) => s.sessionId)).toEqual([
      'sess-2',
    ])
  })

  it('returns an empty batch when nothing was read', async () => {
    const batch = await DocumentAnalyticsCache.takeBatch()
    expect(batch.ok && batch.value).toEqual({ sessions: [], sections: [] })
  })

  it('claims the view notification once per reader per window', async () => {
    expect(
      await DocumentAnalyticsCache.claimViewNotification('doc-1', 'r:1'),
    ).toBe(true)
    expect(
      await DocumentAnalyticsCache.claimViewNotification('doc-1', 'r:1'),
    ).toBe(false)
    expect(
      await DocumentAnalyticsCache.claimViewNotification('doc-1', 'r:2'),
    ).toBe(true)
  })

  it('claims a forward once per visitor of a personal link', async () => {
    expect(await DocumentAnalyticsCache.claimForward('rcp-1', 'v1')).toBe(true)
    expect(await DocumentAnalyticsCache.claimForward('rcp-1', 'v1')).toBe(false)
    expect(await DocumentAnalyticsCache.claimForward('rcp-1', 'v2')).toBe(true)
  })

  it('caps the events stored per session', async () => {
    const cap = DOCUMENT_EVENTS_PER_SESSION_HOUR
    expect(await DocumentAnalyticsCache.reserveEvents('sess-1', 0)).toBe(0)
    expect(await DocumentAnalyticsCache.reserveEvents('sess-1', cap - 5)).toBe(
      cap - 5,
    )
    expect(await DocumentAnalyticsCache.reserveEvents('sess-1', 20)).toBe(5)
    expect(await DocumentAnalyticsCache.reserveEvents('sess-1', 3)).toBe(0)
    expect(await redis.ttl('doc:analytics:events:sess-1')).toBeGreaterThan(0)
  })

  describe('when Redis fails', () => {
    function breakRedis() {
      vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue(
        new Error('down'),
      )
    }

    it('fails soft on the beacon path', async () => {
      breakRedis()
      expect(await DocumentAnalyticsCache.getSessionId('d', 'k')).toBeNull()
      await expect(
        DocumentAnalyticsCache.rememberSession('d', 'k', 's'),
      ).resolves.toBeUndefined()
      expect(await DocumentAnalyticsCache.bufferRead(increment())).toBe(false)
      expect(await DocumentAnalyticsCache.claimViewNotification('d', 'r')).toBe(
        false,
      )
      expect(await DocumentAnalyticsCache.claimForward('r', 'v')).toBe(false)
      expect(await DocumentAnalyticsCache.reserveEvents('s', 2)).toBe(0)
      await expect(
        DocumentAnalyticsCache.releaseBatch(),
      ).resolves.toBeUndefined()
    })

    it('returns errors on the flush path', async () => {
      vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue('down')
      const taken = await DocumentAnalyticsCache.takeBatch()
      expect(!taken.ok && taken.error.code).toBe('INTERNAL_SERVER_ERROR')
      const acked = await DocumentAnalyticsCache.ackBatch()
      expect(!acked.ok && acked.error.code).toBe('INTERNAL_SERVER_ERROR')
    })
  })
})
