import type { ModuleKind, WorkspaceModuleAccess } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeIntegrationGrant,
  createFakeIntegrationGrantWithRelations,
  createFakeOauthAccessToken,
  createFakeOauthClientSummary,
} from '@/src/__tests__/factories/integration-grant.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound, oauthRequestInvalid } from '@/src/errors'
import { hashOpaqueToken } from '@/src/lib/mcp/oauth-utils'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/integration-grant.repository')
vi.mock('@/src/repositories/oauth-client.repository')
vi.mock('@/src/lib/mcp/oauth-provider', () => ({
  OAuthProviderGateway: { consent: vi.fn() },
}))

import { auditAuth } from '@/lib/axiom/audit'
import { OAuthProviderGateway } from '@/src/lib/mcp/oauth-provider'
import { IntegrationGrantRepository } from '@/src/repositories/integration-grant.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { OauthClientRepository } from '@/src/repositories/oauth-client.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  IntegrationGrantService,
  LAST_USED_THROTTLE_MS,
} from '../integration-grant.service'

const grants = vi.mocked(IntegrationGrantRepository)
const clients = vi.mocked(OauthClientRepository)
const memberships = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const gateway = vi.mocked(OAuthProviderGateway)
const audit = vi.mocked(auditAuth)

const USER = 'user-1'
const WORKSPACE = 'ws-1'
const CLIENT = createFakeOauthClientSummary({ clientId: 'client-1' })

function oauthQuery(overrides?: Record<string, string | null>) {
  const params: Record<string, string | null> = {
    client_id: 'client-1',
    scope: 'mcp:read mcp:write offline_access',
    exp: String(Math.floor(Date.now() / 1000) + 600),
    sig: 'signature',
    ...overrides,
  }
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) search.set(key, value)
  }
  return search.toString()
}

function access(
  modules: ModuleKind[],
  disabled: ModuleKind[] = [],
): WorkspaceModuleAccess[] {
  return [...modules, ...disabled].map((module) => ({
    id: `${module}-id`,
    workspaceId: WORKSPACE,
    module,
    enabled: modules.includes(module),
    grantedById: USER,
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
}

function asMember(role: 'OWNER' | 'MEMBER' = 'MEMBER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ userId: USER, workspaceId: WORKSPACE, role })),
  )
}

const HEADERS = new Headers({ cookie: 'session=1' })

beforeEach(() => {
  clients.findByClientId.mockResolvedValue(ok(CLIENT))
  moduleAccess.listByWorkspace.mockResolvedValue(
    ok(access(['CRM', 'SERVICE_DESK'], ['COMMUNICATION'])),
  )
  asMember()
  grants.findActive.mockResolvedValue(ok(null))
  grants.touchLastUsed.mockResolvedValue(ok(true))
  gateway.consent.mockResolvedValue(
    ok({ redirectUrl: 'https://claude.ai/cb?code=abc' }),
  )
})

describe('IntegrationGrantService.getConsentContext', () => {
  it('lists active workspaces with their enabled modules in canonical order', async () => {
    const active = createFakeWorkspace({ id: 'ws-a', name: 'Acme' })
    const suspended = createFakeWorkspace({ id: 'ws-s', status: 'SUSPENDED' })
    const empty = createFakeWorkspace({ id: 'ws-e' })
    memberships.listByUser.mockResolvedValue(
      ok([
        {
          ...createFakeMembership({ workspaceId: active.id }),
          workspace: active,
        },
        {
          ...createFakeMembership({ workspaceId: suspended.id }),
          workspace: suspended,
        },
        {
          ...createFakeMembership({ workspaceId: empty.id }),
          workspace: empty,
        },
      ] as never),
    )
    moduleAccess.listByWorkspace.mockImplementation(async (id) =>
      ok(id === 'ws-e' ? access([], ['CRM']) : access(['CRM', 'SERVICE_DESK'])),
    )

    const context = expectOk(
      await IntegrationGrantService.getConsentContext(USER, oauthQuery()),
    )

    expect(context.client.clientId).toBe('client-1')
    expect(context.requestedScopes).toEqual(['mcp:read', 'mcp:write'])
    expect(context.workspaces).toEqual([
      {
        id: 'ws-a',
        name: 'Acme',
        slug: active.slug,
        modules: ['SERVICE_DESK', 'CRM'],
      },
    ])
  })

  it('rejects a query without signature, an expired one and an unknown client', async () => {
    expectErr(
      await IntegrationGrantService.getConsentContext(
        USER,
        oauthQuery({ sig: null }),
      ),
      'OAUTH_REQUEST_INVALID',
    )
    expectErr(
      await IntegrationGrantService.getConsentContext(
        USER,
        oauthQuery({ exp: String(Math.floor(Date.now() / 1000) - 1) }),
      ),
      'OAUTH_REQUEST_INVALID',
    )
    clients.findByClientId.mockResolvedValueOnce(ok(null))
    expectErr(
      await IntegrationGrantService.getConsentContext(USER, oauthQuery()),
      'OAUTH_REQUEST_INVALID',
    )
    clients.findByClientId.mockResolvedValueOnce(
      ok({ ...CLIENT, disabled: true }),
    )
    expectErr(
      await IntegrationGrantService.getConsentContext(USER, oauthQuery()),
      'OAUTH_REQUEST_INVALID',
    )
  })

  it('rejects a client that did not ask for mcp:read', async () => {
    const error = expectErr(
      await IntegrationGrantService.getConsentContext(
        USER,
        oauthQuery({ scope: 'offline_access' }),
      ),
      'OAUTH_REQUEST_INVALID',
    )
    expect(error.message).toContain('MCP')
  })

  it('propagates database errors', async () => {
    clients.findByClientId.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.getConsentContext(USER, oauthQuery()),
      'DATABASE_ERROR',
    )

    memberships.listByUser.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.getConsentContext(USER, oauthQuery()),
      'DATABASE_ERROR',
    )

    const ws = createFakeWorkspace()
    memberships.listByUser.mockResolvedValueOnce(
      ok([
        { ...createFakeMembership({ workspaceId: ws.id }), workspace: ws },
      ] as never),
    )
    moduleAccess.listByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.getConsentContext(USER, oauthQuery()),
      'DATABASE_ERROR',
    )
  })
})

describe('IntegrationGrantService.consent (accept)', () => {
  const accept = (
    overrides?: Partial<{
      modules: ModuleKind[]
      scopes: ('mcp:read' | 'mcp:write')[]
      oauthQuery: string
    }>,
  ) => ({
    accept: true as const,
    oauthQuery: overrides?.oauthQuery ?? oauthQuery(),
    workspaceId: WORKSPACE,
    modules: overrides?.modules ?? (['CRM', 'SERVICE_DESK'] as ModuleKind[]),
    scopes: overrides?.scopes ?? (['mcp:read'] as ('mcp:read' | 'mcp:write')[]),
  })

  it('creates the grant, runs the provider inside its reference and audits', async () => {
    const created = createFakeIntegrationGrant({ id: 'grant-1' })
    grants.create.mockResolvedValue(ok(created))

    const result = expectOk(
      await IntegrationGrantService.consent(
        USER,
        accept({ scopes: ['mcp:read', 'mcp:write'] }),
        HEADERS,
      ),
    )

    expect(result.redirectUrl).toBe('https://claude.ai/cb?code=abc')
    expect(grants.create).toHaveBeenCalledWith({
      userId: USER,
      workspaceId: WORKSPACE,
      clientId: 'client-1',
      scopes: ['mcp:read', 'mcp:write'],
      modules: ['SERVICE_DESK', 'CRM'],
    })
    expect(gateway.consent).toHaveBeenCalledWith({
      headers: HEADERS,
      oauthQuery: expect.any(String),
      accept: true,
      scope: 'mcp:read mcp:write offline_access',
      grantId: 'grant-1',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.oauth_consent.granted',
        userId: USER,
        meta: expect.objectContaining({
          grantId: 'grant-1',
          scopes: ['mcp:read', 'mcp:write'],
          modules: ['SERVICE_DESK', 'CRM'],
          noticeVersion: 'mcp-consent-v1',
        }),
      }),
    )
  })

  it('updates the active grant of the same client and workspace', async () => {
    const existing = createFakeIntegrationGrant({
      id: 'grant-old',
      scopes: ['mcp:read', 'mcp:write'],
      modules: ['CRM'],
    })
    grants.findActive.mockResolvedValue(ok(existing))
    grants.updateConsent.mockResolvedValue(ok(existing))

    expectOk(
      await IntegrationGrantService.consent(
        USER,
        accept({ oauthQuery: oauthQuery({ scope: 'mcp:read mcp:write' }) }),
        HEADERS,
      ),
    )

    expect(grants.create).not.toHaveBeenCalled()
    expect(grants.updateConsent).toHaveBeenCalledWith('grant-old', {
      scopes: ['mcp:read'],
      modules: ['SERVICE_DESK', 'CRM'],
    })
    // No offline_access asked → none accepted.
    expect(gateway.consent).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mcp:read', grantId: 'grant-old' }),
    )
  })

  it('deletes a new grant when the provider refuses the consent', async () => {
    grants.create.mockResolvedValue(
      ok(createFakeIntegrationGrant({ id: 'g-new' })),
    )
    grants.delete.mockResolvedValue(ok(undefined))
    gateway.consent.mockResolvedValueOnce(err(oauthRequestInvalid()))

    expectErr(
      await IntegrationGrantService.consent(USER, accept(), HEADERS),
      'OAUTH_REQUEST_INVALID',
    )
    expect(grants.delete).toHaveBeenCalledWith('g-new')
    expect(audit).not.toHaveBeenCalled()
  })

  it('restores an existing grant when the provider refuses, even if the undo fails', async () => {
    const existing = createFakeIntegrationGrant({
      id: 'g-old',
      scopes: ['mcp:read', 'mcp:write'],
      modules: ['COMMUNICATION'],
    })
    grants.findActive.mockResolvedValue(ok(existing))
    grants.updateConsent
      .mockResolvedValueOnce(ok(existing))
      .mockResolvedValueOnce(err(databaseError()))
    gateway.consent.mockResolvedValueOnce(err(oauthRequestInvalid()))

    expectErr(
      await IntegrationGrantService.consent(USER, accept(), HEADERS),
      'OAUTH_REQUEST_INVALID',
    )
    expect(grants.updateConsent).toHaveBeenLastCalledWith('g-old', {
      scopes: ['mcp:read', 'mcp:write'],
      modules: ['COMMUNICATION'],
    })
  })

  it('refuses scopes the client did not ask for', async () => {
    expectErr(
      await IntegrationGrantService.consent(
        USER,
        accept({
          oauthQuery: oauthQuery({ scope: 'mcp:read' }),
          scopes: ['mcp:read', 'mcp:write'],
        }),
        HEADERS,
      ),
      'VALIDATION_ERROR',
    )
    expect(grants.create).not.toHaveBeenCalled()
  })

  it('refuses a non-member and a suspended workspace', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await IntegrationGrantService.consent(USER, accept(), HEADERS),
      'FORBIDDEN',
    )
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(
      ok(createFakeMembership({ workspaceStatus: 'SUSPENDED' })),
    )
    expectErr(
      await IntegrationGrantService.consent(USER, accept(), HEADERS),
      'WORKSPACE_SUSPENDED',
    )
    expect(grants.create).not.toHaveBeenCalled()
  })

  it('refuses a module that is not enabled in the workspace', async () => {
    expectErr(
      await IntegrationGrantService.consent(
        USER,
        accept({ modules: ['COMMUNICATION'] }),
        HEADERS,
      ),
      'MODULE_DISABLED',
    )
  })

  it('refuses an invalid request before touching grants', async () => {
    expectErr(
      await IntegrationGrantService.consent(
        USER,
        accept({ oauthQuery: 'client_id=client-1' }),
        HEADERS,
      ),
      'OAUTH_REQUEST_INVALID',
    )
    expect(grants.findActive).not.toHaveBeenCalled()
  })

  it('propagates database errors at each step', async () => {
    moduleAccess.listByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.consent(USER, accept(), HEADERS),
      'DATABASE_ERROR',
    )
    grants.findActive.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.consent(USER, accept(), HEADERS),
      'DATABASE_ERROR',
    )
    grants.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.consent(USER, accept(), HEADERS),
      'DATABASE_ERROR',
    )
    expect(gateway.consent).not.toHaveBeenCalled()
  })
})

describe('IntegrationGrantService.consent (deny)', () => {
  it('forwards the refusal to the provider and audits it', async () => {
    gateway.consent.mockResolvedValueOnce(
      ok({ redirectUrl: 'https://claude.ai/cb?error=access_denied' }),
    )
    const result = expectOk(
      await IntegrationGrantService.consent(
        USER,
        { accept: false, oauthQuery: oauthQuery() },
        HEADERS,
      ),
    )
    expect(result.redirectUrl).toContain('access_denied')
    expect(gateway.consent).toHaveBeenCalledWith({
      headers: HEADERS,
      oauthQuery: expect.any(String),
      accept: false,
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.oauth_consent.denied',
        meta: { clientId: 'client-1' },
      }),
    )
    expect(grants.create).not.toHaveBeenCalled()
  })

  it('does not audit when the provider rejects the query', async () => {
    gateway.consent.mockResolvedValueOnce(err(oauthRequestInvalid()))
    expectErr(
      await IntegrationGrantService.consent(
        USER,
        { accept: false, oauthQuery: 'garbage' },
        HEADERS,
      ),
      'OAUTH_REQUEST_INVALID',
    )
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('IntegrationGrantService.listForUser', () => {
  it('maps the active grants', async () => {
    const grant = createFakeIntegrationGrantWithRelations({
      userId: USER,
      scopes: ['offline_access', 'mcp:write', 'mcp:read'],
      lastUsedAt: new Date('2026-10-17T12:00:00Z'),
    })
    grants.listActiveByUser.mockResolvedValue(ok([grant]))

    const [dto] = expectOk(await IntegrationGrantService.listForUser(USER))
    expect(dto.scopes).toEqual(['mcp:read', 'mcp:write'])
    expect(dto.lastUsedAt).toBe('2026-10-17T12:00:00.000Z')
    expect(dto.workspace.slug).toBe('acme')
  })

  it('propagates database errors', async () => {
    grants.listActiveByUser.mockResolvedValue(err(databaseError()))
    expectErr(await IntegrationGrantService.listForUser(USER), 'DATABASE_ERROR')
  })
})

describe('IntegrationGrantService.revokeForUser', () => {
  it('revokes the user own grant and audits', async () => {
    const grant = createFakeIntegrationGrant({ id: 'g1', userId: USER })
    grants.findById.mockResolvedValue(ok(grant))
    grants.revoke.mockResolvedValue(ok({ ...grant, revokedAt: new Date() }))

    expect(
      expectOk(await IntegrationGrantService.revokeForUser(USER, 'g1')),
    ).toEqual({ id: 'g1' })
    expect(grants.revoke).toHaveBeenCalledWith('g1', expect.any(Date))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.integration_grant.revoked' }),
    )
  })

  it('treats another user grant, a revoked one and a missing one as not found', async () => {
    grants.findById.mockResolvedValueOnce(
      ok(createFakeIntegrationGrant({ userId: 'someone-else' })),
    )
    expectErr(
      await IntegrationGrantService.revokeForUser(USER, 'g1'),
      'INTEGRATION_GRANT_NOT_FOUND',
    )
    grants.findById.mockResolvedValueOnce(
      ok(createFakeIntegrationGrant({ userId: USER, revokedAt: new Date() })),
    )
    expectErr(
      await IntegrationGrantService.revokeForUser(USER, 'g1'),
      'INTEGRATION_GRANT_NOT_FOUND',
    )
    grants.findById.mockResolvedValueOnce(err(notFound('IntegrationGrant')))
    expectErr(
      await IntegrationGrantService.revokeForUser(USER, 'g1'),
      'INTEGRATION_GRANT_NOT_FOUND',
    )
    expect(grants.revoke).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    grants.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.revokeForUser(USER, 'g1'),
      'DATABASE_ERROR',
    )
    grants.findById.mockResolvedValueOnce(
      ok(createFakeIntegrationGrant({ userId: USER })),
    )
    grants.revoke.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.revokeForUser(USER, 'g1'),
      'DATABASE_ERROR',
    )
  })
})

describe('IntegrationGrantService.resolveAccessToken', () => {
  const NOW = new Date('2026-10-17T12:00:00Z')
  const RAW = 'stl_at_secret-value'

  function setup(overrides?: {
    token?: Parameters<typeof createFakeOauthAccessToken>[0]
    grant?: Parameters<typeof createFakeIntegrationGrant>[0]
  }) {
    const grant = createFakeIntegrationGrant({
      id: 'g1',
      userId: USER,
      workspaceId: WORKSPACE,
      clientId: 'client-1',
      scopes: ['mcp:read', 'mcp:write'],
      modules: ['CRM', 'COMMUNICATION'],
      ...overrides?.grant,
    })
    const token = createFakeOauthAccessToken({
      clientId: 'client-1',
      userId: USER,
      referenceId: 'g1',
      expiresAt: new Date(NOW.getTime() + 60_000),
      scopes: ['mcp:read', 'mcp:write', 'offline_access'],
      ...overrides?.token,
    })
    clients.findAccessTokenByHash.mockResolvedValue(ok(token))
    grants.findById.mockResolvedValue(ok(grant))
    return { grant, token }
  }

  it('resolves to the grant, keeping only modules still enabled', async () => {
    setup()
    const grant = expectOk(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
    )

    expect(clients.findAccessTokenByHash).toHaveBeenCalledWith(
      hashOpaqueToken('secret-value'),
    )
    expect(grant).toEqual({
      grantId: 'g1',
      userId: USER,
      workspaceId: WORKSPACE,
      clientId: 'client-1',
      clientName: 'Claude',
      scopes: ['mcp:read', 'mcp:write'],
      // COMMUNICATION is disabled in the workspace now.
      modules: ['CRM'],
    })
    expect(grants.touchLastUsed).toHaveBeenCalledWith(
      'g1',
      NOW,
      LAST_USED_THROTTLE_MS,
    )
  })

  it('caps the scopes at what both the token and the grant hold', async () => {
    setup({ grant: { scopes: ['mcp:read'] } })
    expect(
      expectOk(await IntegrationGrantService.resolveAccessToken(RAW, NOW))
        .scopes,
    ).toEqual(['mcp:read'])
  })

  it('keeps going when touching lastUsedAt fails', async () => {
    setup()
    grants.touchLastUsed.mockResolvedValueOnce(err(databaseError()))
    expectOk(await IntegrationGrantService.resolveAccessToken(RAW, NOW))
  })

  it.each([
    ['a token without the Steel prefix', 'other_token'],
    ['a bare prefix', 'stl_at_'],
  ])('rejects %s', async (_label, raw) => {
    expectErr(
      await IntegrationGrantService.resolveAccessToken(raw, NOW),
      'UNAUTHORIZED',
    )
    expect(clients.findAccessTokenByHash).not.toHaveBeenCalled()
  })

  it('rejects an unknown, expired, orphan or disabled-client token', async () => {
    clients.findAccessTokenByHash.mockResolvedValueOnce(ok(null))
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'UNAUTHORIZED',
    )

    for (const token of [
      { expiresAt: new Date(NOW.getTime() - 1) },
      { expiresAt: null },
      { referenceId: null },
      { userId: null },
      { client: createFakeOauthClientSummary({ disabled: true }) },
    ]) {
      setup({ token })
      expectErr(
        await IntegrationGrantService.resolveAccessToken(RAW, NOW),
        'UNAUTHORIZED',
      )
    }
  })

  it('rejects a revoked, missing or mismatched grant', async () => {
    for (const grant of [
      { revokedAt: new Date() },
      { userId: 'someone-else' },
      { clientId: 'other-client' },
    ]) {
      setup({ grant })
      expectErr(
        await IntegrationGrantService.resolveAccessToken(RAW, NOW),
        'UNAUTHORIZED',
      )
    }
    setup()
    grants.findById.mockResolvedValueOnce(err(notFound('IntegrationGrant')))
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'UNAUTHORIZED',
    )
  })

  it('rejects a token without mcp:read', async () => {
    setup({ token: { scopes: ['offline_access'] } })
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'UNAUTHORIZED',
    )
  })

  it('rejects an ex-member and a suspended workspace', async () => {
    setup()
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'UNAUTHORIZED',
    )
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(
      ok(createFakeMembership({ workspaceStatus: 'SUSPENDED' })),
    )
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'UNAUTHORIZED',
    )
    expect(grants.touchLastUsed).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    clients.findAccessTokenByHash.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'DATABASE_ERROR',
    )

    setup()
    grants.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'DATABASE_ERROR',
    )

    setup()
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(
      err(databaseError()),
    )
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'DATABASE_ERROR',
    )

    setup()
    moduleAccess.listByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await IntegrationGrantService.resolveAccessToken(RAW, NOW),
      'DATABASE_ERROR',
    )
  })

  it('uses the current time by default', async () => {
    setup({ token: { expiresAt: new Date(Date.now() + 60_000) } })
    expectOk(await IntegrationGrantService.resolveAccessToken(RAW))
  })
})
