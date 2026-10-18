import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../document'
import { generateOpenApiJson, OPENAPI_OUTPUT } from '../generate'
import {
  exportedMethods,
  folderToOpenApiPath,
  isCoveredBy,
  listRouteOperations,
  operationKey,
} from '../route-inventory'
import { UNDOCUMENTED_CRM } from '../undocumented/crm'
import { UNDOCUMENTED_WHATSAPP } from '../undocumented/whatsapp'
import { createV1Registry } from '../v1/document'

const root = join(__dirname, '..', '..', '..')

const routes = listRouteOperations(root)
// `/api/v1/**` is documented in the v1 document, with paths relative to
// `/api/v1` (`GET /me` covers `app/api/v1/me/route.ts`).
const documentedV1 = createV1Registry()
  .listOperations()
  .map((op) => op.replace(' ', ' /v1'))
const documented = [...createRegistry().listOperations(), ...documentedV1]
const generated = generateOpenApiJson(root)
const spec = JSON.parse(generated) as Record<string, any>

const ALLOWLISTS = [
  {
    name: 'undocumented/crm.ts',
    entries: UNDOCUMENTED_CRM,
    inScope: (key: string) =>
      key.split(' ')[1].startsWith('/workspaces/{id}/crm/'),
  },
  {
    name: 'undocumented/whatsapp.ts',
    entries: UNDOCUMENTED_WHATSAPP,
    inScope: (key: string) => {
      const path = key.split(' ')[1]
      return (
        path.startsWith('/workspaces/{id}/whatsapp/') ||
        path.startsWith('/whatsapp/')
      )
    },
  },
]
const allowlisted = new Set(ALLOWLISTS.flatMap((list) => list.entries))

describe('public/openapi.json', () => {
  it('is exactly the generator output (run `pnpm openapi:generate`)', () => {
    const committed = readFileSync(join(root, OPENAPI_OUTPUT), 'utf-8')
    // Comparação por igualdade de string: diff grande não ajuda — a correção
    // é sempre regenerar o arquivo.
    expect(
      committed === generated,
      `${OPENAPI_OUTPUT} desatualizado ou editado à mão: rode \`pnpm openapi:generate\``,
    ).toBe(true)
  })

  it('is deterministic', () => {
    expect(generateOpenApiJson(root)).toBe(generated)
  })

  it('resolves every $ref to a declared component', () => {
    const refs = new Set<string>()
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.add(value)
        else walk(value)
      }
    }
    walk(spec)

    const unresolved = [...refs].filter((ref) => {
      const [, section, name] = /^#\/components\/(\w+)\/(.+)$/.exec(ref) ?? []
      return !section || !spec.components?.[section]?.[name]
    })
    expect(unresolved).toEqual([])
  })

  it('declares every tag used by an operation', () => {
    const declared = new Set(
      (spec.tags as { name: string }[]).map((tag) => tag.name),
    )
    const used = new Set<string>()
    for (const item of Object.values(
      spec.paths as Record<string, Record<string, { tags: string[] }>>,
    )) {
      for (const operation of Object.values(item))
        operation.tags.forEach((tag) => used.add(tag))
    }
    expect([...used].filter((tag) => !declared.has(tag))).toEqual([])
  })

  it('has unique operationIds', () => {
    const ids = Object.values(
      spec.paths as Record<string, Record<string, { operationId: string }>>,
    ).flatMap((item) =>
      Object.values(item).map((operation) => operation.operationId),
    )
    expect(ids.length).toBe(new Set(ids).size)
  })
})

describe('route coverage', () => {
  it('finds the app/api route files', () => {
    expect(routes.length).toBeGreaterThan(100)
  })

  it('documents every exported route method (or lists it in undocumented/)', () => {
    const missing = routes
      .filter((route) => !documented.some((op) => isCoveredBy(route, op)))
      .map(operationKey)
      .filter((key) => !allowlisted.has(key))
    expect(
      missing,
      'rotas sem documentação: registre-as em src/openapi/paths/*',
    ).toEqual([])
  })

  it('documents in the v1 document only routes under app/api/v1', () => {
    expect(
      routes
        .filter((route) => documentedV1.some((op) => isCoveredBy(route, op)))
        .filter((route) => !route.path.startsWith('/v1/')),
    ).toEqual([])
  })

  it('only documents operations that exist in app/api', () => {
    const stale = documented.filter(
      (op) => !routes.some((route) => isCoveredBy(route, op)),
    )
    expect(stale, 'operações documentadas sem route.ts correspondente').toEqual(
      [],
    )
  })

  for (const list of ALLOWLISTS) {
    describe(list.name, () => {
      it('only shrinks: no entry is already documented', () => {
        const documentedKeys = new Set(
          routes
            .filter((route) => documented.some((op) => isCoveredBy(route, op)))
            .map(operationKey),
        )
        const alreadyDocumented = list.entries.filter((key) =>
          documentedKeys.has(key),
        )
        expect(
          alreadyDocumented,
          `remova de ${list.name} — já estão documentadas`,
        ).toEqual([])
      })

      it('has no stale entries (route removed or renamed)', () => {
        const existing = new Set(routes.map(operationKey))
        expect(list.entries.filter((key) => !existing.has(key))).toEqual([])
      })

      it('stays within its domain, sorted and without duplicates', () => {
        expect(list.entries.filter((key) => !list.inScope(key))).toEqual([])
        expect([...list.entries]).toEqual([...new Set(list.entries)].sort())
      })
    })
  }
})

describe('route inventory', () => {
  it('maps App Router folders to OpenAPI paths', () => {
    expect(folderToOpenApiPath(['workspaces', '[id]', 'crm', 'leads'])).toEqual(
      {
        path: '/workspaces/{id}/crm/leads',
      },
    )
    expect(folderToOpenApiPath(['(group)', 'status'])).toEqual({
      path: '/status',
    })
    expect(folderToOpenApiPath(['auth', '[...all]'])).toEqual({
      path: '/auth/{all}',
      catchAllPrefix: '/auth/',
    })
    expect(folderToOpenApiPath(['docs', '[[...slug]]'])).toEqual({
      path: '/docs/{slug}',
      catchAllPrefix: '/docs/',
    })
  })

  it('reads exported HTTP methods in every supported form', () => {
    const source = [
      'export const GET = withAxiom(async () => {})',
      'export async function POST() {}',
      'export function HEAD() {}',
      'const handler = () => {}',
      'export { handler as PATCH, OPTIONS }',
      'export const { PUT, DELETE } = toNextJsHandler(auth)',
      'export const config = {}',
    ].join('\n')
    expect(exportedMethods(source).sort()).toEqual([
      'delete',
      'get',
      'head',
      'patch',
      'post',
      'put',
    ])
  })

  it('treats catch-all routes as covered by any documented sub-path', () => {
    const route = {
      method: 'post' as const,
      path: '/auth/{all}',
      file: '',
      catchAllPrefix: '/auth/',
    }
    expect(isCoveredBy(route, 'POST /auth/sign-in/email')).toBe(true)
    expect(isCoveredBy(route, 'GET /auth/get-session')).toBe(false)
    expect(isCoveredBy(route, 'POST /users/me')).toBe(false)
  })
})
