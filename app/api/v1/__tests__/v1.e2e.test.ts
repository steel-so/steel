import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/**
 * Refusals of the public API v1 (ADR 0035). The 401s hold with or without
 * the api-tokens slice; the scope and module refusals need a real personal
 * token, issued through `POST /api/users/me/api-tokens` — they skip while
 * that route does not exist on the build under test.
 */

const READ_ROUTES = [
  '/api/v1/me',
  '/api/v1/servicedesk/tickets',
  '/api/v1/servicedesk/catalog',
  '/api/v1/crm/leads',
  '/api/v1/crm/opportunities',
  '/api/v1/crm/pipelines',
  '/api/v1/whatsapp/templates',
]

async function v1(
  path: string,
  init: {
    method?: string
    token?: string
    cookie?: string
    body?: unknown
  } = {},
) {
  const headers: Record<string, string> = { ...defaultHeaders }
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.cookie) headers.Cookie = init.cookie
  return fetch(`${BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

async function issueToken(
  cookie: string,
  workspaceId: string,
  scopes: string[],
  modules: string[],
): Promise<string | null> {
  const res = await postJson(
    '/api/users/me/api-tokens',
    { name: 'e2e v1', workspaceId, scopes, modules, expiresInDays: 7 },
    cookie,
  )
  if (res.status === 404 || res.status === 405) return null
  expect(res.status).toBe(201)
  return (await res.json()).data.token as string
}

describe('/api/v1 without a valid personal token', () => {
  it.each(READ_ROUTES)(
    'GET %s answers 401 without Authorization',
    async (path) => {
      const res = await v1(path)
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('UNAUTHORIZED')
    },
  )

  it('answers 401 to a malformed or unknown token', async () => {
    for (const token of [
      'garbage',
      'stl_pat_doesnotexistdoesnotexistdoesnotexist00',
    ]) {
      const res = await v1('/api/v1/me', { token })
      expect(res.status).toBe(401)
    }
  })

  it('never accepts the session cookie', async () => {
    const { user } = await authenticatedOwner()
    const me = await v1('/api/v1/me', { cookie: user.cookie })
    expect(me.status).toBe(401)
    const write = await v1('/api/v1/crm/leads', {
      method: 'POST',
      cookie: user.cookie,
      body: { name: 'Lead', emails: ['l@x.com'], source: 'e2e' },
    })
    expect(write.status).toBe(401)
  })
})

describe('/api/v1 with a personal token', () => {
  it('reads with api:read and refuses writes without api:write', async (ctx) => {
    const { user, workspace } = await authenticatedOwner()
    const token = await issueToken(
      user.cookie,
      workspace.id,
      ['api:read'],
      ['CRM'],
    )
    if (!token) return ctx.skip()

    const me = await v1('/api/v1/me', { token })
    expect(me.status).toBe(200)
    const body = (await me.json()).data
    expect(body.workspace.id).toBe(workspace.id)
    expect(body.scopes).toEqual(['api:read'])
    expect(body.modules).toEqual(['CRM'])

    const leads = await v1('/api/v1/crm/leads?limit=5', { token })
    expect(leads.status).toBe(200)
    expect((await leads.json()).data).toMatchObject({
      items: [],
      nextCursor: null,
    })

    const write = await v1('/api/v1/crm/leads', {
      method: 'POST',
      token,
      body: { name: 'Lead', emails: ['l@x.com'], source: 'e2e' },
    })
    expect(write.status).toBe(403)
    expect((await write.json()).error.code).toBe('API_TOKEN_SCOPE_REQUIRED')
  })

  it('refuses a module the token was not created for', async (ctx) => {
    const { user, workspace } = await authenticatedOwner()
    const token = await issueToken(
      user.cookie,
      workspace.id,
      ['api:read', 'api:write'],
      ['CRM'],
    )
    if (!token) return ctx.skip()

    for (const path of [
      '/api/v1/servicedesk/tickets',
      '/api/v1/whatsapp/templates',
    ]) {
      const res = await v1(path, { token })
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('API_TOKEN_MODULE_NOT_ALLOWED')
    }
  })

  it('writes with api:write and audits through the app services', async (ctx) => {
    const { user, workspace } = await authenticatedOwner()
    const token = await issueToken(
      user.cookie,
      workspace.id,
      ['api:read', 'api:write'],
      ['CRM'],
    )
    if (!token) return ctx.skip()

    const created = await v1('/api/v1/crm/leads', {
      method: 'POST',
      token,
      body: { name: 'Lead v1', emails: ['v1@x.com'], source: 'e2e' },
    })
    expect(created.status).toBe(201)

    const duplicate = await v1('/api/v1/crm/leads', {
      method: 'POST',
      token,
      body: { name: 'Lead v1', emails: ['v1@x.com'], source: 'e2e' },
    })
    expect(duplicate.status).toBe(409)

    const invalid = await v1('/api/v1/crm/leads?limit=500', { token })
    expect(invalid.status).toBe(422)

    const listed = await getJson(
      `/api/workspaces/${workspace.id}/crm/leads`,
      user.cookie,
    )
    expect((await listed.json()).data).toHaveLength(1)
  })

  it('imports leads from a CSV body', async (ctx) => {
    const { user, workspace } = await authenticatedOwner()
    const token = await issueToken(
      user.cookie,
      workspace.id,
      ['api:read', 'api:write'],
      ['CRM'],
    )
    if (!token) return ctx.skip()

    const res = await fetch(
      `${BASE_URL}/api/v1/crm/leads/import?source=Feira`,
      {
        method: 'POST',
        headers: {
          Origin: BASE_URL,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/csv',
        },
        body: 'nome;email;telefone\nAna;ana@x.com;\nAna de novo;ana@x.com;\nSem contato;;',
      },
    )
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data).toMatchObject({ total: 3, created: 1, skipped: 1 })
    expect(data.errors).toEqual([
      expect.objectContaining({ row: 4, code: 'VALIDATION_ERROR' }),
    ])
  })
})
