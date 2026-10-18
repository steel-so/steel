import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  resolveApiSession: vi.fn(),
  consume: vi.fn(),
}))

vi.mock('@/lib/axiom/server', () => ({
  withAxiom: <T>(handler: T) => handler,
}))
vi.mock('@/src/lib/api/session', () => ({
  resolveApiSession: mocks.resolveApiSession,
}))
vi.mock('@/src/lib/rate-limit', () => ({
  apiLimiter: {},
  consume: mocks.consume,
}))

import { rateLimited, unauthorized } from '@/src/errors'
import type { ApiSession } from '@/src/lib/api/session'
import { err, ok } from '@/src/lib/result'
import {
  authorizeWebhookV1,
  webhookApiContext,
  webhookV1Route,
} from '@/src/lib/webhooks/v1-route'

const session: ApiSession = {
  tokenId: 'tok1',
  userId: 'u1',
  workspaceId: 'w1',
  scopes: ['api:read'],
  modules: ['CRM'],
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
}

type Handler = (
  request: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>

function call(route: unknown, request: Request, params = {}) {
  return (route as Handler)(request, { params: Promise.resolve(params) })
}

describe('webhook API v1 route helper', () => {
  beforeEach(() => {
    mocks.resolveApiSession.mockResolvedValue(ok(session))
    mocks.consume.mockResolvedValue(ok(undefined))
  })

  it('should refuse a request without a valid token', async () => {
    mocks.resolveApiSession.mockResolvedValue(
      err(unauthorized('Token de API inválido')),
    )
    const handler = vi.fn()
    const res = await call(
      webhookV1Route({ handler }),
      new Request('https://steel.test/api/v1/webhooks/events'),
    )
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('should demand api:write for writes', async () => {
    const res = await call(
      webhookV1Route({ write: true, handler: vi.fn() }),
      new Request('https://steel.test/api/v1/webhooks/trigger', {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.message).toContain('api:write')
  })

  it('should rate limit per token', async () => {
    mocks.consume.mockResolvedValue(err(rateLimited(30)))
    const result = await authorizeWebhookV1(new Request('https://steel.test'))
    expect(result.ok).toBe(false)
    expect(mocks.consume).toHaveBeenCalledWith({}, 'api-token:tok1')
  })

  it('should validate the query and the body', async () => {
    const queryRoute = webhookV1Route({
      query: z.object({ limit: z.coerce.number().max(10) }),
      handler: vi.fn(),
    })
    expect(
      (await call(queryRoute, new Request('https://steel.test/x?limit=99')))
        .status,
    ).toBe(422)

    const bodyRoute = webhookV1Route({
      write: true,
      body: z.object({ type: z.string() }),
      handler: vi.fn(),
    })
    mocks.resolveApiSession.mockResolvedValue(
      ok({ ...session, scopes: ['api:read', 'api:write'] }),
    )
    const invalid = await call(
      bodyRoute,
      new Request('https://steel.test/x', {
        method: 'POST',
        body: JSON.stringify({ type: 1 }),
      }),
    )
    expect(invalid.status).toBe(422)
    const malformed = await call(
      bodyRoute,
      new Request('https://steel.test/x', { method: 'POST', body: '{' }),
    )
    expect(malformed.status).toBe(422)
  })

  it('should pass session, params, query and body to the handler', async () => {
    mocks.resolveApiSession.mockResolvedValue(
      ok({ ...session, scopes: ['api:read', 'api:write'] }),
    )
    const handler = vi.fn(async () => ok({ done: true }))
    const route = webhookV1Route({
      write: true,
      status: 201,
      query: z.object({ q: z.string() }),
      body: z.object({ type: z.string() }),
      handler,
    })
    const res = await call(
      route,
      new Request('https://steel.test/x?q=1', {
        method: 'POST',
        body: JSON.stringify({ type: 'crm.deal.won' }),
      }),
      { id: 'e1' },
    )
    expect(res.status).toBe(201)
    expect((await res.json()).data).toEqual({ done: true })
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { id: 'e1' },
        query: { q: '1' },
        body: { type: 'crm.deal.won' },
        session: expect.objectContaining({ tokenId: 'tok1' }),
      }),
    )
  })

  it('should map a service error and an empty value', async () => {
    const failing = webhookV1Route({
      handler: async () => err(unauthorized()),
    })
    expect(
      (await call(failing, new Request('https://steel.test'))).status,
    ).toBe(401)
    const empty = webhookV1Route({ handler: async () => ok(undefined) })
    const res = await call(empty, new Request('https://steel.test'))
    expect((await res.json()).data).toBeNull()
  })

  it('should build the API call context from the token', () => {
    expect(webhookApiContext(session)).toEqual({
      source: 'api',
      modules: ['CRM'],
    })
  })
})
