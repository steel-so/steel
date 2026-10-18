import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger')
vi.mock('@/src/services/integration-grant-lifecycle.service', () => ({
  IntegrationGrantLifecycleService: {
    findTokenHolder: vi.fn(),
    retireAfterTokenEvent: vi.fn(),
  },
}))

import { logger } from '@/lib/axiom/logger'
import {
  OAUTH_REVOKE_PATH,
  OAUTH_TOKEN_PATH,
  tokenEventOf,
  withGrantLifecycle,
} from '@/src/lib/mcp/token-lifecycle'
import { IntegrationGrantLifecycleService } from '@/src/services/integration-grant-lifecycle.service'

const service = vi.mocked(IntegrationGrantLifecycleService)
const HOLDER = { clientId: 'c', userId: 'u', referenceId: 'g' }
const ORIGIN = 'https://steel.test'

function form(path: string, body: Record<string, string>) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
}

function json(path: string, body: unknown) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  service.findTokenHolder.mockResolvedValue(ok(HOLDER))
  service.retireAfterTokenEvent.mockResolvedValue(ok(1))
})

describe('tokenEventOf', () => {
  it('reads the revoked token, dropping a Bearer prefix', async () => {
    expect(
      await tokenEventOf(
        form(OAUTH_REVOKE_PATH, { token: 'Bearer stl_rt_x', client_id: 'c' }),
        OAUTH_REVOKE_PATH,
      ),
    ).toEqual({ token: 'stl_rt_x', source: 'token_revoked' })
    expect(
      await tokenEventOf(
        json(OAUTH_REVOKE_PATH, { token: 'stl_at_x', n: 1 }),
        OAUTH_REVOKE_PATH,
      ),
    ).toEqual({ token: 'stl_at_x', source: 'token_revoked' })
  })

  it('reads the refresh token of a refresh grant only', async () => {
    expect(
      await tokenEventOf(
        form(OAUTH_TOKEN_PATH, {
          grant_type: 'refresh_token',
          refresh_token: 'stl_rt_y',
        }),
        OAUTH_TOKEN_PATH,
      ),
    ).toEqual({ token: 'stl_rt_y', source: 'refresh_rejected' })
    expect(
      await tokenEventOf(
        form(OAUTH_TOKEN_PATH, { grant_type: 'authorization_code', code: 'x' }),
        OAUTH_TOKEN_PATH,
      ),
    ).toBeNull()
    expect(
      await tokenEventOf(
        form(OAUTH_TOKEN_PATH, { grant_type: 'refresh_token' }),
        OAUTH_TOKEN_PATH,
      ),
    ).toBeNull()
  })

  it('ignores other paths, methods and unreadable bodies', async () => {
    expect(
      await tokenEventOf(form('/api/auth/sign-in/email', {}), '/api/auth/x'),
    ).toBeNull()
    expect(
      await tokenEventOf(
        new Request(`${ORIGIN}${OAUTH_REVOKE_PATH}`),
        OAUTH_REVOKE_PATH,
      ),
    ).toBeNull()
    expect(
      await tokenEventOf(form(OAUTH_REVOKE_PATH, {}), OAUTH_REVOKE_PATH),
    ).toBeNull()
    for (const body of ['not json', 'null', '"text"']) {
      const request = new Request(`${ORIGIN}${OAUTH_REVOKE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(await tokenEventOf(request, OAUTH_REVOKE_PATH)).toBeNull()
    }
  })
})

describe('withGrantLifecycle', () => {
  it('passes other requests straight to the handler', async () => {
    const handle = vi.fn(async () => new Response('ok'))
    const request = form('/api/auth/sign-in/email', {})
    await withGrantLifecycle(request, '/api/auth/sign-in/email', handle)
    expect(handle).toHaveBeenCalledWith(request)
    expect(service.findTokenHolder).not.toHaveBeenCalled()
  })

  it('reads the holder before the provider runs, then retires', async () => {
    const order: string[] = []
    service.findTokenHolder.mockImplementation(async () => {
      order.push('lookup')
      return ok(HOLDER)
    })
    const handle = vi.fn(async (request: Request) => {
      order.push('handle')
      // The provider still gets the whole body.
      expect(new URLSearchParams(await request.text()).get('token')).toBe(
        'stl_rt_x',
      )
      return new Response(null, { status: 200 })
    })
    const response = await withGrantLifecycle(
      form(OAUTH_REVOKE_PATH, { token: 'stl_rt_x', client_id: 'c' }),
      OAUTH_REVOKE_PATH,
      handle,
    )
    expect(response.status).toBe(200)
    expect(order).toEqual(['lookup', 'handle'])
    expect(service.findTokenHolder).toHaveBeenCalledWith('stl_rt_x')
    expect(service.retireAfterTokenEvent).toHaveBeenCalledWith(
      HOLDER,
      'token_revoked',
    )
  })

  it('retires after a refused refresh, not after one that worked', async () => {
    const request = () =>
      form(OAUTH_TOKEN_PATH, {
        grant_type: 'refresh_token',
        refresh_token: 'stl_rt_y',
      })
    await withGrantLifecycle(
      request(),
      OAUTH_TOKEN_PATH,
      async () => new Response('{}', { status: 200 }),
    )
    expect(service.retireAfterTokenEvent).not.toHaveBeenCalled()

    await withGrantLifecycle(
      request(),
      OAUTH_TOKEN_PATH,
      async () => new Response('{}', { status: 400 }),
    )
    expect(service.retireAfterTokenEvent).toHaveBeenCalledWith(
      HOLDER,
      'refresh_rejected',
    )
  })

  it('does nothing without a holder or on a provider failure', async () => {
    service.findTokenHolder.mockResolvedValueOnce(ok(null))
    await withGrantLifecycle(
      form(OAUTH_REVOKE_PATH, { token: 'x' }),
      OAUTH_REVOKE_PATH,
      async () => new Response(null, { status: 200 }),
    )
    await withGrantLifecycle(
      form(OAUTH_REVOKE_PATH, { token: 'stl_rt_x' }),
      OAUTH_REVOKE_PATH,
      async () => new Response(null, { status: 500 }),
    )
    expect(service.retireAfterTokenEvent).not.toHaveBeenCalled()
  })

  it('logs bookkeeping failures and keeps the provider response', async () => {
    service.findTokenHolder.mockResolvedValueOnce(err(databaseError('boom')))
    const first = await withGrantLifecycle(
      form(OAUTH_REVOKE_PATH, { token: 'stl_rt_x' }),
      OAUTH_REVOKE_PATH,
      async () => new Response(null, { status: 200 }),
    )
    expect(first.status).toBe(200)
    expect(logger.warn).toHaveBeenCalledWith(
      'integration_grant.lifecycle_lookup_failed',
      { source: 'token_revoked' },
    )

    service.retireAfterTokenEvent.mockResolvedValueOnce(
      err(databaseError('boom')),
    )
    const second = await withGrantLifecycle(
      form(OAUTH_REVOKE_PATH, { token: 'stl_rt_x' }),
      OAUTH_REVOKE_PATH,
      async () => new Response(null, { status: 200 }),
    )
    expect(second.status).toBe(200)
    expect(logger.warn).toHaveBeenCalledWith(
      'integration_grant.lifecycle_retire_failed',
      { source: 'token_revoked', clientId: 'c' },
    )
  })
})
