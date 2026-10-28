import { describe, expect, it, vi } from 'vitest'
import {
  seedIntegrationGrant,
  seedOauthAccessToken,
  seedOauthClient,
  seedOauthRefreshToken,
} from '@/src/__tests__/factories/integration-grant.factory'
import { seedAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  IntegrationGrantRepository,
  LIVENESS_BATCH,
} from '../integration-grant.repository'

async function scenario() {
  const [user, workspace, client] = await Promise.all([
    seedUser(),
    seedWorkspace(),
    seedOauthClient(),
  ])
  return { user, workspace, client }
}

describe('IntegrationGrantRepository', () => {
  it('creates, finds and lists active grants with client and workspace', async () => {
    const { user, workspace, client } = await scenario()
    const grant = expectOk(
      await IntegrationGrantRepository.create({
        userId: user.id,
        workspaceId: workspace.id,
        clientId: client.clientId,
        scopes: ['mcp:read'],
        modules: ['CRM', 'SERVICE_DESK'],
        redirectHost: 'claude.ai',
      }),
    )
    expect(grant.redirectHost).toBe('claude.ai')
    await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
      revokedAt: new Date(),
    })

    expect(
      expectOk(await IntegrationGrantRepository.findById(grant.id)).id,
    ).toBe(grant.id)
    expect(
      expectOk(
        await IntegrationGrantRepository.findActive(
          user.id,
          client.clientId,
          workspace.id,
        ),
      )?.id,
    ).toBe(grant.id)

    const list = expectOk(
      await IntegrationGrantRepository.listActiveByUser(user.id),
    )
    expect(list).toHaveLength(1)
    expect(list[0].client.name).toBe('Claude')
    expect(list[0].workspace.slug).toBe(workspace.slug)
    expect(list[0].modules).toEqual(['CRM', 'SERVICE_DESK'])
    expect(list[0].redirectHost).toBe('claude.ai')
  })

  it('allows a single active grant per user, client and workspace', async () => {
    const { user, workspace, client } = await scenario()
    const data = {
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
      scopes: ['mcp:read'],
      modules: ['CRM' as const],
    }
    expectOk(await IntegrationGrantRepository.create(data))
    expectErr(await IntegrationGrantRepository.create(data), 'DATABASE_ERROR')
  })

  it('returns RESOURCE_NOT_FOUND for a missing grant', async () => {
    expectErr(
      await IntegrationGrantRepository.findById('missing'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('updates the consent and deletes a grant', async () => {
    const { user, workspace, client } = await scenario()
    const grant = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
    })
    const updated = expectOk(
      await IntegrationGrantRepository.updateConsent(grant.id, {
        scopes: ['mcp:read', 'mcp:write'],
        modules: ['COMMUNICATION'],
        redirectHost: 'chatgpt.com',
      }),
    )
    expect(updated.scopes).toEqual(['mcp:read', 'mcp:write'])
    expect(updated.modules).toEqual(['COMMUNICATION'])
    expect(updated.redirectHost).toBe('chatgpt.com')

    expectOk(await IntegrationGrantRepository.delete(grant.id))
    expectErr(
      await IntegrationGrantRepository.findById(grant.id),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('revokes the grant with its tokens and consent, leaving others alone', async () => {
    const { user, workspace, client } = await scenario()
    const grant = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
    })
    const other = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: (await seedWorkspace()).id,
      clientId: client.clientId,
    })
    const mine = await seedOauthAccessToken({
      clientId: client.clientId,
      userId: user.id,
      referenceId: grant.id,
    })
    const theirs = await seedOauthAccessToken({
      clientId: client.clientId,
      userId: user.id,
      referenceId: other.id,
    })
    const refresh = await prisma.oauthRefreshToken.create({
      data: {
        token: 'refresh-hash',
        clientId: client.clientId,
        userId: user.id,
        referenceId: grant.id,
        scopes: ['mcp:read', 'offline_access'],
      },
    })
    await prisma.oauthConsent.create({
      data: {
        clientId: client.clientId,
        userId: user.id,
        referenceId: grant.id,
        scopes: ['mcp:read'],
      },
    })

    const at = new Date('2026-10-17T12:00:00Z')
    const revoked = expectOk(
      await IntegrationGrantRepository.revoke(grant.id, at),
    )
    expect(revoked.revokedAt).toEqual(at)

    expect(
      await prisma.oauthAccessToken.findUnique({ where: { id: mine.row.id } }),
    ).toBeNull()
    expect(
      await prisma.oauthAccessToken.findUnique({
        where: { id: theirs.row.id },
      }),
    ).not.toBeNull()
    expect(
      (await prisma.oauthRefreshToken.findUnique({ where: { id: refresh.id } }))
        ?.revoked,
    ).toEqual(at)
    expect(
      await prisma.oauthConsent.count({ where: { referenceId: grant.id } }),
    ).toBe(0)
    expect(
      expectOk(await IntegrationGrantRepository.listActiveByUser(user.id)).map(
        (g) => g.id,
      ),
    ).toEqual([other.id])
  })

  it('cancels the pending writes the revoked client proposed', async () => {
    const { user, workspace, client } = await scenario()
    const grant = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
      scopes: ['mcp:read', 'mcp:write'],
    })
    const waiting = await seedAiPendingAction(workspace.id, {
      requestedById: user.id,
      integrationGrantId: grant.id,
    })
    const done = await seedAiPendingAction(workspace.id, {
      requestedById: user.id,
      integrationGrantId: grant.id,
      status: 'EXECUTED',
    })
    const chat = await seedAiPendingAction(workspace.id, {
      requestedById: user.id,
    })

    const at = new Date('2026-10-17T12:00:00Z')
    expectOk(await IntegrationGrantRepository.revoke(grant.id, at))

    const rows = await prisma.aiPendingAction.findMany({
      where: { id: { in: [waiting.id, done.id, chat.id] } },
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.get(waiting.id)).toMatchObject({
      status: 'CANCELED',
      decidedAt: at,
    })
    expect(byId.get(done.id)?.status).toBe('EXECUTED')
    expect(byId.get(chat.id)?.status).toBe('PENDING')
  })

  it('touches lastUsedAt at most once per throttle window', async () => {
    const { user, workspace, client } = await scenario()
    const grant = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
    })
    const t0 = new Date('2026-10-17T12:00:00Z')

    expect(
      expectOk(
        await IntegrationGrantRepository.touchLastUsed(grant.id, t0, 60_000),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await IntegrationGrantRepository.touchLastUsed(
          grant.id,
          new Date(t0.getTime() + 30_000),
          60_000,
        ),
      ),
    ).toBe(false)
    const later = new Date(t0.getTime() + 61_000)
    expect(
      expectOk(
        await IntegrationGrantRepository.touchLastUsed(grant.id, later, 60_000),
      ),
    ).toBe(true)
    expect(
      expectOk(await IntegrationGrantRepository.findById(grant.id)).lastUsedAt,
    ).toEqual(later)
  })

  it('lists a workspace active grants with user and client, newest first', async () => {
    const { user, workspace, client } = await scenario()
    const other = await seedUser({ name: 'Bia' })
    const older = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
    })
    await prisma.integrationGrant.update({
      where: { id: older.id },
      data: { createdAt: new Date('2026-01-01T00:00:00Z') },
    })
    const newer = await seedIntegrationGrant({
      userId: other.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
    })
    await seedIntegrationGrant({
      userId: other.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
      revokedAt: new Date(),
    })
    await seedIntegrationGrant({
      userId: user.id,
      workspaceId: (await seedWorkspace()).id,
      clientId: client.clientId,
    })

    const list = expectOk(
      await IntegrationGrantRepository.listActiveByWorkspace(workspace.id),
    )
    expect(list.map((g) => g.id)).toEqual([newer.id, older.id])
    expect(list[0].user).toEqual({
      id: other.id,
      name: 'Bia',
      email: other.email,
      image: null,
    })
    expect(list[0].client.name).toBe('Claude')
  })

  it('lists active ids by member or by app and revokes many at once', async () => {
    const { user, workspace, client } = await scenario()
    const other = await seedUser()
    const cursor = await seedOauthClient({ name: 'Cursor' })
    const a = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
    })
    const b = await seedIntegrationGrant({
      userId: user.id,
      workspaceId: workspace.id,
      clientId: cursor.clientId,
    })
    const c = await seedIntegrationGrant({
      userId: other.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
    })
    const token = await seedOauthAccessToken({
      clientId: client.clientId,
      userId: user.id,
      referenceId: a.id,
    })
    const refresh = await prisma.oauthRefreshToken.create({
      data: {
        token: 'refresh-many',
        clientId: cursor.clientId,
        userId: user.id,
        referenceId: b.id,
        scopes: ['mcp:read', 'offline_access'],
      },
    })
    await prisma.oauthConsent.create({
      data: {
        clientId: client.clientId,
        userId: user.id,
        referenceId: a.id,
        scopes: ['mcp:read'],
      },
    })

    const byMember = expectOk(
      await IntegrationGrantRepository.listActiveIdsByWorkspace(workspace.id, {
        userId: user.id,
      }),
    )
    expect(byMember.sort()).toEqual([a.id, b.id].sort())
    const byClient = expectOk(
      await IntegrationGrantRepository.listActiveIdsByWorkspace(workspace.id, {
        clientId: client.clientId,
      }),
    )
    expect(byClient.sort()).toEqual([a.id, c.id].sort())

    expect(
      expectOk(await IntegrationGrantRepository.revokeMany([], new Date())),
    ).toBe(0)
    const at = new Date('2026-10-17T12:00:00Z')
    expect(
      expectOk(await IntegrationGrantRepository.revokeMany(byMember, at)),
    ).toBe(2)
    // Already revoked grants are not counted again.
    expect(
      expectOk(await IntegrationGrantRepository.revokeMany(byMember, at)),
    ).toBe(0)

    expect(
      await prisma.oauthAccessToken.findUnique({ where: { id: token.row.id } }),
    ).toBeNull()
    expect(
      (await prisma.oauthRefreshToken.findUnique({ where: { id: refresh.id } }))
        ?.revoked,
    ).toEqual(at)
    expect(
      await prisma.oauthConsent.count({ where: { referenceId: a.id } }),
    ).toBe(0)
    expect(
      expectOk(
        await IntegrationGrantRepository.listActiveByWorkspace(workspace.id),
      ).map((g) => g.id),
    ).toEqual([c.id])
  })

  it('lists the active grants left without a live token', async () => {
    const { user, client } = await scenario()
    // One active grant per (user, client, workspace): a workspace each.
    const seed = async (revokedAt: Date | null = null) =>
      seedIntegrationGrant({
        userId: user.id,
        workspaceId: (await seedWorkspace()).id,
        clientId: client.clientId,
        revokedAt,
      })
    const now = new Date()
    const past = new Date(now.getTime() - 60_000)
    const owner = { clientId: client.clientId, userId: user.id }

    const [
      withAccess,
      withRefresh,
      noExpiryRefresh,
      expired,
      revokedRefresh,
      rotated,
      empty,
      alreadyRevoked,
    ] = await Promise.all([
      seed(),
      seed(),
      seed(),
      seed(),
      seed(),
      seed(),
      seed(),
      seed(now),
    ])
    await seedOauthAccessToken({ ...owner, referenceId: withAccess.id })
    await seedOauthRefreshToken({ ...owner, referenceId: withRefresh.id })
    await seedOauthRefreshToken({
      ...owner,
      referenceId: noExpiryRefresh.id,
      expiresAt: null,
    })
    await seedOauthAccessToken({
      ...owner,
      referenceId: expired.id,
      expiresAt: past,
    })
    await seedOauthRefreshToken({
      ...owner,
      referenceId: expired.id,
      expiresAt: past,
    })
    await seedOauthRefreshToken({
      ...owner,
      referenceId: revokedRefresh.id,
      revoked: past,
    })
    // An unexpired access token left behind by a rotation: its refresh token
    // is revoked, so it does not keep the grant alive.
    const old = await seedOauthRefreshToken({
      ...owner,
      referenceId: rotated.id,
      revoked: past,
    })
    await seedOauthAccessToken({
      ...owner,
      referenceId: rotated.id,
      refreshId: old.row.id,
    })

    const all = [
      withAccess,
      withRefresh,
      noExpiryRefresh,
      expired,
      revokedRefresh,
      rotated,
      empty,
      alreadyRevoked,
    ].map((g) => g.id)
    const byIds = expectOk(
      await IntegrationGrantRepository.listWithoutLiveTokens({ ids: all }, now),
    )
    expect(byIds.nextCursor).toBeNull()
    expect(byIds.dead.map((g) => g.id).sort()).toEqual(
      [expired.id, revokedRefresh.id, rotated.id, empty.id].sort(),
    )

    // By idle time, client and user.
    const later = new Date(now.getTime() + 60_000)
    expect(
      expectOk(
        await IntegrationGrantRepository.listWithoutLiveTokens(
          { updatedBefore: later, ...owner },
          now,
        ),
      ).dead,
    ).toHaveLength(4)
    expect(
      expectOk(
        await IntegrationGrantRepository.listWithoutLiveTokens(
          { updatedBefore: past },
          now,
        ),
      ).dead,
    ).toEqual([])
    expect(
      expectOk(
        await IntegrationGrantRepository.listWithoutLiveTokens(
          { updatedBefore: later, clientId: 'other' },
          now,
        ),
      ).dead,
    ).toEqual([])

    // The cursor skips what was already looked at.
    const sorted = [...all.slice(0, 7)].sort()
    expect(
      expectOk(
        await IntegrationGrantRepository.listWithoutLiveTokens(
          { updatedBefore: later },
          now,
          sorted[5],
        ),
      ).dead.map((g) => g.id),
    ).toEqual(
      sorted
        .slice(6)
        .filter((id) =>
          [expired.id, revokedRefresh.id, rotated.id, empty.id].includes(id),
        ),
    )
  })

  it('does not count an access token revoked with its session as live', async () => {
    const { user, client } = await scenario()
    const owner = { clientId: client.clientId, userId: user.id }
    const now = new Date()
    const grant = await seedIntegrationGrant({
      ...owner,
      workspaceId: (await seedWorkspace()).id,
    })
    // Unexpired, but Better Auth 1.7 marked it when the session ended.
    await seedOauthAccessToken({
      ...owner,
      referenceId: grant.id,
      revoked: new Date(now.getTime() - 1_000),
    })

    expect(
      expectOk(
        await IntegrationGrantRepository.listWithoutLiveTokens(
          { ids: [grant.id] },
          now,
        ),
      ).dead.map((g) => g.id),
    ).toEqual([grant.id])
  })

  it('returns a cursor when a liveness batch is full', async () => {
    const { user, workspace } = await scenario()
    const clientIds = Array.from(
      { length: LIVENESS_BATCH + 1 },
      (_, i) => `bulk-client-${i}`,
    )
    await prisma.oauthClient.createMany({
      data: clientIds.map((clientId) => ({ clientId, scopes: [] })),
    })
    await prisma.integrationGrant.createMany({
      data: clientIds.map((clientId) => ({
        userId: user.id,
        workspaceId: workspace.id,
        clientId,
        scopes: ['mcp:read'],
        modules: ['CRM' as const],
      })),
    })
    const later = new Date(Date.now() + 60_000)
    const first = expectOk(
      await IntegrationGrantRepository.listWithoutLiveTokens(
        { updatedBefore: later },
        new Date(),
      ),
    )
    expect(first.dead).toHaveLength(LIVENESS_BATCH)
    expect(first.nextCursor).toBe(first.dead.at(-1)?.id)
    const second = expectOk(
      await IntegrationGrantRepository.listWithoutLiveTokens(
        { updatedBefore: later },
        new Date(),
        first.nextCursor as string,
      ),
    )
    expect(second.dead).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
  })

  it('returns DATABASE_ERROR when prisma throws', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.integrationGrant, 'findUnique').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.integrationGrant, 'findFirst').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.integrationGrant, 'findMany').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.integrationGrant, 'updateMany').mockRejectedValueOnce(boom)
    expectErr(await IntegrationGrantRepository.findById('x'), 'DATABASE_ERROR')
    expectErr(
      await IntegrationGrantRepository.findActive('u', 'c', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await IntegrationGrantRepository.listActiveByUser('u'),
      'DATABASE_ERROR',
    )
    expectErr(
      await IntegrationGrantRepository.touchLastUsed('x', new Date(), 1),
      'DATABASE_ERROR',
    )
    expectErr(
      await IntegrationGrantRepository.updateConsent('missing', {
        scopes: [],
        modules: [],
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await IntegrationGrantRepository.delete('missing'),
      'DATABASE_ERROR',
    )
    expectErr(
      await IntegrationGrantRepository.revoke('missing', new Date()),
      'DATABASE_ERROR',
    )

    vi.spyOn(prisma.integrationGrant, 'findMany').mockRejectedValueOnce(boom)
    expectErr(
      await IntegrationGrantRepository.listWithoutLiveTokens(
        { ids: ['x'] },
        new Date(),
      ),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.integrationGrant, 'findMany').mockRejectedValueOnce(boom)
    expectErr(
      await IntegrationGrantRepository.listActiveByWorkspace('w'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.integrationGrant, 'findMany').mockRejectedValueOnce(boom)
    expectErr(
      await IntegrationGrantRepository.listActiveIdsByWorkspace('w', {
        userId: 'u',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(boom)
    expectErr(
      await IntegrationGrantRepository.revokeMany(['x'], new Date()),
      'DATABASE_ERROR',
    )
  })
})
