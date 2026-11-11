import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addActiveTime,
  computeScrollPct,
  createTrackerId,
  createTrackerState,
  DOCUMENT_IDLE_AFTER_MS,
  DOCUMENT_SESSION_RESUME_MS,
  isReaderActive,
  isReadingCandidate,
  markEntered,
  measureVisibility,
  pickReadingSection,
  postBeacon,
  pushEvent,
  readSessionKey,
  readVisitorId,
  recordScroll,
  resolveDevice,
  startDocumentTracker,
  takeBeacon,
  touchSessionKey,
} from '@/src/lib/canvas-document/tracker'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

const brokenStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

const context = { sessionKey: 'session-0001', visitorId: 'visitor-0001' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveDevice', () => {
  it('detects iPads that report themselves as a Mac', () => {
    expect(
      resolveDevice({
        width: 1024,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        maxTouchPoints: 5,
      }),
    ).toBe('tablet')
  })

  it('reads tablets and phones from the user agent', () => {
    expect(
      resolveDevice({
        width: 800,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X200)',
      }),
    ).toBe('tablet')
    expect(
      resolveDevice({
        width: 390,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      }),
    ).toBe('mobile')
  })

  it('falls back to the viewport width', () => {
    expect(resolveDevice({ width: 500, userAgent: 'curl/8' })).toBe('mobile')
    expect(resolveDevice({ width: 1280, userAgent: 'Mozilla/5.0 (X11)' })).toBe(
      'desktop',
    )
    expect(resolveDevice({ width: 0, userAgent: '' })).toBe('desktop')
  })
})

describe('computeScrollPct', () => {
  it('measures how far the viewport bottom went into the document', () => {
    expect(computeScrollPct(0, 4000, 1000)).toBe(25)
    expect(computeScrollPct(-1000, 4000, 1000)).toBe(50)
    expect(computeScrollPct(-3000, 4000, 1000)).toBe(100)
  })

  it('clamps to 0–100 and handles empty or short documents', () => {
    expect(computeScrollPct(0, 0, 800)).toBe(0)
    expect(computeScrollPct(0, 500, 800)).toBe(100)
    expect(computeScrollPct(2000, 4000, 800)).toBe(0)
  })
})

describe('section visibility', () => {
  const viewport = { width: 1000, height: 800 }

  it('measures the visible share, height and area', () => {
    expect(
      measureVisibility(
        'a',
        { top: 400, bottom: 1200, left: 0, right: 1000 },
        viewport,
      ),
    ).toEqual({ id: 'a', ratio: 0.5, visibleHeight: 400, visibleArea: 400_000 })
    expect(
      measureVisibility(
        'b',
        { top: 900, bottom: 900, left: 0, right: 1000 },
        viewport,
      ),
    ).toEqual({ id: 'b', ratio: 0, visibleHeight: 0, visibleArea: 0 })
  })

  it('reads a section that is half visible or covers half the viewport', () => {
    expect(
      isReadingCandidate(
        { id: 'a', ratio: 0.5, visibleHeight: 100, visibleArea: 1 },
        800,
      ),
    ).toBe(true)
    expect(
      isReadingCandidate(
        { id: 'a', ratio: 0.2, visibleHeight: 400, visibleArea: 1 },
        800,
      ),
    ).toBe(true)
    expect(
      isReadingCandidate(
        { id: 'a', ratio: 0.2, visibleHeight: 300, visibleArea: 1 },
        800,
      ),
    ).toBe(false)
    expect(
      isReadingCandidate(
        { id: 'a', ratio: 1, visibleHeight: 0, visibleArea: 0 },
        800,
      ),
    ).toBe(false)
  })

  it('picks the candidate with the largest visible area', () => {
    expect(
      pickReadingSection(
        [
          { id: 'small', ratio: 1, visibleHeight: 200, visibleArea: 200_000 },
          { id: 'tall', ratio: 0.3, visibleHeight: 600, visibleArea: 600_000 },
          {
            id: 'sliver',
            ratio: 0.05,
            visibleHeight: 50,
            visibleArea: 900_000,
          },
        ],
        800,
      ),
    ).toBe('tall')
    expect(pickReadingSection([], 800)).toBeNull()
  })
})

describe('isReaderActive', () => {
  it('needs a visible tab and an interaction in the last 30 s', () => {
    const now = 100_000
    expect(isReaderActive({ visible: true, now, lastInteractionAt: now })).toBe(
      true,
    )
    expect(
      isReaderActive({
        visible: true,
        now,
        lastInteractionAt: now - DOCUMENT_IDLE_AFTER_MS - 1,
      }),
    ).toBe(false)
    expect(
      isReaderActive({ visible: false, now, lastInteractionAt: now }),
    ).toBe(false)
  })
})

describe('tracker state and beacons', () => {
  it('always sends the first beacon, then only news', () => {
    const state = createTrackerState()
    const first = takeBeacon(state, { ...context, device: 'mobile' })
    expect(first).toMatchObject({
      sessionKey: 'session-0001',
      visitorId: 'visitor-0001',
      first: true,
      activeMs: 0,
      scrollPct: 0,
      device: 'mobile',
    })
    expect(first).not.toHaveProperty('versionId')
    expect(first).not.toHaveProperty('referrer')
    expect(takeBeacon(state, context)).toBeNull()

    recordScroll(state, 40)
    const scrolled = takeBeacon(state, context)
    expect(scrolled).toMatchObject({ first: false, scrollPct: 40 })
    expect(takeBeacon(state, context)).toBeNull()

    state.reachedEnd = true
    expect(takeBeacon(state, context)).toMatchObject({ reachedEnd: true })
  })

  it('accumulates active time per section and resets after a beacon', () => {
    const state = createTrackerState()
    takeBeacon(state, context)
    addActiveTime(state, 1000, 'sec-a')
    addActiveTime(state, 1000, 'sec-a')
    addActiveTime(state, 500, null)
    addActiveTime(state, 0, 'sec-b')
    addActiveTime(state, 700, 'x'.repeat(65))
    markEntered(state, 'sec-a')
    markEntered(state, 'y'.repeat(65))

    const beacon = takeBeacon(state, {
      ...context,
      versionId: 'ver-1',
      referrer: 'https://mail.google.com/',
    })
    expect(beacon).toMatchObject({
      activeMs: 3200,
      sections: { 'sec-a': 2000 },
      entered: ['sec-a'],
      versionId: 'ver-1',
      referrer: 'https://mail.google.com/',
    })
    expect(state.activeMs).toBe(0)
    expect(state.sections.size).toBe(0)
    expect(state.entered.size).toBe(0)
  })

  it('caps time per beacon, sections and events at the schema limits', () => {
    const state = createTrackerState()
    addActiveTime(state, 500_000, 'sec-a')
    for (let i = 0; i < 205; i++) {
      addActiveTime(state, 10, `s-${i}`)
      markEntered(state, `s-${i}`)
    }
    for (let i = 0; i < 55; i++) {
      pushEvent(state, { type: 'link_clicked', target: `https://x/${i}` })
    }
    const beacon = takeBeacon(state, context)
    expect(beacon?.activeMs).toBe(120_000)
    expect(beacon?.sections['sec-a']).toBe(120_000)
    expect(Object.keys(beacon?.sections ?? {})).toHaveLength(200)
    expect(beacon?.entered).toHaveLength(200)
    expect(beacon?.events).toHaveLength(50)
  })

  it('trims event targets and drops invalid section ids', () => {
    const state = createTrackerState()
    pushEvent(state, {
      type: 'attachment_downloaded',
      target: 'a'.repeat(2500),
      sectionId: 'z'.repeat(70),
    })
    pushEvent(state, { type: 'video_played', sectionId: 'sec-a' })
    expect(state.events[0].target).toHaveLength(2000)
    expect(state.events[0]).not.toHaveProperty('sectionId')
    expect(state.events[1]).toEqual({
      type: 'video_played',
      sectionId: 'sec-a',
    })
  })

  it('only raises the max scroll', () => {
    const state = createTrackerState()
    recordScroll(state, 60)
    recordScroll(state, 30)
    recordScroll(state, 140)
    expect(state.maxScrollPct).toBe(100)
  })
})

describe('ids and storage', () => {
  it('creates ids with crypto.randomUUID or a random fallback', () => {
    expect(createTrackerId()).toMatch(/^[0-9a-f-]{36}$/)
    vi.stubGlobal('crypto', {})
    const fallback = createTrackerId()
    expect(fallback.length).toBeGreaterThanOrEqual(8)
    expect(fallback.length).toBeLessThanOrEqual(64)
  })

  it('keeps the visitor id in storage and in memory without it', () => {
    const storage = memoryStorage()
    const first = readVisitorId(storage, () => 'visitor-abc123')
    expect(first).toBe('visitor-abc123')
    expect(readVisitorId(storage, () => 'other-visitor')).toBe('visitor-abc123')
    expect(readVisitorId(null, () => 'memory-visitor')).toBe('memory-visitor')
    expect(readVisitorId(brokenStorage, () => 'fallback-1')).toBe('fallback-1')
  })

  it('resumes the tab session within 30 min and starts a new one after', () => {
    const storage = memoryStorage()
    const now = 1_000_000
    const key = readSessionKey(storage, 'tok', now, () => 'session-aaa1')
    expect(key).toBe('session-aaa1')
    expect(
      readSessionKey(storage, 'tok', now + 60_000, () => 'session-bbb2'),
    ).toBe('session-aaa1')
    expect(
      readSessionKey(
        storage,
        'tok',
        now + 60_000 + DOCUMENT_SESSION_RESUME_MS + 1,
        () => 'session-ccc3',
      ),
    ).toBe('session-ccc3')
    expect(readSessionKey(storage, 'other', now, () => 'session-ddd4')).toBe(
      'session-ddd4',
    )
  })

  it('ignores malformed stored sessions and broken storage', () => {
    const storage = memoryStorage({
      'steel.doc.session.tok': JSON.stringify({ key: 'short', at: 1 }),
    })
    expect(readSessionKey(storage, 'tok', 2, () => 'session-new1')).toBe(
      'session-new1',
    )
    expect(readSessionKey(brokenStorage, 'tok', 2, () => 'session-x')).toBe(
      'session-x',
    )
    expect(readSessionKey(null, 'tok', 2, () => 'session-y1')).toBe(
      'session-y1',
    )
  })

  it('touches the session time and tolerates broken storage', () => {
    const storage = memoryStorage()
    touchSessionKey(storage, 'tok', 'session-aaa1', 5)
    const stored = JSON.parse(storage.data.get('steel.doc.session.tok') ?? '')
    expect(stored).toEqual({ key: 'session-aaa1', at: 5 })
    expect(() =>
      touchSessionKey(brokenStorage, 'tok', 'session-aaa1', 5),
    ).not.toThrow()
  })
})

describe('postBeacon', () => {
  const payload = takeBeacon(createTrackerState(), context)

  it('uses sendBeacon with a text/plain body', () => {
    const sendBeacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { sendBeacon })
    expect(postBeacon('/api/documents/t/track', payload as never)).toBe(true)
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob]
    expect(url).toBe('/api/documents/t/track')
    expect(blob.type).toMatch(/^text\/plain/i)
  })

  it('falls back to fetch keepalive when sendBeacon refuses or throws', () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null)))
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('navigator', { sendBeacon: () => false })
    expect(postBeacon('/track', payload as never)).toBe(true)
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('nope')
      },
    })
    expect(postBeacon('/track', payload as never)).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0]).toEqual([
      '/track',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    ])
  })

  it('swallows fetch failures', () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(postBeacon('/track', payload as never)).toBe(true)
    vi.stubGlobal('fetch', () => {
      throw new Error('sync')
    })
    expect(postBeacon('/track', payload as never)).toBe(false)
    vi.stubGlobal('fetch', undefined)
    expect(postBeacon('/track', payload as never)).toBe(false)
  })
})

describe('startDocumentTracker outside the browser', () => {
  it('is a no-op on the server', () => {
    const stop = startDocumentTracker({ token: 'tok' })
    expect(stop()).toBeUndefined()
  })
})
