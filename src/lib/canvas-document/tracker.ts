/**
 * Reading tracker of the public link (owned by the documents analytics
 * slice). Scans the `data-doc-section` elements rendered by the catalog,
 * measures active time per section and posts `DocumentTrackSchema` beacons
 * to `POST /api/documents/<token>/track`.
 *
 * Time only counts while the tab is visible and the reader interacted in
 * the last 30 s. The section "being read" is the one at least half visible
 * (or covering at least half of the viewport); with several, the one with
 * the largest visible area. Beacons go every 15 s and when the page is
 * hidden or closed, through `navigator.sendBeacon` (fallback: `fetch` with
 * `keepalive`). The pure helpers are exported for the unit tests.
 */
import type { DocumentTrackInput } from '@/src/schemas/document.schema'
import { DOC_END_ATTR, DOC_SECTION_ATTR, DOC_TRACK_ATTR } from './constants'

export interface DocumentTrackerOptions {
  token: string
  versionId?: string
  /** Defaults to `/api/documents/<token>/track`. */
  endpoint?: string
  /** Element holding the rendered document; defaults to `document.body`. */
  root?: HTMLElement
}

export const DOCUMENT_TRACK_INTERVAL_MS = 15_000
export const DOCUMENT_IDLE_AFTER_MS = 30_000
/** A new session starts after this long without any beacon in the tab. */
export const DOCUMENT_SESSION_RESUME_MS = 30 * 60_000

const TICK_MS = 1_000
const MAX_MS_PER_BEACON = 120_000
const MAX_ID_LENGTH = 64
const MAX_SECTIONS = 200
const MAX_EVENTS = 50
const MAX_TARGET_LENGTH = 2_000
const VISITOR_STORAGE_KEY = 'steel.doc.visitor'
const SESSION_STORAGE_PREFIX = 'steel.doc.session.'

/** pt-BR notice for the public page footer (LGPD transparency). */
export const DOCUMENT_TRACKING_NOTICE =
  'Quem enviou este documento vê quanto tempo ele foi lido e quais partes foram vistas. Não guardamos seu IP, só um código anônimo deste navegador.'

export type DocumentDevice = 'desktop' | 'tablet' | 'mobile'
export type DocumentTrackEvent = DocumentTrackInput['events'][number]

export interface SectionVisibility {
  id: string
  /** Visible share of the section itself (0–1). */
  ratio: number
  /** Visible height in px. */
  visibleHeight: number
  /** Visible area in px². */
  visibleArea: number
}

export interface ViewportRect {
  top: number
  bottom: number
  left: number
  right: number
}

export interface TrackerState {
  activeMs: number
  sections: Map<string, number>
  entered: Set<string>
  maxScrollPct: number
  sentScrollPct: number
  reachedEnd: boolean
  sentReachedEnd: boolean
  events: DocumentTrackEvent[]
  first: boolean
}

export interface BeaconContext {
  sessionKey: string
  visitorId: string
  versionId?: string
  device?: DocumentDevice
  referrer?: string
}

interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// ── Pure helpers ───────────────────────────────────────────────────────────

const TABLET_UA = /iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i
const MOBILE_UA = /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i

/** Device class from the user agent, then from the viewport width. */
export function resolveDevice(input: {
  width: number
  userAgent: string
  maxTouchPoints?: number
}): DocumentDevice {
  const ua = input.userAgent
  // iPadOS reports itself as a Mac; only the touch points give it away.
  if (/Macintosh/.test(ua) && (input.maxTouchPoints ?? 0) > 1) return 'tablet'
  if (TABLET_UA.test(ua)) return 'tablet'
  if (MOBILE_UA.test(ua)) return 'mobile'
  if (input.width > 0 && input.width < 640) return 'mobile'
  return 'desktop'
}

/**
 * Share of the document already shown (0–100): how far the bottom of the
 * viewport went into the root element. A document shorter than the
 * viewport counts as fully shown.
 */
export function computeScrollPct(
  rootTop: number,
  rootHeight: number,
  viewportHeight: number,
): number {
  if (rootHeight <= 0) return 0
  const seen = viewportHeight - rootTop
  const pct = Math.round((seen / rootHeight) * 100)
  return Math.min(100, Math.max(0, pct))
}

/** Visible share, height and area of an element inside the viewport. */
export function measureVisibility(
  id: string,
  rect: ViewportRect,
  viewport: { width: number; height: number },
): SectionVisibility {
  const height = Math.max(0, rect.bottom - rect.top)
  const visibleHeight = Math.max(
    0,
    Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0),
  )
  const visibleWidth = Math.max(
    0,
    Math.min(rect.right, viewport.width) - Math.max(rect.left, 0),
  )
  return {
    id,
    ratio: height > 0 ? visibleHeight / height : 0,
    visibleHeight,
    visibleArea: visibleHeight * visibleWidth,
  }
}

/** At least half of the section, or at least half of the viewport. */
export function isReadingCandidate(
  section: SectionVisibility,
  viewportHeight: number,
): boolean {
  if (section.visibleHeight <= 0) return false
  return section.ratio >= 0.5 || section.visibleHeight >= viewportHeight / 2
}

/** The section being read: the candidate with the largest visible area. */
export function pickReadingSection(
  sections: SectionVisibility[],
  viewportHeight: number,
): string | null {
  let best: SectionVisibility | null = null
  for (const section of sections) {
    if (!isReadingCandidate(section, viewportHeight)) continue
    if (!best || section.visibleArea > best.visibleArea) best = section
  }
  return best?.id ?? null
}

/** Tab visible and some interaction in the last 30 s. */
export function isReaderActive(input: {
  visible: boolean
  now: number
  lastInteractionAt: number
}): boolean {
  return (
    input.visible &&
    input.now - input.lastInteractionAt <= DOCUMENT_IDLE_AFTER_MS
  )
}

export function createTrackerState(): TrackerState {
  return {
    activeMs: 0,
    sections: new Map(),
    entered: new Set(),
    maxScrollPct: 0,
    sentScrollPct: -1,
    reachedEnd: false,
    sentReachedEnd: false,
    events: [],
    first: true,
  }
}

function validId(id: string | null | undefined): id is string {
  return Boolean(id) && (id as string).length <= MAX_ID_LENGTH
}

/** Adds active time to the document and to the section being read. */
export function addActiveTime(
  state: TrackerState,
  ms: number,
  sectionId: string | null,
): void {
  if (ms <= 0) return
  state.activeMs += ms
  if (!validId(sectionId)) return
  if (!state.sections.has(sectionId) && state.sections.size >= MAX_SECTIONS) {
    return
  }
  state.sections.set(sectionId, (state.sections.get(sectionId) ?? 0) + ms)
}

export function markEntered(state: TrackerState, sectionId: string): void {
  if (!validId(sectionId) || state.entered.size >= MAX_SECTIONS) return
  state.entered.add(sectionId)
}

export function recordScroll(state: TrackerState, pct: number): void {
  if (pct > state.maxScrollPct) state.maxScrollPct = Math.min(100, pct)
}

export function pushEvent(
  state: TrackerState,
  event: DocumentTrackEvent,
): void {
  if (state.events.length >= MAX_EVENTS) return
  const target = event.target?.slice(0, MAX_TARGET_LENGTH)
  const sectionId = validId(event.sectionId) ? event.sectionId : undefined
  state.events.push({
    type: event.type,
    ...(target ? { target } : {}),
    ...(sectionId ? { sectionId } : {}),
  })
}

const clampMs = (ms: number) => Math.min(MAX_MS_PER_BEACON, Math.round(ms))

/**
 * Drains the state into a beacon payload, or `null` when there is nothing
 * new to report (the first beacon always goes: it opens the session).
 */
export function takeBeacon(
  state: TrackerState,
  context: BeaconContext,
): DocumentTrackInput | null {
  const scrollPct = Math.round(state.maxScrollPct)
  const hasNews =
    state.first ||
    state.activeMs >= 1 ||
    state.sections.size > 0 ||
    state.entered.size > 0 ||
    state.events.length > 0 ||
    scrollPct !== state.sentScrollPct ||
    state.reachedEnd !== state.sentReachedEnd
  if (!hasNews) return null

  const sections: Record<string, number> = {}
  for (const [id, ms] of state.sections) sections[id] = clampMs(ms)

  const payload: DocumentTrackInput = {
    sessionKey: context.sessionKey,
    visitorId: context.visitorId,
    ...(context.versionId ? { versionId: context.versionId } : {}),
    activeMs: clampMs(state.activeMs),
    sections,
    entered: [...state.entered],
    scrollPct,
    reachedEnd: state.reachedEnd,
    first: state.first,
    ...(context.device ? { device: context.device } : {}),
    ...(context.referrer ? { referrer: context.referrer } : {}),
    events: state.events,
  }

  state.activeMs = 0
  state.sections = new Map()
  state.entered = new Set()
  state.events = []
  state.first = false
  state.sentScrollPct = scrollPct
  state.sentReachedEnd = state.reachedEnd
  return payload
}

/** Random id (8–64 chars, as the beacon schema asks). */
export function createTrackerId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  const random = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `${random()}${random()}${random()}`
}

function isTrackerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= MAX_ID_LENGTH
  )
}

/**
 * Long-lived anonymous visitor id (localStorage). Without storage (private
 * mode, blocked site data) the id lives only in memory for this page.
 */
export function readVisitorId(
  storage: KeyValueStorage | null,
  generate: () => string = createTrackerId,
): string {
  try {
    const stored = storage?.getItem(VISITOR_STORAGE_KEY)
    if (isTrackerId(stored)) return stored
    const id = generate()
    storage?.setItem(VISITOR_STORAGE_KEY, id)
    return id
  } catch {
    return generate()
  }
}

/**
 * Session id of this tab for one document (sessionStorage): a reload keeps
 * the session; a new tab, or 30 min without beacons, starts a new one.
 */
export function readSessionKey(
  storage: KeyValueStorage | null,
  token: string,
  now: number,
  generate: () => string = createTrackerId,
): string {
  const key = `${SESSION_STORAGE_PREFIX}${token}`
  try {
    const raw = storage?.getItem(key)
    const stored = raw
      ? (JSON.parse(raw) as { key?: unknown; at?: unknown })
      : null
    if (
      stored &&
      isTrackerId(stored.key) &&
      typeof stored.at === 'number' &&
      now - stored.at <= DOCUMENT_SESSION_RESUME_MS
    ) {
      storage?.setItem(key, JSON.stringify({ key: stored.key, at: now }))
      return stored.key
    }
    const id = generate()
    storage?.setItem(key, JSON.stringify({ key: id, at: now }))
    return id
  } catch {
    return generate()
  }
}

/** Keeps the session alive (last beacon time) for `readSessionKey`. */
export function touchSessionKey(
  storage: KeyValueStorage | null,
  token: string,
  sessionKey: string,
  now: number,
): void {
  try {
    storage?.setItem(
      `${SESSION_STORAGE_PREFIX}${token}`,
      JSON.stringify({ key: sessionKey, at: now }),
    )
  } catch {
    // Storage unavailable: the session ends with the page.
  }
}

/** Posts the beacon; `sendBeacon` first, `fetch` keepalive as fallback. */
export function postBeacon(
  endpoint: string,
  payload: DocumentTrackInput,
): boolean {
  const body = JSON.stringify(payload)
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
      if (navigator.sendBeacon(endpoint, blob)) return true
    }
  } catch {
    // Fall through to fetch.
  }
  if (typeof fetch !== 'function') return false
  try {
    fetch(endpoint, {
      method: 'POST',
      body,
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    }).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

// ── DOM ────────────────────────────────────────────────────────────────────

function safeStorage(
  kind: 'localStorage' | 'sessionStorage',
): KeyValueStorage | null {
  try {
    return window[kind] ?? null
  } catch {
    return null
  }
}

function sectionIdOf(element: Element): string | undefined {
  const id = element
    .closest(`[${DOC_SECTION_ATTR}]`)
    ?.getAttribute(DOC_SECTION_ATTR)
  return id ?? undefined
}

const INTERACTION_EVENTS = [
  'scroll',
  'wheel',
  'mousemove',
  'mousedown',
  'touchstart',
  'touchmove',
  'keydown',
] as const

/** Starts tracking; returns a stop function (flushes the last beacon). */
export function startDocumentTracker(
  options: DocumentTrackerOptions,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }

  const root = options.root ?? document.body
  const endpoint =
    options.endpoint ??
    `/api/documents/${encodeURIComponent(options.token)}/track`
  const sessionStore = safeStorage('sessionStorage')
  const visitorId = readVisitorId(safeStorage('localStorage'))
  const sessionKey = readSessionKey(sessionStore, options.token, Date.now())
  const context: BeaconContext = {
    sessionKey,
    visitorId,
    versionId: options.versionId,
    device: resolveDevice({
      width: window.innerWidth,
      userAgent: navigator.userAgent ?? '',
      maxTouchPoints: navigator.maxTouchPoints,
    }),
    referrer: document.referrer
      ? document.referrer.slice(0, MAX_TARGET_LENGTH)
      : undefined,
  }

  const state = createTrackerState()
  const intersecting = new Set<Element>()
  const observed = new WeakSet<Element>()
  const playedVideos = new Set<string>()
  let qualifying = new Set<string>()
  let hasEndMarker = false
  let visible = document.visibilityState === 'visible'
  let lastInteractionAt = Date.now()
  let lastTickAt = Date.now()
  let stopped = false

  const viewport = () => ({
    width: window.innerWidth || document.documentElement.clientWidth,
    height: window.innerHeight || document.documentElement.clientHeight,
  })

  const measureSections = (): SectionVisibility[] => {
    const size = viewport()
    const result: SectionVisibility[] = []
    for (const element of intersecting) {
      const id = element.getAttribute(DOC_SECTION_ATTR)
      if (!id) continue
      result.push(measureVisibility(id, element.getBoundingClientRect(), size))
    }
    return result
  }

  const updateScroll = () => {
    const rect = root.getBoundingClientRect()
    const height = Math.max(rect.height, root.scrollHeight)
    const pct = computeScrollPct(rect.top, height, viewport().height)
    recordScroll(state, pct)
    if (!hasEndMarker && pct >= 98) state.reachedEnd = true
  }

  const tick = () => {
    const now = Date.now()
    const elapsed = Math.min(now - lastTickAt, TICK_MS * 2)
    lastTickAt = now
    if (!visible) return
    const sections = measureSections()
    const height = viewport().height
    const next = new Set(
      sections
        .filter((section) => isReadingCandidate(section, height))
        .map((section) => section.id),
    )
    for (const id of next) if (!qualifying.has(id)) markEntered(state, id)
    qualifying = next
    updateScroll()
    if (!isReaderActive({ visible, now, lastInteractionAt })) return
    addActiveTime(state, elapsed, pickReadingSection(sections, height))
  }

  const send = () => {
    const payload = takeBeacon(state, context)
    if (!payload) return
    postBeacon(endpoint, payload)
    touchSessionKey(sessionStore, options.token, sessionKey, Date.now())
  }

  const IO = typeof IntersectionObserver === 'function'
  const sectionObserver = IO
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) intersecting.add(entry.target)
            else intersecting.delete(entry.target)
          }
        },
        { threshold: [0, 0.25, 0.5, 0.75, 1] },
      )
    : null
  const endObserver = IO
    ? new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          state.reachedEnd = true
        }
      })
    : null

  const scan = () => {
    for (const element of root.querySelectorAll(`[${DOC_SECTION_ATTR}]`)) {
      if (observed.has(element)) continue
      observed.add(element)
      if (sectionObserver) sectionObserver.observe(element)
      else intersecting.add(element)
    }
    for (const element of root.querySelectorAll(`[${DOC_END_ATTR}]`)) {
      hasEndMarker = true
      if (observed.has(element)) continue
      observed.add(element)
      endObserver?.observe(element)
    }
  }

  const mutationObserver =
    typeof MutationObserver === 'function' ? new MutationObserver(scan) : null

  const onInteraction = () => {
    lastInteractionAt = Date.now()
  }

  const onScroll = () => {
    onInteraction()
    updateScroll()
  }

  const onClick = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target || !root.contains(target)) return
    const tracked = target.closest(`[${DOC_TRACK_ATTR}]`)
    const anchor = target.closest('a[href]')
    const kind =
      tracked?.getAttribute(DOC_TRACK_ATTR) ?? (anchor ? 'link' : null)
    if (!kind) return
    const href =
      anchor?.getAttribute('href') ??
      tracked?.getAttribute('href') ??
      tracked?.getAttribute('data-doc-track-target') ??
      undefined
    const sectionId = sectionIdOf(target)
    if (kind === 'link') {
      pushEvent(state, { type: 'link_clicked', target: href, sectionId })
    } else if (kind === 'attachment') {
      pushEvent(state, {
        type: 'attachment_downloaded',
        target: href ?? tracked?.textContent?.trim(),
        sectionId,
      })
    } else if (kind === 'video' && !tracked?.querySelector('video')) {
      // Embedded players (iframes) never expose `play`: the click on the
      // poster is the best signal available.
      const key = href ?? `${sectionId ?? ''}:video`
      if (playedVideos.has(key)) return
      playedVideos.add(key)
      pushEvent(state, { type: 'video_played', target: href, sectionId })
    }
  }

  const onPlay = (event: Event) => {
    const video = event.target
    if (!(video instanceof HTMLVideoElement) || !root.contains(video)) return
    const source = video.currentSrc || video.src || undefined
    const sectionId = sectionIdOf(video)
    const key = source ?? `${sectionId ?? ''}:video`
    if (playedVideos.has(key)) return
    playedVideos.add(key)
    pushEvent(state, { type: 'video_played', target: source, sectionId })
  }

  const onVisibility = () => {
    tick()
    visible = document.visibilityState === 'visible'
    if (visible) {
      lastInteractionAt = Date.now()
      lastTickAt = Date.now()
    } else {
      send()
    }
  }

  const onPageHide = () => {
    tick()
    send()
  }

  scan()
  mutationObserver?.observe(root, { childList: true, subtree: true })
  const handlerOf = (name: (typeof INTERACTION_EVENTS)[number]) =>
    name === 'scroll' ? onScroll : onInteraction
  for (const name of INTERACTION_EVENTS) {
    window.addEventListener(name, handlerOf(name), {
      passive: true,
      capture: true,
    })
  }
  root.addEventListener('click', onClick, true)
  root.addEventListener('play', onPlay, true)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)

  updateScroll()
  send()
  const tickTimer = window.setInterval(tick, TICK_MS)
  const beaconTimer = window.setInterval(send, DOCUMENT_TRACK_INTERVAL_MS)

  return () => {
    if (stopped) return
    stopped = true
    tick()
    send()
    window.clearInterval(tickTimer)
    window.clearInterval(beaconTimer)
    sectionObserver?.disconnect()
    endObserver?.disconnect()
    mutationObserver?.disconnect()
    for (const name of INTERACTION_EVENTS) {
      window.removeEventListener(name, handlerOf(name), true)
    }
    root.removeEventListener('click', onClick, true)
    root.removeEventListener('play', onPlay, true)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
  }
}
