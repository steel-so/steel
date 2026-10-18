import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { hashApiToken } from '@/src/lib/api/token'
import { prisma } from '@/src/lib/prisma'

/** Ajustes › Segurança › Tokens de API (ADR 0035). */

const BASE = '/api/users/me/api-tokens'

function body(workspaceId: string, patch: Record<string, unknown> = {}) {
  return {
    name: 'GitHub Actions',
    workspaceId,
    scopes: ['api:read'],
    modules: ['SERVICE_DESK'],
    ...patch,
  }
}

describe('/api/users/me/api-tokens', () => {
  it('requires a session', async () => {
    expect((await getJson(BASE)).status).toBe(401)
    expect((await postJson(BASE, {})).status).toBe(401)
  })

  it('creates a token, shows the value once and stores only its hash', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      BASE,
      body(workspace.id, { expiresInDays: 7 }),
      user.cookie,
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const { data } = await res.json()
    expect(data).toMatchObject({
      name: 'GitHub Actions',
      workspace: { id: workspace.id },
      scopes: ['api:read'],
      modules: ['SERVICE_DESK'],
      createdVia: 'SETTINGS',
      expired: false,
    })
    expect(data.token).toMatch(/^stl_pat_[A-Za-z0-9_-]{43}$/)
    expect(data.prefix).toBe(data.token.slice(0, 16))

    const row = await prisma.apiToken.findUnique({ where: { id: data.id } })
    expect(row?.tokenHash).toBe(hashApiToken(data.token))
    expect(JSON.stringify(row)).not.toContain(data.token)

    const list = await getJson(BASE, user.cookie)
    expect(list.status).toBe(200)
    const listed = (await list.json()).data
    expect(listed.map((t: { id: string }) => t.id)).toEqual([data.id])
    expect(listed[0]).not.toHaveProperty('token')
  })

  it('lists the workspaces a token may be created for', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(`${BASE}/workspaces`, user.cookie)
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toEqual([
      {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
      },
    ])
  })

  it('validates the input', async () => {
    const { user, workspace } = await authenticatedOwner()
    for (const patch of [
      { scopes: ['api:write'] },
      { modules: [] },
      { expiresInDays: 366 },
      { name: '' },
    ]) {
      const res = await postJson(BASE, body(workspace.id, patch), user.cookie)
      expect(res.status).toBe(422)
    }
  })

  it("refuses a workspace the user doesn't belong to", async () => {
    const { user } = await authenticatedOwner()
    const { workspace: foreign } = await authenticatedOwner()
    const res = await postJson(BASE, body(foreign.id), user.cookie)
    expect(res.status).toBe(403)
  })

  it('revokes an own token, once', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = (
      await (await postJson(BASE, body(workspace.id), user.cookie)).json()
    ).data

    const res = await deleteJson(`${BASE}/${created.id}`, user.cookie)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ id: created.id })
    expect(
      (await prisma.apiToken.findUnique({ where: { id: created.id } }))
        ?.revokedAt,
    ).not.toBeNull()
    expect((await (await getJson(BASE, user.cookie)).json()).data).toEqual([])

    const again = await deleteJson(`${BASE}/${created.id}`, user.cookie)
    expect(again.status).toBe(404)
    expect((await again.json()).error.code).toBe('API_TOKEN_NOT_FOUND')
  })

  it("never revokes someone else's token", async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const theirs = (
      await (await postJson(BASE, body(workspace.id), member.cookie)).json()
    ).data

    const res = await deleteJson(`${BASE}/${theirs.id}`, user.cookie)
    expect(res.status).toBe(404)
    expect(
      (await prisma.apiToken.findUnique({ where: { id: theirs.id } }))
        ?.revokedAt,
    ).toBeNull()
  })
})
