import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

/** Ajustes › Apps conectados › Tokens de API (OWNER/ADMIN, ADR 0035). */

async function createToken(cookie: string, workspaceId: string) {
  const res = await postJson(
    '/api/users/me/api-tokens',
    {
      name: 'Script',
      workspaceId,
      scopes: ['api:read'],
      modules: ['CRM'],
    },
    cookie,
  )
  expect(res.status).toBe(201)
  return (await res.json()).data as { id: string }
}

describe('/api/workspaces/[id]/api-tokens', () => {
  it('lists every member token for the owner', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const theirs = await createToken(member.cookie, workspace.id)

    const res = await getJson(
      `/api/workspaces/${workspace.id}/api-tokens`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      id: theirs.id,
      user: { id: member.id, email: member.email },
      scopes: ['api:read'],
    })
    expect(data[0]).not.toHaveProperty('token')
  })

  it.each(['MEMBER', 'VIEWER'] as const)('refuses a %s', async (role) => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, role)
    const res = await getJson(
      `/api/workspaces/${workspace.id}/api-tokens`,
      member.cookie,
    )
    expect(res.status).toBe(403)
  })

  it("lets an admin revoke a member's token", async () => {
    const { workspace } = await authenticatedOwner()
    const admin = await addMember(workspace.id, 'ADMIN')
    const member = await addMember(workspace.id, 'MEMBER')
    const theirs = await createToken(member.cookie, workspace.id)

    const res = await deleteJson(
      `/api/workspaces/${workspace.id}/api-tokens/${theirs.id}`,
      admin.cookie,
    )
    expect(res.status).toBe(200)
    expect(
      (await prisma.apiToken.findUnique({ where: { id: theirs.id } }))
        ?.revokedAt,
    ).not.toBeNull()
  })

  it('never revokes a token of another workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const foreign = await createToken(other.user.cookie, other.workspace.id)

    const res = await deleteJson(
      `/api/workspaces/${workspace.id}/api-tokens/${foreign.id}`,
      user.cookie,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('API_TOKEN_NOT_FOUND')
    expect(
      (await prisma.apiToken.findUnique({ where: { id: foreign.id } }))
        ?.revokedAt,
    ).toBeNull()
  })
})
