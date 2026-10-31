import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

describe('Meta channels settings', () => {
  it('starts with everything off and lets the owner turn switches on', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/meta-channels`

    const initial = await getJson(`${base}/settings`, user.cookie)
    expect(initial.status).toBe(200)
    expect((await initial.json()).data).toMatchObject({
      coexistenceEnabled: false,
    })

    const patched = await patchJson(
      `${base}/settings`,
      { coexistenceEnabled: true },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data).toMatchObject({
      coexistenceEnabled: true,
    })

    const again = await getJson(`${base}/settings`, user.cookie)
    expect((await again.json()).data.coexistenceEnabled).toBe(true)
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
      { coexistenceEnabled: true },
      member.cookie,
    )
    expect(write.status).toBe(403)
  })

  it('lists no Coexistence connections for a fresh workspace', async () => {
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
