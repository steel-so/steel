import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const body = {
  text: 'Internet rápida',
  messages: [{ role: 'user', content: 'Deixe mais curto' }],
  field: { label: 'Título principal' },
}

describe('POST /api/workspaces/[id]/crm/landing-pages/ai', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/some-id/crm/landing-pages/ai`,
      {
        method: 'POST',
        headers: { ...defaultHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    expect(res.status).toBe(401)
  })

  it('should reject a conversation that does not end on the user', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/landing-pages/ai`,
      { messages: [{ role: 'assistant', content: 'Oi' }] },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should return 403 when user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/landing-pages/ai`,
      body,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})
