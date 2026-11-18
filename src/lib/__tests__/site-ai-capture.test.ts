import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/env/server', () => ({ CHROMIUM_PATH: undefined }))

import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'
import {
  cleanBlock,
  cleanStyle,
  fontFamiliesFromStacks,
  shortText,
} from '@/src/lib/site-ai/fidelity/capture/clean-style'
import {
  normalizeColor,
  parseColor,
} from '@/src/lib/site-ai/fidelity/capture/color'
import {
  decideRoute,
  isServerAddressAllowed,
  redirectDepth,
} from '@/src/lib/site-ai/fidelity/capture/route-policy'
import {
  CAPTURE_TTL_SECONDS,
  captureKey,
  loadCapture,
  saveCapture,
} from '@/src/lib/site-ai/fidelity/capture/store'
import {
  fitJpeg,
  MAX_STRIP_CHARS,
  planStrips,
} from '@/src/lib/site-ai/fidelity/capture/strips'
import type { ReferenceCapture } from '@/src/lib/site-ai/fidelity/types'

describe('normalizeColor', () => {
  it('should convert rgb and rgba to #rrggbb', () => {
    expect(normalizeColor('rgb(255, 0, 128)')).toBe('#ff0080')
    expect(normalizeColor('rgba(17, 24, 39, 0.5)')).toBe('#111827')
    expect(parseColor('rgba(17, 24, 39, 0.5)')?.alpha).toBe(0.5)
  })

  it('should treat fully transparent colors as transparent', () => {
    expect(normalizeColor('rgba(0, 0, 0, 0)')).toBe('transparent')
    expect(normalizeColor('transparent')).toBe('transparent')
  })

  it('should expand short hex and drop hex alpha', () => {
    expect(normalizeColor('#FA0')).toBe('#ffaa00')
    expect(normalizeColor('#11223344')).toBe('#112233')
  })

  it('should convert hsl, color(srgb) and oklch', () => {
    expect(normalizeColor('hsl(0, 100%, 50%)')).toBe('#ff0000')
    expect(normalizeColor('color(srgb 1 0 0)')).toBe('#ff0000')
    expect(normalizeColor('oklch(1 0 0)')).toBe('#ffffff')
    expect(normalizeColor('oklch(0 0 0)')).toBe('#000000')
  })

  it('should return null for things that are not colors', () => {
    expect(normalizeColor('')).toBeNull()
    expect(normalizeColor('nope')).toBeNull()
    expect(normalizeColor('rgb(a, b, c)')).toBeNull()
  })
})

describe('cleanStyle / cleanBlock', () => {
  it('should normalize colors, drop defaults and keep alpha', () => {
    expect(
      cleanStyle({
        color: 'rgb(0, 0, 0)',
        'background-color': 'rgba(0, 0, 0, 0)',
        'border-radius': '0px',
        padding: '16px 24px',
        'box-shadow': 'none',
        'font-size': '',
      }),
    ).toEqual({ color: '#000000', padding: '16px 24px' })
    expect(
      cleanStyle({ 'background-color': 'rgba(255, 255, 255, 0.4)' }),
    ).toEqual({
      'background-color': '#ffffff',
      'background-color-alpha': '0.4',
    })
  })

  it('should shorten text and round geometry recursively', () => {
    const long = 'a'.repeat(300)
    expect(shortText('  hello \n  world ')).toBe('hello world')
    expect(shortText(long)).toHaveLength(120)
    const block = cleanBlock({
      y: 10.4,
      height: 99.6,
      tag: 'SECTION',
      style: { color: 'rgb(255, 255, 255)' },
      text: ' x ',
      children: [{ y: 11, height: 20, tag: 'H1', style: {}, text: 'Title' }],
    })
    expect(block).toMatchObject({
      y: 10,
      height: 100,
      tag: 'section',
      text: 'x',
    })
    expect(block.children?.[0].tag).toBe('h1')
  })

  it('should list the first non-generic family by usage', () => {
    expect(
      fontFamiliesFromStacks([
        ['"Inter", system-ui, sans-serif', 5],
        ['Georgia, serif', 2],
        ['system-ui, sans-serif', 9],
        ['inter, sans-serif', 1],
      ]),
    ).toEqual(['Inter', 'Georgia', 'inter'])
  })
})

describe('planStrips / fitJpeg', () => {
  it('should cut the page into 1100px bands', () => {
    expect(planStrips(2500, 8)).toEqual([
      { y: 0, height: 1100 },
      { y: 1100, height: 1100 },
      { y: 2200, height: 300 },
    ])
  })

  it('should stop at the strip limit', () => {
    expect(planStrips(50_000, 4)).toHaveLength(4)
    expect(planStrips(50_000, 8)).toHaveLength(8)
  })

  it('should return nothing for an empty page', () => {
    expect(planStrips(0, 8)).toEqual([])
    expect(planStrips(Number.NaN, 8)).toEqual([])
  })

  it('should lower the quality until the data URL fits', async () => {
    const encode = vi.fn(async (quality: number) =>
      Buffer.alloc(quality > 50 ? 2_000_000 : 1000),
    )
    const url = await fitJpeg(encode)
    expect(url?.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(url?.length).toBeLessThanOrEqual(MAX_STRIP_CHARS)
    expect(encode.mock.calls.map(([q]) => q)).toEqual([78, 62, 48])
  })

  it('should give up when nothing fits', async () => {
    expect(await fitJpeg(async () => Buffer.alloc(5_000_000))).toBeNull()
  })
})

describe('decideRoute', () => {
  const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }]
  const privateResolver = async () => [{ address: '10.0.0.5', family: 4 }]

  it('should allow public http(s) hosts and inline schemes', async () => {
    expect(
      await decideRoute('https://example.com/a', 0, publicResolver),
    ).toEqual({
      allow: true,
    })
    expect(await decideRoute('data:image/png;base64,AAAA', 0)).toEqual({
      allow: true,
    })
    expect(await decideRoute('blob:https://example.com/1', 0)).toEqual({
      allow: true,
    })
  })

  it('should block private, loopback and metadata targets', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://localhost/',
      'http://[::1]/',
      'http://intranet.local/',
    ]) {
      expect((await decideRoute(url, 0, publicResolver)).allow).toBe(false)
    }
  })

  it('should block hosts that resolve to a private address', async () => {
    expect(
      await decideRoute('https://evil.example/', 0, privateResolver),
    ).toEqual({ allow: false, reason: 'blocked_host' })
  })

  it('should block other ports, credentials and non-web schemes', async () => {
    expect(
      (await decideRoute('https://example.com:8443/', 0, publicResolver)).allow,
    ).toBe(false)
    expect(
      (await decideRoute('https://u:p@example.com/', 0, publicResolver)).allow,
    ).toBe(false)
    expect(await decideRoute('file:///etc/passwd', 0)).toEqual({
      allow: false,
      reason: 'scheme',
    })
    expect(
      (await decideRoute('ws://example.com/', 0, publicResolver)).allow,
    ).toBe(false)
    expect((await decideRoute('ftp://example.com/', 0)).allow).toBe(false)
  })

  it('should allow at most 3 redirects', async () => {
    expect(
      (await decideRoute('https://example.com/', 3, publicResolver)).allow,
    ).toBe(true)
    expect(
      await decideRoute('https://example.com/', 4, publicResolver),
    ).toEqual({
      allow: false,
      reason: 'redirects',
    })
  })

  it('should count the redirect chain depth', () => {
    const chain = (n: number): { redirectedFrom(): unknown } =>
      n === 0
        ? { redirectedFrom: () => null }
        : { redirectedFrom: () => chain(n - 1) }
    expect(redirectDepth(chain(0) as never)).toBe(0)
    expect(redirectDepth(chain(3) as never)).toBe(3)
    expect(redirectDepth(chain(50) as never)).toBeGreaterThan(3)
  })

  it('should reject the connected address when private', () => {
    expect(isServerAddressAllowed('93.184.216.34')).toBe(true)
    expect(isServerAddressAllowed('10.1.2.3')).toBe(false)
    expect(isServerAddressAllowed('::1')).toBe(false)
    expect(isServerAddressAllowed(undefined)).toBe(true)
  })
})

describe('capture store', () => {
  const capture: ReferenceCapture = {
    url: 'https://example.com',
    title: 'Example',
    desktop: { width: 1440, height: 900, strips: [], blocks: [] },
    mobile: { width: 390, height: 844, strips: [] },
    fonts: ['Inter'],
  }

  function fakeRedis() {
    const data = new Map<string, { value: string; ttl: number }>()
    return {
      data,
      set: vi.fn(async (key: string, value: string, _m: 'EX', ttl: number) => {
        data.set(key, { value, ttl })
      }),
      get: vi.fn(async (key: string) => data.get(key)?.value ?? null),
    }
  }

  it('should store with a 15 minute TTL and read back', async () => {
    const redis = fakeRedis()
    await saveCapture(redis, 'req-1', ok(capture))
    expect(redis.data.get(captureKey('req-1'))?.ttl).toBe(CAPTURE_TTL_SECONDS)
    expect(captureKey('req-1')).toBe('site-ai:capture:req-1')
    expect(await loadCapture(redis, 'req-1')).toEqual({
      ok: true,
      value: capture,
    })
  })

  it('should store failures with their pt-BR message', async () => {
    const redis = fakeRedis()
    await saveCapture(
      redis,
      'req-2',
      err(appError('BAD_REQUEST', 'Este endereço não é um site público.')),
    )
    const loaded = await loadCapture(redis, 'req-2')
    expect(loaded).toMatchObject({
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Este endereço não é um site público.',
      },
    })
  })

  it('should return null while nothing was stored', async () => {
    expect(await loadCapture(fakeRedis(), 'missing')).toBeNull()
  })
})
