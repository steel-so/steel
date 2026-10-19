import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

// Never reaches the real Apollo API: no key is ever connected here.
describe('Apollo import routes /api/workspaces/[id]/crm/apollo', () => {
  it('should report not connected and list no imports', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/apollo`

    const integration = await getJson(`${base}/integration`, user.cookie)
    expect(integration.status).toBe(200)
    expect((await integration.json()).data.connected).toBe(false)

    const imports = await getJson(`${base}/imports`, user.cookie)
    expect(imports.status).toBe(200)
    expect((await imports.json()).data).toEqual([])
  })

  it('should answer 409 on search and import without a connected key', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/apollo`

    const search = await postJson(
      `${base}/search`,
      { filters: { personTitles: ['CTO'] } },
      user.cookie,
    )
    expect(search.status).toBe(409)
    expect((await search.json()).error.code).toBe('CRM_APOLLO_NOT_CONNECTED')

    const created = await postJson(
      `${base}/imports`,
      { source: 'SEARCH', filters: {}, apolloIds: ['a1'] },
      user.cookie,
    )
    expect(created.status).toBe(409)
  })

  it('should validate the body and reject anonymous calls', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/apollo`

    const invalid = await postJson(
      `${base}/imports`,
      { source: 'SEARCH' },
      user.cookie,
    )
    expect(invalid.status).toBe(422)

    const anonymous = await fetch(`${BASE_URL}${base}/integration`, {
      headers: defaultHeaders,
    })
    expect(anonymous.status).toBe(401)
  })
})
