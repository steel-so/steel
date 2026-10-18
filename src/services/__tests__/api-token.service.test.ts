import type { ModuleKind, WorkspaceModuleAccess } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeApiToken,
  createFakeApiTokenWithUser,
  createFakeApiTokenWithWorkspace,
} from '@/src/__tests__/factories/api-token.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { hashApiToken } from '@/src/lib/api/token'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/api-token.repository')

import { auditAuth } from '@/lib/axiom/audit'
import { ApiTokenRepository } from '@/src/repositories/api-token.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  API_TOKEN_LAST_USED_THROTTLE_MS,
  ApiTokenService,
  MAX_ACTIVE_API_TOKENS,
} from '../api-token.service'

const tokens = vi.mocked(ApiTokenRepository)
const memberships = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const audit = vi.mocked(auditAuth)

const USER = 'user-1'
const WORKSPACE = 'ws-1'
const NOW = new Date('2026-10-17T12:00:00Z')
const RAW = `stl_pat_${'a'.repeat(43)}`

function access(
  modules: ModuleKind[],
  disabled: ModuleKind[] = [],
  workspaceId = WORKSPACE,
): WorkspaceModuleAccess[] {
  return [...modules, ...disabled].map((module) => ({
    id: `${module}-id`,
    workspaceId,
    module,
    enabled: modules.includes(module),
    grantedById: USER,
    createdAt: NOW,
    updatedAt: NOW,
  }))
}

function asMember(
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'MEMBER',
  workspaceStatus: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(
      createFakeMembership({
        userId: USER,
        workspaceId: WORKSPACE,
        role,
        workspaceStatus,
      }),
    ),
  )
}

const ISSUE = {
  workspaceId: WORKSPACE,
  name: 'CI',
  scopes: ['api:write' as const, 'api:read' as const],
  modules: ['CRM', 'SERVICE_DESK'] as ModuleKind[],
  expiresInDays: 30,
  createdVia: 'SETTINGS' as const,
}

beforeEach(() => {
  asMember()
  moduleAccess.listByWorkspace.mockResolvedValue(
    ok(access(['CRM', 'SERVICE_DESK'], ['COMMUNICATION'])),
  )
  tokens.countActiveByUser.mockResolvedValue(ok(0))
  tokens.create.mockImplementation(async (data) =>
    ok(
      createFakeApiTokenWithWorkspace({
        ...data,
        id: 'tok-new',
        deviceName: data.deviceName ?? null,
      }),
    ),
  )
  tokens.touchLastUsed.mockResolvedValue(ok(true))
  tokens.revoke.mockResolvedValue(ok(true))
})

describe('ApiTokenService.issue', () => {
  it('creates a hashed token and returns the value once', async () => {
    const created = expectOk(await ApiTokenService.issue(USER, ISSUE, NOW))

    expect(created.token).toMatch(/^stl_pat_[A-Za-z0-9_-]{43}$/)
    expect(created.prefix).toBe(`stl_pat_${created.token.slice(8, 16)}`)
    expect(created.scopes).toEqual(['api:read', 'api:write'])
    expect(created.modules).toEqual(['SERVICE_DESK', 'CRM'])
    expect(created.expiresAt).toBe('2026-11-16T12:00:00.000Z')

    const data = tokens.create.mock.calls[0][0]
    expect(data.tokenHash).toBe(hashApiToken(created.token))
    expect(data).toMatchObject({
      userId: USER,
      workspaceId: WORKSPACE,
      name: 'CI',
      scopes: ['api:read', 'api:write'],
      modules: ['SERVICE_DESK', 'CRM'],
      createdVia: 'SETTINGS',
      deviceName: null,
    })
    expect(JSON.stringify(audit.mock.calls)).not.toContain(created.token)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.api_token.created',
        userId: USER,
        meta: expect.objectContaining({
          tokenId: 'tok-new',
          workspaceId: WORKSPACE,
          createdVia: 'SETTINGS',
        }),
      }),
    )
  })

  it('records the device name of the CLI', async () => {
    expectOk(
      await ApiTokenService.issue(
        USER,
        { ...ISSUE, createdVia: 'DEVICE', deviceName: 'notebook' },
        NOW,
      ),
    )
    expect(tokens.create.mock.calls[0][0]).toMatchObject({
      createdVia: 'DEVICE',
      deviceName: 'notebook',
    })
  })

  it('refuses a non-member', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await ApiTokenService.issue(USER, ISSUE, NOW), 'FORBIDDEN')
    expect(tokens.create).not.toHaveBeenCalled()
  })

  it('refuses a suspended workspace', async () => {
    asMember('MEMBER', 'SUSPENDED')
    expectErr(
      await ApiTokenService.issue(USER, ISSUE, NOW),
      'WORKSPACE_SUSPENDED',
    )
  })

  it('refuses a module that is not enabled', async () => {
    expectErr(
      await ApiTokenService.issue(
        USER,
        { ...ISSUE, modules: ['COMMUNICATION'] },
        NOW,
      ),
      'MODULE_DISABLED',
    )
  })

  it('caps active tokens per user', async () => {
    tokens.countActiveByUser.mockResolvedValue(ok(MAX_ACTIVE_API_TOKENS))
    const error = expectErr(
      await ApiTokenService.issue(USER, ISSUE, NOW),
      'API_TOKEN_LIMIT_REACHED',
    )
    expect(error.details).toEqual({ max: MAX_ACTIVE_API_TOKENS })
  })

  it.each([
    ['membership', () => memberships.findByUserAndWorkspace],
    ['module access', () => moduleAccess.listByWorkspace],
    ['count', () => tokens.countActiveByUser],
    ['create', () => tokens.create],
  ])('propagates a database error from %s', async (_label, mock) => {
    mock().mockResolvedValue(err(databaseError()) as never)
    expectErr(await ApiTokenService.issue(USER, ISSUE, NOW), 'DATABASE_ERROR')
  })
})

describe('ApiTokenService.createForUser', () => {
  it('issues a SETTINGS token from the form input', async () => {
    const created = expectOk(
      await ApiTokenService.createForUser(USER, {
        name: 'CI',
        workspaceId: WORKSPACE,
        scopes: ['api:read'],
        modules: ['CRM'],
        expiresInDays: 90,
      }),
    )
    expect(created.createdVia).toBe('SETTINGS')
    expect(created.scopes).toEqual(['api:read'])
  })
})

describe('ApiTokenService.listGrantableWorkspaces', () => {
  it('keeps active workspaces with enabled modules', async () => {
    const active = createFakeWorkspace({ id: 'ws-a', name: 'Acme' })
    const suspended = createFakeWorkspace({ id: 'ws-s', status: 'SUSPENDED' })
    const empty = createFakeWorkspace({ id: 'ws-e' })
    memberships.listByUser.mockResolvedValue(
      ok(
        [active, suspended, empty].map((workspace) => ({
          ...createFakeMembership({ workspaceId: workspace.id }),
          workspace,
        })) as never,
      ),
    )
    moduleAccess.listByWorkspace.mockImplementation(async (id) =>
      ok(id === 'ws-e' ? access([], ['CRM'], id) : access(['CRM'], [], id)),
    )

    expect(
      expectOk(await ApiTokenService.listGrantableWorkspaces(USER)),
    ).toEqual([
      { id: 'ws-a', name: 'Acme', slug: active.slug, modules: ['CRM'] },
    ])
  })

  it('propagates database errors', async () => {
    memberships.listByUser.mockResolvedValue(err(databaseError()))
    expectErr(
      await ApiTokenService.listGrantableWorkspaces(USER),
      'DATABASE_ERROR',
    )

    memberships.listByUser.mockResolvedValue(
      ok([
        {
          ...createFakeMembership({ workspaceId: 'ws-a' }),
          workspace: createFakeWorkspace({ id: 'ws-a' }),
        },
      ] as never),
    )
    moduleAccess.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await ApiTokenService.listGrantableWorkspaces(USER),
      'DATABASE_ERROR',
    )
  })
})

describe('ApiTokenService.listForUser', () => {
  it('maps the user tokens', async () => {
    tokens.listByUser.mockResolvedValue(
      ok([createFakeApiTokenWithWorkspace({ id: 'tok-1', userId: USER })]),
    )
    const list = expectOk(await ApiTokenService.listForUser(USER, NOW))
    expect(list.map((t) => t.id)).toEqual(['tok-1'])
    expect(tokens.listByUser).toHaveBeenCalledWith(USER)
  })

  it('propagates database errors', async () => {
    tokens.listByUser.mockResolvedValue(err(databaseError()))
    expectErr(await ApiTokenService.listForUser(USER), 'DATABASE_ERROR')
  })
})

describe('ApiTokenService.revokeForUser', () => {
  it('revokes an own active token and audits it', async () => {
    tokens.findById.mockResolvedValue(
      ok(createFakeApiToken({ id: 'tok-1', userId: USER })),
    )
    expect(
      expectOk(await ApiTokenService.revokeForUser(USER, 'tok-1')),
    ).toEqual({ id: 'tok-1' })
    expect(tokens.revoke).toHaveBeenCalledWith('tok-1', expect.any(Date))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.api_token.revoked',
        userId: USER,
        meta: expect.objectContaining({ tokenId: 'tok-1', by: 'holder' }),
      }),
    )
  })

  it("reads someone else's or a revoked token as missing", async () => {
    tokens.findById.mockResolvedValue(
      ok(createFakeApiToken({ userId: 'someone-else' })),
    )
    expectErr(
      await ApiTokenService.revokeForUser(USER, 'tok-1'),
      'API_TOKEN_NOT_FOUND',
    )
    tokens.findById.mockResolvedValue(
      ok(createFakeApiToken({ userId: USER, revokedAt: NOW })),
    )
    expectErr(
      await ApiTokenService.revokeForUser(USER, 'tok-1'),
      'API_TOKEN_NOT_FOUND',
    )
    expect(tokens.revoke).not.toHaveBeenCalled()
  })

  it('maps a missing token and a lost race to API_TOKEN_NOT_FOUND', async () => {
    tokens.findById.mockResolvedValue(err(notFound('ApiToken')))
    expectErr(
      await ApiTokenService.revokeForUser(USER, 'nope'),
      'API_TOKEN_NOT_FOUND',
    )
    tokens.findById.mockResolvedValue(ok(createFakeApiToken({ userId: USER })))
    tokens.revoke.mockResolvedValue(ok(false))
    expectErr(
      await ApiTokenService.revokeForUser(USER, 'tok-1'),
      'API_TOKEN_NOT_FOUND',
    )
    expect(audit).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    tokens.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await ApiTokenService.revokeForUser(USER, 'tok-1'),
      'DATABASE_ERROR',
    )
    tokens.findById.mockResolvedValue(ok(createFakeApiToken({ userId: USER })))
    tokens.revoke.mockResolvedValue(err(databaseError()))
    expectErr(
      await ApiTokenService.revokeForUser(USER, 'tok-1'),
      'DATABASE_ERROR',
    )
  })
})

describe('ApiTokenService.revokeCurrent', () => {
  it('revokes the token of the session', async () => {
    tokens.findById.mockResolvedValue(
      ok(createFakeApiToken({ id: 'tok-1', userId: USER })),
    )
    expect(
      expectOk(
        await ApiTokenService.revokeCurrent({ tokenId: 'tok-1', userId: USER }),
      ),
    ).toEqual({ id: 'tok-1' })
    expect(tokens.findById).toHaveBeenCalledWith('tok-1')
  })
})

describe('ApiTokenService.listForWorkspace', () => {
  it('lists every member token for OWNER/ADMIN', async () => {
    asMember('ADMIN')
    tokens.listByWorkspace.mockResolvedValue(
      ok([createFakeApiTokenWithUser({ id: 'tok-1', workspaceId: WORKSPACE })]),
    )
    const list = expectOk(
      await ApiTokenService.listForWorkspace(USER, WORKSPACE, NOW),
    )
    expect(list[0]).toMatchObject({ id: 'tok-1', user: { name: 'Ana' } })
  })

  it.each(['MEMBER', 'VIEWER'] as const)('refuses a %s', async (role) => {
    asMember(role)
    expectErr(
      await ApiTokenService.listForWorkspace(USER, WORKSPACE),
      'FORBIDDEN',
    )
    expect(tokens.listByWorkspace).not.toHaveBeenCalled()
  })

  it('refuses a non-member and propagates database errors', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await ApiTokenService.listForWorkspace(USER, WORKSPACE),
      'FORBIDDEN',
    )
    asMember('OWNER')
    tokens.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await ApiTokenService.listForWorkspace(USER, WORKSPACE),
      'DATABASE_ERROR',
    )
  })
})

describe('ApiTokenService.revokeForWorkspace', () => {
  it("revokes a member's token for an admin", async () => {
    asMember('OWNER')
    tokens.findById.mockResolvedValue(
      ok(
        createFakeApiToken({
          id: 'tok-1',
          userId: 'member-1',
          workspaceId: WORKSPACE,
        }),
      ),
    )
    expectOk(await ApiTokenService.revokeForWorkspace(USER, WORKSPACE, 'tok-1'))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.api_token.revoked',
        userId: USER,
        meta: expect.objectContaining({
          holderId: 'member-1',
          by: 'workspace_admin',
        }),
      }),
    )
  })

  it('refuses a plain member', async () => {
    asMember('MEMBER')
    expectErr(
      await ApiTokenService.revokeForWorkspace(USER, WORKSPACE, 'tok-1'),
      'FORBIDDEN',
    )
    expect(tokens.findById).not.toHaveBeenCalled()
  })

  it('reads a token of another workspace, revoked or missing as missing', async () => {
    asMember('ADMIN')
    tokens.findById.mockResolvedValue(
      ok(createFakeApiToken({ workspaceId: 'other-ws' })),
    )
    expectErr(
      await ApiTokenService.revokeForWorkspace(USER, WORKSPACE, 'tok-1'),
      'API_TOKEN_NOT_FOUND',
    )
    tokens.findById.mockResolvedValue(
      ok(createFakeApiToken({ workspaceId: WORKSPACE, revokedAt: NOW })),
    )
    expectErr(
      await ApiTokenService.revokeForWorkspace(USER, WORKSPACE, 'tok-1'),
      'API_TOKEN_NOT_FOUND',
    )
    tokens.findById.mockResolvedValue(err(notFound('ApiToken')))
    expectErr(
      await ApiTokenService.revokeForWorkspace(USER, WORKSPACE, 'tok-1'),
      'API_TOKEN_NOT_FOUND',
    )
    tokens.findById.mockResolvedValue(
      ok(createFakeApiToken({ workspaceId: WORKSPACE })),
    )
    tokens.revoke.mockResolvedValue(ok(false))
    expectErr(
      await ApiTokenService.revokeForWorkspace(USER, WORKSPACE, 'tok-1'),
      'API_TOKEN_NOT_FOUND',
    )
  })

  it('propagates database errors', async () => {
    asMember('ADMIN')
    tokens.findById.mockResolvedValue(
      ok(createFakeApiToken({ workspaceId: WORKSPACE })),
    )
    tokens.revoke.mockResolvedValue(err(databaseError()))
    expectErr(
      await ApiTokenService.revokeForWorkspace(USER, WORKSPACE, 'tok-1'),
      'DATABASE_ERROR',
    )
  })
})

describe('ApiTokenService.resolveToken', () => {
  function stored(overrides?: Parameters<typeof createFakeApiToken>[0]) {
    const token = createFakeApiToken({
      id: 'tok-1',
      userId: USER,
      workspaceId: WORKSPACE,
      tokenHash: hashApiToken(RAW),
      scopes: ['api:read', 'api:write'],
      modules: ['CRM', 'COMMUNICATION'],
      expiresAt: new Date('2027-01-01T00:00:00Z'),
      ...overrides,
    })
    tokens.findByHash.mockResolvedValue(ok(token))
    return token
  }

  it('resolves to the session, narrowing modules to the enabled ones', async () => {
    stored()
    const session = expectOk(await ApiTokenService.resolveToken(RAW, NOW))
    expect(session).toEqual({
      tokenId: 'tok-1',
      userId: USER,
      workspaceId: WORKSPACE,
      scopes: ['api:read', 'api:write'],
      modules: ['CRM'],
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    })
    expect(tokens.findByHash).toHaveBeenCalledWith(hashApiToken(RAW))
    expect(tokens.touchLastUsed).toHaveBeenCalledWith(
      'tok-1',
      NOW,
      API_TOKEN_LAST_USED_THROTTLE_MS,
    )
  })

  it('goes on when stamping lastUsedAt fails', async () => {
    stored()
    tokens.touchLastUsed.mockResolvedValue(err(databaseError()))
    expectOk(await ApiTokenService.resolveToken(RAW, NOW))
  })

  it.each(['stl_at_abc', 'crm_live_abc', 'stl_pat_short'])(
    'rejects %s without a lookup',
    async (raw) => {
      expectErr(await ApiTokenService.resolveToken(raw, NOW), 'UNAUTHORIZED')
      expect(tokens.findByHash).not.toHaveBeenCalled()
    },
  )

  it('rejects unknown, revoked and expired tokens', async () => {
    tokens.findByHash.mockResolvedValue(ok(null))
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'UNAUTHORIZED')
    stored({ revokedAt: NOW })
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'UNAUTHORIZED')
    stored({ expiresAt: NOW })
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'UNAUTHORIZED')
  })

  it('rejects ex-members and suspended workspaces', async () => {
    stored()
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'UNAUTHORIZED')
    asMember('MEMBER', 'SUSPENDED')
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'UNAUTHORIZED')
  })

  it('rejects a token without the read scope', async () => {
    stored({ scopes: ['api:write'] })
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'UNAUTHORIZED')
  })

  it('propagates database errors', async () => {
    tokens.findByHash.mockResolvedValue(err(databaseError()))
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'DATABASE_ERROR')

    stored()
    memberships.findByUserAndWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'DATABASE_ERROR')

    asMember()
    moduleAccess.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await ApiTokenService.resolveToken(RAW, NOW), 'DATABASE_ERROR')
  })

  it('defaults `now` to the current time', async () => {
    stored({ expiresAt: new Date(Date.now() + 60_000) })
    expectOk(await ApiTokenService.resolveToken(RAW))
  })
})
