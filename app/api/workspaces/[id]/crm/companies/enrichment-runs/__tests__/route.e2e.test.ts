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

// Never reaches BrasilAPI: every request here fails validation or has no CNPJ.
describe('CNPJ enrichment routes /api/workspaces/[id]/crm/companies', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/some-id/crm/companies/enrichment-runs`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('should return 403 for a stranger', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/companies/cnpj-lookup`,
      { cnpj: '11222333000181' },
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should reject a CNPJ with bad check digits', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/companies/cnpj-lookup`,
      { cnpj: '11222333000182' },
      user.cookie,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('CRM_CNPJ_INVALID')
  })

  it('should return null enrichment and reject enriching a company without CNPJ', async () => {
    const { user, workspace } = await authenticatedOwner()
    const created = await postJson(
      `/api/workspaces/${workspace.id}/crm/companies`,
      { name: 'Sem CNPJ' },
      user.cookie,
    )
    const companyId = (await created.json()).data.id
    const base = `/api/workspaces/${workspace.id}/crm/companies/${companyId}/enrichment`

    const read = await getJson(base, user.cookie)
    expect(read.status).toBe(200)
    expect((await read.json()).data).toBeNull()

    const enrich = await postJson(base, {}, user.cookie)
    expect(enrich.status).toBe(422)
    expect((await enrich.json()).error.code).toBe('CRM_CNPJ_INVALID')
  })

  it('should 404 the enrichment of an unknown company', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/companies/nope/enrichment`,
      user.cookie,
    )
    expect(res.status).toBe(404)
  })

  it('should queue a bulk run for an admin and refuse a second one', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/companies/enrichment-runs`

    const empty = await getJson(base, user.cookie)
    expect((await empty.json()).data).toEqual([])

    const started = await postJson(base, {}, user.cookie)
    expect(started.status).toBe(202)
    const run = (await started.json()).data
    expect(run).toMatchObject({ onlyMissing: true, overwrite: false, total: 0 })

    const detail = await getJson(`${base}/${run.id}`, user.cookie)
    expect(detail.status).toBe(200)

    const missing = await getJson(`${base}/nope`, user.cookie)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe('CRM_CNPJ_RUN_NOT_FOUND')
  })

  it('should cancel a queued run and refuse to cancel it again', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/companies/enrichment-runs`
    const run = (await (await postJson(base, {}, user.cookie)).json()).data

    const canceled = await postJson(`${base}/${run.id}/cancel`, {}, user.cookie)
    expect(canceled.status).toBe(200)
    expect((await canceled.json()).data.status).toBe('CANCELED')

    const again = await postJson(`${base}/${run.id}/cancel`, {}, user.cookie)
    expect(again.status).toBe(409)
    expect((await again.json()).error.code).toBe('CRM_CNPJ_RUN_NOT_CANCELABLE')

    const missing = await postJson(`${base}/nope/cancel`, {}, user.cookie)
    expect(missing.status).toBe(404)
  })

  it('should forbid a MEMBER from canceling a bulk run', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/companies/enrichment-runs/any/cancel`,
      {},
      member.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should forbid a MEMBER from starting a bulk run', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/companies/enrichment-runs`,
      {},
      member.cookie,
    )
    expect(res.status).toBe(403)
  })
})
