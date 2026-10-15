// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  AB_CONFIG_ID,
  abCookieName,
  abRuntimeConfig,
  changedVariants,
  MISSING_FINGERPRINT,
  parseAbCookie,
  resolveAbVisitorKey,
  SITE_AB_SCRIPT,
  SITE_CONSENT_EVENT,
  serializeAbConfig,
  stableStringify,
  variantFingerprints,
} from '@/src/lib/sites/experiment-runtime'
import type { AbRuntimeEntry } from '@/src/lib/sites/experiments'
import { SITE_FORM_SUBMITTED_EVENT } from '@/src/lib/sites/runtime-script'

const NOW = new Date('2026-10-15T12:00:00Z')
const visitor = {
  ip: '203.0.113.9',
  userAgent: 'Mozilla/5.0',
  siteId: 'site1',
  secret: 'secret',
  now: NOW,
}

describe('visitor key', () => {
  it('uses the cookie when it holds a key we wrote', () => {
    const key = 'a'.repeat(32)
    expect(parseAbCookie(key)).toBe(key)
    expect(parseAbCookie('not-a-key')).toBeNull()
    expect(parseAbCookie(undefined)).toBeNull()
    expect(resolveAbVisitorKey({ ...visitor, cookie: key })).toBe(key)
  })

  it('derives a stable opaque key without the cookie', () => {
    const key = resolveAbVisitorKey({ ...visitor, cookie: null })
    expect(key).toMatch(/^[a-f0-9]{32}$/)
    expect(resolveAbVisitorKey({ ...visitor, cookie: 'bad' })).toBe(key)
    expect(
      resolveAbVisitorKey({ ...visitor, cookie: null, ip: '198.51.100.1' }),
    ).not.toBe(key)
    expect(
      resolveAbVisitorKey({
        ...visitor,
        cookie: null,
        now: new Date('2026-10-16T12:00:00Z'),
      }),
    ).not.toBe(key)
    expect(key).not.toContain('203')
    expect(abCookieName('clinica')).toBe('ss-ab-clinica')
  })
})

describe('fingerprints', () => {
  it('serializes with sorted keys', () => {
    expect(stableStringify({ b: 1, a: [2, { d: undefined, c: 'x' }] })).toBe(
      '{"a":[2,{"c":"x"}],"b":1}',
    )
    expect(stableStringify(undefined)).toBe('null')
    expect(stableStringify({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}')
  })

  function docWith(text: string): CanvasDocument {
    const doc = createSiteDocument(text)
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        root: { ...doc.nodes.root, children: ['s1', 's2'] },
        s2: { ...doc.nodes.s1, id: 's2', children: [] },
      },
    }
  }

  it('hashes each section variant and notices changes', () => {
    const experiment = {
      kind: 'SECTION' as const,
      pageId: 'home',
      controlNodeId: 's1',
      variants: [
        { key: 'A' as const, name: 'A', weight: 50, nodeId: 's1' },
        { key: 'B' as const, name: 'B', weight: 50, nodeId: 's2' },
        { key: 'C' as const, name: 'C', weight: 0 },
      ],
    }
    const before = variantFingerprints(experiment, [
      { id: 'home', document: docWith('Olá') },
    ])
    const after = variantFingerprints(experiment, [
      { id: 'home', document: docWith('Oi') },
    ])
    expect(before.C).toBe(MISSING_FINGERPRINT)
    expect(before.B).toBe(after.B)
    expect(changedVariants(before, after)).toEqual(['A'])
    expect(
      variantFingerprints(experiment, [{ id: 'other', document: docWith('x') }])
        .A,
    ).toBe(MISSING_FINGERPRINT)
  })

  it('hashes whole pages of a page test', () => {
    const experiment = {
      kind: 'PAGE' as const,
      pageId: 'home',
      controlNodeId: null,
      variants: [
        { key: 'A' as const, name: 'A', weight: 50, pageId: 'home' },
        { key: 'B' as const, name: 'B', weight: 50, pageId: 'gone' },
      ],
    }
    const prints = variantFingerprints(experiment, [
      { id: 'home', document: docWith('Olá') },
    ])
    expect(prints.A).toMatch(/^[a-f0-9]{24}$/)
    expect(prints.B).toBe(MISSING_FINGERPRINT)
  })
})

describe('SITE_AB_SCRIPT', () => {
  const KEY = 'b'.repeat(32)
  let fetchMock: ReturnType<typeof vi.fn>
  let store: Map<string, string>

  function mount(entries: AbRuntimeEntry[], options: { ask: boolean }) {
    const config = abRuntimeConfig({
      slug: 'clinica',
      visitorKey: KEY,
      bannerEnabled: options.ask,
      entries,
    })
    document.body.innerHTML = `<a id="cta" href="#x"><span id="inner">Comprar</span></a><button id="other">x</button><script id="${AB_CONFIG_ID}" type="application/json">${serializeAbConfig(config)}</script>`
    // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
    window.eval(SITE_AB_SCRIPT)
  }

  const bodies = () =>
    fetchMock.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string).events,
    )

  // Every mount registers document listeners: drop them after each test.
  let listeners: Array<Parameters<Document['addEventListener']>> = []
  const addListener = document.addEventListener.bind(document)

  beforeEach(() => {
    listeners = []
    vi.spyOn(document, 'addEventListener').mockImplementation(
      (...args: Parameters<Document['addEventListener']>) => {
        listeners.push(args)
        addListener(...args)
      },
    )
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
    fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0]?.trim()
      if (!name) continue
      // biome-ignore lint/suspicious/noDocumentCookie: clears the cookies the script under test wrote
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
  })

  afterEach(() => {
    for (const [type, listener, options] of listeners) {
      document.removeEventListener(type, listener, options)
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('escapes the config for an inline script', () => {
    expect(
      serializeAbConfig(
        abRuntimeConfig({
          slug: '</script>',
          visitorKey: KEY,
          bannerEnabled: false,
          entries: [],
        }),
      ),
    ).not.toContain('</script>')
  })

  it('sends exposures and page goals right away without a banner, and no cookie', () => {
    mount(
      [
        { id: 'e1', x: true },
        { id: 'e2', x: false, g: { t: 'page' } },
      ],
      { ask: false },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sites/clinica/experiments')
    expect(bodies()[0]).toEqual([
      { experimentId: 'e1', kind: 'EXPOSURE' },
      { experimentId: 'e2', kind: 'CONVERSION' },
    ])
    expect(document.cookie).not.toContain('ss-ab-clinica')
  })

  it('waits for consent with a banner, then stores the cookie', () => {
    mount([{ id: 'e1', x: true, g: { t: 'form' } }], { ask: true })
    expect(fetchMock).not.toHaveBeenCalled()
    // Conversions before consent are not sent either.
    document.dispatchEvent(
      new CustomEvent(SITE_FORM_SUBMITTED_EVENT, {
        detail: { action: '/api/crm/forms/tok/submit' },
      }),
    )
    expect(fetchMock).not.toHaveBeenCalled()

    document.dispatchEvent(
      new CustomEvent(SITE_CONSENT_EVENT, { detail: 'no' }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    document.dispatchEvent(
      new CustomEvent(SITE_CONSENT_EVENT, { detail: 'accepted' }),
    )
    expect(bodies()[0]).toEqual([{ experimentId: 'e1', kind: 'EXPOSURE' }])
    expect(document.cookie).toContain(`ss-ab-clinica=${KEY}`)
  })

  it('starts at once when consent was given before', () => {
    store.set('steel-site-consent:clinica', 'accepted')
    mount([{ id: 'e1', x: true }], { ask: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.cookie).toContain(`ss-ab-clinica=${KEY}`)
  })

  it('counts a form goal once, for the matching form', () => {
    mount(
      [
        { id: 'any', x: true, g: { t: 'form' } },
        { id: 'tok', x: false, g: { t: 'form', f: 'abc' } },
      ],
      { ask: false },
    )
    const submit = (action: string) =>
      document.dispatchEvent(
        new CustomEvent(SITE_FORM_SUBMITTED_EVENT, { detail: { action } }),
      )
    submit('/api/crm/forms/xyz/submit')
    submit('/api/crm/forms/abc/submit')
    submit('/api/crm/forms/abc/submit')
    document.dispatchEvent(new CustomEvent(SITE_FORM_SUBMITTED_EVENT))
    expect(bodies().slice(1)).toEqual([
      [{ experimentId: 'any', kind: 'CONVERSION' }],
      [{ experimentId: 'tok', kind: 'CONVERSION' }],
    ])
  })

  it('counts clicks inside the goal element only', () => {
    mount([{ id: 'e1', x: false, g: { t: 'click', a: 'cta' } }], {
      ask: false,
    })
    ;(document.getElementById('other') as HTMLElement).click()
    expect(fetchMock).not.toHaveBeenCalled()
    ;(document.getElementById('inner') as HTMLElement).click()
    ;(document.getElementById('cta') as HTMLElement).click()
    expect(bodies()).toEqual([[{ experimentId: 'e1', kind: 'CONVERSION' }]])
  })

  it('ignores a page without config or with broken config', () => {
    document.body.innerHTML = ''
    // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
    window.eval(SITE_AB_SCRIPT)
    document.body.innerHTML = `<script id="${AB_CONFIG_ID}" type="application/json">{oops</script>`
    // biome-ignore lint/security/noGlobalEval: runs the inline page script under test
    window.eval(SITE_AB_SCRIPT)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
