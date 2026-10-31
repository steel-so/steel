import { describe, expect, it } from 'vitest'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-config-item.factory'
import {
  seedSdDepartment,
  seedSdDepartmentMember,
  seedSdSettings,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const sd = (workspaceId: string, path: string) =>
  `/api/workspaces/${workspaceId}/servicedesk/remote/${path}`

async function setup() {
  const { user: owner, workspace } = await authenticatedOwner()
  await seedSdSettings(workspace.id)
  const department = await seedSdDepartment(workspace.id)
  await seedSdDepartmentMember(department.id, owner.id)
  const requester = await addMember(workspace.id)
  const item = await seedSdConfigItem(workspace.id, owner.id)
  return { owner, workspace, requester, item }
}

describe('ServiceDesk remote access', () => {
  it('returns 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}${sd('x', 'settings')}`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('is agent-only: requester and stranger are refused', async () => {
    const { workspace, requester, item } = await setup()
    const stranger = await createAuthenticatedUser()

    expect(
      (await getJson(sd(workspace.id, 'settings'), stranger.cookie)).status,
    ).toBe(403)
    const res = await postJson(
      sd(workspace.id, 'connect'),
      { configItemId: item.id },
      requester.cookie,
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('SD_NOT_AGENT')
  })

  it('walks settings -> id -> connect -> sessions', async () => {
    const { owner, workspace, item } = await setup()
    const cookie = owner.cookie

    const defaults = await (
      await getJson(sd(workspace.id, 'settings'), cookie)
    ).json()
    expect(defaults.data).toMatchObject({
      enabled: false,
      provider: 'RUSTDESK',
    })

    // Off by default: connecting is refused.
    const off = await postJson(
      sd(workspace.id, 'connect'),
      { configItemId: item.id },
      cookie,
    )
    expect(off.status).toBe(409)
    expect((await off.json()).error.code).toBe('SD_REMOTE_DISABLED')

    expect(
      (await patchJson(sd(workspace.id, 'settings'), { enabled: true }, cookie))
        .status,
    ).toBe(200)

    // No id yet.
    const missing = await postJson(
      sd(workspace.id, 'connect'),
      { configItemId: item.id },
      cookie,
    )
    expect((await missing.json()).error.code).toBe(
      'SD_REMOTE_ENDPOINT_NOT_FOUND',
    )

    // Pasted ids are normalized; passwords/garbage are refused.
    const bad = await putJson(
      sd(workspace.id, 'endpoints'),
      { configItemId: item.id, provider: 'RUSTDESK', remoteId: 'a b;c' },
      cookie,
    )
    expect(bad.status).toBe(400)
    const saved = await putJson(
      sd(workspace.id, 'endpoints'),
      { configItemId: item.id, provider: 'RUSTDESK', remoteId: '123 456 789' },
      cookie,
    )
    expect(saved.status).toBe(200)
    const endpoint = (await saved.json()).data
    expect(endpoint.remoteId).toBe('123456789')

    const connected = await postJson(
      sd(workspace.id, 'connect'),
      { configItemId: item.id },
      cookie,
    )
    expect(connected.status).toBe(200)
    expect((await connected.json()).data.link).toBe(
      'rustdesk://connection/new/123456789',
    )

    const sessions = await (
      await getJson(
        `${sd(workspace.id, 'sessions')}?configItemId=${item.id}`,
        cookie,
      )
    ).json()
    expect(sessions.data).toHaveLength(1)
    expect(
      await prisma.sdRemoteSession.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(1)

    expect(
      (await deleteJson(sd(workspace.id, `endpoints/${endpoint.id}`), cookie))
        .status,
    ).toBe(200)
  })

  it('does not reach an asset from another workspace', async () => {
    const { owner, workspace } = await setup()
    const other = await setup()
    await patchJson(
      sd(workspace.id, 'settings'),
      { enabled: true },
      owner.cookie,
    )
    const res = await postJson(
      sd(workspace.id, 'connect'),
      { configItemId: other.item.id },
      owner.cookie,
    )
    expect(res.status).toBe(404)
  })
})
