import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/axiom/server', () => ({
  withAxiom: (handler: unknown) => handler,
}))
vi.mock('@/src/lib/api/session', () => ({ resolveApiSession: vi.fn() }))
vi.mock('@/src/lib/rate-limit', () => ({
  apiLimiter: { name: 'api' },
  consume: vi.fn(),
}))
vi.mock('@/src/lib/consent', () => ({ requireConsent: vi.fn() }))

import { currentAuditContext } from '@/lib/axiom/audit-context'
import { forbidden, notFound, rateLimited, unauthorized } from '@/src/errors'
import type { ApiSession } from '@/src/lib/api/session'
import { resolveApiSession } from '@/src/lib/api/session'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { err, ok } from '@/src/lib/result'

const resolve = vi.mocked(resolveApiSession)
const mockedConsume = vi.mocked(consume)
const consent = vi.mocked(requireConsent)

const SESSION: ApiSession = {
  tokenId: 'tok_1',
  userId: 'user_1',
  workspaceId: 'ws_1',
  scopes: ['api:read', 'api:write'],
  modules: ['CRM'],
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
}

type Handler = (
  request: NextRequest,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>

function call(
  route: unknown,
  init: { method?: string; url?: string; body?: string } = {},
  params: Record<string, string> = {},
) {
  const request = new Request(init.url ?? 'http://localhost/api/v1/x', {
    method: init.method ?? 'GET',
    headers: { Authorization: 'Bearer stl_pat_x' },
    body: init.body,
  })
  return (route as Handler)(request as NextRequest, {
    params: Promise.resolve(params),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolve.mockResolvedValue(ok(SESSION))
  mockedConsume.mockResolvedValue(ok(undefined))
  consent.mockResolvedValue(ok(true))
})

describe('apiV1Route — authentication and limits', () => {
  it('answers 401 when the token does not resolve, before anything else', async () => {
    resolve.mockResolvedValue(err(unauthorized('Token de API inválido')))
    const handler = vi.fn()
    const res = await call(apiV1Route({ access: 'read', handler }))

    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
    expect(mockedConsume).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('consumes the per-user limiter (the per-token one is in resolveApiSession)', async () => {
    const handler = vi.fn().mockResolvedValue(ok({ ok: true }))
    await call(apiV1Route({ access: 'read', handler }))

    expect(mockedConsume).toHaveBeenCalledOnce()
    expect(mockedConsume).toHaveBeenCalledWith(apiLimiter, 'user:user_1')
  })

  it('answers 429 when the per-user limiter is exhausted', async () => {
    mockedConsume.mockResolvedValue(err(rateLimited(30)))
    const handler = vi.fn()
    const res = await call(apiV1Route({ access: 'read', handler }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('apiV1Route — scope, module and consent', () => {
  it('refuses a write with a read-only token (403 API_TOKEN_SCOPE_REQUIRED)', async () => {
    resolve.mockResolvedValue(ok({ ...SESSION, scopes: ['api:read'] }))
    const handler = vi.fn()
    const res = await call(
      apiV1Route({ access: 'write', consent: 'POST x', handler }),
      { method: 'POST', body: '{}' },
    )

    expect(res.status).toBe(403)
    expect((await res.json()).error).toEqual({
      code: 'API_TOKEN_SCOPE_REQUIRED',
      details: { requiredScope: 'api:write' },
    })
    expect(consent).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('lets a read-only token read', async () => {
    resolve.mockResolvedValue(ok({ ...SESSION, scopes: ['api:read'] }))
    const handler = vi.fn().mockResolvedValue(ok([]))
    const res = await call(apiV1Route({ access: 'read', handler }))
    expect(res.status).toBe(200)
  })

  it('refuses a module the token was not created for (403 API_TOKEN_MODULE_NOT_ALLOWED)', async () => {
    const handler = vi.fn()
    const res = await call(
      apiV1Route({ access: 'read', module: 'SERVICE_DESK', handler }),
    )

    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('API_TOKEN_MODULE_NOT_ALLOWED')
    expect(handler).not.toHaveBeenCalled()
  })

  it('runs the consent gate on writes and stops on refusal', async () => {
    consent.mockResolvedValue(err(forbidden('Consentimento obrigatório')))
    const handler = vi.fn()
    const res = await call(
      apiV1Route({
        access: 'write',
        module: 'CRM',
        consent: 'POST /api/v1/crm/leads',
        handler,
      }),
      { method: 'POST' },
    )

    expect(consent).toHaveBeenCalledWith('user_1', 'POST /api/v1/crm/leads')
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('goes on to the handler once the consent gate passes', async () => {
    const handler = vi.fn().mockResolvedValue(ok(null))
    const res = await call(
      apiV1Route({ access: 'write', consent: 'POST x', handler }),
      { method: 'POST' },
    )
    expect(consent).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })

  it('skips the consent gate on reads', async () => {
    const handler = vi.fn().mockResolvedValue(ok(null))
    await call(apiV1Route({ access: 'read', consent: 'GET x', handler }))
    expect(consent).not.toHaveBeenCalled()
  })
})

describe('apiV1Route — input', () => {
  const query = z.object({ limit: z.coerce.number().int().max(10) })
  const body = z.object({ name: z.string().min(1) })

  it('parses the query string (repeated keys become a list)', async () => {
    const handler = vi.fn().mockResolvedValue(ok(null))
    await call(
      apiV1Route({
        access: 'read',
        query: z.object({ tag: z.array(z.string()) }),
        handler,
      }),
      { url: 'http://localhost/api/v1/x?tag=a&tag=b' },
    )
    expect(handler.mock.calls[0][0].query).toEqual({ tag: ['a', 'b'] })
  })

  it('answers 422 on an invalid query', async () => {
    const handler = vi.fn()
    const res = await call(apiV1Route({ access: 'read', query, handler }), {
      url: 'http://localhost/api/v1/x?limit=99',
    })
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.message).toBe('Parâmetros inválidos')
    expect(handler).not.toHaveBeenCalled()
  })

  it('parses a JSON body and passes params and session', async () => {
    const handler = vi.fn().mockResolvedValue(ok({ id: '1' }))
    const res = await call(
      apiV1Route({ access: 'write', body, status: 201, handler }),
      { method: 'POST', body: JSON.stringify({ name: 'Ana' }) },
      { ticketId: 'INC-1' },
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      success: true,
      statusCode: 201,
      data: { id: '1' },
    })
    expect(handler).toHaveBeenCalledWith({
      session: SESSION,
      params: { ticketId: 'INC-1' },
      body: { name: 'Ana' },
      query: undefined,
      text: '',
    })
  })

  it.each([
    ['malformed JSON', '{', 'Corpo inválido (JSON malformado)'],
    ['an invalid body', JSON.stringify({ name: '' }), 'Dados inválidos'],
  ])('answers 422 on %s', async (_label, raw, message) => {
    const handler = vi.fn()
    const res = await call(apiV1Route({ access: 'write', body, handler }), {
      method: 'POST',
      body: raw,
    })
    expect(res.status).toBe(422)
    expect((await res.json()).message).toBe(message)
    expect(handler).not.toHaveBeenCalled()
  })

  it('accepts an empty body as {} when allowed', async () => {
    const handler = vi.fn().mockResolvedValue(ok(null))
    await call(
      apiV1Route({
        access: 'write',
        body: z.object({}),
        allowEmptyBody: true,
        handler,
      }),
      { method: 'POST' },
    )
    expect(handler.mock.calls[0][0].body).toEqual({})
  })

  it('hands a raw text body to the handler', async () => {
    const handler = vi.fn().mockResolvedValue(ok(null))
    await call(
      apiV1Route({ access: 'write', text: { maxBytes: 100 }, handler }),
      {
        method: 'POST',
        body: 'name\nAna',
      },
    )
    expect(handler.mock.calls[0][0].text).toBe('name\nAna')
  })

  it.each([
    ['an empty text body', '   ', 'Envie o conteúdo no corpo'],
    [
      'a text body over the limit',
      'x'.repeat(2 * 1024 * 1024),
      'Corpo maior que 1 MB',
    ],
  ])('answers 422 on %s', async (_label, raw, message) => {
    const handler = vi.fn()
    const res = await call(
      apiV1Route({ access: 'write', text: { maxBytes: 1024 * 1024 }, handler }),
      { method: 'POST', body: raw },
    )
    expect(res.status).toBe(422)
    expect((await res.json()).message).toBe(message)
    expect(handler).not.toHaveBeenCalled()
  })

  it('treats an unreadable text body as empty', async () => {
    const handler = vi.fn()
    const request = new Request('http://localhost/api/v1/x', {
      method: 'POST',
      body: 'x',
    })
    await request.text()
    const res = await (
      apiV1Route({
        access: 'write',
        text: { maxBytes: 10 },
        handler,
      }) as unknown as Handler
    )(request as NextRequest, { params: Promise.resolve({}) })
    expect(res.status).toBe(422)
  })
})

describe('apiV1Route — service result', () => {
  it('runs the handler with source: api in the audit context', async () => {
    let seen: unknown
    const handler = vi.fn(async () => {
      seen = currentAuditContext()
      return ok(null)
    })
    const res = await call(apiV1Route({ access: 'read', handler }))

    expect(seen).toEqual({ source: 'api', apiTokenId: 'tok_1' })
    expect(currentAuditContext()).toBeUndefined()
    expect(await res.json()).toEqual({
      success: true,
      statusCode: 200,
      data: null,
    })
  })

  it('maps a service error through handleError', async () => {
    const handler = vi.fn().mockResolvedValue(err(notFound('CrmLead')))
    const res = await call(apiV1Route({ access: 'read', handler }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('RESOURCE_NOT_FOUND')
  })
})
