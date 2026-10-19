import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeIntegrationGrant } from '@/src/__tests__/factories/integration-grant.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { hashOpaqueToken } from '@/src/lib/mcp/oauth-utils'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger')
vi.mock('@/src/repositories/integration-grant.repository')
vi.mock('@/src/repositories/oauth-client.repository')

import { auditAuth } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { IntegrationGrantRepository } from '@/src/repositories/integration-grant.repository'
import { OauthClientRepository } from '@/src/repositories/oauth-client.repository'
import {
  IN_FLIGHT_GRACE_MS,
  IntegrationGrantLifecycleService,
  MAX_PRUNE_BATCHES,
  PRUNE_IDLE_MS,
} from '../integration-grant-lifecycle.service'

const grants = vi.mocked(IntegrationGrantRepository)
const clients = vi.mocked(OauthClientRepository)
const audit = vi.mocked(auditAuth)

const NOW = new Date('2026-10-18T12:00:00Z')
const HOLDER = { clientId: 'client-1', userId: 'user-1', referenceId: 'g-1' }

function page(dead = [] as ReturnType<typeof createFakeIntegrationGrant>[]) {
  return ok({ dead, nextCursor: null })
}

beforeEach(() => {
  grants.revokeMany.mockImplementation(async (ids) => ok(ids.length))
})

describe('IntegrationGrantLifecycleService.findTokenHolder', () => {
  it('looks an access or refresh token up by the hash of its value', async () => {
    clients.findTokenHolderByHash.mockResolvedValue(ok(HOLDER))

    expect(
      expectOk(
        await IntegrationGrantLifecycleService.findTokenHolder('stl_at_abc'),
      ),
    ).toEqual(HOLDER)
    expect(clients.findTokenHolderByHash).toHaveBeenLastCalledWith(
      'access_token',
      hashOpaqueToken('abc'),
    )

    expectOk(
      await IntegrationGrantLifecycleService.findTokenHolder('stl_rt_xyz'),
    )
    expect(clients.findTokenHolderByHash).toHaveBeenLastCalledWith(
      'refresh_token',
      hashOpaqueToken('xyz'),
    )
  })

  it('has no holder for a foreign or empty token', async () => {
    for (const raw of ['other', 'stl_at_', 'stl_rt_', '']) {
      expect(
        expectOk(await IntegrationGrantLifecycleService.findTokenHolder(raw)),
      ).toBeNull()
    }
    expect(clients.findTokenHolderByHash).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    clients.findTokenHolderByHash.mockResolvedValue(err(databaseError('boom')))
    expectErr(
      await IntegrationGrantLifecycleService.findTokenHolder('stl_at_abc'),
      'DATABASE_ERROR',
    )
  })
})

describe('IntegrationGrantLifecycleService.retireAfterTokenEvent', () => {
  it('retires the token grant when nothing live is left and audits it', async () => {
    const grant = createFakeIntegrationGrant({
      id: 'g-1',
      clientId: 'client-1',
      userId: 'user-1',
    })
    grants.listWithoutLiveTokens.mockResolvedValue(page([grant]))

    expect(
      expectOk(
        await IntegrationGrantLifecycleService.retireAfterTokenEvent(
          HOLDER,
          'token_revoked',
          NOW,
        ),
      ),
    ).toBe(1)
    expect(grants.listWithoutLiveTokens).toHaveBeenCalledTimes(1)
    expect(grants.listWithoutLiveTokens).toHaveBeenCalledWith(
      { ids: ['g-1'] },
      NOW,
    )
    expect(grants.revokeMany).toHaveBeenCalledWith(['g-1'], NOW)
    expect(audit).toHaveBeenCalledWith({
      event: 'auth.integration_grant.expired',
      userId: 'user-1',
      meta: {
        grantId: 'g-1',
        clientId: 'client-1',
        workspaceId: grant.workspaceId,
        source: 'token_revoked',
      },
    })
    expect(logger.info).toHaveBeenCalledWith(
      'integration_grant.retired',
      expect.objectContaining({ retired: 1, source: 'token_revoked' }),
    )
  })

  it('leaves a grant that still has live tokens', async () => {
    grants.listWithoutLiveTokens.mockResolvedValue(page())
    expect(
      expectOk(
        await IntegrationGrantLifecycleService.retireAfterTokenEvent(
          HOLDER,
          'token_revoked',
          NOW,
        ),
      ),
    ).toBe(0)
    expect(grants.revokeMany).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('never retires a grant of another client or user', async () => {
    grants.listWithoutLiveTokens.mockResolvedValue(
      page([
        createFakeIntegrationGrant({
          id: 'g-1',
          clientId: 'other',
          userId: 'user-1',
        }),
        createFakeIntegrationGrant({
          id: 'g-1',
          clientId: 'client-1',
          userId: 'other',
        }),
      ]),
    )
    expect(
      expectOk(
        await IntegrationGrantLifecycleService.retireAfterTokenEvent(
          HOLDER,
          'token_revoked',
          NOW,
        ),
      ),
    ).toBe(0)
    expect(grants.revokeMany).not.toHaveBeenCalled()
  })

  it('after a refused refresh also checks the idle grants of the client and user', async () => {
    const own = createFakeIntegrationGrant({
      id: 'g-1',
      clientId: 'client-1',
      userId: 'user-1',
    })
    const sibling = createFakeIntegrationGrant({
      id: 'g-2',
      clientId: 'client-1',
      userId: 'user-1',
    })
    grants.listWithoutLiveTokens
      .mockResolvedValueOnce(page([own]))
      .mockResolvedValueOnce(page([own, sibling]))

    expect(
      expectOk(
        await IntegrationGrantLifecycleService.retireAfterTokenEvent(
          HOLDER,
          'refresh_rejected',
          NOW,
        ),
      ),
    ).toBe(2)
    expect(grants.listWithoutLiveTokens).toHaveBeenLastCalledWith(
      {
        clientId: 'client-1',
        userId: 'user-1',
        updatedBefore: new Date(NOW.getTime() - IN_FLIGHT_GRACE_MS),
      },
      NOW,
    )
    expect(grants.revokeMany).toHaveBeenCalledWith(['g-1', 'g-2'], NOW)
    expect(audit).toHaveBeenCalledTimes(2)
  })

  it('without a reference only the family check runs', async () => {
    grants.listWithoutLiveTokens.mockResolvedValue(page())
    expectOk(
      await IntegrationGrantLifecycleService.retireAfterTokenEvent(
        { ...HOLDER, referenceId: null },
        'refresh_rejected',
      ),
    )
    expect(grants.listWithoutLiveTokens).toHaveBeenCalledTimes(1)
    expect(grants.listWithoutLiveTokens.mock.calls[0][0]).toMatchObject({
      clientId: 'client-1',
    })
  })

  it('propagates database errors from each step', async () => {
    grants.listWithoutLiveTokens.mockResolvedValueOnce(
      err(databaseError('boom')),
    )
    expectErr(
      await IntegrationGrantLifecycleService.retireAfterTokenEvent(
        HOLDER,
        'token_revoked',
        NOW,
      ),
      'DATABASE_ERROR',
    )

    grants.listWithoutLiveTokens
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await IntegrationGrantLifecycleService.retireAfterTokenEvent(
        HOLDER,
        'refresh_rejected',
        NOW,
      ),
      'DATABASE_ERROR',
    )

    grants.listWithoutLiveTokens.mockResolvedValueOnce(
      page([
        createFakeIntegrationGrant({
          id: 'g-1',
          clientId: 'client-1',
          userId: 'user-1',
        }),
      ]),
    )
    grants.revokeMany.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await IntegrationGrantLifecycleService.retireAfterTokenEvent(
        HOLDER,
        'token_revoked',
        NOW,
      ),
      'DATABASE_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('IntegrationGrantLifecycleService.pruneWithoutLiveTokens', () => {
  it('retires grants idle for a day without live tokens, page by page', async () => {
    const a = createFakeIntegrationGrant({ id: 'a' })
    const b = createFakeIntegrationGrant({ id: 'b' })
    grants.listWithoutLiveTokens
      .mockResolvedValueOnce(ok({ dead: [a], nextCursor: 'a' }))
      .mockResolvedValueOnce(ok({ dead: [], nextCursor: 'z' }))
      .mockResolvedValueOnce(ok({ dead: [b], nextCursor: null }))

    expect(
      expectOk(
        await IntegrationGrantLifecycleService.pruneWithoutLiveTokens(NOW),
      ),
    ).toBe(2)

    const updatedBefore = new Date(NOW.getTime() - PRUNE_IDLE_MS)
    expect(grants.listWithoutLiveTokens.mock.calls).toEqual([
      [{ updatedBefore }, NOW, undefined],
      [{ updatedBefore }, NOW, 'a'],
      [{ updatedBefore }, NOW, 'z'],
    ])
    expect(grants.revokeMany).toHaveBeenCalledTimes(2)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.integration_grant.expired',
        meta: expect.objectContaining({ grantId: 'b', source: 'retention' }),
      }),
    )
  })

  it('stops after the batch limit', async () => {
    grants.listWithoutLiveTokens.mockResolvedValue(
      ok({ dead: [], nextCursor: 'more' }),
    )
    expect(
      expectOk(await IntegrationGrantLifecycleService.pruneWithoutLiveTokens()),
    ).toBe(0)
    expect(grants.listWithoutLiveTokens).toHaveBeenCalledTimes(
      MAX_PRUNE_BATCHES,
    )
  })

  it('propagates database errors', async () => {
    grants.listWithoutLiveTokens.mockResolvedValueOnce(
      err(databaseError('boom')),
    )
    expectErr(
      await IntegrationGrantLifecycleService.pruneWithoutLiveTokens(NOW),
      'DATABASE_ERROR',
    )

    grants.listWithoutLiveTokens.mockResolvedValueOnce(
      page([createFakeIntegrationGrant()]),
    )
    grants.revokeMany.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await IntegrationGrantLifecycleService.pruneWithoutLiveTokens(NOW),
      'DATABASE_ERROR',
    )
  })
})
