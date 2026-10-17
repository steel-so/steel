import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

async function seedGrant(userId: string, workspaceId: string) {
  const client = await prisma.oauthClient.create({
    data: {
      clientId: `e2e-client-${Date.now()}-${Math.random()}`,
      name: 'Cursor',
      redirectUris: ['http://127.0.0.1:1/cb'],
    },
  })
  return prisma.integrationGrant.create({
    data: {
      userId,
      workspaceId,
      clientId: client.clientId,
      scopes: ['mcp:read', 'mcp:write'],
      modules: ['SERVICE_DESK'],
    },
  })
}

describe('/api/users/me/integration-grants', () => {
  it('requires a session', async () => {
    const res = await fetch(`${BASE_URL}/api/users/me/integration-grants`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('lists only the user own active grants', async () => {
    const { user, workspace } = await authenticatedOwner()
    const mine = await seedGrant(user.id, workspace.id)
    const other = await createAuthenticatedUser()
    await prisma.membership.create({
      data: { userId: other.id, workspaceId: workspace.id, role: 'MEMBER' },
    })
    await seedGrant(other.id, workspace.id)

    const res = await fetch(`${BASE_URL}/api/users/me/integration-grants`, {
      headers: { ...defaultHeaders, Cookie: user.cookie },
    })
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.map((g: { id: string }) => g.id)).toEqual([mine.id])
    expect(data[0]).toMatchObject({
      client: { name: 'Cursor' },
      scopes: ['mcp:read', 'mcp:write'],
      modules: ['SERVICE_DESK'],
      lastUsedAt: null,
    })
  })

  it("never revokes someone else's grant", async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await createAuthenticatedUser()
    await prisma.membership.create({
      data: { userId: other.id, workspaceId: workspace.id, role: 'MEMBER' },
    })
    const theirs = await seedGrant(other.id, workspace.id)

    const res = await fetch(
      `${BASE_URL}/api/users/me/integration-grants/${theirs.id}`,
      { method: 'DELETE', headers: { ...defaultHeaders, Cookie: user.cookie } },
    )
    expect(res.status).toBe(404)
    expect(
      (await prisma.integrationGrant.findUnique({ where: { id: theirs.id } }))
        ?.revokedAt,
    ).toBeNull()
  })
})
