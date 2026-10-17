import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

async function seedClient(name: string) {
  return prisma.oauthClient.create({
    data: {
      clientId: `e2e-client-${createId()}`,
      name,
      redirectUris: ['http://127.0.0.1:1/cb'],
    },
  })
}

async function seedGrant(
  userId: string,
  workspaceId: string,
  clientId: string,
) {
  return prisma.integrationGrant.create({
    data: {
      userId,
      workspaceId,
      clientId,
      scopes: ['mcp:read'],
      modules: ['CRM'],
    },
  })
}

async function isRevoked(id: string) {
  const grant = await prisma.integrationGrant.findUnique({ where: { id } })
  return grant?.revokedAt != null
}

describe('/api/workspaces/[id]/integration-grants', () => {
  it('requires a session', async () => {
    const res = await getJson(
      `/api/workspaces/${createId()}/integration-grants`,
    )
    expect(res.status).toBe(401)
  })

  it("lists every member's grants for the owner, never for a member", async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const claude = await seedClient('Claude')
    const mine = await seedGrant(user.id, workspace.id, claude.clientId)
    const theirs = await seedGrant(member.id, workspace.id, claude.clientId)

    const res = await getJson(
      `/api/workspaces/${workspace.id}/integration-grants`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.grants.map((g: { id: string }) => g.id).sort()).toEqual(
      [mine.id, theirs.id].sort(),
    )
    expect(data.clients).toEqual([
      expect.objectContaining({
        client: expect.objectContaining({ name: 'Claude' }),
        members: 2,
        usage: { last7Days: 0, last30Days: 0 },
      }),
    ])

    const denied = await getJson(
      `/api/workspaces/${workspace.id}/integration-grants`,
      member.cookie,
    )
    expect(denied.status).toBe(403)
  })

  it('revokes one grant, all of a member and all of an app', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const claude = await seedClient('Claude')
    const cursor = await seedClient('Cursor')
    const one = await seedGrant(member.id, workspace.id, claude.clientId)
    const memberCursor = await seedGrant(
      member.id,
      workspace.id,
      cursor.clientId,
    )
    const ownerCursor = await seedGrant(user.id, workspace.id, cursor.clientId)
    const base = `/api/workspaces/${workspace.id}/integration-grants`

    const single = await deleteJson(`${base}/${one.id}`, user.cookie)
    expect(single.status).toBe(200)
    expect(await isRevoked(one.id)).toBe(true)
    expect(await isRevoked(memberCursor.id)).toBe(false)

    const again = await deleteJson(`${base}/${one.id}`, user.cookie)
    expect(again.status).toBe(404)

    const byMember = await deleteJson(
      `${base}/members/${member.id}`,
      user.cookie,
    )
    expect(byMember.status).toBe(200)
    expect((await byMember.json()).data).toEqual({ revoked: 1 })
    expect(await isRevoked(memberCursor.id)).toBe(true)
    expect(await isRevoked(ownerCursor.id)).toBe(false)

    const byClient = await deleteJson(
      `${base}/clients/${encodeURIComponent(cursor.clientId)}`,
      user.cookie,
    )
    expect(byClient.status).toBe(200)
    expect((await byClient.json()).data).toEqual({ revoked: 1 })
    expect(await isRevoked(ownerCursor.id)).toBe(true)
  })

  it('never reaches a grant of another workspace nor lets a member revoke', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const claude = await seedClient('Claude')
    const foreign = await seedGrant(
      other.user.id,
      other.workspace.id,
      claude.clientId,
    )
    const member = await addMember(workspace.id, 'MEMBER')
    const own = await seedGrant(user.id, workspace.id, claude.clientId)

    const cross = await deleteJson(
      `/api/workspaces/${workspace.id}/integration-grants/${foreign.id}`,
      user.cookie,
    )
    expect(cross.status).toBe(404)
    expect(await isRevoked(foreign.id)).toBe(false)

    const denied = await deleteJson(
      `/api/workspaces/${workspace.id}/integration-grants/clients/${encodeURIComponent(claude.clientId)}`,
      member.cookie,
    )
    expect(denied.status).toBe(403)
    expect(await isRevoked(own.id)).toBe(false)
  })
})
