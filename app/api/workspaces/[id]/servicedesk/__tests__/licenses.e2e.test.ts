import { describe, expect, it } from 'vitest'
import { seedSdInventoryDevice } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
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
  `/api/workspaces/${workspaceId}/servicedesk/${path}`

async function setup() {
  const { user: owner, workspace } = await authenticatedOwner()
  await seedSdSettings(workspace.id)
  const agent = await addMember(workspace.id)
  const department = await seedSdDepartment(workspace.id)
  await seedSdDepartmentMember(department.id, agent.id)
  const requester = await addMember(workspace.id)
  return { owner, agent, requester, workspace }
}

const body = {
  name: 'Microsoft Office',
  matchPattern: 'Office',
  seats: 1,
  expiresAt: '2027-01-10',
}

describe('ServiceDesk software licenses', () => {
  it('returns 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}${sd('x', 'licenses')}`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('refuses strangers and requesters', async () => {
    const { workspace, requester } = await setup()
    const stranger = await createAuthenticatedUser()
    expect(
      (await getJson(sd(workspace.id, 'licenses'), stranger.cookie)).status,
    ).toBe(403)
    const res = await getJson(sd(workspace.id, 'licenses'), requester.cookie)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('SD_NOT_AGENT')
  })

  it('lets only admins write, and agents read', async () => {
    const { owner, agent, workspace } = await setup()
    expect(
      (await postJson(sd(workspace.id, 'licenses'), body, agent.cookie)).status,
    ).toBe(403)

    const created = await postJson(
      sd(workspace.id, 'licenses'),
      body,
      owner.cookie,
    )
    expect(created.status).toBe(201)
    const license = (await created.json()).data

    const device = await seedSdInventoryDevice({
      workspaceId: workspace.id,
      hostname: 'PC-01',
    })
    await prisma.sdInventorySoftware.create({
      data: { deviceId: device.id, name: 'Microsoft Office', version: '16' },
    })
    await seedSdInventoryDevice({
      workspaceId: workspace.id,
      hostname: 'PC-02',
    }).then((d) =>
      prisma.sdInventorySoftware.create({
        data: { deviceId: d.id, name: 'MS Office 2019', version: '' },
      }),
    )

    const list = await getJson(sd(workspace.id, 'licenses'), agent.cookie)
    expect(list.status).toBe(200)
    const listed = (await list.json()).data
    expect(listed.items[0]).toMatchObject({ installed: 2, balance: -1 })
    expect(listed.items[0].status).toMatch(/UNDER_LICENSED|EXPIRED/)
    expect(listed.summary.total).toBe(1)

    const detail = await getJson(
      sd(workspace.id, `licenses/${license.id}`),
      agent.cookie,
    )
    expect((await detail.json()).data.devices).toHaveLength(2)

    const patched = await patchJson(
      sd(workspace.id, `licenses/${license.id}`),
      { seats: 5 },
      owner.cookie,
    )
    expect((await patched.json()).data.balance).toBe(3)
    expect(
      (
        await patchJson(
          sd(workspace.id, `licenses/${license.id}`),
          { seats: 5 },
          agent.cookie,
        )
      ).status,
    ).toBe(403)
  })

  it('validates the body', async () => {
    const { owner, workspace } = await setup()
    const res = await postJson(
      sd(workspace.id, 'licenses'),
      { ...body, seats: -3 },
      owner.cookie,
    )
    expect(res.status).toBe(400)
  })

  it('assigns assets, lists them per asset and archives', async () => {
    const { owner, agent, workspace } = await setup()
    const item = await seedSdConfigItem(workspace.id, owner.id, {
      name: 'PC-01',
    })
    const created = await postJson(
      sd(workspace.id, 'licenses'),
      body,
      owner.cookie,
    )
    const id = (await created.json()).data.id

    const assigned = await putJson(
      sd(workspace.id, `licenses/${id}/assets`),
      { configItemIds: [item.id] },
      owner.cookie,
    )
    expect((await assigned.json()).data.assetCount).toBe(1)
    const foreign = await putJson(
      sd(workspace.id, `licenses/${id}/assets`),
      { configItemIds: ['missing'] },
      owner.cookie,
    )
    expect(foreign.status).toBe(422)

    const perItem = await getJson(
      sd(workspace.id, `config-items/${item.id}/licenses`),
      agent.cookie,
    )
    expect((await perItem.json()).data).toHaveLength(1)

    expect(
      (await deleteJson(sd(workspace.id, `licenses/${id}`), owner.cookie))
        .status,
    ).toBe(200)
    const hidden = await getJson(sd(workspace.id, 'licenses'), agent.cookie)
    expect((await hidden.json()).data.items).toHaveLength(0)
    const restored = await postJson(
      sd(workspace.id, `licenses/${id}/restore`),
      {},
      owner.cookie,
    )
    expect(restored.status).toBe(200)
  })
})
