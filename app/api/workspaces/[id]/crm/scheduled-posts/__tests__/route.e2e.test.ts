import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

describe('GET /api/workspaces/[id]/crm/scheduled-posts', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/some-id/crm/scheduled-posts`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('should return 403 when user is not a workspace member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()

    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/scheduled-posts`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})

describe('POST, PATCH & DELETE /api/workspaces/[id]/crm/scheduled-posts', () => {
  it('should create with targets, update and delete', async () => {
    const { user, workspace } = await authenticatedOwner()
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const created = await postJson(
      `/api/workspaces/${workspace.id}/crm/scheduled-posts`,
      {
        content: 'Olá',
        mode: 'schedule',
        scheduledFor,
        // FACEBOOK accepts text-only posts (no media required).
        platforms: ['FACEBOOK'],
      },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const createdBody = await created.json()
    expect(createdBody.data.targets).toHaveLength(1)

    const updated = await patchJson(
      `/api/workspaces/${workspace.id}/crm/scheduled-posts/${createdBody.data.id}`,
      { content: 'Olá mundo' },
      user.cookie,
    )
    expect(updated.status).toBe(200)

    const deleted = await deleteJson(
      `/api/workspaces/${workspace.id}/crm/scheduled-posts/${createdBody.data.id}`,
      user.cookie,
    )
    expect(deleted.status).toBe(200)
  })

  it('should reject creation when a media-required platform has no attachment', async () => {
    const { user, workspace } = await authenticatedOwner()
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/scheduled-posts`,
      {
        content: 'Olá',
        mode: 'schedule',
        scheduledFor,
        platforms: ['INSTAGRAM'],
      },
      user.cookie,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('CRM_SCHEDULED_POST_INVALID')
  })
})

// 1x1 transparent PNG.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('POST /api/workspaces/[id]/crm/scheduled-posts/[postId]/publish', () => {
  it('should mark the post FAILED since no platform is really connected', async () => {
    const { user, workspace } = await authenticatedOwner()
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const form = new FormData()
    form.set('content', 'Olá')
    form.set('mode', 'schedule')
    form.set('scheduledFor', scheduledFor)
    form.append('platforms', 'INSTAGRAM')
    const bytes = Buffer.from(TINY_PNG_BASE64, 'base64')
    form.append('media', new Blob([bytes], { type: 'image/png' }), 'pixel.png')

    const createRes = await fetch(
      `${BASE_URL}/api/workspaces/${workspace.id}/crm/scheduled-posts`,
      { method: 'POST', headers: { Cookie: user.cookie }, body: form },
    )
    expect(createRes.status).toBe(201)
    const created = await createRes.json()

    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/scheduled-posts/${created.data.id}/publish`,
      {},
      user.cookie,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('FAILED')
    expect(body.data.targets[0].status).toBe('FAILED')
    expect(body.data.targets[0].error).toBeTruthy()

    const again = await postJson(
      `/api/workspaces/${workspace.id}/crm/scheduled-posts/${created.data.id}/publish`,
      {},
      user.cookie,
    )
    expect(again.status).toBe(200)
  })
})
