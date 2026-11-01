import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmSocialConnection } from '@/src/__tests__/factories/crm-social.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmSocialConnectionNotFound,
  crmSocialOauthFailed,
  databaseError,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { SocialProvider } from '@/src/lib/social/providers/types'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-social.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/lib/axiom/audit', () => ({
  auditMutation: vi.fn(),
  auditAuth: vi.fn(),
  auditAccess: vi.fn(),
}))
vi.mock('@/src/lib/social/crypto', () => ({
  isTokenCryptoConfigured: vi.fn(() => true),
  encryptToken: vi.fn((plaintext: string) => `enc:${plaintext}`),
  decryptToken: vi.fn((payload: string) => payload.replace(/^enc:/, '')),
}))
vi.mock('@/src/lib/social/oauth-state', () => ({
  createOauthState: vi.fn(() => 'state-token'),
  verifyOauthState: vi.fn(),
}))
vi.mock('@/src/lib/social/pkce', () => ({
  createPkcePair: vi.fn(() => ({
    verifier: 'verifier',
    challenge: 'challenge',
  })),
}))
vi.mock('@/src/lib/social/redirect', () => ({
  socialCallbackUrl: vi.fn(() => 'https://app.test/api/social/callback/x'),
}))
vi.mock('@/src/lib/social/providers', () => ({ getProvider: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { isTokenCryptoConfigured } from '@/src/lib/social/crypto'
import {
  createOauthState,
  verifyOauthState,
} from '@/src/lib/social/oauth-state'
import { getProvider } from '@/src/lib/social/providers'
import { CrmSocialConnectionRepository } from '@/src/repositories/crm-social.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmSocialConnectionService } from '../crm-social.service'

const mockedConnectionRepo = vi.mocked(CrmSocialConnectionRepository)
const mockedWorkspaceRepo = vi.mocked(WorkspaceRepository)
const mockedGetProvider = vi.mocked(getProvider)
const mockedAudit = vi.mocked(auditMutation)

function asMember(role: Role = 'MEMBER') {
  vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function provider(overrides: Partial<SocialProvider> = {}): SocialProvider {
  return {
    platform: 'TIKTOK',
    isConfigured: () => true,
    buildAuthorizeUrl: vi.fn(() => 'https://x.test/authorize'),
    exchangeCode: vi.fn(async () =>
      ok({
        accessToken: 'user-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date('2026-10-01T00:00:00Z'),
        scope: 'tweet.read',
      }),
    ),
    fetchAccounts: vi.fn(async () =>
      ok([{ externalId: 'acc-1', name: 'Acc' }]),
    ),
    ...overrides,
  }
}

beforeEach(() => {
  asMember('MEMBER')
  mockedWorkspaceRepo.findById.mockResolvedValue(
    ok(createFakeWorkspace({ id: 'ws1', slug: 'acme' })),
  )
  vi.mocked(verifyOauthState).mockReturnValue(
    ok({
      workspaceId: 'ws1',
      slug: 'acme',
      platform: 'TIKTOK' as const,
    }) as ReturnType<typeof verifyOauthState>,
  )
})

describe('CrmSocialConnectionService.list()', () => {
  it('should list the workspace connections as DTOs without tokens', async () => {
    asMember('VIEWER')
    mockedConnectionRepo.listByWorkspace.mockResolvedValue(
      ok([
        createFakeCrmSocialConnection({
          id: 'c1',
          accessToken: 'enc:secret',
          refreshToken: 'enc:refresh',
          tokenExpiresAt: new Date('2026-10-01T00:00:00Z'),
        }),
      ]),
    )

    const [dto] = expectOk(await CrmSocialConnectionService.list('u1', 'ws1'))

    expect(dto.id).toBe('c1')
    expect(dto.expiresAt).toBe('2026-10-01T00:00:00.000Z')
    expect(dto).not.toHaveProperty('accessToken')
    expect(dto).not.toHaveProperty('refreshToken')
    expect(mockedConnectionRepo.listByWorkspace).toHaveBeenCalledWith('ws1')
  })

  it('should return FORBIDDEN for a non-member', async () => {
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(null),
    )
    expectErr(await CrmSocialConnectionService.list('x', 'ws1'), 'FORBIDDEN')
    expect(mockedConnectionRepo.listByWorkspace).not.toHaveBeenCalled()
  })

  it('should return MODULE_DISABLED when CRM is off', async () => {
    vi.mocked(WorkspaceModuleAccessRepository.isEnabled).mockResolvedValueOnce(
      ok(false),
    )
    expectErr(
      await CrmSocialConnectionService.list('u1', 'ws1'),
      'MODULE_DISABLED',
    )
  })

  it('should propagate a repository error', async () => {
    mockedConnectionRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSocialConnectionService.list('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmSocialConnectionService.create()', () => {
  const dto = {
    platform: 'FACEBOOK' as const,
    externalAccountId: 'page-1',
    accountName: 'Acme',
  }

  it('should register a manual connection and audit it', async () => {
    mockedConnectionRepo.create.mockResolvedValue(
      ok(createFakeCrmSocialConnection({ id: 'c1', platform: 'FACEBOOK' })),
    )

    const result = expectOk(
      await CrmSocialConnectionService.create('u1', 'ws1', dto),
    )

    expect(result.id).toBe('c1')
    expect(mockedConnectionRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      createdById: 'u1',
      platform: 'FACEBOOK',
      externalAccountId: 'page-1',
      accountName: 'Acme',
    })
    expect(mockedAudit).toHaveBeenCalledWith({
      entity: 'crm_social_connection',
      action: 'create',
      actorId: 'u1',
      targetId: 'c1',
      meta: { platform: 'FACEBOOK' },
    })
  })

  it('should audit the failure and propagate a repository error', async () => {
    mockedConnectionRepo.create.mockResolvedValue(
      err({ code: 'CRM_SOCIAL_CONNECTION_CONFLICT', message: 'dup' }),
    )

    expectErr(
      await CrmSocialConnectionService.create('u1', 'ws1', dto),
      'CRM_SOCIAL_CONNECTION_CONFLICT',
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'CRM_SOCIAL_CONNECTION_CONFLICT',
      }),
    )
  })

  it('should return FORBIDDEN for a VIEWER', async () => {
    asMember('VIEWER')
    expectErr(
      await CrmSocialConnectionService.create('u1', 'ws1', dto),
      'FORBIDDEN',
    )
    expect(mockedConnectionRepo.create).not.toHaveBeenCalled()
  })
})

describe('CrmSocialConnectionService.remove()', () => {
  beforeEach(() => {
    asMember('ADMIN')
  })

  it('should delete an existing connection and audit it', async () => {
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeCrmSocialConnection({ id: 'c1' })),
    )
    mockedConnectionRepo.remove.mockResolvedValue(ok(undefined))

    expectOk(await CrmSocialConnectionService.remove('u1', 'ws1', 'c1'))

    expect(mockedConnectionRepo.findById).toHaveBeenCalledWith('c1', 'ws1')
    expect(mockedConnectionRepo.remove).toHaveBeenCalledWith('c1')
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 'c1' }),
    )
  })

  it('should return FORBIDDEN for a MEMBER (no DELETE on social)', async () => {
    asMember('MEMBER')
    expectErr(
      await CrmSocialConnectionService.remove('u1', 'ws1', 'c1'),
      'FORBIDDEN',
    )
    expect(mockedConnectionRepo.findById).not.toHaveBeenCalled()
  })

  it('should not delete a connection from another workspace', async () => {
    mockedConnectionRepo.findById.mockResolvedValue(
      err(crmSocialConnectionNotFound()),
    )
    expectErr(
      await CrmSocialConnectionService.remove('u1', 'ws1', 'c-other'),
      'CRM_SOCIAL_CONNECTION_NOT_FOUND',
    )
    expect(mockedConnectionRepo.remove).not.toHaveBeenCalled()
  })

  it('should propagate a delete failure without auditing', async () => {
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeCrmSocialConnection({ id: 'c1' })),
    )
    mockedConnectionRepo.remove.mockResolvedValue(err(databaseError()))

    expectErr(
      await CrmSocialConnectionService.remove('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )
    expect(mockedAudit).not.toHaveBeenCalled()
  })
})

describe('CrmSocialConnectionService.beginConnect()', () => {
  it('should build the authorize URL with a signed state and PKCE', async () => {
    const p = provider({ usesPkce: true })
    mockedGetProvider.mockReturnValue(p)

    expect(
      expectOk(
        await CrmSocialConnectionService.beginConnect('u1', 'ws1', 'TIKTOK'),
      ),
    ).toEqual({
      authorizeUrl: 'https://x.test/authorize',
      pkceVerifier: 'verifier',
    })
    expect(createOauthState).toHaveBeenCalledWith('ws1', 'acme', 'TIKTOK')
    expect(p.buildAuthorizeUrl).toHaveBeenCalledWith({
      redirectUri: 'https://app.test/api/social/callback/x',
      state: 'state-token',
      codeChallenge: 'challenge',
    })
  })

  it('should skip PKCE for providers that do not use it', async () => {
    const p = provider()
    mockedGetProvider.mockReturnValue(p)

    const result = expectOk(
      await CrmSocialConnectionService.beginConnect('u1', 'ws1', 'FACEBOOK'),
    )

    expect(result.pkceVerifier).toBeNull()
    expect(p.buildAuthorizeUrl).toHaveBeenCalledWith(
      expect.objectContaining({ codeChallenge: undefined }),
    )
  })

  it('should return CRM_SOCIAL_NOT_CONFIGURED without token encryption', async () => {
    vi.mocked(isTokenCryptoConfigured).mockReturnValueOnce(false)
    expectErr(
      await CrmSocialConnectionService.beginConnect('u1', 'ws1', 'TIKTOK'),
      'CRM_SOCIAL_NOT_CONFIGURED',
    )
    expect(mockedGetProvider).not.toHaveBeenCalled()
  })

  it('should return CRM_SOCIAL_NOT_CONFIGURED when the provider lacks credentials', async () => {
    mockedGetProvider.mockReturnValue(provider({ isConfigured: () => false }))
    expectErr(
      await CrmSocialConnectionService.beginConnect('u1', 'ws1', 'TIKTOK'),
      'CRM_SOCIAL_NOT_CONFIGURED',
    )
  })

  it('should propagate a workspace lookup error', async () => {
    mockedGetProvider.mockReturnValue(provider())
    mockedWorkspaceRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSocialConnectionService.beginConnect('u1', 'ws1', 'TIKTOK'),
      'DATABASE_ERROR',
    )
  })

  it('should fail when the workspace no longer exists', async () => {
    mockedGetProvider.mockReturnValue(provider())
    mockedWorkspaceRepo.findById.mockResolvedValue(
      ok(null as unknown as ReturnType<typeof createFakeWorkspace>),
    )
    expectErr(
      await CrmSocialConnectionService.beginConnect('u1', 'ws1', 'TIKTOK'),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it('should return FORBIDDEN for a VIEWER', async () => {
    asMember('VIEWER')
    expectErr(
      await CrmSocialConnectionService.beginConnect('u1', 'ws1', 'TIKTOK'),
      'FORBIDDEN',
    )
  })
})

describe('CrmSocialConnectionService.completeConnect()', () => {
  it('should reject a tampered/expired state before anything else', async () => {
    vi.mocked(verifyOauthState).mockReturnValueOnce(err('invalid'))

    expectErr(
      await CrmSocialConnectionService.completeConnect('u1', 'bad', 'c', null),
      'CRM_SOCIAL_STATE_INVALID',
    )
    expect(MembershipRepository.findByUserAndWorkspace).not.toHaveBeenCalled()
  })

  it('should return FORBIDDEN when the actor is not a member of the state workspace', async () => {
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(null),
    )
    expectErr(
      await CrmSocialConnectionService.completeConnect('x', 's', 'c', null),
      'FORBIDDEN',
    )
    expect(mockedGetProvider).not.toHaveBeenCalled()
  })

  it('should return CRM_SOCIAL_NOT_CONFIGURED when the provider lacks credentials', async () => {
    mockedGetProvider.mockReturnValue(provider({ isConfigured: () => false }))
    expectErr(
      await CrmSocialConnectionService.completeConnect('u1', 's', 'c', null),
      'CRM_SOCIAL_NOT_CONFIGURED',
    )
  })

  it('should persist the account with the override token and encrypted refresh token', async () => {
    const overrideExpiry = new Date('2026-12-01T00:00:00Z')
    const p = provider({
      fetchAccounts: vi.fn(async () =>
        ok([
          {
            externalId: 'page-1',
            name: 'Page',
            accessTokenOverride: {
              accessToken: 'page-token',
              expiresAt: overrideExpiry,
            },
          },
        ]),
      ),
    })
    mockedGetProvider.mockReturnValue(p)
    mockedConnectionRepo.listByPlatform.mockResolvedValue(ok([]))
    mockedConnectionRepo.upsertOAuthConnection.mockResolvedValue(
      ok(createFakeCrmSocialConnection({ id: 'c1' })),
    )

    expect(
      expectOk(
        await CrmSocialConnectionService.completeConnect(
          'u1',
          'state',
          'code',
          'pkce-verifier',
        ),
      ),
    ).toEqual({ workspaceSlug: 'acme', platform: 'TIKTOK', connected: 1 })

    expect(p.exchangeCode).toHaveBeenCalledWith({
      code: 'code',
      redirectUri: 'https://app.test/api/social/callback/x',
      codeVerifier: 'pkce-verifier',
    })
    expect(mockedConnectionRepo.upsertOAuthConnection).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      createdById: 'u1',
      platform: 'TIKTOK',
      externalAccountId: 'page-1',
      accountName: 'Page',
      accessToken: 'enc:page-token',
      refreshToken: 'enc:refresh-token',
      tokenExpiresAt: overrideExpiry,
      scope: 'tweet.read',
      isPrimary: true,
    })
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'c1',
        meta: {
          platform: 'TIKTOK',
          via: 'oauth',
          externalAccountId: 'page-1',
        },
      }),
    )
  })

  it('should store a null refresh token when the provider returns none', async () => {
    const p = provider({
      exchangeCode: vi.fn(async () =>
        ok({
          accessToken: 't',
          refreshToken: null,
          expiresAt: null,
          scope: null,
        }),
      ),
    })
    mockedGetProvider.mockReturnValue(p)
    mockedConnectionRepo.listByPlatform.mockResolvedValue(ok([]))
    mockedConnectionRepo.upsertOAuthConnection.mockResolvedValue(
      ok(createFakeCrmSocialConnection()),
    )

    expectOk(
      await CrmSocialConnectionService.completeConnect('u1', 's', 'c', null),
    )

    expect(p.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ codeVerifier: undefined }),
    )
    expect(mockedConnectionRepo.upsertOAuthConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'enc:t',
        refreshToken: null,
        tokenExpiresAt: null,
      }),
    )
  })

  it('should propagate a code exchange failure', async () => {
    mockedGetProvider.mockReturnValue(
      provider({
        exchangeCode: vi.fn(async () => err(crmSocialOauthFailed('bad code'))),
      }),
    )
    expectErr(
      await CrmSocialConnectionService.completeConnect('u1', 's', 'c', null),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(mockedConnectionRepo.upsertOAuthConnection).not.toHaveBeenCalled()
  })

  it('should propagate an accounts discovery failure (e.g. no page)', async () => {
    mockedGetProvider.mockReturnValue(
      provider({
        fetchAccounts: vi.fn(async () =>
          err({ code: 'CRM_SOCIAL_NO_PAGE' as const, message: 'sem página' }),
        ),
      }),
    )
    expectErr(
      await CrmSocialConnectionService.completeConnect('u1', 's', 'c', null),
      'CRM_SOCIAL_NO_PAGE',
    )
  })

  it('should propagate a workspace lookup error', async () => {
    mockedGetProvider.mockReturnValue(provider())
    mockedWorkspaceRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSocialConnectionService.completeConnect('u1', 's', 'c', null),
      'DATABASE_ERROR',
    )
  })

  it('should fail when the workspace was deleted mid-flow', async () => {
    mockedGetProvider.mockReturnValue(provider())
    mockedWorkspaceRepo.findById.mockResolvedValue(
      ok(null as unknown as ReturnType<typeof createFakeWorkspace>),
    )
    expectErr(
      await CrmSocialConnectionService.completeConnect('u1', 's', 'c', null),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it('should propagate a failure listing existing connections', async () => {
    mockedGetProvider.mockReturnValue(provider())
    mockedConnectionRepo.listByPlatform.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSocialConnectionService.completeConnect('u1', 's', 'c', null),
      'DATABASE_ERROR',
    )
  })

  it('should stop at the first persistence failure', async () => {
    mockedGetProvider.mockReturnValue(
      provider({
        fetchAccounts: vi.fn(async () =>
          ok([
            { externalId: 'a', name: null },
            { externalId: 'b', name: null },
          ]),
        ),
      }),
    )
    mockedConnectionRepo.listByPlatform.mockResolvedValue(ok([]))
    mockedConnectionRepo.upsertOAuthConnection.mockResolvedValue(
      err(databaseError()),
    )

    expectErr(
      await CrmSocialConnectionService.completeConnect('u1', 's', 'c', null),
      'DATABASE_ERROR',
    )
    expect(mockedConnectionRepo.upsertOAuthConnection).toHaveBeenCalledTimes(1)
    expect(mockedAudit).not.toHaveBeenCalled()
  })
})

describe('CrmSocialConnectionService.setPrimary()', () => {
  it('should propagate a not-found connection', async () => {
    mockedConnectionRepo.findById.mockResolvedValue(
      err(crmSocialConnectionNotFound()),
    )
    expectErr(
      await CrmSocialConnectionService.setPrimary('u1', 'ws1', 'c1'),
      'CRM_SOCIAL_CONNECTION_NOT_FOUND',
    )
    expect(mockedConnectionRepo.setPrimary).not.toHaveBeenCalled()
  })

  it('should propagate a failure switching the primary', async () => {
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeCrmSocialConnection({ id: 'c1', platform: 'YOUTUBE' })),
    )
    mockedConnectionRepo.setPrimary.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmSocialConnectionService.setPrimary('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('should return FORBIDDEN for a VIEWER (no EDIT on social)', async () => {
    asMember('VIEWER')
    expectErr(
      await CrmSocialConnectionService.setPrimary('u1', 'ws1', 'c1'),
      'FORBIDDEN',
    )
  })
})
