import type { ModuleKind, WorkspaceModuleAccess } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { DeviceAuthorizationEntry } from '@/src/cache/device-authorization.cache'
import { databaseError, forbidden } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'
import type { ApiTokenCreatedDTO } from '@/types/api-token'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/api-token.repository')
vi.mock('@/src/cache/device-authorization.cache', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/src/cache/device-authorization.cache')
    >()
  return {
    ...actual,
    DeviceAuthorizationCache: {
      create: vi.fn(),
      findByDeviceCodeHash: vi.fn(),
      findByUserCode: vi.fn(),
      update: vi.fn(),
      claimDecision: vi.fn(),
      consume: vi.fn(),
    },
  }
})
vi.mock('@/src/services/api-token.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/services/api-token.service')>()
  return {
    ...actual,
    ApiTokenService: {
      issue: vi.fn(),
      listGrantableWorkspaces: vi.fn(),
    },
  }
})

import { auditAuth } from '@/lib/axiom/audit'
import {
  DEVICE_CLAIM_GRACE_SECONDS,
  DeviceAuthorizationCache,
  hashDeviceCode,
} from '@/src/cache/device-authorization.cache'
import { ApiTokenRepository } from '@/src/repositories/api-token.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  ApiTokenService,
  MAX_ACTIVE_API_TOKENS,
} from '@/src/services/api-token.service'
import {
  DEVICE_CODE_EXPIRES_IN_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DeviceAuthorizationService,
  deviceTokenName,
  formatUserCode,
} from '../device-authorization.service'

const cache = vi.mocked(DeviceAuthorizationCache)
const apiTokens = vi.mocked(ApiTokenService)
const tokenRepo = vi.mocked(ApiTokenRepository)
const memberships = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const audit = vi.mocked(auditAuth)

const USER = 'user-1'
const WORKSPACE = 'ws-1'
const NOW = new Date('2026-10-17T12:00:00Z')
const DEVICE_CODE = 'd'.repeat(43)
const HASH = hashDeviceCode(DEVICE_CODE)
const ORIGIN = 'https://steel.test/some/path'

function entry(
  overrides?: Partial<DeviceAuthorizationEntry>,
): DeviceAuthorizationEntry {
  return {
    userCode: 'BCDFGH23',
    deviceName: 'notebook',
    status: 'pending',
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    interval: 5,
    lastPolledAt: null,
    approval: null,
    decidedBy: null,
    ...overrides,
  }
}

function access(modules: ModuleKind[]): WorkspaceModuleAccess[] {
  return (['SERVICE_DESK', 'CRM', 'COMMUNICATION'] as ModuleKind[]).map(
    (module) => ({
      id: `${module}-id`,
      workspaceId: WORKSPACE,
      module,
      enabled: modules.includes(module),
      grantedById: USER,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  )
}

const CREATED: ApiTokenCreatedDTO = {
  id: 'tok-1',
  name: 'Steel CLI — notebook',
  prefix: 'stl_pat_abcd1234',
  workspace: { id: WORKSPACE, name: 'Acme', slug: 'acme' },
  scopes: ['api:read'],
  modules: ['CRM'],
  createdVia: 'DEVICE',
  deviceName: 'notebook',
  expiresAt: '2027-01-15T12:00:00.000Z',
  expired: false,
  lastUsedAt: null,
  createdAt: NOW.toISOString(),
  token: 'stl_pat_secret',
}

const APPROVE = {
  accept: true as const,
  userCode: 'BCDFGH23',
  workspaceId: WORKSPACE,
  modules: ['CRM'] as ModuleKind[],
  scopes: ['api:read' as const],
  expiresInDays: 90,
}

beforeEach(() => {
  cache.create.mockResolvedValue(ok(true))
  cache.update.mockResolvedValue(ok(undefined))
  cache.claimDecision.mockResolvedValue(ok(true))
  cache.findByUserCode.mockResolvedValue(
    ok({ deviceCodeHash: HASH, entry: entry() }),
  )
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ userId: USER, workspaceId: WORKSPACE })),
  )
  moduleAccess.listByWorkspace.mockResolvedValue(ok(access(['CRM'])))
  tokenRepo.countActiveByUser.mockResolvedValue(ok(0))
  apiTokens.issue.mockResolvedValue(ok(CREATED))
})

describe('helpers', () => {
  it('formats the user code and names the CLI token', () => {
    expect(formatUserCode('BCDFGH23')).toBe('BCDF-GH23')
    expect(deviceTokenName('notebook')).toBe('Steel CLI — notebook')
    expect(deviceTokenName(null)).toBe('Steel CLI')
    expect(deviceTokenName('x'.repeat(200))).toHaveLength(100)
  })
})

describe('DeviceAuthorizationService.start', () => {
  it('stores a pending login and returns the codes and URIs', async () => {
    const started = expectOk(
      await DeviceAuthorizationService.start(
        { deviceName: 'notebook', clientName: 'steel-cli/1.0.0' },
        ORIGIN,
        NOW,
      ),
    )
    expect(started.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(started.userCode).toMatch(
      /^[BCDFGHJKLMNPQRSTVWXZ2-9]{4}-[BCDFGHJKLMNPQRSTVWXZ2-9]{4}$/,
    )
    expect(started.verificationUri).toBe('https://steel.test/device')
    expect(started.verificationUriComplete).toBe(
      `https://steel.test/device?code=${started.userCode}`,
    )
    expect(started.interval).toBe(DEVICE_POLL_INTERVAL_SECONDS)
    expect(started.expiresIn).toBe(DEVICE_CODE_EXPIRES_IN_SECONDS)

    const [hash, stored, ttl] = cache.create.mock.calls[0]
    expect(hash).toBe(hashDeviceCode(started.deviceCode))
    expect(stored).toMatchObject({
      userCode: started.userCode.replace('-', ''),
      clientName: 'steel-cli/1.0.0',
      deviceName: 'notebook',
      status: 'pending',
      expiresAt: '2026-10-17T12:10:00.000Z',
      approval: null,
    })
    expect(ttl).toBe(
      DEVICE_CODE_EXPIRES_IN_SECONDS + DEVICE_CLAIM_GRACE_SECONDS,
    )
  })

  it('draws another user code on a collision', async () => {
    cache.create.mockResolvedValueOnce(ok(false))
    expectOk(await DeviceAuthorizationService.start({}, ORIGIN, NOW))
    expect(cache.create).toHaveBeenCalledTimes(2)
    expect(cache.create.mock.calls[1][1].deviceName).toBeNull()
    expect(cache.create.mock.calls[1][1].clientName).toBeNull()
  })

  it('gives up after repeated collisions', async () => {
    cache.create.mockResolvedValue(ok(false))
    expectErr(
      await DeviceAuthorizationService.start({}, ORIGIN, NOW),
      'INTERNAL_SERVER_ERROR',
    )
  })

  it('propagates a store failure', async () => {
    cache.create.mockResolvedValue(
      err(appError('INTERNAL_SERVER_ERROR', 'down')),
    )
    expectErr(
      await DeviceAuthorizationService.start({}, ORIGIN),
      'INTERNAL_SERVER_ERROR',
    )
  })
})

describe('DeviceAuthorizationService.poll', () => {
  it('answers AUTHORIZATION_PENDING and records the poll', async () => {
    cache.findByDeviceCodeHash.mockResolvedValue(ok(entry()))
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'AUTHORIZATION_PENDING',
    )
    expect(cache.findByDeviceCodeHash).toHaveBeenCalledWith(HASH)
    expect(cache.update).toHaveBeenCalledWith(
      HASH,
      expect.objectContaining({ lastPolledAt: NOW.toISOString(), interval: 5 }),
    )
  })

  it('answers SLOW_DOWN and widens the interval when polled too soon', async () => {
    cache.findByDeviceCodeHash.mockResolvedValue(
      ok(entry({ lastPolledAt: new Date(NOW.getTime() - 2000).toISOString() })),
    )
    const error = expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'SLOW_DOWN',
    )
    expect(error.details).toEqual({ interval: 10 })
    expect(cache.update).toHaveBeenCalledWith(
      HASH,
      expect.objectContaining({ interval: 10 }),
    )
  })

  it('caps the widened interval at 60 seconds', async () => {
    cache.findByDeviceCodeHash.mockResolvedValue(
      ok(entry({ interval: 60, lastPolledAt: NOW.toISOString() })),
    )
    const error = expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'SLOW_DOWN',
    )
    expect(error.details).toEqual({ interval: 60 })
  })

  it('accepts a poll after the interval', async () => {
    cache.findByDeviceCodeHash.mockResolvedValue(
      ok(entry({ lastPolledAt: new Date(NOW.getTime() - 5000).toISOString() })),
    )
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'AUTHORIZATION_PENDING',
    )
  })

  it('answers EXPIRED_TOKEN for an unknown code', async () => {
    cache.findByDeviceCodeHash.mockResolvedValue(ok(null))
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'EXPIRED_TOKEN',
    )
  })

  it('answers EXPIRED_TOKEN for an expired pending code and drops it', async () => {
    cache.findByDeviceCodeHash.mockResolvedValue(
      ok(entry({ expiresAt: NOW.toISOString() })),
    )
    cache.consume.mockResolvedValue(ok(entry()))
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'EXPIRED_TOKEN',
    )
    expect(cache.consume).toHaveBeenCalledWith(HASH)
  })

  it('answers ACCESS_DENIED once for a refused code', async () => {
    cache.findByDeviceCodeHash.mockResolvedValue(
      ok(entry({ status: 'denied' })),
    )
    cache.consume.mockResolvedValue(ok(entry({ status: 'denied' })))
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'ACCESS_DENIED',
    )
    expect(cache.consume).toHaveBeenCalledWith(HASH)
  })

  it('mints the token for an approved code, once', async () => {
    const approved = entry({
      status: 'approved',
      approval: {
        userId: USER,
        workspaceId: WORKSPACE,
        scopes: ['api:read'],
        modules: ['CRM'],
        expiresInDays: 90,
      },
    })
    cache.findByDeviceCodeHash.mockResolvedValue(ok(approved))
    cache.consume.mockResolvedValue(ok(approved))

    expect(
      expectOk(await DeviceAuthorizationService.poll(DEVICE_CODE, NOW)),
    ).toEqual({
      token: 'stl_pat_secret',
      tokenId: 'tok-1',
      expiresAt: '2027-01-15T12:00:00.000Z',
      workspace: { id: WORKSPACE, slug: 'acme', name: 'Acme' },
      scopes: ['api:read'],
      modules: ['CRM'],
    })
    expect(apiTokens.issue).toHaveBeenCalledWith(
      USER,
      {
        workspaceId: WORKSPACE,
        name: 'Steel CLI — notebook',
        scopes: ['api:read'],
        modules: ['CRM'],
        expiresInDays: 90,
        createdVia: 'DEVICE',
        deviceName: 'notebook',
      },
      NOW,
    )
  })

  it('answers EXPIRED_TOKEN when another poll claimed the approval', async () => {
    cache.findByDeviceCodeHash.mockResolvedValue(
      ok(entry({ status: 'approved' })),
    )
    cache.consume.mockResolvedValue(ok(null))
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'EXPIRED_TOKEN',
    )
    expect(apiTokens.issue).not.toHaveBeenCalled()
  })

  it('returns the issuing failure (e.g. the user left the workspace)', async () => {
    const approved = entry({
      status: 'approved',
      approval: {
        userId: USER,
        workspaceId: WORKSPACE,
        scopes: ['api:read'],
        modules: ['CRM'],
        expiresInDays: 90,
      },
    })
    cache.findByDeviceCodeHash.mockResolvedValue(ok(approved))
    cache.consume.mockResolvedValue(ok(approved))
    apiTokens.issue.mockResolvedValue(err(forbidden()))
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'FORBIDDEN',
    )
  })

  it('propagates store failures', async () => {
    const down = err(appError('INTERNAL_SERVER_ERROR', 'down'))
    cache.findByDeviceCodeHash.mockResolvedValue(down)
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE),
      'INTERNAL_SERVER_ERROR',
    )

    cache.findByDeviceCodeHash.mockResolvedValue(ok(entry()))
    cache.update.mockResolvedValue(down)
    expectErr(
      await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
      'INTERNAL_SERVER_ERROR',
    )

    cache.consume.mockResolvedValue(down)
    for (const stored of [
      entry({ status: 'approved' }),
      entry({ status: 'denied' }),
      entry({ expiresAt: NOW.toISOString() }),
    ]) {
      cache.findByDeviceCodeHash.mockResolvedValue(ok(stored))
      expectErr(
        await DeviceAuthorizationService.poll(DEVICE_CODE, NOW),
        'INTERNAL_SERVER_ERROR',
      )
    }
  })
})

describe('DeviceAuthorizationService.getContext', () => {
  it('returns the formatted code and the grantable workspaces', async () => {
    const workspaces = [
      { id: WORKSPACE, name: 'Acme', slug: 'acme', modules: ['CRM' as const] },
    ]
    apiTokens.listGrantableWorkspaces.mockResolvedValue(ok(workspaces))
    expect(
      expectOk(
        await DeviceAuthorizationService.getContext(USER, 'BCDFGH23', NOW),
      ),
    ).toEqual({
      userCode: 'BCDF-GH23',
      deviceName: 'notebook',
      expiresAt: entry().expiresAt,
      workspaces,
    })
    expect(cache.findByUserCode).toHaveBeenCalledWith('BCDFGH23')
  })

  it.each([
    ['unknown', null],
    [
      'expired',
      { deviceCodeHash: HASH, entry: entry({ expiresAt: NOW.toISOString() }) },
    ],
    [
      'answered',
      { deviceCodeHash: HASH, entry: entry({ status: 'approved' }) },
    ],
  ])('answers DEVICE_CODE_INVALID for an %s code', async (_label, found) => {
    cache.findByUserCode.mockResolvedValue(ok(found))
    expectErr(
      await DeviceAuthorizationService.getContext(USER, 'BCDFGH23', NOW),
      'DEVICE_CODE_INVALID',
    )
  })

  it('propagates failures', async () => {
    apiTokens.listGrantableWorkspaces.mockResolvedValue(err(databaseError()))
    expectErr(
      await DeviceAuthorizationService.getContext(USER, 'BCDFGH23', NOW),
      'DATABASE_ERROR',
    )
    cache.findByUserCode.mockResolvedValue(
      err(appError('INTERNAL_SERVER_ERROR', 'down')),
    )
    expectErr(
      await DeviceAuthorizationService.getContext(USER, 'BCDFGH23'),
      'INTERNAL_SERVER_ERROR',
    )
  })
})

describe('DeviceAuthorizationService.decide', () => {
  it('approves: stores the choice and audits it', async () => {
    expect(
      expectOk(await DeviceAuthorizationService.decide(USER, APPROVE, NOW)),
    ).toEqual({ status: 'approved' })

    expect(cache.claimDecision).toHaveBeenCalledWith(
      HASH,
      600 + DEVICE_CLAIM_GRACE_SECONDS,
    )
    expect(cache.update).toHaveBeenCalledWith(
      HASH,
      expect.objectContaining({
        status: 'approved',
        decidedBy: USER,
        approval: {
          userId: USER,
          workspaceId: WORKSPACE,
          scopes: ['api:read'],
          modules: ['CRM'],
          expiresInDays: 90,
        },
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.device_authorization.approved',
        userId: USER,
      }),
    )
    expect(apiTokens.issue).not.toHaveBeenCalled()
  })

  it('denies without checking membership', async () => {
    expect(
      expectOk(
        await DeviceAuthorizationService.decide(
          USER,
          { accept: false, userCode: 'BCDFGH23' },
          NOW,
        ),
      ),
    ).toEqual({ status: 'denied' })
    expect(memberships.findByUserAndWorkspace).not.toHaveBeenCalled()
    expect(cache.update).toHaveBeenCalledWith(
      HASH,
      expect.objectContaining({
        status: 'denied',
        decidedBy: USER,
        approval: null,
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.device_authorization.denied' }),
    )
  })

  it('refuses a non-member, a disabled module and a full cap', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await DeviceAuthorizationService.decide(USER, APPROVE, NOW),
      'FORBIDDEN',
    )
    expectErr(
      await DeviceAuthorizationService.decide(
        USER,
        { ...APPROVE, modules: ['COMMUNICATION'] },
        NOW,
      ),
      'MODULE_DISABLED',
    )
    tokenRepo.countActiveByUser.mockResolvedValueOnce(ok(MAX_ACTIVE_API_TOKENS))
    expectErr(
      await DeviceAuthorizationService.decide(USER, APPROVE, NOW),
      'API_TOKEN_LIMIT_REACHED',
    )
    expect(cache.claimDecision).not.toHaveBeenCalled()
  })

  it('answers DEVICE_CODE_INVALID for an unknown code or a lost race', async () => {
    cache.findByUserCode.mockResolvedValueOnce(ok(null))
    expectErr(
      await DeviceAuthorizationService.decide(USER, APPROVE, NOW),
      'DEVICE_CODE_INVALID',
    )
    cache.claimDecision.mockResolvedValueOnce(ok(false))
    expectErr(
      await DeviceAuthorizationService.decide(USER, APPROVE, NOW),
      'DEVICE_CODE_INVALID',
    )
    expect(cache.update).not.toHaveBeenCalled()
  })

  it('claims at least one second for a code at its last instant', async () => {
    cache.findByUserCode.mockResolvedValue(
      ok({
        deviceCodeHash: HASH,
        entry: entry({ expiresAt: new Date(NOW.getTime() + 10).toISOString() }),
      }),
    )
    expectOk(await DeviceAuthorizationService.decide(USER, APPROVE, NOW))
    expect(cache.claimDecision).toHaveBeenCalledWith(
      HASH,
      1 + DEVICE_CLAIM_GRACE_SECONDS,
    )
  })

  it('defaults `now` to the current time', async () => {
    cache.findByUserCode.mockResolvedValue(
      ok({
        deviceCodeHash: HASH,
        entry: entry({
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
    )
    expectOk(await DeviceAuthorizationService.decide(USER, APPROVE))
  })

  it('propagates failures', async () => {
    moduleAccess.listByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await DeviceAuthorizationService.decide(USER, APPROVE, NOW),
      'DATABASE_ERROR',
    )
    tokenRepo.countActiveByUser.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await DeviceAuthorizationService.decide(USER, APPROVE, NOW),
      'DATABASE_ERROR',
    )
    const down = err(appError('INTERNAL_SERVER_ERROR', 'down'))
    cache.claimDecision.mockResolvedValueOnce(down)
    expectErr(
      await DeviceAuthorizationService.decide(USER, APPROVE, NOW),
      'INTERNAL_SERVER_ERROR',
    )
    cache.update.mockResolvedValueOnce(down)
    expectErr(
      await DeviceAuthorizationService.decide(USER, APPROVE, NOW),
      'INTERNAL_SERVER_ERROR',
    )
  })
})
