import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/voice-agent`

describe('voice attendant settings', () => {
  it('starts off, and an admin turns it on once someone is set to act as', async () => {
    const { user, workspace } = await authenticatedOwner()

    const initial = await getJson(`${base(workspace.id)}/settings`, user.cookie)
    expect(initial.status).toBe(200)
    expect((await initial.json()).data).toMatchObject({
      enabled: false,
      maxCallSeconds: 300,
      monthlyMinutesCap: 300,
      pabxSecretConfigured: false,
    })

    const noIdentity = await patchJson(
      `${base(workspace.id)}/settings`,
      { enabled: true },
      user.cookie,
    )
    expect(noIdentity.status).toBe(422)
    expect((await noIdentity.json()).error.code).toBe('VOICE_AGENT_NOT_READY')

    const saved = await patchJson(
      `${base(workspace.id)}/settings`,
      {
        enabled: true,
        runAsUserId: user.id,
        noticeText: 'Atendimento automatizado por IA.',
        maxCallSeconds: 180,
        fallbackTarget: 'suporte',
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      enabled: true,
      runAsUserId: user.id,
      effectiveNotice: 'Atendimento automatizado por IA.',
      maxCallSeconds: 180,
      fallbackTarget: 'suporte',
    })
  })

  it('validates the body and the identity', async () => {
    const { user, workspace } = await authenticatedOwner()
    const invalid = await patchJson(
      `${base(workspace.id)}/settings`,
      { maxCallSeconds: 5 },
      user.cookie,
    )
    expect(invalid.status).toBe(422)

    const { user: stranger } = await authenticatedOwner()
    const notMember = await patchJson(
      `${base(workspace.id)}/settings`,
      { runAsUserId: stranger.id },
      user.cookie,
    )
    expect(notMember.status).toBe(422)
  })

  it('is closed to plain members and strangers', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const { user: outsider } = await authenticatedOwner()

    for (const cookie of [member.cookie, outsider.cookie]) {
      const read = await getJson(`${base(workspace.id)}/settings`, cookie)
      expect(read.status).toBe(403)
      const write = await patchJson(
        `${base(workspace.id)}/settings`,
        { voice: 'ash' },
        cookie,
      )
      expect(write.status).toBe(403)
    }
    const anonymous = await getJson(`${base(workspace.id)}/settings`)
    expect(anonymous.status).toBe(401)
    expect(user.cookie).toBeTruthy()
  })
})

describe('voice attendant secret and usage', () => {
  it('shows the secret once and keeps only its hint', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(`${base(workspace.id)}/secret`, {}, user.cookie)
    expect(res.status).toBe(200)
    const { secret, hint } = (await res.json()).data
    expect(secret).toMatch(/^vk_/)
    expect(hint).toBe(secret.slice(-4))

    const settings = await getJson(
      `${base(workspace.id)}/settings`,
      user.cookie,
    )
    const body = JSON.stringify((await settings.json()).data)
    expect(body).toContain(hint)
    expect(body).not.toContain(secret)
  })

  it('reports the month’s minutes against the cap', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(`${base(workspace.id)}/usage`, user.cookie)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      minutesUsed: 0,
      minutesCap: 300,
      calls: 0,
    })
  })
})

describe('voice attendant routes', () => {
  it('adds, toggles and removes a queue or number', async () => {
    const { user, workspace } = await authenticatedOwner()

    const created = await postJson(
      `${base(workspace.id)}/routes`,
      { kind: 'QUEUE', value: 'suporte', transferTarget: '200' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const route = (await created.json()).data
    expect(route).toMatchObject({
      kind: 'QUEUE',
      value: 'suporte',
      enabled: true,
      transferTarget: '200',
    })

    const duplicate = await postJson(
      `${base(workspace.id)}/routes`,
      { kind: 'QUEUE', value: 'suporte' },
      user.cookie,
    )
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).error.code).toBe(
      'VOICE_AGENT_ROUTE_DUPLICATE',
    )

    const invalid = await postJson(
      `${base(workspace.id)}/routes`,
      { kind: 'QUEUE', value: 'has space' },
      user.cookie,
    )
    expect(invalid.status).toBe(422)

    const list = await getJson(`${base(workspace.id)}/routes`, user.cookie)
    expect((await list.json()).data).toHaveLength(1)

    const toggled = await patchJson(
      `${base(workspace.id)}/routes/${route.id}`,
      { enabled: false },
      user.cookie,
    )
    expect(toggled.status).toBe(200)
    expect((await toggled.json()).data.enabled).toBe(false)

    const removed = await deleteJson(
      `${base(workspace.id)}/routes/${route.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    const gone = await deleteJson(
      `${base(workspace.id)}/routes/${route.id}`,
      user.cookie,
    )
    expect(gone.status).toBe(404)
    expect((await gone.json()).error.code).toBe('VOICE_AGENT_ROUTE_NOT_FOUND')
  })

  it('does not touch another workspace’s routes', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { user: otherUser, workspace: other } = await authenticatedOwner()
    const created = await postJson(
      `${base(other.id)}/routes`,
      { kind: 'DID', value: '1140041234' },
      otherUser.cookie,
    )
    const route = (await created.json()).data

    const crossed = await patchJson(
      `${base(workspace.id)}/routes/${route.id}`,
      { enabled: false },
      user.cookie,
    )
    expect(crossed.status).toBe(404)
  })
})
