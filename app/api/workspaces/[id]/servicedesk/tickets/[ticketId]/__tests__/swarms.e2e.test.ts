import { describe, expect, it } from 'vitest'
import { getJson, postJson } from '@/src/__tests__/helpers/e2e'
import { setupTabs, tabApi } from './sd-tab-e2e.helpers'

describe('ticket swarming', () => {
  it('runs the whole flow: start, answer, invite again, close', async () => {
    const { workspace, agent, requester, ticket } = await setupTabs()
    const base = `${tabApi(workspace.id, ticket.id)}/swarms`

    const empty = await getJson(base, agent.cookie)
    expect(empty.status).toBe(200)
    const list = (await empty.json()).data
    expect(list.items).toEqual([])
    expect(list.slackAvailable).toBe(false)

    const started = await postJson(
      base,
      { reason: 'Preciso de ajuda com a rede', userIds: [requester.id] },
      agent.cookie,
    )
    expect(started.status).toBe(201)
    const swarm = (await started.json()).data
    expect(swarm.status).toBe('OPEN')
    expect(swarm.members).toHaveLength(1)
    expect(swarm.members[0].status).toBe('INVITED')
    expect(swarm.slack.status).toBe('NONE')

    const again = await postJson(
      base,
      { reason: 'Outro swarming', userIds: [requester.id] },
      agent.cookie,
    )
    expect(again.status).toBe(409)
    expect((await again.json()).error.code).toBe('SD_SWARM_ALREADY_OPEN')

    const asInvitee = await getJson(base, requester.cookie)
    expect(asInvitee.status).toBe(200)

    const declined = await postJson(
      `${base}/${swarm.id}/respond`,
      { response: 'DECLINE' },
      requester.cookie,
    )
    expect((await declined.json()).data.members[0].status).toBe('DECLINED')

    const invited = await postJson(
      `${base}/${swarm.id}/invite`,
      { userIds: [requester.id] },
      agent.cookie,
    )
    expect((await invited.json()).data.members[0].status).toBe('INVITED')

    const joined = await postJson(
      `${base}/${swarm.id}/respond`,
      { response: 'JOIN' },
      requester.cookie,
    )
    expect((await joined.json()).data.members[0].status).toBe('JOINED')

    const closed = await postJson(
      `${base}/${swarm.id}/close`,
      { outcome: 'Trocado o switch' },
      agent.cookie,
    )
    expect(closed.status).toBe(200)
    expect((await closed.json()).data).toMatchObject({
      status: 'CLOSED',
      outcome: 'Trocado o switch',
    })

    const twice = await postJson(`${base}/${swarm.id}/close`, {}, agent.cookie)
    expect(twice.status).toBe(409)
    expect((await twice.json()).error.code).toBe('SD_SWARM_CLOSED')
  })

  it('is closed to requesters and strangers, and validates the body', async () => {
    const { workspace, agent, requester, ticket } = await setupTabs()
    const base = `${tabApi(workspace.id, ticket.id)}/swarms`

    const asRequester = await getJson(base, requester.cookie)
    expect(asRequester.status).toBe(403)
    expect((await asRequester.json()).error.code).toBe('SD_NOT_AGENT')

    const start = await postJson(
      base,
      { reason: 'Rede', userIds: [agent.id] },
      requester.cookie,
    )
    expect(start.status).toBe(403)

    const invalid = await postJson(
      base,
      { reason: 'x', userIds: [] },
      agent.cookie,
    )
    expect(invalid.status).toBe(422)

    const outsider = await postJson(
      base,
      { reason: 'Rede caiu', userIds: ['not-a-member'] },
      agent.cookie,
    )
    expect(outsider.status).toBe(422)
  })
})
