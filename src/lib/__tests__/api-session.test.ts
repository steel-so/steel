import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, rateLimited, unauthorized } from '@/src/errors'
import type { ApiSession } from '@/src/lib/api/session'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/api-token.service', () => ({
  ApiTokenService: { resolveToken: vi.fn() },
}))
vi.mock('@/src/lib/rate-limit', () => ({
  apiTokenLimiter: { name: 'api-token' },
  consume: vi.fn(),
}))

import { resolveApiSession } from '@/src/lib/api/session'
import { apiTokenLimiter, consume } from '@/src/lib/rate-limit'
import { ApiTokenService } from '@/src/services/api-token.service'

const resolveToken = vi.mocked(ApiTokenService.resolveToken)
const consumeLimit = vi.mocked(consume)

const SESSION: ApiSession = {
  tokenId: 'tok-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  scopes: ['api:read'],
  modules: ['CRM'],
  expiresAt: new Date('2027-01-01T00:00:00Z'),
}

function request(authorization?: string) {
  return new Request('https://steel.test/api/v1/me', {
    headers: authorization ? { authorization } : {},
  })
}

beforeEach(() => {
  resolveToken.mockResolvedValue(ok(SESSION))
  consumeLimit.mockResolvedValue(ok(undefined))
})

describe('resolveApiSession', () => {
  it('resolves the bearer token and consumes the per-token limit', async () => {
    const session = expectOk(
      await resolveApiSession(request('Bearer stl_pat_abc')),
    )
    expect(session).toEqual(SESSION)
    expect(resolveToken).toHaveBeenCalledWith('stl_pat_abc')
    expect(consumeLimit).toHaveBeenCalledWith(apiTokenLimiter, 'token:tok-1')
  })

  it.each([undefined, 'Basic dXNlcjpwYXNz', 'Bearer'])(
    'is unauthorized without a bearer token (%s)',
    async (header) => {
      expectErr(await resolveApiSession(request(header)), 'UNAUTHORIZED')
      expect(resolveToken).not.toHaveBeenCalled()
    },
  )

  it('never reads the session cookie', async () => {
    const withCookie = new Request('https://steel.test/api/v1/me', {
      headers: { cookie: 'better-auth.session_token=abc' },
    })
    expectErr(await resolveApiSession(withCookie), 'UNAUTHORIZED')
  })

  it('propagates the resolution failure without consuming the limit', async () => {
    resolveToken.mockResolvedValueOnce(err(unauthorized()))
    expectErr(
      await resolveApiSession(request('Bearer stl_pat_x')),
      'UNAUTHORIZED',
    )
    resolveToken.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await resolveApiSession(request('Bearer stl_pat_x')),
      'DATABASE_ERROR',
    )
    expect(consumeLimit).not.toHaveBeenCalled()
  })

  it('answers RATE_LIMITED over the per-token budget', async () => {
    consumeLimit.mockResolvedValueOnce(err(rateLimited(12)))
    const error = expectErr(
      await resolveApiSession(request('Bearer stl_pat_x')),
      'RATE_LIMITED',
    )
    expect(error.details).toMatchObject({ retryAfterSeconds: 12 })
  })
})
