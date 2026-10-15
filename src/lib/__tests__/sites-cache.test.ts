import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({ logger: { warn: vi.fn() } }))

import { revalidateTag } from 'next/cache'
import { logger } from '@/lib/axiom/logger'
import { revalidateSites, siteCacheTag } from '@/src/lib/sites/cache'
import { publicSiteUrl } from '@/src/lib/sites/public-url'

describe('site cache', () => {
  beforeEach(() => {
    vi.mocked(revalidateTag).mockReset()
  })

  it('expires each distinct slug immediately', () => {
    revalidateSites('a', 'b', 'a')
    expect(siteCacheTag('a')).toBe('site:a')
    expect(revalidateTag).toHaveBeenCalledTimes(2)
    expect(revalidateTag).toHaveBeenCalledWith('site:a', { expire: 0 })
  })

  it('only logs outside a Next request', () => {
    vi.mocked(revalidateTag)
      .mockImplementationOnce(() => {
        throw new Error('static generation store missing')
      })
      .mockImplementationOnce(() => {
        throw 'boom'
      })
    revalidateSites('a', 'b')
    expect(logger.warn).toHaveBeenCalledWith('sites.cache.revalidate_skipped', {
      slug: 'a',
      cause: 'static generation store missing',
    })
    expect(logger.warn).toHaveBeenCalledWith('sites.cache.revalidate_skipped', {
      slug: 'b',
      cause: 'boom',
    })
  })

  it('builds the public URL from the app URL', () => {
    expect(publicSiteUrl('clinica')).toBe(
      `${new URL(process.env.BETTER_AUTH_URL as string).origin}/s/clinica`,
    )
  })
})
