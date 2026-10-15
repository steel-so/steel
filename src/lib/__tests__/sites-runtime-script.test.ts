// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SITE_COOKIE_BANNER_ID,
  SITE_FORM_SUBMITTED_EVENT,
  SITE_RUNTIME_CONFIG_ID,
  SITE_RUNTIME_SCRIPT,
  serializeRuntimeConfig,
  showsCookieBanner,
  siteRuntimeConfig,
} from '@/src/lib/sites/runtime-script'

type Tracking = Parameters<typeof siteRuntimeConfig>[0]['tracking']

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function mount(options: { banner: boolean; tracking?: Tracking }) {
  const config = siteRuntimeConfig({
    slug: 'clinica',
    pageId: 'p1',
    path: '/contato',
    bannerEnabled: options.banner,
    tracking: options.tracking,
  })
  const banner = showsCookieBanner({
    bannerEnabled: options.banner,
    tracking: options.tracking,
  })
    ? `<section id="${SITE_COOKIE_BANNER_ID}" hidden><button data-consent="rejected">Rejeitar</button><button data-consent="accepted">Aceitar</button></section>`
    : ''
  document.head.innerHTML = ''
  document.body.innerHTML = `${banner}<script id="${SITE_RUNTIME_CONFIG_ID}" type="application/json">${serializeRuntimeConfig(config)}</script>`
  // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
  window.eval(SITE_RUNTIME_SCRIPT)
}

function bodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(
    (call) =>
      JSON.parse((call[1] as RequestInit).body as string) as Record<
        string,
        unknown
      >,
  )
}

const bannerEl = () =>
  document.getElementById(SITE_COOKIE_BANNER_ID) as HTMLElement

const click = (choice: 'accepted' | 'rejected') =>
  (bannerEl().querySelector(`[data-consent=${choice}]`) as HTMLElement).click()

const scripts = () =>
  [...document.head.querySelectorAll('script')].map((s) => s.src)

let fetchMock: ReturnType<typeof vi.fn>
let store: Map<string, string>

beforeEach(() => {
  // Node's own (file-less) localStorage shadows jsdom's: use a memory one.
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
  window.history.replaceState(
    null,
    '',
    '/contato?utm_source=ig&utm_campaign=out',
  )
  fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
  vi.stubGlobal('fetch', fetchMock)
  const w = window as unknown as Record<string, unknown>
  delete w.dataLayer
  delete w.gtag
  delete w.fbq
  delete w._fbq
})

afterEach(() => vi.unstubAllGlobals())

describe('SITE_RUNTIME_SCRIPT', () => {
  // Runs first: every mount leaves its listener on `document`.
  it('waits for consent with the banner on and loads nothing on reject', async () => {
    mount({ banner: true, tracking: { googleAnalyticsId: 'G-ABC123' } })
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(bannerEl().hidden).toBe(false)
    click('rejected')
    expect(bannerEl().hidden).toBe(true)
    expect(store.get('steel-site-consent:clinica')).toBe('rejected')
    expect(scripts()).toEqual([])

    // A form sent without consent records nothing.
    document.dispatchEvent(
      new CustomEvent(SITE_FORM_SUBMITTED_EVENT, {
        detail: { action: '/api/crm/forms/tok/submit' },
      }),
    )
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the view right away when there is no banner nor trackers', async () => {
    mount({ banner: false })
    await flush()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sites/clinica/views',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    )
    expect(bodies(fetchMock)[0]).toEqual({
      pageId: 'p1',
      path: '/contato',
      utmSource: 'ig',
      utmCampaign: 'out',
    })
    expect(document.getElementById(SITE_COOKIE_BANNER_ID)).toBeNull()
  })

  it('sends the view and loads GA4, GTM and the Pixel after accepting', async () => {
    mount({
      banner: true,
      tracking: {
        googleAnalyticsId: 'G-ABC123',
        googleTagManagerId: 'GTM-XYZ12',
        metaPixelId: '1234567',
      },
    })
    click('accepted')
    await flush()
    expect(bodies(fetchMock)).toHaveLength(1)
    expect(scripts()).toEqual([
      'https://www.googletagmanager.com/gtag/js?id=G-ABC123',
      'https://www.googletagmanager.com/gtm.js?id=GTM-XYZ12',
      'https://connect.facebook.net/en_US/fbevents.js',
    ])
    const w = window as unknown as {
      dataLayer: unknown[]
      fbq: { queue: unknown[][] }
    }
    expect(w.dataLayer.length).toBeGreaterThanOrEqual(3)
    expect(w.fbq.queue.map((args) => [...args])).toEqual([
      ['init', '1234567'],
      ['track', 'PageView'],
    ])

    document.dispatchEvent(
      new CustomEvent(SITE_FORM_SUBMITTED_EVENT, {
        detail: { action: 'https://x/api/crm/forms/abc%20d/submit' },
      }),
    )
    await flush()
    expect(bodies(fetchMock)[1]).toEqual({
      pageId: 'p1',
      path: '/contato',
      kind: 'CONVERSION',
      formToken: 'abc d',
    })
    expect(w.fbq.queue.at(-1)).toEqual(
      expect.objectContaining({ 0: 'track', 1: 'Lead' }),
    )
    expect(w.dataLayer).toContainEqual({ event: 'steel_form_submit' })
  })

  it('remembers an earlier acceptance', async () => {
    store.set('steel-site-consent:clinica', 'accepted')
    mount({ banner: false, tracking: { metaPixelId: '1234567' } })
    await flush()
    // View sent once (no banner), Pixel loaded without asking again.
    expect(bodies(fetchMock)).toHaveLength(1)
    expect(bannerEl().hidden).toBe(true)
    expect(scripts()).toEqual([
      'https://connect.facebook.net/en_US/fbevents.js',
    ])
  })

  it('remembers a rejection and records conversions without a banner', async () => {
    store.set('steel-site-consent:clinica', 'rejected')
    mount({ banner: false, tracking: { googleTagManagerId: 'GTM-XYZ12' } })
    await flush()
    expect(scripts()).toEqual([])
    document.dispatchEvent(
      new CustomEvent(SITE_FORM_SUBMITTED_EVENT, { detail: {} }),
    )
    await flush()
    expect(bodies(fetchMock)[1]).toEqual({
      pageId: 'p1',
      path: '/contato',
      kind: 'CONVERSION',
    })
  })

  it('does nothing without a valid config', () => {
    document.body.innerHTML = `<script id="${SITE_RUNTIME_CONFIG_ID}" type="application/json">{nope</script>`
    // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
    window.eval(SITE_RUNTIME_SCRIPT)
    document.body.innerHTML = ''
    // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
    window.eval(SITE_RUNTIME_SCRIPT)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serializes the config without closing the script element', () => {
    const json = serializeRuntimeConfig(
      siteRuntimeConfig({
        slug: 'x',
        pageId: '</script>',
        path: '/',
        bannerEnabled: false,
        tracking: undefined,
      }),
    )
    expect(json).not.toContain('<')
    expect(JSON.parse(json).tracking).toEqual({})
  })
})
