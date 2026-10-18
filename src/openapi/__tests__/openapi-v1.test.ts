import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findBreakingChanges } from '../v1/compat'
import { createV1Registry } from '../v1/document'
import { generateOpenApiV1Json, OPENAPI_V1_OUTPUT } from '../v1/generate'

const root = join(__dirname, '..', '..', '..')
const generated = generateOpenApiV1Json(root)
const spec = JSON.parse(generated) as Record<string, any>

type Operation = {
  operationId: string
  tags: string[]
  security: Record<string, string[]>[]
  responses: Record<string, unknown>
}
const operations = Object.values(
  spec.paths as Record<string, Record<string, Operation>>,
).flatMap((item) => Object.values(item))

describe('public/openapi.v1.json', () => {
  it('is exactly the generator output (run `pnpm openapi:generate`)', () => {
    const committed = readFileSync(join(root, OPENAPI_V1_OUTPUT), 'utf-8')
    expect(
      committed === generated,
      `${OPENAPI_V1_OUTPUT} desatualizado ou editado à mão: rode \`pnpm openapi:generate\``,
    ).toBe(true)
  })

  it('is deterministic', () => {
    expect(generateOpenApiV1Json(root)).toBe(generated)
  })

  it('has the contract routes, written with the /api/v1 prefix', () => {
    expect(createV1Registry().listOperations()).toEqual(
      [
        'DELETE /auth/token',
        'GET /crm/leads',
        'GET /crm/opportunities',
        'GET /crm/pipelines',
        'GET /me',
        'GET /servicedesk/catalog',
        'GET /servicedesk/phases',
        'GET /servicedesk/tickets',
        'GET /servicedesk/tickets/{ticketId}',
        'GET /whatsapp/broadcasts/{broadcastId}',
        'GET /whatsapp/conversations/waiting',
        'GET /whatsapp/templates',
        'POST /auth/device',
        'POST /auth/device/token',
        'POST /crm/leads',
        'POST /crm/leads/import',
        'POST /crm/opportunities/{opportunityId}/stage',
        'POST /servicedesk/tickets',
        'POST /servicedesk/tickets/{ticketId}/comments',
        'POST /servicedesk/tickets/{ticketId}/phase',
        'POST /whatsapp/messages/template',
        'GET /webhooks/events',
        'GET /webhooks/endpoints',
        'POST /webhooks/endpoints',
        'PATCH /webhooks/endpoints/{id}',
        'DELETE /webhooks/endpoints/{id}',
        'POST /webhooks/endpoints/{id}/test',
        'GET /webhooks/deliveries',
        'POST /webhooks/deliveries/{id}/retry',
        'GET /webhooks/listen',
        'POST /webhooks/trigger',
      ].sort(),
    )
    expect(
      Object.keys(spec.paths).every((path) => path.startsWith('/api/v1/')),
    ).toBe(true)
    expect(spec.servers.map((server: { url: string }) => server.url)).toEqual([
      'https://homologacao.stratustelecom.com.br',
      'http://localhost:3001',
    ])
  })

  it('authenticates every operation with the personal token, never the cookie', () => {
    expect(spec.components.securitySchemes).toHaveProperty('personalToken')
    expect(spec.components.securitySchemes).not.toHaveProperty('cookieAuth')
    // Starting and polling the device login happen before there is a token.
    const anonymous = ['startDeviceAuthorization', 'pollDeviceToken']
    for (const operation of operations) {
      if (anonymous.includes(operation.operationId)) {
        expect(operation.security).toEqual([])
        continue
      }
      expect(operation.security).toEqual([{ personalToken: [] }])
      expect(operation.responses).toHaveProperty('401')
      expect(operation.responses).toHaveProperty('429')
    }
  })

  it('names every operation for the SDK, uniquely', () => {
    const ids = operations.map((operation) => operation.operationId)
    expect(ids.every((id) => /^[a-z][A-Za-z]+$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares its tags without the v1 prefix', () => {
    const declared = new Set(
      (spec.tags as { name: string }[]).map((tag) => tag.name),
    )
    expect([...declared]).toEqual([
      'Autenticação',
      'Conta',
      'ServiceDesk',
      'CRM',
      'Comunicação',
      'Webhooks',
    ])
    for (const operation of operations) {
      for (const tag of operation.tags) expect(declared.has(tag)).toBe(true)
    }
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

  it('exposes the component names the CLI SDK imports', () => {
    for (const name of [
      'SuccessEnvelope',
      'ErrorEnvelope',
      'ApiScope',
      'ModuleKind',
      'WorkspaceRef',
      'DeviceAuthorizationRequest',
      'DeviceAuthorization',
      'DeviceToken',
      'Me',
    ]) {
      expect(spec.components.schemas).toHaveProperty(name)
    }
    expect(spec.components.schemas).not.toHaveProperty('ErrorResponse')
    expect(
      spec.components.schemas.ErrorEnvelope.properties.error.required,
    ).toEqual(['code'])
    expect(spec.components.schemas.Me.required).toEqual([
      'user',
      'workspace',
      'role',
      'scopes',
      'modules',
      'token',
    ])
  })

  it('lists in ErrorCode only the codes the v1 routes can answer', () => {
    const codes = spec.components.schemas.ErrorCode.enum as string[]
    expect(codes).toContain('API_TOKEN_SCOPE_REQUIRED')
    expect(codes).toContain('API_TOKEN_MODULE_NOT_ALLOWED')
    expect(codes).toContain('INTERNAL_SERVER_ERROR')
    expect(codes).not.toContain('BILLING_DISABLED')
  })

  it('is compatible with itself (the CI check has nothing to report)', () => {
    expect(findBreakingChanges(spec, JSON.parse(generated))).toEqual([])
  })
})
