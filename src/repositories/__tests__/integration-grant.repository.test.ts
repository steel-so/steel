import { describe, expect, it, vi } from 'vitest'
import {
  seedIntegrationGrant,
  seedOauthAccessToken,
  seedOauthClient,
} from '@/src/__tests__/factories/integration-grant.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { IntegrationGrantRepository } from '../integration-grant.repository'

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
      }),
    )
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
      }),
    )
    expect(updated.scopes).toEqual(['mcp:read', 'mcp:write'])
    expect(updated.modules).toEqual(['COMMUNICATION'])

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
