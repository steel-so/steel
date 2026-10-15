import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

/** Pipeline with a WON stage, a won deal today and a lead with contacts. */
async function seedSales(workspaceId: string, ownerId: string) {
  const pipeline = await prisma.crmPipeline.create({
    data: {
      name: 'Vendas',
      workspaceId,
      createdById: ownerId,
      isDefault: true,
    },
  })
  const [open, won] = await Promise.all([
    prisma.crmPipelineStage.create({
      data: {
        name: 'Proposta',
        pipelineId: pipeline.id,
        probability: 50,
        position: 0,
      },
    }),
    prisma.crmPipelineStage.create({
      data: {
        name: 'Ganho',
        pipelineId: pipeline.id,
        category: 'WON',
        probability: 100,
        position: 1,
      },
    }),
  ])
  const company = await prisma.crmCompany.create({
    data: { name: 'Empresa X', workspaceId, createdById: ownerId },
  })
  await prisma.crmOpportunity.create({
    data: {
      name: 'Renovação anual',
      amount: 18_400,
      workspaceId,
      createdById: ownerId,
      ownerId,
      pipelineId: pipeline.id,
      stageId: won.id,
      companyId: company.id,
      wonAt: new Date(),
    },
  })
  await prisma.crmOpportunity.create({
    data: {
      name: 'Expansão',
      amount: 10_000,
      workspaceId,
      createdById: ownerId,
      ownerId,
      pipelineId: pipeline.id,
      stageId: open.id,
    },
  })
  await prisma.crmLead.create({
    data: {
      name: 'Carlos Lima',
      emails: ['carlos@cliente.com.br'],
      phones: ['+5511999990000'],
      source: 'Site',
      workspaceId,
      createdById: ownerId,
    },
  })
}

describe('CRM sales TV', () => {
  it('serves the "Vendas — TV" dashboard through a revocable token link', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedSales(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/crm`

    // One-click template.
    const created = await postJson(
      `${base}/dashboards/templates`,
      { template: 'sales-tv' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const dashboard = (await created.json()).data
    expect(dashboard.title).toBe('Vendas — TV')
    expect(dashboard.settings.pages).toHaveLength(2)

    const widgetsRes = await getJson(
      `${base}/dashboards/${dashboard.id}/widgets`,
      user.cookie,
    )
    const widgets = (await widgetsRes.json()).data as {
      id: string
      type: string
      config: { kind?: string }
    }[]
    expect(widgets).toHaveLength(10)
    const goalWidget = widgets.find((w) => w.config.kind === 'goal')
    expect(goalWidget).toBeTruthy()

    // A table of leads on the same dashboard (contact data must not leak).
    const leadsWidget = await postJson(
      `${base}/dashboards/${dashboard.id}/widgets`,
      {
        type: 'VIEW',
        config: { source: 'leads', fields: ['name', 'emails'] },
        page: 1,
      },
      user.cookie,
    )
    expect(leadsWidget.status).toBe(201)
    const leadsWidgetId = (await leadsWidget.json()).data.id

    // Metrics for the logged-in editor.
    const goal = await getJson(`${base}/sales-metrics?kind=goal`, user.cookie)
    expect(goal.status).toBe(200)
    const goalBody = (await goal.json()).data
    expect(goalBody).toMatchObject({
      kind: 'goal',
      wonAmount: 18_400,
      targetAmount: null,
    })
    const badQuery = await getJson(
      `${base}/sales-metrics?kind=nope`,
      user.cookie,
    )
    expect(badQuery.status).toBe(422)

    const lookups = await getJson(`${base}/dashboards/lookups`, user.cookie)
    expect(lookups.status).toBe(200)
    expect((await lookups.json()).data.stages).toHaveLength(2)

    // Only owners and admins publish a TV link.
    const member = await addMember(workspace.id, 'MEMBER')
    const denied = await postJson(
      `${base}/dashboards/${dashboard.id}/tv-links`,
      { name: 'TV' },
      member.cookie,
    )
    expect(denied.status).toBe(403)

    const linkRes = await postJson(
      `${base}/dashboards/${dashboard.id}/tv-links`,
      { name: 'TV da sala de vendas' },
      user.cookie,
    )
    expect(linkRes.status).toBe(201)
    const link = (await linkRes.json()).data
    expect(link.path).toMatch(/^\/tv\/[A-Za-z0-9_-]{32}$/)
    const token = link.path.slice('/tv/'.length)

    const listed = await getJson(
      `${base}/dashboards/${dashboard.id}/tv-links`,
      user.cookie,
    )
    expect((await listed.json()).data).toHaveLength(1)

    // No session: the token is the credential.
    const boot = await getJson(`/api/crm/tv/${token}`)
    expect(boot.status).toBe(200)
    const bootBody = (await boot.json()).data
    expect(bootBody.dashboard.title).toBe('Vendas — TV')
    expect(bootBody.widgets).toHaveLength(11)
    expect(bootBody.timeZone).toBe('America/Sao_Paulo')

    const goalData = await getJson(
      `/api/crm/tv/${token}/widgets/${goalWidget?.id}`,
    )
    expect(goalData.status).toBe(200)
    expect((await goalData.json()).data).toMatchObject({
      type: 'SALES',
      metric: { kind: 'goal', wonAmount: 18_400 },
    })

    const rows = await getJson(`/api/crm/tv/${token}/widgets/${leadsWidgetId}`)
    const rowsBody = (await rows.json()).data
    expect(rowsBody.type).toBe('ROWS')
    expect(rowsBody.rows[0].name).toBe('Carlos Lima')
    expect(JSON.stringify(rowsBody)).not.toContain('carlos@cliente.com.br')
    expect(JSON.stringify(rowsBody)).not.toContain('+5511999990000')

    const wins = await getJson(`/api/crm/tv/${token}/wins`)
    const winsBody = (await wins.json()).data
    expect(winsBody.rows[0]).toMatchObject({
      opportunityName: 'Renovação anual',
      companyName: 'Empresa X',
      amount: 18_400,
    })

    const page = await getJson(`/tv/${token}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('crm-dashboard-tv')

    // Revoking cuts the screen.
    const revoked = await deleteJson(
      `${base}/dashboards/${dashboard.id}/tv-links/${link.id}`,
      user.cookie,
    )
    expect(revoked.status).toBe(200)
    const gone = await getJson(`/api/crm/tv/${token}`)
    expect(gone.status).toBe(404)
    expect((await gone.json()).error.code).toBe('CRM_TV_LINK_NOT_FOUND')
    expect((await getJson(`/api/crm/tv/${token}/wins`)).status).toBe(404)
    // The streamed page may answer 200 with the not-found UI: check the body.
    const goneHtml = await (await getJson(`/tv/${token}`)).text()
    expect(goneHtml).not.toContain('crm-dashboard-tv')
  })

  it('answers 404 for an unknown token and 401 for workspace routes without a session', async () => {
    expect((await getJson('/api/crm/tv/not-a-real-token')).status).toBe(404)
    const { workspace } = await authenticatedOwner()
    expect(
      (
        await getJson(
          `/api/workspaces/${workspace.id}/crm/sales-metrics?kind=goal`,
        )
      ).status,
    ).toBe(401)
  })
})
