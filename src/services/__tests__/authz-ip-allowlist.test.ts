import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  record: vi.fn(),
  context: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('../workspace-access-recorder', () => ({
  recordWorkspaceAccess: mocks.record,
}))
vi.mock('@/src/lib/analytics/request-context', () => ({
  annotateRequest: vi.fn(),
  currentRequestContext: mocks.context,
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { PATHNAME_REQUEST_HEADER } from '@/src/lib/request-path'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { assertIpAllowed, assertMember } from '../authz'

const ALLOWLIST = ['200.1.2.0/24']

function request(
  ip: string | null,
  path: string | null = '/acme/home',
  userAgent: string | null = 'Mozilla/5.0',
) {
  const h = new Headers()
  if (ip) h.set('x-forwarded-for', ip)
  if (path) h.set(PATHNAME_REQUEST_HEADER, path)
  if (userAgent) h.set('user-agent', userAgent)
  mocks.headers.mockResolvedValue(h)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockReturnValue(undefined)
})

describe('assertIpAllowed — entry log (ADR 0053)', () => {
  it('records nothing without an allowlist', async () => {
    expectOk(await assertIpAllowed('ws_1', [], 'u_1'))
    expectOk(await assertIpAllowed('ws_1', null, 'u_1'))
    expect(mocks.headers).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('records nothing outside a request (worker, scripts)', async () => {
    mocks.headers.mockRejectedValue(new Error('outside a request scope'))
    expectOk(await assertIpAllowed('ws_1', ALLOWLIST, 'u_1'))
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('records an allowed app entry', async () => {
    request('200.1.2.3')
    expectOk(await assertIpAllowed('ws_1', ALLOWLIST, 'u_1'))
    expect(mocks.record).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      userId: 'u_1',
      ip: '200.1.2.3',
      userAgent: 'Mozilla/5.0',
      outcome: 'ALLOWED',
      surface: 'APP',
      path: '/acme/home',
    })
  })

  it('records a blocked API call and denies it', async () => {
    request('8.8.8.8', '/api/workspaces/ws_1/crm/leads', null)
    expectErr(
      await assertIpAllowed('ws_1', ALLOWLIST, 'u_1'),
      'WORKSPACE_IP_NOT_ALLOWED',
    )
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'BLOCKED',
        surface: 'API',
        ip: '8.8.8.8',
        userAgent: null,
      }),
    )
    expect(logger.warn).toHaveBeenCalledWith('workspace.ip_blocked', {
      workspaceId: 'ws_1',
      actorId: 'u_1',
      ip: '8.8.8.8',
    })
  })

  it('records an unknown IP as blocked (fail-closed)', async () => {
    request(null)
    expectErr(
      await assertIpAllowed('ws_1', ALLOWLIST, 'u_1'),
      'WORKSPACE_IP_NOT_ALLOWED',
    )
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ ip: null, outcome: 'BLOCKED' }),
    )
  })

  it('without the proxy path, a route handler counts as API', async () => {
    request('200.1.2.3', null)
    mocks.context.mockReturnValue({})
    await assertIpAllowed('ws_1', ALLOWLIST, 'u_1')
    expect(mocks.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ surface: 'API', path: null }),
    )

    mocks.context.mockReturnValue(undefined)
    await assertIpAllowed('ws_1', ALLOWLIST, 'u_1')
    expect(mocks.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ surface: 'APP', path: null }),
    )
  })

  it('treats `/api` itself as the API', async () => {
    request('200.1.2.3', '/api')
    await assertIpAllowed('ws_1', ALLOWLIST, 'u_1')
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'API' }),
    )
  })

  it('runs through assertMember for every API call', async () => {
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok({
        ...createFakeMembership({ userId: 'u_1', workspaceId: 'ws_1' }),
        workspace: { status: 'ACTIVE', allowedIps: ALLOWLIST },
      }),
    )
    request('9.9.9.9', '/api/workspaces/ws_1/members')
    expectErr(await assertMember('u_1', 'ws_1'), 'WORKSPACE_IP_NOT_ALLOWED')
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'BLOCKED', surface: 'API' }),
    )
  })
})
