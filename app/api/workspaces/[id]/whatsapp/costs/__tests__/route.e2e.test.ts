import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'
import { currentMonthRange } from '@/src/lib/whatsapp/cost'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

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

describe('/api/workspaces/[id]/whatsapp/costs', () => {
  it('should forbid money endpoints to plain members and admins-only roles stay in', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const admin = await addMember(workspace.id, 'ADMIN')
    const base = `/api/workspaces/${workspace.id}/whatsapp/costs`

    for (const path of ['', '/export', '/prices', '/settings']) {
      expect((await getJson(`${base}${path}`, member.cookie)).status).toBe(403)
      expect((await getJson(`${base}${path}`, admin.cookie)).status).toBe(200)
      expect((await getJson(`${base}${path}`, user.cookie)).status).toBe(200)
    }
  })

  it('should return an empty report with both providers side by side', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedConnection(workspace.id, user.id, 'ZAPI')
    const { from, to } = currentMonthRange()

    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/costs?from=${from}&to=${to}`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.totals.messages).toBe(0)
    expect(
      data.byProvider.map((p: { provider: string }) => p.provider),
    ).toEqual(['META', 'ZAPI'])
    expect(data.budget.monthlyCostBudget).toBeNull()
  })

  it('should reject an invalid range', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/costs?from=2026-10-10&to=2026-10-01`,
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should seed the reference prices, add one and delete it', async () => {
    const { user, workspace } = await authenticatedOwner()
    const url = `/api/workspaces/${workspace.id}/whatsapp/costs/prices`

    const list = (await (await getJson(url, user.cookie)).json()).data
    expect(list).toHaveLength(3)
    expect(list.every((p: { reference: boolean }) => p.reference)).toBe(true)

    const created = await postJson(
      url,
      { category: 'UTILITY', unitPrice: 0.07 },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const price = (await created.json()).data

    const removed = await deleteJson(`${url}/${price.id}`, user.cookie)
    expect(removed.status).toBe(200)
    const again = await deleteJson(`${url}/${price.id}`, user.cookie)
    expect(again.status).toBe(404)
    expect((await again.json()).error.code).toBe('WHATSAPP_PRICE_NOT_FOUND')
  })

  it('should save a Marketing Messages Lite price only for MARKETING', async () => {
    const { user, workspace } = await authenticatedOwner()
    const url = `/api/workspaces/${workspace.id}/whatsapp/costs/prices`

    const created = await postJson(
      url,
      { category: 'MARKETING', unitPrice: 0.4, liteUnitPrice: 0.35 },
      user.cookie,
    )
    expect(created.status).toBe(201)
    expect((await created.json()).data.liteUnitPrice).toBe(0.35)

    const refused = await postJson(
      url,
      { category: 'UTILITY', unitPrice: 0.04, liteUnitPrice: 0.03 },
      user.cookie,
    )
    expect(refused.status).toBe(422)
  })

  it('should reject an invalid price', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/costs/prices`,
      { category: 'SERVICE', unitPrice: 1 },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should save the budget and a monthly fee, and refuse a foreign connection', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const zapi = await seedConnection(workspace.id, user.id, 'ZAPI')
    const foreign = await seedConnection(
      other.workspace.id,
      other.user.id,
      'ZAPI',
    )
    const url = `/api/workspaces/${workspace.id}/whatsapp/costs/settings`

    const saved = await patchJson(
      url,
      {
        monthlyCostBudget: 500,
        connectionFees: [{ connectionId: zapi.id, monthlyFee: 199.9 }],
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    const data = (await saved.json()).data
    expect(data.monthlyCostBudget).toBe(500)
    expect(data.connections[0].monthlyFee).toBe(199.9)

    const refused = await patchJson(
      url,
      { connectionFees: [{ connectionId: foreign.id, monthlyFee: 1 }] },
      user.cookie,
    )
    expect(refused.status).toBe(404)
  })

  it('should export a CSV attachment', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/costs/export`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('custos-whatsapp-')
    expect(await res.text()).toContain('Seção;Item;Mensagens')
  })
})
