import { type Browser, chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  REACT_SHELL_TIME_SCRIPT,
  scriptsBlockedByCsp,
} from '@/src/__tests__/helpers/csp-scripts'
import { authenticatedOwner } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/**
 * Guard for the CSP nonce regression of Next 16.4 (see `next.config.ts`,
 * `experimental.turbopackSharedRuntime`): the Turbopack bootstrap became an
 * inline `<script id="_R_">` in the build-time static shell, without the
 * nonce, so the browser blocked it and no page hydrated. Fetch-only tests
 * could not see it — the HTML was all there, only nothing was clickable.
 *
 * Two layers: every executable `<script>` of the real `next start` responses
 * must be allowed by the response's own CSP header, and a real Chromium must
 * hydrate the page (the cookie banner only goes away on click once React is
 * running). React's shell-time marker is the one inline script allowed to
 * stay blocked (ADR 0011).
 */

const PUBLIC_PAGES = [
  '/',
  '/sign-in',
  '/sign-up',
  '/forget-password',
  '/pricing',
  '/status',
  '/docs',
  '/dev',
  '/changelog',
  '/legals/privacy',
]

const PRIVATE_PAGES = ['', '/servicedesk', '/crm', '/zap', '/settings']

async function render(path: string, cookie?: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  })
  return {
    res,
    html: await res.text(),
    csp: res.headers.get('content-security-policy') ?? '',
  }
}

async function expectScriptsAllowed(path: string, cookie?: string) {
  const { res, html, csp } = await render(path, cookie)
  expect(res.status, `${path} status`).toBe(200)
  expect(csp, `${path} has no CSP header`).toMatch(/script-src [^;]*'nonce-/)
  expect(html, `${path} rendered no scripts`).toMatch(/<script\b/)
  expect(
    scriptsBlockedByCsp(html, csp, res.url, {
      allowInline: [REACT_SHELL_TIME_SCRIPT],
    }),
  ).toEqual([])
}

describe('CSP and scripts of rendered pages', () => {
  it.each(PUBLIC_PAGES)(
    '%s: every script is allowed by its CSP',
    async (path) => {
      await expectScriptsAllowed(path)
    },
  )

  it('private pages: every script is allowed by their CSP', async () => {
    const { user, workspace } = await authenticatedOwner()
    for (const path of PRIVATE_PAGES) {
      await expectScriptsAllowed(`/${workspace.slug}${path}`, user.cookie)
    }
  }, 120_000)
})

describe('hydration under the production CSP (Chromium)', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch()
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
  })

  /**
   * Opens `path` with no consent cookie, records every CSP violation and
   * dismisses the cookie banner. The banner is a client component: the click
   * only removes it (and writes the consent cookie) once React hydrated.
   */
  async function hydrateAndDismissBanner(
    path: string,
    session?: { name: string; value: string },
  ) {
    const context = await browser.newContext()
    try {
      if (session) await context.addCookies([{ ...session, url: BASE_URL }])
      const page = await context.newPage()
      await page.addInitScript(() => {
        const violations: { directive: string; blocked: string }[] = []
        Object.assign(window, { __cspViolations: violations })
        document.addEventListener('securitypolicyviolation', (event) => {
          violations.push({
            directive: event.effectiveDirective,
            blocked: event.blockedURI,
          })
        })
      })

      const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' })
      expect(res?.status()).toBe(200)

      const banner = page.locator('section[aria-label="Aviso de cookies"]')
      await banner.waitFor({ state: 'visible', timeout: 20_000 })
      // The bootstrap ran: Next's `hydrateRoot(document, …)` marks the
      // container. Blocked by the CSP, this never happens.
      await page.waitForFunction(
        () =>
          Object.keys(document).some((key) =>
            key.startsWith('__reactContainer$'),
          ),
        undefined,
        { timeout: 20_000 },
      )
      // A click that lands before the banner's boundary finished hydrating
      // may be dropped, so retry a few times; without React it never goes.
      const reject = banner.getByRole('button', { name: 'Rejeitar' })
      let dismissed = false
      for (let attempt = 0; attempt < 5 && !dismissed; attempt++) {
        await reject.click({ timeout: 5_000 }).catch(() => {})
        dismissed = await banner
          .waitFor({ state: 'detached', timeout: 3_000 })
          .then(() => true)
          .catch(() => false)
      }
      expect(dismissed, `${path}: cookie banner ignored the click`).toBe(true)

      const consent = (await context.cookies(BASE_URL)).find(
        (cookie) => cookie.name === 'nx_cookie_consent',
      )
      expect(consent?.value).toBe('rejected')

      // The event carries no script text (the CSP has no 'report-sample'), so
      // inline violations are counted against the React markers in the page:
      // anything beyond them is a real script the CSP stopped.
      const { violations, shellMarkers } = await page.evaluate((marker) => {
        const all = (
          window as unknown as {
            __cspViolations: { directive: string; blocked: string }[]
          }
        ).__cspViolations
        return {
          violations: all.filter((v) => v.directive.startsWith('script-src')),
          shellMarkers: Array.from(document.scripts).filter(
            (script) => !script.src && script.text === marker,
          ).length,
        }
      }, REACT_SHELL_TIME_SCRIPT)
      const external = violations.filter((v) => v.blocked !== 'inline')
      expect(external, `${path}: external scripts blocked`).toEqual([])
      expect(
        violations.length,
        `${path}: inline scripts blocked besides React's shell-time marker`,
      ).toBeLessThanOrEqual(shellMarkers)
    } finally {
      await context.close()
    }
  }

  it('hydrates the prerendered sign-in page', async () => {
    await hydrateAndDismissBanner('/sign-in')
  }, 90_000)

  it('hydrates the workspace home of a signed-in user', async () => {
    const { user, workspace } = await authenticatedOwner()
    const token = /better-auth\.session_token=([^;]+)/.exec(user.cookie)?.[1]
    expect(token).toBeTruthy()
    await hydrateAndDismissBanner(`/${workspace.slug}`, {
      name: 'better-auth.session_token',
      value: token as string,
    })
  }, 90_000)
})
