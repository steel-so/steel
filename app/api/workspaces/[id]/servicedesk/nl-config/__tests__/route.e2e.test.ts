import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

describe('POST /api/workspaces/[id]/servicedesk/nl-config/*', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    for (const action of ['preview', 'apply']) {
      const res = await fetch(
        `${BASE_URL}/api/workspaces/some-id/servicedesk/nl-config/${action}`,
        {
          method: 'POST',
          headers: { ...defaultHeaders, 'Content-Type': 'application/json' },
          body: '{}',
        },
      )
      expect(res.status).toBe(401)
    }
  })

  it('should reject a request too short to be a description', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/servicedesk/nl-config/preview`,
      { kind: 'SLA', text: 'a' },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should reject an apply body that fails the creation schema', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/servicedesk/nl-config/apply`,
      { kind: 'AUTOMATION', config: { name: 'Sem ações' } },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should return 403 when user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/servicedesk/nl-config/preview`,
      { kind: 'SLA', text: 'SLA de 4 horas para todos' },
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})
