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

describe('/api/workspaces/[id]/whatsapp/ads', () => {
  it('should keep the money endpoints to OWNER and ADMIN', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const admin = await addMember(workspace.id, 'ADMIN')
    const base = `/api/workspaces/${workspace.id}/whatsapp/ads`

    for (const path of ['', '/export', '/settings', '/spends']) {
      expect((await getJson(`${base}${path}`, member.cookie)).status).toBe(403)
      expect((await getJson(`${base}${path}`, admin.cookie)).status).toBe(200)
      expect((await getJson(`${base}${path}`, user.cookie)).status).toBe(200)
    }
  })

  it('should start with the attribution off and an empty report', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/ads`

    const settings = (
      await (await getJson(`${base}/settings`, user.cookie)).json()
    ).data
    expect(settings).toMatchObject({ enabled: false, createLeads: false })

    const report = (await (await getJson(base, user.cookie)).json()).data
    expect(report.rows).toEqual([])
    expect(report.totals.roi).toBeNull()
  })

  it('should reject an invalid range', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/ads?from=2026-10-10&to=2026-10-01`,
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should save the settings and refuse an owner outside the workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/ads/settings`

    const res = await patchJson(
      base,
      { enabled: true, createLeads: true, leadSource: 'Meta Ads' },
      user.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      enabled: true,
      createLeads: true,
      leadSource: 'Meta Ads',
    })

    const stranger = await authenticatedOwner()
    const refused = await patchJson(
      base,
      { leadOwnerId: stranger.user.id },
      user.cookie,
    )
    expect(refused.status).toBe(403)
  })

  it('should add a spend, prorate it in the report and delete it', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/ads`

    const created = await postJson(
      `${base}/spends`,
      {
        sourceId: 'ad-e2e',
        label: 'Anúncio e2e',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-10',
        amount: 1000,
      },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const spend = (await created.json()).data

    const report = (
      await (
        await getJson(`${base}?from=2026-10-06&to=2026-10-31`, user.cookie)
      ).json()
    ).data
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ sourceId: 'ad-e2e', spend: 500 })

    const csv = await getJson(
      `${base}/export?from=2026-10-06&to=2026-10-31`,
      user.cookie,
    )
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('ad-e2e')

    expect(
      (await deleteJson(`${base}/spends/${spend.id}`, user.cookie)).status,
    ).toBe(200)
    expect(
      (await deleteJson(`${base}/spends/${spend.id}`, user.cookie)).status,
    ).toBe(404)
  })

  it('should reject an invalid spend', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/ads/spends`,
      {
        sourceId: 'ad',
        periodStart: '2026-10-10',
        periodEnd: '2026-10-01',
        amount: 10,
      },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should answer null for a conversation that did not come from an ad', async () => {
    const { user, workspace } = await authenticatedOwner()
    const connection = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: 'META',
        label: 'Oficial',
        phoneNumber: `5511${Date.now()}`,
        metaPhoneNumberId: `pn-${Date.now()}`,
        createdById: user.id,
      },
    })
    const contact = await prisma.whatsAppContact.create({
      data: { workspaceId: workspace.id, waId: `5511${Date.now()}` },
    })
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
      },
    })
    const path = `/api/workspaces/${workspace.id}/whatsapp/conversations/${conversation.id}/ad-referral`

    expect((await (await getJson(path, user.cookie)).json()).data).toBeNull()

    await prisma.whatsAppAdReferral.create({
      data: {
        workspaceId: workspace.id,
        contactId: contact.id,
        conversationId: conversation.id,
        providerMessageId: `wamid.${Date.now()}`,
        sourceType: 'ad',
        sourceId: 'ad-1',
        headline: 'Verão',
      },
    })
    expect(
      (await (await getJson(path, user.cookie)).json()).data,
    ).toMatchObject({ sourceId: 'ad-1', headline: 'Verão' })
  })
})
