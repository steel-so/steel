// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startDocumentTracker } from '@/src/lib/canvas-document/tracker'
import type { DocumentTrackInput } from '@/src/schemas/document.schema'

type ObserverCallback = (entries: Partial<IntersectionObserverEntry>[]) => void

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly observed: Element[] = []
  disconnected = false

  constructor(readonly callback: ObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  disconnect() {
    this.disconnected = true
  }

  emit(element: Element, isIntersecting: boolean) {
    this.callback([{ target: element, isIntersecting }])
  }
}

const VIEWPORT = { width: 1024, height: 800 }

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: VIEWPORT.width,
    width: VIEWPORT.width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

function place(element: Element, top: number, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(top, height))
}

let visibility: DocumentVisibilityState = 'visible'
let sendBeacon: ReturnType<typeof vi.fn>

async function beacons(): Promise<DocumentTrackInput[]> {
  const blobs = sendBeacon.mock.calls.map((call) => call[1] as Blob)
  return Promise.all(blobs.map(async (blob) => JSON.parse(await blob.text())))
}

function buildDocument(options: { end?: boolean } = {}) {
  const root = document.createElement('main')
  root.innerHTML = `
    <section data-doc-section="sec-a" data-doc-section-name="Introdução">
      <a data-doc-track="link" href="https://cliente.com.br">Site</a>
      <a href="/termos">Termos</a>
      <span data-doc-track="attachment" data-doc-track-target="contrato.pdf">
        Contrato
      </span>
      <div data-doc-track="video" data-doc-track-target="https://youtu.be/x">
        <img alt="" />
      </div>
      <video src="https://cdn.example.com/demo.mp4"></video>
    </section>
    <section data-doc-section="sec-b"><p>Preços</p></section>
    ${options.end === false ? '' : '<div data-doc-end></div>'}
  `
  document.body.appendChild(root)
  const [a, b] = root.querySelectorAll('[data-doc-section]')
  place(root, 0, 1600)
  place(a, 0, 800)
  place(b, 800, 800)
  return { root, a, b }
}

const sectionObserver = () => FakeIntersectionObserver.instances[0]
const endObserver = () => FakeIntersectionObserver.instances[1]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  sendBeacon = vi.fn(() => true)
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: sendBeacon,
  })
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: VIEWPORT.height,
  })
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: VIEWPORT.width,
  })
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('startDocumentTracker (DOM)', () => {
  it('opens the session with a first beacon to the token endpoint', async () => {
    const { root } = buildDocument()
    const stop = startDocumentTracker({ token: 'tok 1', root, versionId: 'v1' })

    expect(sendBeacon).toHaveBeenCalledTimes(1)
    expect(sendBeacon.mock.calls[0][0]).toBe('/api/documents/tok%201/track')
    const [first] = await beacons()
    expect(first).toMatchObject({
      first: true,
      versionId: 'v1',
      device: 'desktop',
      activeMs: 0,
      scrollPct: 50,
    })
    expect(first.sessionKey).toHaveLength(36)
    expect(window.localStorage.getItem('steel.doc.visitor')).toBe(
      first.visitorId,
    )
    stop()
  })

  it('counts active time on the section being read and its views', async () => {
    const { root, a } = buildDocument()
    const stop = startDocumentTracker({
      token: 'tok',
      root,
      endpoint: '/custom',
    })
    sectionObserver().emit(a, true)
    window.dispatchEvent(new Event('mousemove'))

    vi.advanceTimersByTime(15_000)

    const [, second] = await beacons()
    expect(sendBeacon.mock.calls[1][0]).toBe('/custom')
    expect(second).toMatchObject({
      first: false,
      activeMs: 15_000,
      sections: { 'sec-a': 15_000 },
      entered: ['sec-a'],
    })
    stop()
  })

  it('stops counting after 30 s without interaction', async () => {
    const { root, a } = buildDocument()
    const stop = startDocumentTracker({ token: 'tok', root })
    sectionObserver().emit(a, true)

    vi.advanceTimersByTime(45_000)

    const sent = await beacons()
    expect(sent).toHaveLength(3)
    expect(sent[1].activeMs).toBe(15_000)
    expect(sent[2].activeMs).toBe(15_000)

    window.dispatchEvent(new Event('keydown'))
    vi.advanceTimersByTime(15_000)
    const resumed = await beacons()
    expect(resumed[3].activeMs).toBe(15_000)
    stop()
  })

  it('flushes when the tab is hidden and pauses until it is back', async () => {
    const { root, a } = buildDocument()
    const stop = startDocumentTracker({ token: 'tok', root })
    sectionObserver().emit(a, true)
    vi.advanceTimersByTime(5_000)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    const [, hidden] = await beacons()
    expect(hidden.activeMs).toBe(5_000)

    vi.advanceTimersByTime(30_000)
    expect(sendBeacon).toHaveBeenCalledTimes(2)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(10_000)
    const back = await beacons()
    expect(back[2].activeMs).toBe(10_000)
    stop()
  })

  it('records link clicks, downloads and video plays once per video', async () => {
    const { root } = buildDocument()
    const stop = startDocumentTracker({ token: 'tok', root })
    // jsdom does not navigate; keep the anchors' default action quiet.
    document.addEventListener('click', (event) => event.preventDefault())
    const click = (selector: string) =>
      root
        .querySelector(selector)
        ?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        )

    click('a[data-doc-track]')
    click('a[href="/termos"]')
    click('[data-doc-track="attachment"]')
    click('[data-doc-track="video"] img')
    click('[data-doc-track="video"] img')
    root.querySelector('video')?.dispatchEvent(new Event('play'))
    root.querySelector('video')?.dispatchEvent(new Event('play'))
    root.querySelector('p')?.dispatchEvent(new MouseEvent('click'))
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    stop()
    const sent = await beacons()
    expect(sent.at(-1)?.events).toEqual([
      {
        type: 'link_clicked',
        target: 'https://cliente.com.br',
        sectionId: 'sec-a',
      },
      { type: 'link_clicked', target: '/termos', sectionId: 'sec-a' },
      {
        type: 'attachment_downloaded',
        target: 'contrato.pdf',
        sectionId: 'sec-a',
      },
      {
        type: 'video_played',
        target: 'https://youtu.be/x',
        sectionId: 'sec-a',
      },
      {
        type: 'video_played',
        target: 'https://cdn.example.com/demo.mp4',
        sectionId: 'sec-a',
      },
    ])
  })

  it('marks the end through the end marker', async () => {
    const { root } = buildDocument()
    const stop = startDocumentTracker({ token: 'tok', root })
    const marker = root.querySelector('[data-doc-end]') as Element

    endObserver().callback([{ target: marker, isIntersecting: false }])
    vi.advanceTimersByTime(15_000)
    expect((await beacons()).at(-1)?.reachedEnd).toBe(false)

    endObserver().emit(marker, true)
    vi.advanceTimersByTime(15_000)
    expect((await beacons()).at(-1)?.reachedEnd).toBe(true)
    stop()
  })

  it('marks the end by scroll when there is no end marker', async () => {
    const { root } = buildDocument({ end: false })
    const stop = startDocumentTracker({ token: 'tok', root })

    place(root, -800, 1600)
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(15_000)

    expect((await beacons()).at(-1)).toMatchObject({
      scrollPct: 100,
      reachedEnd: true,
    })
    stop()
  })

  it('observes sections rendered after the start', async () => {
    const { root } = buildDocument()
    const stop = startDocumentTracker({ token: 'tok', root })
    const late = document.createElement('section')
    late.setAttribute('data-doc-section', 'sec-late')
    root.appendChild(late)

    await vi.waitFor(() => expect(sectionObserver().observed).toContain(late))
    stop()
  })

  it('works without IntersectionObserver by measuring every section', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { root } = buildDocument()
    const stop = startDocumentTracker({ token: 'tok', root })
    window.dispatchEvent(new Event('touchstart'))

    vi.advanceTimersByTime(15_000)

    expect((await beacons()).at(-1)?.sections).toEqual({ 'sec-a': 15_000 })
    stop()
  })

  it('flushes on pagehide and cleans up on stop', async () => {
    const { root, a } = buildDocument()
    const stop = startDocumentTracker({ token: 'tok', root })
    sectionObserver().emit(a, true)
    vi.advanceTimersByTime(3_000)

    window.dispatchEvent(new Event('pagehide'))
    expect((await beacons()).at(-1)?.activeMs).toBe(3_000)

    stop()
    stop()
    expect(sectionObserver().disconnected).toBe(true)
    expect(endObserver().disconnected).toBe(true)
    const count = sendBeacon.mock.calls.length
    root.querySelector('p')?.click()
    vi.advanceTimersByTime(60_000)
    expect(sendBeacon).toHaveBeenCalledTimes(count)
  })

  it('reuses the tab session on a reload and keeps the visitor', async () => {
    const { root } = buildDocument()
    startDocumentTracker({ token: 'tok', root })()
    startDocumentTracker({ token: 'tok', root })()

    const sent = await beacons()
    expect(sent[0].sessionKey).toBe(sent.at(-1)?.sessionKey)
    expect(sent[0].visitorId).toBe(sent.at(-1)?.visitorId)
  })
})
