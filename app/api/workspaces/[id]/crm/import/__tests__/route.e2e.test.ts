import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

describe('POST /api/workspaces/[id]/crm/import', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}/api/workspaces/some-id/crm/import`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 when user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/import`,
      {
        entity: 'people',
        rows: [{ name: 'Ana', email: 'ana@acme.com' }],
        consentConfirmed: true,
      },
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should import people and report rejected rows', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/import`,
      {
        entity: 'people',
        rows: [
          { name: 'Ana', email: 'ana@acme.com' },
          { name: 'Ana repetida', email: 'ana@acme.com' },
          { name: 'Sem contato' },
        ],
        consentConfirmed: true,
      },
      user.cookie,
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(1)
    expect(body.data.rejected).toHaveLength(2)
  })

  it('should return 422 without the consent statement', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/import`,
      { entity: 'leads', rows: [{ name: 'Ana', email: 'a@acme.com' }] },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })
})
