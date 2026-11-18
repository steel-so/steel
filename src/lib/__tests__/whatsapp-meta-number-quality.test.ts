import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import {
  clearMetaNumberQualityCache,
  fetchMetaNumberQuality,
  metaNumberQualityOf,
} from '../whatsapp/meta-number-quality'

const fetchMock = vi.fn()

function graph(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn1',
    provider: 'META' as const,
    metaPhoneNumberId: 'phone-1',
    encryptedMetaAccessToken: 'enc:token-1',
    ...overrides,
  } as never
}

const MIN = 60_000

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  clearMetaNumberQualityCache()
})

describe('fetchMetaNumberQuality()', () => {
  it('should call the Graph API with the token and a timeout', async () => {
    graph({ quality_rating: 'GREEN' })

    await fetchMetaNumberQuality({ phoneNumberId: 'p1', accessToken: 'tk' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://graph.facebook.com/v26.0/p1?fields=quality_rating',
    )
    expect(init.headers).toEqual({ Authorization: 'Bearer tk' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['GREEN', 'GREEN'],
    ['YELLOW', 'YELLOW'],
    ['RED', 'RED'],
    ['green', 'GREEN'],
    ['Yellow', 'YELLOW'],
    ['red', 'RED'],
    ['NA', 'UNKNOWN'],
    ['whatever', 'UNKNOWN'],
    ['', 'UNKNOWN'],
  ])('should map rating "%s" to %s', async (rating, expected) => {
    graph({ quality_rating: rating })

    expect(
      await fetchMetaNumberQuality({ phoneNumberId: 'p', accessToken: 't' }),
    ).toBe(expected)
  })

  it('should read a missing rating as UNKNOWN', async () => {
    graph({})

    expect(
      await fetchMetaNumberQuality({ phoneNumberId: 'p', accessToken: 't' }),
    ).toBe('UNKNOWN')
  })

  it('should read an unparseable body as UNKNOWN', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json')
      },
    })

    expect(
      await fetchMetaNumberQuality({ phoneNumberId: 'p', accessToken: 't' }),
    ).toBe('UNKNOWN')
  })

  it('should throw the Graph error message', async () => {
    graph({ error: { message: 'Invalid OAuth access token.' } }, 401)

    await expect(
      fetchMetaNumberQuality({ phoneNumberId: 'p', accessToken: 't' }),
    ).rejects.toThrow('Invalid OAuth access token.')
  })

  it('should throw a generic message when the error body is unreadable', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('html')
      },
    })

    await expect(
      fetchMetaNumberQuality({ phoneNumberId: 'p', accessToken: 't' }),
    ).rejects.toThrow('Failed to read the number quality (502)')
  })

  it('should throw a generic message when the error has no message', async () => {
    graph({ error: {} }, 500)

    await expect(
      fetchMetaNumberQuality({ phoneNumberId: 'p', accessToken: 't' }),
    ).rejects.toThrow('Failed to read the number quality (500)')
  })
})

describe('metaNumberQualityOf()', () => {
  it.each([
    ['not META', { provider: 'ZAPI' }],
    ['missing phone id', { metaPhoneNumberId: null }],
    ['missing token', { encryptedMetaAccessToken: null }],
  ])('should be UNKNOWN without fetching when %s', async (_name, overrides) => {
    expect(await metaNumberQualityOf(connection(overrides))).toBe('UNKNOWN')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should decrypt the token and read the rating', async () => {
    graph({ quality_rating: 'RED' })

    expect(await metaNumberQualityOf(connection(), 0)).toBe('RED')
    expect(fetchMock.mock.calls[0][0]).toContain('/phone-1?')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: 'Bearer token-1',
    })
  })

  it('should default `now` to the current time', async () => {
    graph({ quality_rating: 'GREEN' })

    expect(await metaNumberQualityOf(connection())).toBe('GREEN')
    expect(await metaNumberQualityOf(connection())).toBe('GREEN')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should serve a cache hit within 30 minutes', async () => {
    graph({ quality_rating: 'YELLOW' })

    expect(await metaNumberQualityOf(connection(), 0)).toBe('YELLOW')
    expect(await metaNumberQualityOf(connection(), 29 * MIN)).toBe('YELLOW')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should cache per connection', async () => {
    graph({ quality_rating: 'RED' })
    graph({ quality_rating: 'GREEN' })

    expect(await metaNumberQualityOf(connection({ id: 'a' }), 0)).toBe('RED')
    expect(await metaNumberQualityOf(connection({ id: 'b' }), 0)).toBe('GREEN')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should refresh after the entry expires', async () => {
    graph({ quality_rating: 'GREEN' })
    graph({ quality_rating: 'RED' })

    expect(await metaNumberQualityOf(connection(), 0)).toBe('GREEN')
    expect(await metaNumberQualityOf(connection(), 30 * MIN)).toBe('RED')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should keep the last known value on failure and wait 2 minutes to retry', async () => {
    graph({ quality_rating: 'RED' })
    expect(await metaNumberQualityOf(connection(), 0)).toBe('RED')

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(await metaNumberQualityOf(connection(), 31 * MIN)).toBe('RED')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.number_quality.lookup_failed',
      { connectionId: 'conn1', reason: 'network down' },
    )

    // inside the 2 min retry window: no new call
    expect(await metaNumberQualityOf(connection(), 32 * MIN)).toBe('RED')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // after the retry window: tries again
    graph({ quality_rating: 'GREEN' })
    expect(await metaNumberQualityOf(connection(), 33 * MIN)).toBe('GREEN')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('should be UNKNOWN when the lookup fails with no history', async () => {
    graph({ error: { message: 'boom' } }, 500)

    expect(await metaNumberQualityOf(connection(), 0)).toBe('UNKNOWN')
    expect(await metaNumberQualityOf(connection(), MIN)).toBe('UNKNOWN')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should never throw, even on a non-Error rejection', async () => {
    fetchMock.mockRejectedValueOnce('string failure')

    await expect(metaNumberQualityOf(connection(), 0)).resolves.toBe('UNKNOWN')
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.number_quality.lookup_failed',
      { connectionId: 'conn1', reason: 'string failure' },
    )
  })

  it('should treat a decrypt failure as a failed lookup', async () => {
    vi.mocked(decryptConnectionSecret).mockRejectedValueOnce(
      new Error('bad key'),
    )

    await expect(metaNumberQualityOf(connection(), 0)).resolves.toBe('UNKNOWN')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
