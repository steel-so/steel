import { describe, expect, it } from 'vitest'
import { seedSendingDomain } from '@/src/__tests__/factories/newsletter-nl-domains.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

describe('GET /api/workspaces/[id]/crm/email-senders', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}/api/workspaces/x/crm/email-senders`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/email-senders`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should list verified domains and the platform address, also to a VIEWER', async () => {
    const { user, workspace } = await authenticatedOwner()
    const verified = await seedSendingDomain({
      workspaceId: workspace.id,
      createdById: user.id,
      status: 'VERIFIED',
    })
    await seedSendingDomain({
      workspaceId: workspace.id,
      createdById: user.id,
      status: 'PENDING',
    })

    const viewer = await addMember(workspace.id, 'VIEWER')
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/email-senders`,
      viewer.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      platformAddress: 'notificacoes@stratustelecom.com.br',
      verifiedDomains: [verified.name],
    })
  })
})
