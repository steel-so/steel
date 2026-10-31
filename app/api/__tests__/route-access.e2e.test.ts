import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/**
 * Access-control sweep over every route of the app.
 *
 * The routes are discovered from the file system and the public allowlist is
 * read from `proxy.ts`, so a new route (or a new public prefix) is covered —
 * or fails the build — without anyone editing a list here.
 *
 * `proxy.ts` only checks that the session cookie EXISTS; the real validation
 * is inside each handler. That is why a forged cookie is tested separately
 * from a missing one.
 */

const ROOT = process.cwd()
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type Method = (typeof METHODS)[number]

const DUMMY = 'e2e_dummy_id'
const FORGED_COOKIE = 'better-auth.session_token=forged.value'

// Statuses that mean "nothing was handed over". 2xx and 5xx never belong here.
const DENIED = new Set([400, 401, 403, 404, 405, 409, 410, 413, 415, 422, 429])

/**
 * Public prefixes reviewed one by one: each is authenticated by something
 * other than the session cookie. Adding a prefix to `PUBLIC_ROUTES` without
 * listing it here fails the "no unreviewed public prefix" test below, which
 * forces the question "what authenticates this?" to be answered in review.
 */
const REVIEWED_PUBLIC: Record<string, string> = {
  '/api/auth': 'Better Auth endpoints (own rate limit and CSRF)',
  '/api/status': 'public status page data',
  '/api/talk-to-sales': 'public contact form (rate limited)',
  '/api/payment/webhook': 'payment provider signature',
  '/api/whatsapp/webhook': 'Meta/Z-API signature or verify token',
  '/api/pabx/calls/webhook': 'PABX webhook secret',
  '/api/pabx/voice-agent': 'voice agent shared secret',
  '/api/crm/proposals': 'proposal link token',
  '/api/crm/forms': 'public form id + rate limit',
  '/api/crm/integrations': 'integration key',
  '/api/crm/apollo/webhook': 'webhook secret',
  '/api/crm/workflows': 'workflow trigger token',
  '/api/crm/landing-pages': 'public landing page',
  '/api/social/blob': 'signed blob token',
  '/api/crm/unsubscribe': 'HMAC unsubscribe token',
  '/api/crm/campaigns/c': 'signed click token',
  '/api/crm/campaigns/o': 'signed open-pixel token',
  '/api/crm/campaigns/resend-webhook': 'Svix signature',
  '/api/crm/cadences/c': 'signed click token (run + destination)',
  '/api/crm/cadences/o': 'signed open-pixel token',
  '/api/crm/meetings':
    'public booking page: slug of an active page, rate limited, consent required to book',
  '/api/crm/meeting-bookings': 'guest manage token',
  '/api/crm/deal-rooms': 'deal room link token (rate limited)',
  '/api/crm/payments': 'payment provider signature over the raw body',
  '/api/servicedesk/approvals': 'approval link token',
  '/api/surveys/public': 'survey link token',
  '/api/servicedesk/monitoring': 'monitoring source token',
  '/api/status-page': 'public customer status page; subscription tokens',
  '/api/servicedesk/inventory': 'inventory agent token (Bearer)',
  '/api/servicedesk/integrations/slack': 'Slack signature',
  '/api/servicedesk/integrations/github': 'GitHub signature',
  '/api/integrations/github/webhook': 'GitHub signature',
  '/api/integrations/gitlab/webhook': 'GitLab token',
  '/api/servicedesk/portal': 'portal magic link + own session cookie',
  '/api/wiki/public': 'published page token',
  '/api/sites': 'published site runtime and beacon',
  '/api/crm/tv': 'TV link token',
  '/api/mcp': 'OAuth bearer token',
  '/api/v1': 'personal access token',
  '/api/widget':
    'site chat widget: public key + Origin on the allowed list (rate limited)',
  '/api/newsletters':
    'newsletter subscribe (rate limited, honeypot) and signed confirm/unsubscribe/preferences tokens',
}

/**
 * Public routes that legitimately answer 2xx to an anonymous caller. Anything
 * else under a public prefix must refuse a request that carries no valid
 * credential.
 */
const OPEN_BY_DESIGN = ['/api/auth', '/api/status', '/api/talk-to-sales']

/**
 * Single endpoints under a credentialed prefix that answer an anonymous call
 * on purpose. Each one reads or changes nothing without its token.
 */
const OPEN_ENDPOINTS: Record<string, string> = {
  'GET /api/whatsapp/webhook/zapi':
    'health check, answers "OK" and reads nothing',
  'DELETE /api/servicedesk/portal/session':
    'portal logout, only clears the caller own cookie',
  'GET /api/crm/campaigns/o/[token]':
    'open-tracking pixel, answers a GIF whatever the token',
  'GET /api/crm/cadences/o/[token]':
    'open-tracking pixel, answers a GIF whatever the token',
  'POST /api/v1/auth/device': 'device authorization request (RFC 8628)',
  'GET /api/crm/unsubscribe/[token]':
    'redirects to the result page; an invalid token unsubscribes nobody',
  'GET /api/newsletters/unsubscribe/[token]':
    'redirects to the confirmation page; never unsubscribes on GET',
}

/** Browser OAuth callbacks send the visitor away instead of answering 401. */
const REDIRECTS_WITHOUT_SESSION = [
  'GET /api/servicedesk/integrations/oauth/slack',
  'GET /api/social/callback/[platform]',
]

// GitHub answers 200 to `ping` and unknown events before it reads anything.
// Declaring a real event makes the sweep reach the signature check.
const WEBHOOK_EVENT_HEADERS = { 'x-github-event': 'issues' }

/** 503 = the webhook secret is not configured, which fails closed. */
const refused = (status: number | 'timeout', p: Probe) =>
  status !== 'timeout' &&
  (DENIED.has(status) ||
    status === 503 ||
    `${p.method} ${p.template}` in OPEN_ENDPOINTS)

function listRouteFiles(dir: string, name: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listRouteFiles(full, name))
    else if (entry === name) out.push(full)
  }
  return out
}

function exportedMethods(source: string): Method[] {
  const found = new Set<Method>()
  for (const m of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
  )) {
    found.add(m[1] as Method)
  }
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop() as Method
      if ((METHODS as readonly string[]).includes(name)) found.add(name)
    }
  }
  return [...found]
}

function publicPrefixes(): string[] {
  const src = readFileSync(join(ROOT, 'proxy.ts'), 'utf8')
  const start = src.indexOf('const PUBLIC_ROUTES = [')
  const end = src.indexOf('\n]\n', start)
  const block = src.slice(start, end).replace(/\/\/[^\n]*/g, '')
  return [...block.matchAll(/'(\/[^']*)'/g)].map((m) => m[1])
}

const PUBLIC = publicPrefixes()
const isPublic = (url: string) =>
  PUBLIC.some((p) => url === p || url.startsWith(`${p}/`))

type ApiRoute = { template: string; methods: Method[] }

function apiRoutes(): ApiRoute[] {
  const base = join(ROOT, 'app', 'api')
  return listRouteFiles(base, 'route.ts').map((file) => ({
    template: `/${relative(join(ROOT, 'app'), join(file, '..')).split(sep).join('/')}`,
    methods: exportedMethods(readFileSync(file, 'utf8')),
  }))
}

function fill(template: string, workspaceId?: string): string {
  return template
    .replace(/\[\[\.\.\.[^\]]+\]\]/g, 'a/b')
    .replace(/\[\.\.\.[^\]]+\]/g, 'a/b')
    .replace(/^\/api\/workspaces\/\[id\]/, (m) =>
      workspaceId ? `/api/workspaces/${workspaceId}` : m,
    )
    .replace(/\[[^\]]+\]/g, DUMMY)
}

async function call(
  method: Method,
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<number | 'timeout'> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { ...defaultHeaders, ...extraHeaders },
      body: method === 'GET' ? undefined : '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    // Streams (SSE) would hold the socket open; the status line is enough.
    await res.body?.cancel()
    return res.status
  } catch {
    return 'timeout'
  }
}

async function pool<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

type Probe = { method: Method; path: string; template: string }

function probes(routes: ApiRoute[], workspaceId?: string): Probe[] {
  return routes.flatMap((r) =>
    r.methods.map((method) => ({
      method,
      template: r.template,
      path: fill(r.template, workspaceId),
    })),
  )
}

async function sweep(
  list: Probe[],
  headers: Record<string, string>,
  accept: (status: number | 'timeout', probe: Probe) => boolean,
): Promise<string[]> {
  const failures: string[] = []
  await pool(list, 16, async (p) => {
    const status = await call(p.method, p.path, headers)
    if (!accept(status, p))
      failures.push(`${status}  ${p.method} ${p.template}`)
  })
  return failures.sort()
}

const ROUTES = apiRoutes()
const PRIVATE = ROUTES.filter((r) => !isPublic(r.template))
const PUBLIC_API = ROUTES.filter((r) => isPublic(r.template))

describe('route inventory', () => {
  it('should discover the API routes and the public allowlist', () => {
    expect(ROUTES.length).toBeGreaterThan(500)
    expect(PUBLIC.length).toBeGreaterThan(20)
    expect(probes(PRIVATE).length).toBeGreaterThan(500)
  })

  it('should have no unreviewed public prefix under /api', () => {
    const unreviewed = PUBLIC.filter(
      (p) => p.startsWith('/api/') && !(p in REVIEWED_PUBLIC),
    )
    expect(unreviewed).toEqual([])
  })

  it('should not keep a reviewed prefix that left PUBLIC_ROUTES', () => {
    const stale = Object.keys(REVIEWED_PUBLIC).filter(
      (p) => !PUBLIC.includes(p),
    )
    expect(stale).toEqual([])
  })
})

describe('private API routes', () => {
  it('should answer 401 to every method when there is no session cookie', async () => {
    const failures = await sweep(probes(PRIVATE), {}, (s) => s === 401)
    expect(failures).toEqual([])
  }, 300_000)

  it('should answer 401 to every method when the session cookie is forged', async () => {
    const failures = await sweep(
      probes(PRIVATE),
      { Cookie: FORGED_COOKIE },
      (s, p) =>
        s === 401 ||
        (typeof s === 'number' &&
          s >= 300 &&
          s < 400 &&
          REDIRECTS_WITHOUT_SESSION.includes(`${p.method} ${p.template}`)),
    )
    expect(failures).toEqual([])
  }, 300_000)
})

describe('workspace isolation', () => {
  it('should let the owner reach their own workspace (control)', async () => {
    const owner = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${owner.workspace.id}`,
      owner.user.cookie,
    )
    expect(res.status).toBe(200)
  })

  it('should grant a member of workspace A nothing on workspace B', async () => {
    const [a, b] = await Promise.all([
      authenticatedOwner(),
      authenticatedOwner(),
    ])
    const scoped = PRIVATE.filter((r) =>
      r.template.startsWith('/api/workspaces/[id]'),
    )
    expect(scoped.length).toBeGreaterThan(300)

    const failures = await sweep(
      probes(scoped, b.workspace.id),
      { Cookie: a.user.cookie },
      (s) => s !== 'timeout' && DENIED.has(s),
    )
    expect(failures).toEqual([])
  }, 300_000)
})

describe('public API routes', () => {
  const closed = PUBLIC_API.filter(
    (r) =>
      !OPEN_BY_DESIGN.some(
        (p) => r.template === p || r.template.startsWith(`${p}/`),
      ),
  )

  it('should refuse an anonymous call that carries no valid credential', async () => {
    const failures = await sweep(probes(closed), WEBHOOK_EVENT_HEADERS, refused)
    expect(failures).toEqual([])
  }, 300_000)

  it('should refuse a garbage bearer token and a garbage signature', async () => {
    const failures = await sweep(
      probes(closed),
      {
        ...WEBHOOK_EVENT_HEADERS,
        Authorization: 'Bearer stl_pat_invalid',
        'x-hub-signature-256': 'sha256=invalid',
        'x-signature': 'invalid',
        'x-slack-signature': 'v0=invalid',
        'x-gitlab-token': 'invalid',
      },
      refused,
    )
    expect(failures).toEqual([])
  }, 300_000)
})

describe('pages', () => {
  function pageTemplates(): string[] {
    const base = join(ROOT, 'app')
    return listRouteFiles(base, 'page.tsx')
      .map((file) => {
        const rel = relative(base, join(file, '..')).split(sep)
        const url = rel.filter(
          (seg) => !/^\(.+\)$/.test(seg) && !seg.startsWith('@'),
        )
        return `/${url.join('/')}`.replace(/\/$/, '') || '/'
      })
      .filter((url) => !url.startsWith('/api/'))
  }

  const privatePages = [...new Set(pageTemplates())].filter(
    (url) => !isPublic(url) && existsSync(join(ROOT, 'app')),
  )

  it('should redirect every private page to /sign-in when there is no session', async () => {
    expect(privatePages.length).toBeGreaterThan(20)
    const failures: string[] = []
    await pool(privatePages, 16, async (template) => {
      const path = template
        .replace(/\[\[\.\.\.[^\]]+\]\]/g, 'a/b')
        .replace(/\[\.\.\.[^\]]+\]/g, 'a/b')
        .replace(/\[[^\]]+\]/g, DUMMY)
      try {
        const res = await fetch(`${BASE_URL}${path}`, {
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        })
        await res.body?.cancel()
        const location = res.headers.get('location') ?? ''
        const redirected =
          res.status >= 300 && res.status < 400 && location.includes('/sign-in')
        // A route the proxy does not guard may still answer 401/403/404.
        if (!redirected && ![401, 403, 404].includes(res.status)) {
          failures.push(`${res.status}  GET ${template}`)
        }
      } catch {
        failures.push(`timeout  GET ${template}`)
      }
    })
    expect(failures.sort()).toEqual([])
  }, 300_000)
})
