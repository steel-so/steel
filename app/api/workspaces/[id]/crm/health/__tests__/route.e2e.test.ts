import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

async function seedFunnel(workspaceId: string, cookie: string) {
  const pipeline = await (
    await postJson(
      `/api/workspaces/${workspaceId}/crm/pipelines`,
      { name: 'Vendas' },
      cookie,
    )
  ).json()
  const stage = await (
    await postJson(
      `/api/workspaces/${workspaceId}/crm/pipelines/${pipeline.data.id}/stages`,
      { name: 'Novo' },
      cookie,
    )
  ).json()
  return { pipelineId: pipeline.data.id, stageId: stage.data.id }
}

describe('GET /api/workspaces/[id]/crm/health/companies', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/some-id/crm/health/companies`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('should return 403 when the user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()

    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/health/companies`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should return 422 for an unknown level', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/health/companies?level=EXTREME`,
      user.cookie,
    )
    expect(res.status).toBe(422)
  })
})

describe('customer health lifecycle', () => {
  it('should compute on first look, recompute and rank the company', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm`

    const created = await postJson(
      `${base}/companies`,
      { name: 'Acme Ltda' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const company = (await created.json()).data

    const first = await getJson(
      `${base}/health/companies/${company.id}`,
      user.cookie,
    )
    expect(first.status).toBe(200)
    const health = (await first.json()).data
    expect(health).toMatchObject({
      companyId: company.id,
      companyName: 'Acme Ltda',
    })
    expect(health.riskScore + health.healthScore).toBe(100)
    expect(health.nextAction.label).toBeTruthy()

    const again = await postJson(
      `${base}/health/companies/${company.id}`,
      {},
      user.cookie,
    )
    expect(again.status).toBe(200)
    expect((await again.json()).data.riskDelta).toBe(0)

    const ranking = await getJson(
      `${base}/health/companies?limit=10`,
      user.cookie,
    )
    expect(ranking.status).toBe(200)
    expect(
      (await ranking.json()).data.map(
        (r: { companyId: string }) => r.companyId,
      ),
    ).toContain(company.id)

    const missing = await getJson(`${base}/health/companies/nope`, user.cookie)
    expect(missing.status).toBe(404)
  })

  it('should not let a viewer recompute', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm`
    const company = (
      await (
        await postJson(`${base}/companies`, { name: 'Beta SA' }, user.cookie)
      ).json()
    ).data
    const viewer = await addMember(workspace.id, 'VIEWER')

    const read = await getJson(
      `${base}/health/companies/${company.id}`,
      viewer.cookie,
    )
    expect(read.status).toBe(200)
    const write = await postJson(
      `${base}/health/companies/${company.id}`,
      {},
      viewer.cookie,
    )
    expect(write.status).toBe(403)
  })
})

describe('opportunity health lifecycle', () => {
  it('should score an open deal, list it for the board and recompute', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm`

    const funnel = await seedFunnel(workspace.id, user.cookie)
    const created = await postJson(
      `${base}/opportunities`,
      { name: 'Renovação anual', ...funnel },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const deal = (await created.json()).data

    const got = await getJson(
      `${base}/health/opportunities/${deal.id}`,
      user.cookie,
    )
    expect(got.status).toBe(200)
    const health = (await got.json()).data
    expect(health).toMatchObject({
      opportunityId: deal.id,
      opportunityName: 'Renovação anual',
    })
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(health.level)

    const board = await getJson(
      `${base}/health/opportunities?pipelineId=${deal.pipelineId}`,
      user.cookie,
    )
    expect(board.status).toBe(200)
    expect((await board.json()).data).toHaveLength(1)

    const recomputed = await postJson(
      `${base}/health/opportunities/${deal.id}`,
      {},
      user.cookie,
    )
    expect(recomputed.status).toBe(200)

    const missing = await getJson(
      `${base}/health/opportunities/nope`,
      user.cookie,
    )
    expect(missing.status).toBe(404)
  })

  it('should return 422 for a bad board filter', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/health/opportunities?limit=0`,
      user.cookie,
    )
    expect(res.status).toBe(422)
  })
})
