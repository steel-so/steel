import { describe, expect, it, vi } from 'vitest'
import { createFakeSnapshot } from '@/src/__tests__/factories/site.factory'
import { searchSettings } from '@/src/__tests__/factories/site-search.factory'
import { INDEXNOW_ENDPOINT } from '@/src/lib/sites/search/indexnow'
import type { SiteSnapshot } from '@/src/lib/sites/snapshot'
import { DEFAULT_SITE_SEARCH_SETTINGS } from '@/src/schemas/site-search.schema'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { SiteIndexNowService } from '../site-indexnow.service'

function snapshotWith(
  indexNow: { enabled: boolean; key?: string },
  noindex = false,
): SiteSnapshot {
  return createFakeSnapshot({
    settings: searchSettings({
      seo: { noindex },
      search: { ...DEFAULT_SITE_SEARCH_SETTINGS, indexNow },
    }),
  })
}

describe('SiteIndexNowService.ping', () => {
  it('does nothing when off, without a key, on a noindex site or without pages', async () => {
    const fetcher = vi.fn()
    for (const snapshot of [
      snapshotWith({ enabled: false, key: 'abcdef12' }),
      snapshotWith({ enabled: true }),
      snapshotWith({ enabled: true, key: 'abcdef12' }, true),
      { ...snapshotWith({ enabled: true, key: 'abcdef12' }), pages: [] },
      createFakeSnapshot(),
    ]) {
      const result = await SiteIndexNowService.ping(
        'sorriso',
        snapshot,
        fetcher,
      )
      expect(result).toEqual({ ok: true, value: { sent: 0, status: null } })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('posts the indexable URLs with the key location', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 202 }))
    const result = await SiteIndexNowService.ping(
      'sorriso',
      snapshotWith({ enabled: true, key: 'abcdef12' }),
      fetcher as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: true, value: { sent: 1, status: 202 } })
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(INDEXNOW_ENDPOINT)
    const body = JSON.parse(String(init.body))
    expect(body.key).toBe('abcdef12')
    expect(body.keyLocation).toMatch(/\/indexnow-key\.txt$/)
    expect(body.urlList).toHaveLength(1)
    expect(logger.info).toHaveBeenCalledWith(
      'site_indexnow.ping',
      expect.objectContaining({ status: 202 }),
    )
  })

  it('logs rejections and network errors without failing', async () => {
    const rejected = vi.fn(async () => new Response(null, { status: 403 }))
    expect(
      await SiteIndexNowService.ping(
        's',
        snapshotWith({ enabled: true, key: 'abcdef12' }),
        rejected as unknown as typeof fetch,
      ),
    ).toEqual({ ok: true, value: { sent: 1, status: 403 } })
    expect(logger.warn).toHaveBeenCalledWith(
      'site_indexnow.rejected',
      expect.anything(),
    )

    for (const failure of [new Error('offline'), 'boom']) {
      const broken = vi.fn(async () => {
        throw failure
      })
      expect(
        await SiteIndexNowService.ping(
          's',
          snapshotWith({ enabled: true, key: 'abcdef12' }),
          broken as unknown as typeof fetch,
        ),
      ).toEqual({ ok: true, value: { sent: 1, status: null } })
    }
    expect(logger.warn).toHaveBeenCalledWith(
      'site_indexnow.failed',
      expect.objectContaining({ message: 'boom' }),
    )
  })
})
