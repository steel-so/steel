import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

// No Meta credentials: the page read fails locally (no network call) and the
// route answers with the ledger and `stale: true`.
async function seedConnection(
  workspaceId: string,
  userId: string,
  provider: 'META' | 'ZAPI',
) {
  return prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider,
      label: provider === 'META' ? 'Oficial' : 'Z-API',
      phoneNumber: `5511${suffix()}`,
      createdById: userId,
      ...(provider === 'ZAPI'
        ? { zapiInstanceId: `inst-${suffix()}`, encryptedZapiToken: 'enc' }
        : { metaPhoneNumberId: `pn-${suffix()}` }),
    },
  })
}

describe('/api/workspaces/[id]/whatsapp/costs/spend-caps', () => {
  it('should be restricted to OWNER/ADMIN', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const admin = await addMember(workspace.id, 'ADMIN')
    const url = `/api/workspaces/${workspace.id}/whatsapp/costs/spend-caps`

    expect((await getJson(url, member.cookie)).status).toBe(403)
    expect((await getJson(url, admin.cookie)).status).toBe(200)
    expect((await getJson(url, user.cookie)).status).toBe(200)
  })

  it('should list only Meta numbers, with the ledger while Meta is unread', async () => {
    const { user, workspace } = await authenticatedOwner()
    const meta = await seedConnection(workspace.id, user.id, 'META')
    await seedConnection(workspace.id, user.id, 'ZAPI')

    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/costs/spend-caps`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      connectionId: meta.id,
      source: 'STEEL_LEDGER',
      status: 'NO_CAP',
      monthlyCapAmount: null,
      spent: 0,
      stale: true,
    })
  })

  it('should set, read back and remove a BLOCK cap', async () => {
    const { user, workspace } = await authenticatedOwner()
    const meta = await seedConnection(workspace.id, user.id, 'META')
    const base = `/api/workspaces/${workspace.id}/whatsapp/costs/spend-caps`

    const saved = await putJson(
      `${base}/${meta.id}`,
      { monthlyCapAmount: 1500, capMode: 'BLOCK' },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      monthlyCapAmount: 1500,
      capMode: 'BLOCK',
      status: 'ALLOWED',
      percent: 0,
    })

    const listed = await getJson(`${base}?connectionId=${meta.id}`, user.cookie)
    expect((await listed.json()).data[0].monthlyCapAmount).toBe(1500)

    const removed = await putJson(
      `${base}/${meta.id}`,
      { monthlyCapAmount: null, capMode: 'WARN' },
      user.cookie,
    )
    expect(removed.status).toBe(200)
    expect((await removed.json()).data).toMatchObject({
      monthlyCapAmount: null,
      status: 'NO_CAP',
    })
  })

  it('should refuse a Z-API number, a foreign number and an invalid body', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const zapi = await seedConnection(workspace.id, user.id, 'ZAPI')
    const foreign = await seedConnection(
      other.workspace.id,
      other.user.id,
      'META',
    )
    const base = `/api/workspaces/${workspace.id}/whatsapp/costs/spend-caps`
    const body = { monthlyCapAmount: 1500, capMode: 'BLOCK' }

    const onZapi = await putJson(`${base}/${zapi.id}`, body, user.cookie)
    expect(onZapi.status).toBe(422)

    const onForeign = await putJson(`${base}/${foreign.id}`, body, user.cookie)
    expect(onForeign.status).toBe(404)

    const invalid = await putJson(
      `${base}/${zapi.id}`,
      { monthlyCapAmount: -1, capMode: 'NOPE' },
      user.cookie,
    )
    expect(invalid.status).toBe(422)
  })
})
