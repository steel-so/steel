import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

async function approveWebphone(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      pabxExtension: '1122S',
      pabxDeviceId: '0',
      pabxWebphoneEnabled: true,
    },
  })
}

describe('browser phone call history', () => {
  it('requires a session', async () => {
    const begin = await postJson('/api/workspaces/ws1/phone-calls/webphone', {
      direction: 'out',
      number: '11999998888',
    })
    expect(begin.status).toBe(401)

    const report = await patchJson(
      '/api/workspaces/ws1/phone-calls/call1/webphone',
      { event: 'answered' },
    )
    expect(report.status).toBe(401)
  })

  it('refuses a user whose browser phone was not released', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/phone-calls/webphone`,
      { direction: 'out', number: '11999998888' },
      user.cookie,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('PABX_EXTENSION_REQUIRED')
  })

  it('rejects an invalid body', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/phone-calls/webphone`,
      { direction: 'sideways' },
      user.cookie,
    )
    expect(res.status).toBe(400)
  })

  it('records an outbound call, then its end, and hides it from other users', async () => {
    const { user, workspace } = await authenticatedOwner()
    await approveWebphone(user.id)

    const begin = await postJson(
      `/api/workspaces/${workspace.id}/phone-calls/webphone`,
      { direction: 'out', number: '11999998888', name: 'Maria' },
      user.cookie,
    )
    expect(begin.status).toBe(201)
    const started = (await begin.json()).data
    expect(started.callbackToken).toEqual(expect.any(String))
    expect(started.call).toMatchObject({
      direction: 'OUTBOUND',
      source: 'WEBPHONE',
      status: 'DIALING',
      conversationId: null,
    })

    const callId = started.call.id
    const path = `/api/workspaces/${workspace.id}/phone-calls/${callId}/webphone`
    const answered = await patchJson(path, { event: 'answered' }, user.cookie)
    expect(answered.status).toBe(200)
    expect((await answered.json()).data.status).toBe('IN_PROGRESS')

    const ended = await patchJson(
      path,
      { event: 'ended', outcome: 'completed' },
      user.cookie,
    )
    expect(ended.status).toBe(200)
    expect((await ended.json()).data.status).toBe('COMPLETED')

    const other = await addMember(workspace.id, 'ADMIN')
    const stolen = await patchJson(path, { event: 'answered' }, other.cookie)
    expect(stolen.status).toBe(404)
  })

  it('refuses someone outside the workspace', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/phone-calls/webphone`,
      { direction: 'in', number: '11999998888' },
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})
