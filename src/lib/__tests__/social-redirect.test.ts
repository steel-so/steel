import { afterEach, describe, expect, it, vi } from 'vitest'

async function load(meta: string | undefined) {
  vi.resetModules()
  vi.doMock('@/lib/env/server', () => ({
    BETTER_AUTH_URL: 'https://steel.example.com/',
    META_PUBLIC_URL: meta,
  }))
  return import('@/src/lib/social/redirect')
}

describe('socialCallbackUrl', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/env/server')
  })

  it('uses the Meta host for Facebook and Instagram when META_PUBLIC_URL is set', async () => {
    const { socialCallbackUrl } = await load('https://meta.example.com')
    expect(socialCallbackUrl('FACEBOOK')).toBe(
      'https://meta.example.com/api/social/callback/facebook',
    )
    expect(socialCallbackUrl('INSTAGRAM')).toBe(
      'https://meta.example.com/api/social/callback/instagram',
    )
  })

  it('keeps the canonical host for every other platform', async () => {
    const { socialCallbackUrl } = await load('https://meta.example.com')
    expect(socialCallbackUrl('TIKTOK')).toBe(
      'https://steel.example.com/api/social/callback/tiktok',
    )
    expect(socialCallbackUrl('YOUTUBE')).toMatch(
      /^https:\/\/steel\.example\.com\/api\/social\/callback\//,
    )
  })

  it('falls back to the canonical host without META_PUBLIC_URL', async () => {
    const { socialCallbackUrl } = await load(undefined)
    expect(socialCallbackUrl('FACEBOOK')).toBe(
      'https://steel.example.com/api/social/callback/facebook',
    )
  })
})
