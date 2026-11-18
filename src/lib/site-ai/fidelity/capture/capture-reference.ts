import type { Browser, BrowserContext, Page, Route } from 'playwright-core'
import { logger } from '@/lib/axiom/logger'
import { CHROMIUM_PATH } from '@/lib/env/server'
import { type AppError, appError, badRequest } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type Resolver,
  SAFE_FETCH_MESSAGES,
  stripUrlForDisplay,
  validateFetchTarget,
} from '@/src/lib/safe-fetch/fetch-html'
import type { CaptureBlock, ReferenceCapture } from '../types'
import {
  cleanBlock,
  fontFamiliesFromStacks,
  type RawBlock,
} from './clean-style'
import { EXTRACT_SCRIPT, type RawExtraction } from './extract-dom'
import {
  decideRoute,
  isServerAddressAllowed,
  redirectDepth,
} from './route-policy'
import {
  fitJpeg,
  MAX_DESKTOP_STRIPS,
  MAX_MOBILE_STRIPS,
  planStrips,
} from './strips'

/**
 * Reference capture (docs/site-ai-fidelity.md, step 1). Runs only in the
 * worker: one Chromium per call, always closed. Every request of the browser
 * goes through the `safe-fetch` policy; downloads, WebSockets, service
 * workers and permissions are off; 45 s and 25 MB per page.
 */

export const CAPTURE_TOTAL_TIMEOUT_MS = 45_000
export const CAPTURE_LAUNCH_TIMEOUT_MS = 20_000
export const CAPTURE_MAX_BYTES = 25 * 1024 * 1024
const GOTO_TIMEOUT_MS = 25_000
const SCROLL_MAX_PX = 10_000
const MOBILE_MIN_BUDGET_MS = 8_000

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const

export const CAPTURE_FAILED_MESSAGE =
  'Não foi possível capturar a página de referência. Tente de novo em instantes.'
export const CAPTURE_TIMEOUT_MESSAGE =
  'A página de referência demorou demais para carregar.'
export const CAPTURE_TOO_BIG_MESSAGE =
  'A página de referência é pesada demais para ser capturada.'
export const CAPTURE_HTTP_ERROR_MESSAGE =
  'A página de referência respondeu com erro.'

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--font-render-hinting=none',
  '--disable-background-networking',
]

export interface CaptureDeps {
  launchBrowser?: () => Promise<Browser>
  resolver?: Resolver
}

/** Carries the user-facing error through the capture steps. */
class CaptureFailure extends Error {
  constructor(readonly failure: AppError) {
    super(failure.message)
    this.name = 'CaptureFailure'
  }
}

class CaptureTimeout extends Error {
  constructor() {
    super('Reference capture timed out')
    this.name = 'CaptureTimeout'
  }
}

interface Guard {
  bytes: number
  violation: AppError | null
}

async function launchChromium(): Promise<Browser> {
  const { chromium } = await import('playwright-core')
  return chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
    timeout: CAPTURE_LAUNCH_TIMEOUT_MS,
    ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
  })
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CaptureTimeout()), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

function assertGuard(guard: Guard): void {
  if (guard.violation) throw new CaptureFailure(guard.violation)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const SCROLL_SCRIPT = `(async () => {
  const cap = ${SCROLL_MAX_PX};
  const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
  let y = 0;
  for (let i = 0; i < 40; i++) {
    const height = Math.min(document.documentElement.scrollHeight, cap);
    if (y >= height) break;
    y += step;
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 150));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
  return Math.min(document.documentElement.scrollHeight, cap);
})()`

async function openContext(
  browser: Browser,
  viewport: { width: number; height: number },
  mobile: boolean,
  guard: Guard,
  resolver: Resolver | undefined,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    acceptDownloads: false,
    serviceWorkers: 'block',
    permissions: [],
    javaScriptEnabled: true,
    bypassCSP: false,
  })

  await context.route('**/*', async (route: Route) => {
    const request = route.request()
    const url = request.url()
    const decision = await decideRoute(url, redirectDepth(request), resolver)
    if (!decision.allow) {
      const isDocument =
        request.isNavigationRequest() && request.frame().parentFrame() === null
      if (isDocument) {
        guard.violation =
          decision.reason === 'redirects'
            ? badRequest(SAFE_FETCH_MESSAGES.too_many_redirects)
            : badRequest(
                decision.reason === 'scheme'
                  ? SAFE_FETCH_MESSAGES.bad_scheme
                  : SAFE_FETCH_MESSAGES[decision.reason],
              )
      }
      await route.abort('blockedbyclient').catch(() => undefined)
      return
    }
    await route.continue().catch(() => undefined)
  })
  // No WebSockets at all.
  await context.routeWebSocket(/.*/, (socket) => {
    socket.close()
  })
  return context
}

function watchPage(page: Page, guard: Guard): void {
  page.on('download', (download) => {
    void download.cancel().catch(() => undefined)
  })
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => undefined)
  })
  page.on('popup', (popup) => {
    void popup.close().catch(() => undefined)
  })
  page.on('response', (response) => {
    void response
      .serverAddr()
      .then((addr) => {
        // Chromium resolved DNS itself: reject a page served from a private IP.
        if (addr && !isServerAddressAllowed(addr.ipAddress)) {
          guard.violation = badRequest(SAFE_FETCH_MESSAGES.blocked_host)
        }
      })
      .catch(() => undefined)
  })
  page.on('requestfinished', (request) => {
    void request
      .sizes()
      .then((sizes) => {
        guard.bytes += sizes.responseBodySize + sizes.responseHeadersSize
        if (guard.bytes > CAPTURE_MAX_BYTES) {
          guard.violation = appError('BAD_REQUEST', CAPTURE_TOO_BIG_MESSAGE)
        }
      })
      .catch(() => undefined)
  })
}

interface ViewportResult {
  height: number
  strips: string[]
  extraction: RawExtraction | null
  finalUrl: string
}

async function captureViewport(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  options: { mobile: boolean; maxStrips: number; extract: boolean },
  guard: Guard,
  deadline: number,
  resolver: Resolver | undefined,
): Promise<ViewportResult> {
  const remaining = () => Math.max(1_000, deadline - Date.now())
  const context = await openContext(
    browser,
    viewport,
    options.mobile,
    guard,
    resolver,
  )
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(remaining())
    watchPage(page, guard)

    let status = 0
    try {
      const response = await page.goto(url, {
        waitUntil: 'load',
        timeout: Math.min(GOTO_TIMEOUT_MS, remaining()),
      })
      status = response?.status() ?? 0
    } catch (cause) {
      assertGuard(guard)
      const name = cause instanceof Error ? cause.name : ''
      throw new CaptureFailure(
        appError(
          'INTERNAL_SERVER_ERROR',
          name === 'TimeoutError'
            ? CAPTURE_TIMEOUT_MESSAGE
            : CAPTURE_FAILED_MESSAGE,
        ),
      )
    }
    assertGuard(guard)
    if (status >= 400) {
      throw new CaptureFailure(
        appError('INTERNAL_SERVER_ERROR', CAPTURE_HTTP_ERROR_MESSAGE),
      )
    }

    await page
      .waitForLoadState('networkidle', {
        timeout: Math.min(4_000, remaining()),
      })
      .catch(() => undefined)
    // Scroll to the end so lazy-loaded content is in the screenshots.
    const scrolled = await page
      .evaluate<number>(SCROLL_SCRIPT)
      .catch(() => viewport.height)
    await sleep(Math.min(400, remaining()))
    assertGuard(guard)

    const extraction = options.extract
      ? await page.evaluate<RawExtraction>(EXTRACT_SCRIPT)
      : null
    const height = Math.min(
      Math.max(extraction?.pageHeight ?? 0, scrolled, viewport.height),
      SCROLL_MAX_PX,
    )

    const strips: string[] = []
    for (const rect of planStrips(height, options.maxStrips)) {
      assertGuard(guard)
      const dataUrl = await fitJpeg((quality) =>
        page.screenshot({
          type: 'jpeg',
          quality,
          fullPage: true,
          animations: 'disabled',
          clip: {
            x: 0,
            y: rect.y,
            width: viewport.width,
            height: rect.height,
          },
        }),
      )
      if (dataUrl) strips.push(dataUrl)
    }
    assertGuard(guard)
    return {
      height,
      strips,
      extraction,
      finalUrl: stripUrlForDisplay(page.url()),
    }
  } finally {
    await context.close().catch(() => undefined)
  }
}

function toBlocks(raw: RawBlock[]): CaptureBlock[] {
  return raw.map(cleanBlock)
}

async function runCapture(
  browser: Browser,
  url: string,
  deadline: number,
  resolver: Resolver | undefined,
): Promise<ReferenceCapture> {
  const guard: Guard = { bytes: 0, violation: null }

  const desktop = await captureViewport(
    browser,
    url,
    DESKTOP_VIEWPORT,
    { mobile: false, maxStrips: MAX_DESKTOP_STRIPS, extract: true },
    guard,
    deadline,
    resolver,
  )
  const extraction = desktop.extraction
  if (!extraction || desktop.strips.length === 0) {
    throw new CaptureFailure(
      appError('INTERNAL_SERVER_ERROR', CAPTURE_FAILED_MESSAGE),
    )
  }

  let mobile: ViewportResult | null = null
  try {
    // Not enough budget left: ship the desktop capture alone.
    if (deadline - Date.now() >= MOBILE_MIN_BUDGET_MS) {
      mobile = await captureViewport(
        browser,
        url,
        MOBILE_VIEWPORT,
        { mobile: true, maxStrips: MAX_MOBILE_STRIPS, extract: false },
        guard,
        deadline - 1_500,
        resolver,
      )
    }
  } catch (cause) {
    // A security violation is fatal; any other mobile problem degrades.
    if (cause instanceof CaptureFailure && guard.violation) throw cause
    logger.warn('site_ai.capture.mobile_failed', {
      component: 'SiteAiCapture',
      url: stripUrlForDisplay(url),
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }

  return {
    url: desktop.finalUrl || stripUrlForDisplay(url),
    title: extraction.title.replace(/\s+/g, ' ').trim().slice(0, 200),
    desktop: {
      width: DESKTOP_VIEWPORT.width,
      height: desktop.height,
      strips: desktop.strips,
      blocks: toBlocks(extraction.blocks),
    },
    mobile: {
      width: MOBILE_VIEWPORT.width,
      height: mobile?.height ?? 0,
      strips: mobile?.strips ?? [],
    },
    fonts: fontFamiliesFromStacks(extraction.fontStacks),
  }
}

/**
 * Opens `url` in a headless Chromium (desktop 1440x900 and mobile 390x844),
 * scrolls to the end, takes strip screenshots and extracts the DOM blocks.
 * Worker only. The error message is pt-BR and safe to show to the user.
 */
export async function captureReference(
  url: string,
  deps: CaptureDeps = {},
): Promise<Result<ReferenceCapture>> {
  const checked = await validateFetchTarget(url, deps.resolver)
  if (!checked.ok) return err(badRequest(SAFE_FETCH_MESSAGES[checked.reason]))

  const deadline = Date.now() + CAPTURE_TOTAL_TIMEOUT_MS
  let browser: Browser | null = null
  try {
    const launch = deps.launchBrowser ?? launchChromium
    return ok(
      await withTimeout(
        (async () => {
          browser = await launch()
          return runCapture(
            browser,
            checked.url.toString(),
            deadline,
            deps.resolver,
          )
        })(),
        CAPTURE_TOTAL_TIMEOUT_MS,
      ),
    )
  } catch (cause) {
    if (cause instanceof CaptureFailure) return err(cause.failure)
    if (cause instanceof CaptureTimeout) {
      return err(appError('INTERNAL_SERVER_ERROR', CAPTURE_TIMEOUT_MESSAGE))
    }
    logger.error('site_ai.capture.failed', {
      component: 'SiteAiCapture',
      url: stripUrlForDisplay(url),
      message: cause instanceof Error ? cause.message : String(cause),
    })
    return err(appError('INTERNAL_SERVER_ERROR', CAPTURE_FAILED_MESSAGE))
  } finally {
    const opened = browser as Browser | null
    if (opened) await opened.close().catch(() => undefined)
  }
}
