import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/platform-flag.repository')
vi.mock('@/src/lib/admin-audit', () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}))

import { recordAdminAction } from '@/src/lib/admin-audit'
import {
  getActiveFlagKeys,
  invalidatePlatformFlagsCache,
  isFeatureEnabled,
} from '@/src/lib/platform-flags'
import { PlatformFlagRepository } from '@/src/repositories/platform-flag.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { AdminFeatureFlagService } from '../admin-feature-flag.service'

const repo = vi.mocked(PlatformFlagRepository)
const admin = createFakeUser({
  isPlatformAdmin: true,
  email: 'admin@stratustelecom.com.br',
})
const regular = createFakeUser({ email: 'user@example.com' })

const now = new Date('2026-11-19T12:00:00Z')
const flag = {
  id: 'f1',
  key: 'novo-dashboard',
  name: 'Novo dashboard',
  description: null,
  enabled: false,
  betaEnabled: true,
  createdAt: now,
  updatedAt: now,
  _count: { workspaces: 2 },
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidatePlatformFlagsCache()
  vi.mocked(UserRepository.findById).mockResolvedValue(ok(admin))
})

describe('AdminFeatureFlagService', () => {
  it('rejects non platform admins', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(ok(regular))
    expectErr(await AdminFeatureFlagService.list('u1'), 'FORBIDDEN')
    expect(repo.list).not.toHaveBeenCalled()
  })

  it('lists flags as DTOs', async () => {
    repo.list.mockResolvedValue(ok([flag] as never))
    const value = expectOk(await AdminFeatureFlagService.list('a1'))
    expect(value[0]).toMatchObject({
      key: 'novo-dashboard',
      workspaceCount: 2,
      createdAt: now.toISOString(),
    })
  })

  it('creates a flag and audits it', async () => {
    repo.findByKey.mockResolvedValue(ok(null))
    repo.create.mockResolvedValue(ok(flag as never))
    const input = {
      key: 'novo-dashboard',
      name: 'Novo dashboard',
      description: null,
      enabled: false,
      betaEnabled: true,
    }
    expectOk(await AdminFeatureFlagService.create('a1', input))
    expect(repo.create).toHaveBeenCalledWith(input)
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feature_flag.create' }),
    )
  })

  it('refuses a duplicated key', async () => {
    repo.findByKey.mockResolvedValue(ok(flag as never))
    expectErr(
      await AdminFeatureFlagService.create('a1', {
        key: 'novo-dashboard',
        name: 'x',
        description: null,
        enabled: false,
        betaEnabled: false,
      }),
      'CONFLICT',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('returns not found when updating or deleting a missing flag', async () => {
    repo.findById.mockResolvedValue(ok(null))
    expectErr(
      await AdminFeatureFlagService.update('a1', 'x', { enabled: true }),
      'RESOURCE_NOT_FOUND',
    )
    expectErr(
      await AdminFeatureFlagService.remove('a1', 'x'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('updates and deletes an existing flag', async () => {
    repo.findById.mockResolvedValue(ok(flag as never))
    repo.update.mockResolvedValue(ok({ ...flag, enabled: true } as never))
    repo.delete.mockResolvedValue(ok(true))
    const updated = expectOk(
      await AdminFeatureFlagService.update('a1', 'f1', { enabled: true }),
    )
    expect(updated.enabled).toBe(true)
    expect(expectOk(await AdminFeatureFlagService.remove('a1', 'f1'))).toEqual({
      id: 'f1',
    })
  })

  it('grants a flag to a workspace', async () => {
    repo.findById.mockResolvedValue(ok(flag as never))
    repo.setGrant.mockResolvedValue(ok(true))
    expectOk(
      await AdminFeatureFlagService.setWorkspaceGrant('a1', 'f1', {
        workspaceId: 'ws1',
        granted: true,
      }),
    )
    expect(repo.setGrant).toHaveBeenCalledWith('f1', 'ws1', true)
  })

  it('marks a workspace as beta', async () => {
    repo.setWorkspaceBeta.mockResolvedValue(
      ok({ id: 'ws1', name: 'W', slug: 'w', beta: true }),
    )
    const value = expectOk(
      await AdminFeatureFlagService.setWorkspaceBeta('a1', {
        workspaceId: 'ws1',
        beta: true,
      }),
    )
    expect(value.beta).toBe(true)
  })

  it('lists workspaces flagging the granted ones', async () => {
    repo.listWorkspaces.mockResolvedValue(
      ok([
        { id: 'ws1', name: 'A', slug: 'a', beta: false },
        { id: 'ws2', name: 'B', slug: 'b', beta: true },
      ]),
    )
    repo.listGrantedWorkspaceIds.mockResolvedValue(ok(['ws2']))
    const value = expectOk(
      await AdminFeatureFlagService.listWorkspaces('a1', { flagId: 'f1' }),
    )
    expect(value.map((w) => w.granted)).toEqual([false, true])
  })
})

describe('isFeatureEnabled', () => {
  it('reads the active keys and caches them briefly', async () => {
    repo.listActiveKeys.mockResolvedValue(ok(['a', 'b']))
    expect(await isFeatureEnabled('a', 'ws1')).toBe(true)
    expect(await isFeatureEnabled('c', 'ws1')).toBe(false)
    expect(repo.listActiveKeys).toHaveBeenCalledTimes(1)
  })

  it('refetches after the TTL', async () => {
    repo.listActiveKeys.mockResolvedValue(ok(['a']))
    await getActiveFlagKeys('ws1', 0)
    await getActiveFlagKeys('ws1', 20_000)
    expect(repo.listActiveKeys).toHaveBeenCalledTimes(2)
  })

  it('treats read failures as disabled', async () => {
    repo.listActiveKeys.mockResolvedValue(err(databaseError()))
    expect(await isFeatureEnabled('a', 'ws1')).toBe(false)
  })
})
