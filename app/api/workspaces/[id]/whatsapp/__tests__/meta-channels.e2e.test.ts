import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

// Low entropy on purpose: secret scanners flag random-looking literals.
const USER_TOKEN = 'x'.repeat(24)

const WEBHOOK = '/api/whatsapp/webhook/meta-social'

describe('Meta channels settings', () => {
  it('starts with everything off and lets the owner turn switches on', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/meta-channels`

    const initial = await getJson(`${base}/settings`, user.cookie)
    expect(initial.status).toBe(200)
    expect((await initial.json()).data).toMatchObject({
      instagramEnabled: false,
      messengerEnabled: false,
      commentsEnabled: false,
      coexistenceEnabled: false,
    })

    const patched = await patchJson(
      `${base}/settings`,
      { instagramEnabled: true, commentsEnabled: true },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data).toMatchObject({
      instagramEnabled: true,
      messengerEnabled: false,
      commentsEnabled: true,
    })

    const again = await getJson(`${base}/settings`, user.cookie)
    expect((await again.json()).data.instagramEnabled).toBe(true)
  })

  it('rejects an empty update and lets a member read but not write', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const base = `/api/workspaces/${workspace.id}/whatsapp/meta-channels`

    const empty = await patchJson(`${base}/settings`, {}, user.cookie)
    expect(empty.status).toBe(422)

    const read = await getJson(`${base}/settings`, member.cookie)
    expect(read.status).toBe(200)

    const write = await patchJson(
      `${base}/settings`,
      { messengerEnabled: true },
      member.cookie,
    )
    expect(write.status).toBe(403)
  })

  it('refuses to list pages or connect while the channels are off', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/meta-channels`
    const token = USER_TOKEN

    const pages = await postJson(
      `${base}/pages`,
      { accessToken: token },
      user.cookie,
    )
    expect(pages.status).toBe(403)

    const connect = await postJson(
      `${base}/connect`,
      { accessToken: token, pageId: '123456', channels: ['MESSENGER'] },
      user.cookie,
    )
    expect(connect.status).toBe(403)

    const invalid = await postJson(`${base}/connect`, {}, user.cookie)
    expect(invalid.status).toBe(422)
  })

  it('lists no social connections for a fresh workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/meta-channels/connections`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([])
  })
})

describe('Coexistence', () => {
  it('refuses to connect a number while Coexistence is off', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/connections/coexistence`,
      { code: 'abc', phoneNumberId: '555000111', wabaId: '777000222' },
      user.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('validates the signup payload', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/connections/coexistence`,
      { code: 'abc' },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('answers 404 for the sync of an unknown connection', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/connections/missing/coexistence`,
      user.cookie,
    )
    expect(res.status).toBe(404)
  })
})

describe('Social comments', () => {
  it('hides the comments of a conversation that does not exist', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations/missing/social-comments`,
      user.cookie,
    )
    expect(res.status).toBe(404)
  })

  it('rejects an empty reply', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations/missing/social-comments/m1/reply`,
      { text: '' },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })
})

describe('Instagram and Messenger webhook', () => {
  it('rejects a wrong verify token', async () => {
    const res = await getJson(
      `${WEBHOOK}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`,
    )
    expect(res.status).toBe(403)
  })

  it('rejects a delivery without a valid signature', async () => {
    const res = await postJson(WEBHOOK, { object: 'page', entry: [] })
    expect(res.status).toBe(401)
  })
})
