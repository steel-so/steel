import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const env = vi.hoisted(() => ({ WEB_SEARCH_API_KEY: undefined as string | undefined }))
vi.mock('@/lib/env/server', () => env)

import {
  createBraveSearchProvider,
  getWebSearchProvider,
  requireWebSearchProvider,
} from '../prospecting/web-search'

beforeEach(() => {
  env.WEB_SEARCH_API_KEY = undefined
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('createBraveSearchProvider()', () => {
  it('should map the results, keeping only https and stripping tags', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      json({
        web: {
          results: [
            {
              title: 'Acme <strong>Logística</strong>',
              url: 'https://acme.com.br',
              description: 'Líder em <b>logística</b>',
            },
            { title: 'Inseguro', url: 'http://acme.com.br', description: '' },
            { title: 'Sem url', description: 'x' },
          ],
        },
      }),
    )
    const provider = createBraveSearchProvider('key-1', fetchImpl)
    const hits = expectOk(await provider.search('acme', 5))
    expect(hits).toEqual([
      {
        title: 'Acme Logística',
        url: 'https://acme.com.br',
        snippet: 'Líder em logística',
      },
    ])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('q=acme')
    expect(url).toContain('count=5')
    expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('key-1')
    expect(provider.source).toBe('brave')
  })

  it('should clamp the count and tolerate an empty answer', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => json({}))
    const provider = createBraveSearchProvider('k', fetchImpl)
    expect(expectOk(await provider.search('x', 99))).toEqual([])
    expect(expectOk(await provider.search('x', 0))).toEqual([])
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]))
    expect(urls[0]).toContain('count=8')
    expect(urls[1]).toContain('count=1')
  })

  it('should turn HTTP errors and network failures into a domain error', async () => {
    const down = createBraveSearchProvider('k', async () => json({}, 429))
    expect(expectErr(await down.search('x', 3)).message).toContain('429')

    const broken = createBraveSearchProvider('k', async () => {
      throw new Error('boom')
    })
    expectErr(await broken.search('x', 3), 'CRM_PROSPECT_WEB_FAILED')
  })
})

describe('getWebSearchProvider()', () => {
  it('should be absent without a key', () => {
    expect(getWebSearchProvider()).toBeNull()
    expectErr(requireWebSearchProvider(), 'CRM_PROSPECT_SEARCH_NOT_CONFIGURED')
  })

  it('should use Brave when the key is set', () => {
    env.WEB_SEARCH_API_KEY = 'secret'
    expect(getWebSearchProvider()?.source).toBe('brave')
    expect(expectOk(requireWebSearchProvider()).source).toBe('brave')
  })
})
