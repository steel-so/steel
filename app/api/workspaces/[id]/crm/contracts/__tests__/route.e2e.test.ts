import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const DAY = 86_400_000

async function seedFunnel(workspaceId: string, cookie: string) {
  const pipeline = await (
    await postJson(
      `/api/workspaces/${workspaceId}/crm/pipelines`,
      { name: 'Vendas', isDefault: true },
      cookie,
    )
  ).json()
  await postJson(
    `/api/workspaces/${workspaceId}/crm/pipelines/${pipeline.data.id}/stages`,
    { name: 'Renovação' },
    cookie,
  )
}

describe('contracts routes', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/some-id/crm/contracts`,
    )
    expect(res.status).toBe(401)
  })

  it('should return 422 for an invalid list query', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/contracts?status=NOPE`,
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should create, list, renew, edit and remove a contract', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm`
    await seedFunnel(workspace.id, user.cookie)
    const company = (
      await (
        await postJson(`${base}/companies`, { name: 'Acme Ltda' }, user.cookie)
      ).json()
    ).data

    const start = new Date(Date.now() - 300 * DAY).toISOString()
    const end = new Date(Date.now() + 20 * DAY).toISOString()
    const created = await postJson(
      `${base}/contracts`,
      {
        name: 'Plano anual',
        companyId: company.id,
        value: 12000,
        startDate: start,
        endDate: end,
      },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const contract = (await created.json()).data
    expect(contract).toMatchObject({
      companyName: 'Acme Ltda',
      value: 12000,
      renewalState: 'EXPIRING',
      status: 'ACTIVE',
    })

    const soon = await getJson(`${base}/contracts?endsWithinDays=30`, user.cookie)
    expect(
      (await soon.json()).data.map((c: { id: string }) => c.id),
    ).toContain(contract.id)

    const renewed = await postJson(
      `${base}/contracts/${contract.id}/renew`,
      {},
      user.cookie,
    )
    expect(renewed.status).toBe(201)
    expect((await renewed.json()).data.renewalOpportunityId).toBeTruthy()

    const again = await postJson(
      `${base}/contracts/${contract.id}/renew`,
      {},
      user.cookie,
    )
    expect(again.status).toBe(422)

    const edited = await patchJson(
      `${base}/contracts/${contract.id}`,
      { autoRenews: true },
      user.cookie,
    )
    expect(edited.status).toBe(200)
    expect((await edited.json()).data.autoRenews).toBe(true)

    const upsell = await getJson(
      `${base}/companies/${company.id}/upsell`,
      user.cookie,
    )
    expect(upsell.status).toBe(200)
    expect((await upsell.json()).data.timing).toBe('NEUTRAL')

    const removed = await deleteJson(
      `${base}/contracts/${contract.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    expect(
      (await getJson(`${base}/contracts/${contract.id}`, user.cookie)).status,
    ).toBe(404)
  })

  it('should reject an end date before the start', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm`
    const company = (
      await (
        await postJson(`${base}/companies`, { name: 'Beta' }, user.cookie)
      ).json()
    ).data
    const res = await postJson(
      `${base}/contracts`,
      {
        name: 'Errado',
        companyId: company.id,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
      },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should keep the scan and the settings for admins', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const base = `/api/workspaces/${workspace.id}/crm`

    expect((await postJson(`${base}/contracts/scan`, {}, member.cookie)).status).toBe(
      403,
    )
    expect(
      (await patchJson(`${base}/deals-settings`, { renewalLeadDays: 30 }, member.cookie))
        .status,
    ).toBe(403)
    expect((await getJson(`${base}/deals-settings`, member.cookie)).status).toBe(200)
  })

  it('should let an owner change the settings and run the scan', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm`

    const before = await (await getJson(`${base}/deals-settings`, user.cookie)).json()
    expect(before.data.proposalPaymentEnabled).toBe(false)

    const saved = await patchJson(
      `${base}/deals-settings`,
      { proposalPaymentEnabled: true, renewalLeadDays: 45 },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      proposalPaymentEnabled: true,
      renewalLeadDays: 45,
    })

    const scan = await postJson(`${base}/contracts/scan`, {}, user.cookie)
    expect(scan.status).toBe(200)
    expect((await scan.json()).data.workspaces).toBe(1)
  })
})
