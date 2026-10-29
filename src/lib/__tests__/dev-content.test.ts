import fs from 'node:fs'
import path from 'node:path'
import { compile } from '@mdx-js/mdx'
import remarkGfm from 'remark-gfm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/redis', () => ({ redis: {}, ensureRedisConnected: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  type ApiCall,
  extractApiCalls,
  matchSpecPath,
  matchSpecPrefix,
} from '@/src/lib/dev/api-calls'
import { getAllDevPages } from '@/src/lib/dev/pages'
import { getAllDocs } from '@/src/lib/docs/pages'
import { INTERNAL_PATH_PREFIXES } from '@/src/lib/docs/public-openapi'
import {
  apiLimiter,
  authLimiter,
  uploadLimiter,
  whatsappWebhookLimiter,
} from '@/src/lib/rate-limit'

/**
 * Guards over the real developer guides (`content/dev`): every page parses
 * and compiles, every link lands, every `/api/...` call in them exists in
 * `public/openapi.json` with that method, and the numbers they quote match
 * the code.
 */

type DevPage = Awaited<ReturnType<typeof getAllDevPages>>[number]

const ROOT = process.cwd()
type Spec = { paths: Record<string, Record<string, unknown>> }
const readSpec = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'public', file), 'utf-8')) as Spec
// Calls are relative to `/api`; the v1 document writes `/api/v1/...` paths.
const v1Paths = Object.fromEntries(
  Object.entries(readSpec('openapi.v1.json').paths).map(([route, item]) => [
    route.replace(/^\/api/, ''),
    item,
  ]),
)
const spec: Spec = {
  paths: { ...readSpec('openapi.json').paths, ...v1Paths },
}

const LANDING = path.join(ROOT, 'app', '(web)', 'dev', 'page.tsx')
const KNOWN_COMPONENTS = new Set([
  'Callout',
  'Kbd',
  'ErrorCodeTable',
  'BaseUrl',
  'McpServerUrl',
  'McpToolTable',
])

/**
 * `/api/mcp` speaks MCP (JSON-RPC over Streamable HTTP), not REST: it is
 * documented in the MCP guide (`/dev/mcp`), not in the REST reference.
 */
const NON_REST_PATHS = new Set([
  '/mcp',
  // The OAuth issuer (`<app>/api/auth`) quoted in the MCP OAuth guide: an
  // identifier in the metadata documents, not a route.
  '/auth',
])

/** Url patterns of every page and route handler under `app/`. */
function appRoutes(): RegExp[] {
  const routes: RegExp[] = []
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name === '__tests__') continue
        const isGroup = /^\(.*\)$/.test(entry.name)
        walk(
          path.join(dir, entry.name),
          isGroup ? segments : [...segments, entry.name],
        )
      } else if (/^(page|route)\.tsx?$/.test(entry.name)) {
        const pattern = segments
          .map((s) =>
            s.startsWith('[...')
              ? '.+'
              : s.startsWith('[')
                ? '[^/]+'
                : s.replace(/\./g, '\\.'),
          )
          .join('/')
        routes.push(new RegExp(`^/${pattern}$`))
      }
    }
  }
  walk(path.join(ROOT, 'app'), [])
  return routes
}

let pages: DevPage[]
let docsByHref: Map<string, { headings: { id: string }[] }>

beforeAll(async () => {
  pages = await getAllDevPages()
  docsByHref = new Map((await getAllDocs()).map((page) => [page.href, page]))
})

describe('developer guides (content/dev)', () => {
  it('has the guides the site promises', () => {
    expect(pages.map((page) => page.href)).toEqual([
      '/dev/comecando',
      '/dev/autenticacao',
      '/dev/respostas-e-erros',
      '/dev/limites',
      '/dev/paginacao',
      '/dev/api-v1',
      '/dev/api-v1/conta',
      '/dev/api-v1/servicedesk',
      '/dev/api-v1/crm',
      '/dev/api-v1/comunicacao',
      '/dev/api-v1/webhooks',
      '/dev/webhooks',
      '/dev/webhooks/eventos',
      '/dev/webhooks/receber',
      '/dev/guias/criar-lead',
      '/dev/guias/abrir-chamado',
      '/dev/guias/disparar-workflow',
      '/dev/guias/eventos-github-gitlab',
      '/dev/cli',
      '/dev/cli/scripts-e-ci',
      '/dev/cli/webhooks',
      '/dev/sdk',
      '/dev/n8n',
      '/dev/mcp',
      '/dev/mcp/escrita',
      '/dev/mcp/oauth',
      '/dev/changelog',
      '/dev/suporte',
    ])
  })

  it('every page compiles as MDX and only uses known components', async () => {
    for (const page of pages) {
      await expect(
        compile(page.source, { remarkPlugins: [remarkGfm] }),
        page.href,
      ).resolves.toBeTruthy()
      const outsideCode = page.source
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '')
      for (const match of outsideCode.matchAll(/<([A-Z]\w*)/g)) {
        expect(
          KNOWN_COMPONENTS.has(match[1]),
          `${page.href}: <${match[1]}>`,
        ).toBe(true)
      }
    }
  })

  it('every internal link points to a real page and heading', () => {
    const byHref = new Map(pages.map((page) => [page.href, page]))
    const routes = appRoutes()
    const broken: string[] = []

    for (const page of pages) {
      for (const match of page.source.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const [target, anchor] = match[1].split('#')
        // `/dev/api` and `/dev/api/v1` are the references (routes).
        const isContent =
          (target.startsWith('/dev/') && !/^\/dev\/api(\/|$)/.test(target)) ||
          target.startsWith('/docs/')
        if (!isContent) {
          // Any other page of the site: a route under app/.
          if (!routes.some((route) => route.test(target))) {
            broken.push(`${page.href} -> ${match[1]}`)
          }
          continue
        }
        const dest = target.startsWith('/dev/')
          ? byHref.get(target)
          : docsByHref.get(target)
        if (!dest) broken.push(`${page.href} -> ${match[1]}`)
        else if (anchor && !dest.headings.some((h) => h.id === anchor)) {
          broken.push(`${page.href} -> ${match[1]} (missing heading)`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('every guide in "Guias por caso de uso" makes at least one real call', () => {
    for (const page of pages.filter((p) => p.section === 'guias')) {
      const withMethod = extractApiCalls(page.source).filter(
        (call) => call.method !== null,
      )
      expect(withMethod.length, page.href).toBeGreaterThan(0)
    }
  })

  it('the MCP guide renders the server url and the generated tool table', () => {
    const mcp = pages.find((page) => page.href === '/dev/mcp')
    expect(mcp?.source).toMatch(/^<McpToolTable \/>$/m)
    expect(mcp?.source).toContain('<McpServerUrl />')
  })

  it('the error guide renders the generated table', () => {
    const errors = pages.find((page) => page.href === '/dev/respostas-e-erros')
    expect(errors?.source).toMatch(/^<ErrorCodeTable \/>$/m)
  })
})

describe('API calls in the guides exist in public/openapi.json (or openapi.v1.json)', () => {
  const sources = (): { where: string; calls: ApiCall[] }[] => [
    ...pages.map((page) => ({
      where: page.href,
      calls: extractApiCalls(page.source),
    })),
    {
      where: '/dev (landing)',
      calls: extractApiCalls(fs.readFileSync(LANDING, 'utf-8')),
    },
  ]

  it('finds calls to check', () => {
    const total = sources().reduce((sum, s) => sum + s.calls.length, 0)
    expect(total).toBeGreaterThan(50)
  })

  it('every path and method is documented, and none is internal', () => {
    const problems: string[] = []
    for (const { where, calls } of sources()) {
      for (const call of calls) {
        const at = `${where}:${call.line} ${call.method ?? '*'} ${call.path}`
        if (NON_REST_PATHS.has(call.path)) continue
        if (
          INTERNAL_PATH_PREFIXES.some((prefix) => call.path.startsWith(prefix))
        ) {
          problems.push(`${at} (internal route)`)
          continue
        }
        if (call.prefix) {
          if (!matchSpecPrefix(spec.paths, call.path)) {
            problems.push(`${at}/... (no route under this prefix)`)
          }
          continue
        }
        const match = matchSpecPath(spec.paths, call.path)
        if (!match) {
          problems.push(`${at} (not in the spec)`)
        } else if (call.method && !match.methods.includes(call.method)) {
          problems.push(
            `${at} (spec ${match.template} has ${match.methods.join(', ')})`,
          )
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe('numbers quoted in the guides match the code', () => {
  const text = () => pages.map((page) => page.source).join('\n')
  const limits = () =>
    pages.find((page) => page.href === '/dev/limites')?.source ?? ''

  it('quotes the generic API limit', () => {
    expect(limits()).toContain(
      `${apiLimiter.points} requisições a cada ${apiLimiter.duration} segundos`,
    )
    // "N requisições/chamadas/envios por minuto" anywhere is the same limit.
    expect(apiLimiter.duration).toBe(60)
    for (const match of text().matchAll(
      /(\d+) (?:requisições|chamadas|envios) por minuto/g,
    )) {
      expect(Number(match[1])).toBe(apiLimiter.points)
    }
  })

  it('quotes the WhatsApp webhook, upload and login limits', () => {
    expect(limits()).toContain(
      `${whatsappWebhookLimiter.points} eventos a cada ${whatsappWebhookLimiter.duration} segundos`,
    )
    expect(limits()).toContain(
      `${uploadLimiter.points} envios de arquivo a cada ${uploadLimiter.duration} segundos`,
    )
    expect(limits()).toContain(
      `${authLimiter.points} tentativas a cada ${authLimiter.duration / 60} minutos, com bloqueio de ${authLimiter.blockDuration / 60} minutos`,
    )
  })
})
