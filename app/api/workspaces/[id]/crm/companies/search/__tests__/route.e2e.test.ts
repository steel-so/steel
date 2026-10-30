import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

describe('POST /api/workspaces/[id]/crm/companies/search', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/some-id/crm/companies/search`,
      {
        method: 'POST',
        headers: { ...defaultHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'uma pergunta' }),
      },
    )
    expect(res.status).toBe(401)
  })

  it('should reject an empty question', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/companies/search`,
      { query: ' ' },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should return 403 when user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/companies/search`,
      { query: 'uma pergunta qualquer' },
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})
