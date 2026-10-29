import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/agents`

async function createAgent(
  workspaceId: string,
  ownerId: string,
  cookie: string,
) {
  const response = await postJson(
    base(workspaceId),
    {
      name: 'Triagem',
      instructions: 'Classifique os chamados.',
      triggerType: 'MANUAL',
      ownerId,
    },
    cookie,
  )
  expect(response.status).toBe(201)
  return (await response.json()).data as { id: string }
}

describe('Steel Agent versions', () => {
  it('records v1 on create, versions each edit and restores an old one', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await createAgent(workspace.id, user.id, user.cookie)
    const url = `${base(workspace.id)}/${agent.id}`

    const edited = await patchJson(
      url,
      { instructions: 'Classifique e priorize.', changeNote: 'Prioridade' },
      user.cookie,
    )
    expect(edited.status).toBe(200)
    const body = (await edited.json()).data
    expect(body.instructions).toBe('Classifique e priorize.')
    expect(body.version).toMatchObject({ number: 2, status: 'PUBLISHED' })

    const untouched = await patchJson(
      url,
      { name: 'Nova triagem' },
      user.cookie,
    )
    expect((await untouched.json()).data.version).toBeNull()

    const list = await getJson(`${url}/versions`, user.cookie)
    expect(list.status).toBe(200)
    const versions = (await list.json()).data
    expect(versions.versions.map((v: { number: number }) => v.number)).toEqual([
      2, 1,
    ])
    expect(versions.canManage).toBe(true)

    const v1 = versions.versions[1]
    const restored = await postJson(
      `${url}/versions/${v1.id}/restore`,
      {},
      user.cookie,
    )
    expect(restored.status).toBe(201)
    expect((await restored.json()).data).toMatchObject({
      number: 3,
      status: 'PUBLISHED',
    })
    const after = (await (await getJson(url, user.cookie)).json()).data
    expect(after.instructions).toBe('Classifique os chamados.')
  })

  it('runs an A/B experiment that can be promoted or discarded', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await createAgent(workspace.id, user.id, user.cookie)
    const url = `${base(workspace.id)}/${agent.id}`

    const ab = await patchJson(
      url,
      { instructions: 'Versão desafiante.', rolloutPercent: 25 },
      user.cookie,
    )
    const challenger = (await ab.json()).data
    expect(challenger.version).toMatchObject({ status: 'CHALLENGER' })
    expect(challenger.instructions).toBe('Classifique os chamados.')

    const promote = await postJson(
      `${url}/versions/${challenger.version.id}/promote`,
      {},
      user.cookie,
    )
    expect(promote.status).toBe(200)
    const promoted = (await (await getJson(url, user.cookie)).json()).data
    expect(promoted.instructions).toBe('Versão desafiante.')

    const second = await patchJson(
      url,
      { instructions: 'Outra tentativa.', rolloutPercent: 10 },
      user.cookie,
    )
    const next = (await second.json()).data.version
    const discard = await postJson(
      `${url}/versions/${next.id}/discard`,
      {},
      user.cookie,
    )
    expect(discard.status).toBe(200)
    expect((await discard.json()).data.status).toBe('DISCARDED')
  })

  it('rejects actions on versions in the wrong state and rate-bound input', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await createAgent(workspace.id, user.id, user.cookie)
    const url = `${base(workspace.id)}/${agent.id}`
    const versions = (
      await (await getJson(`${url}/versions`, user.cookie)).json()
    ).data.versions
    const published = versions[0]

    const promote = await postJson(
      `${url}/versions/${published.id}/promote`,
      {},
      user.cookie,
    )
    expect(promote.status).toBe(409)
    expect((await promote.json()).error.code).toBe(
      'STEEL_AGENT_VERSION_INVALID_STATE',
    )

    const invalid = await patchJson(url, { rolloutPercent: 100 }, user.cookie)
    expect(invalid.status).toBe(422)

    const missing = await postJson(
      `${url}/versions/nope/discard`,
      {},
      user.cookie,
    )
    expect(missing.status).toBe(404)
  })

  it('lets members read but not change versions, and blocks anonymous calls', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await createAgent(workspace.id, user.id, user.cookie)
    const url = `${base(workspace.id)}/${agent.id}`
    const member = await addMember(workspace.id, 'MEMBER')

    const read = await getJson(`${url}/versions`, member.cookie)
    expect(read.status).toBe(200)
    const listed = (await read.json()).data
    expect(listed.canManage).toBe(false)

    const forbidden = await postJson(
      `${url}/versions/${listed.versions[0].id}/discard`,
      {},
      member.cookie,
    )
    expect(forbidden.status).toBe(403)

    const anonymous = await getJson(`${url}/versions`)
    expect(anonymous.status).toBe(401)
  })
})
