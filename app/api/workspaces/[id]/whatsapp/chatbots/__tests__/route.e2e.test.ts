import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'

describe('/api/workspaces/[id]/whatsapp/chatbots', () => {
  it('walks a bot from draft to published, paused and deleted', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/chatbots`

    const created = await postJson(
      base,
      { name: 'Atendimento', template: 'menu' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const bot = (await created.json()).data
    expect(bot).toMatchObject({ status: 'DRAFT', publishedVersion: 0 })
    expect(bot.flow.nodes.length).toBeGreaterThan(1)

    // A draft cannot be activated before it is published.
    const early = await putJson(
      `${base}/${bot.id}/status`,
      { status: 'ACTIVE' },
      user.cookie,
    )
    expect(early.status).toBe(409)
    expect((await early.json()).error.code).toBe(
      'WHATSAPP_CHATBOT_NOT_PUBLISHED',
    )

    const issues = await postJson(`${base}/${bot.id}/validate`, {}, user.cookie)
    expect(issues.status).toBe(200)
    expect((await issues.json()).data).toEqual([])

    const published = await postJson(
      `${base}/${bot.id}/publish`,
      {},
      user.cookie,
    )
    expect(published.status).toBe(200)
    expect((await published.json()).data.chatbot).toMatchObject({
      status: 'ACTIVE',
      publishedVersion: 1,
      hasUnpublishedChanges: false,
    })

    const paused = await putJson(
      `${base}/${bot.id}/status`,
      { status: 'PAUSED' },
      user.cookie,
    )
    expect((await paused.json()).data.status).toBe('PAUSED')

    const list = await getJson(base, user.cookie)
    const items = (await list.json()).data
    expect(items).toHaveLength(1)
    expect(items[0].stats.sessions).toBe(0)

    const sessions = await getJson(
      `${base}/${bot.id}/sessions?limit=5`,
      user.cookie,
    )
    expect((await sessions.json()).data).toEqual([])

    const removed = await deleteJson(`${base}/${bot.id}`, user.cookie)
    expect(removed.status).toBe(200)
    expect((await getJson(`${base}/${bot.id}`, user.cookie)).status).toBe(404)
  })

  it('refuses to publish a broken draft and keeps the edits', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/chatbots`
    const bot = (
      await (await postJson(base, { name: 'Quebrado' }, user.cookie)).json()
    ).data

    const saved = await patchJson(
      `${base}/${bot.id}`,
      { name: 'Quebrado 2', flow: { nodes: [], edges: [] } },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data.name).toBe('Quebrado 2')

    const publish = await postJson(`${base}/${bot.id}/publish`, {}, user.cookie)
    expect(publish.status).toBe(422)
    expect((await publish.json()).error.code).toBe(
      'WHATSAPP_CHATBOT_INVALID_FLOW',
    )
  })

  it('simulates the draft step by step without sending anything', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/chatbots`
    const bot = (
      await (
        await postJson(base, { name: 'Menu', template: 'menu' }, user.cookie)
      ).json()
    ).data

    const first = await postJson(`${base}/${bot.id}/simulate`, {}, user.cookie)
    expect(first.status).toBe(200)
    const step = (await first.json()).data
    expect(step.status).toBe('WAITING')
    expect(step.outputs[0].kind).toBe('menu')

    const second = await postJson(
      `${base}/${bot.id}/simulate`,
      { state: step.state, input: '1' },
      user.cookie,
    )
    expect((await second.json()).data.status).toBe('HANDED_OFF_HUMAN')
  })

  it('validates the keyword trigger and the body', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/chatbots`

    expect((await postJson(base, { name: '' }, user.cookie)).status).toBe(422)
    const noWords = await postJson(
      base,
      { name: 'Palavras', triggerKind: 'KEYWORD' },
      user.cookie,
    )
    expect(noWords.status).toBe(422)
    const ok = await postJson(
      base,
      { name: 'Palavras', triggerKind: 'KEYWORD', keywords: ['orçamento'] },
      user.cookie,
    )
    expect(ok.status).toBe(201)
  })

  it('lets members read bots but not change them', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/chatbots`
    const bot = (
      await (await postJson(base, { name: 'Bot' }, user.cookie)).json()
    ).data

    expect((await getJson(base, member.cookie)).status).toBe(200)
    expect((await getJson(`${base}/${bot.id}`, member.cookie)).status).toBe(200)
    expect((await postJson(base, { name: 'X' }, member.cookie)).status).toBe(
      403,
    )
    expect(
      (await patchJson(`${base}/${bot.id}`, { name: 'Y' }, member.cookie))
        .status,
    ).toBe(403)
    expect(
      (await postJson(`${base}/${bot.id}/publish`, {}, member.cookie)).status,
    ).toBe(403)
    expect((await deleteJson(`${base}/${bot.id}`, member.cookie)).status).toBe(
      403,
    )
  })

  it('does not leak bots across workspaces', async () => {
    const owner = await authenticatedOwner()
    const other = await authenticatedOwner()
    const bot = (
      await (
        await postJson(
          `/api/workspaces/${owner.workspace.id}/whatsapp/chatbots`,
          { name: 'Meu' },
          owner.user.cookie,
        )
      ).json()
    ).data

    const peek = await getJson(
      `/api/workspaces/${other.workspace.id}/whatsapp/chatbots/${bot.id}`,
      other.user.cookie,
    )
    expect(peek.status).toBe(404)
    const stranger = await getJson(
      `/api/workspaces/${owner.workspace.id}/whatsapp/chatbots`,
      other.user.cookie,
    )
    expect(stranger.status).toBe(403)
  })
})
