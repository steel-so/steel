import { describe, expect, it } from 'vitest'
import { BOLETO_STEPS } from '@/src/__tests__/factories/nov-a5-procedures.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/ai-procedures`

const body = (extra: Record<string, unknown> = {}) => ({
  name: 'Segunda via de boleto',
  whenToUse: 'O cliente pede a segunda via de um boleto',
  status: 'ACTIVE',
  steps: BOLETO_STEPS,
  ...extra,
})

describe('AI procedures routes — authentication', () => {
  it.each([
    ['GET', ''],
    ['POST', ''],
    ['GET', '/catalog'],
    ['GET', '/runs'],
    ['GET', '/runs/r1'],
    ['GET', '/p1'],
    ['PATCH', '/p1'],
    ['DELETE', '/p1'],
    ['POST', '/p1/preview'],
    ['GET', '/p1/versions'],
    ['POST', '/p1/versions/v1/restore'],
    ['GET', '/p1/runs'],
  ])('should return 401 for %s %s without a session', async (method, path) => {
    const res = await fetch(`${BASE_URL}${base('ws')}${path}`, {
      method,
      headers: defaultHeaders,
      ...(!['GET', 'DELETE'].includes(method) && { body: '{}' }),
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    for (const path of ['', '/catalog', '/runs']) {
      const res = await getJson(`${base(workspace.id)}${path}`, stranger.cookie)
      expect(res.status).toBe(403)
    }
  })
})

describe('AI procedures CRUD and versions', () => {
  it('should create, version, restore, preview and delete a procedure', async () => {
    const { user, workspace } = await authenticatedOwner()

    const created = await postJson(base(workspace.id), body(), user.cookie)
    expect(created.status).toBe(201)
    const procedure = (await created.json()).data
    expect(procedure.currentVersion).toBe(1)

    const list = await getJson(base(workspace.id), user.cookie)
    expect((await list.json()).data).toHaveLength(1)

    const patched = await patchJson(
      `${base(workspace.id)}/${procedure.id}`,
      { whenToUse: 'Pedido de boleto vencido', changeNote: 'ajuste' },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data.currentVersion).toBe(2)

    const versions = await getJson(
      `${base(workspace.id)}/${procedure.id}/versions`,
      user.cookie,
    )
    const listed = (await versions.json()).data
    expect(listed.map((v: { number: number }) => v.number)).toEqual([2, 1])

    const restored = await postJson(
      `${base(workspace.id)}/${procedure.id}/versions/${listed[1].id}/restore`,
      {},
      user.cookie,
    )
    expect(restored.status).toBe(200)
    expect((await restored.json()).data.currentVersion).toBe(3)

    const preview = await postJson(
      `${base(workspace.id)}/${procedure.id}/preview`,
      { variables: {} },
      user.cookie,
    )
    expect(preview.status).toBe(200)
    expect((await preview.json()).data.plan).toHaveLength(3)

    const catalog = await getJson(`${base(workspace.id)}/catalog`, user.cookie)
    expect((await catalog.json()).data.canManage).toBe(true)

    const runs = await getJson(
      `${base(workspace.id)}/${procedure.id}/runs`,
      user.cookie,
    )
    expect((await runs.json()).data).toEqual([])

    const deleted = await deleteJson(
      `${base(workspace.id)}/${procedure.id}`,
      user.cookie,
    )
    expect(deleted.status).toBe(200)
    const gone = await getJson(
      `${base(workspace.id)}/${procedure.id}`,
      user.cookie,
    )
    expect(gone.status).toBe(404)
  })

  it('should validate the body and the step structure', async () => {
    const { user, workspace } = await authenticatedOwner()
    const empty = await postJson(base(workspace.id), {}, user.cookie)
    expect(empty.status).toBe(422)
    const broken = await postJson(
      base(workspace.id),
      body({ steps: [{ ...BOLETO_STEPS[1], url: 'https://x.com/{{nada}}' }] }),
      user.cookie,
    )
    expect(broken.status).toBe(422)
    expect((await broken.json()).error.code).toBe('AI_PROCEDURE_INVALID')
  })

  it('should let members read but not change procedures', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const created = await postJson(base(workspace.id), body(), user.cookie)
    const procedure = (await created.json()).data

    const read = await getJson(base(workspace.id), member.cookie)
    expect(read.status).toBe(200)
    const denied = await postJson(base(workspace.id), body(), member.cookie)
    expect(denied.status).toBe(403)
    const deniedPatch = await patchJson(
      `${base(workspace.id)}/${procedure.id}`,
      { name: 'x' },
      member.cookie,
    )
    expect(deniedPatch.status).toBe(403)
  })

  it('should not leak procedures across workspaces', async () => {
    const [a, b] = await Promise.all([authenticatedOwner(), authenticatedOwner()])
    const created = await postJson(base(a.workspace.id), body(), a.user.cookie)
    const procedure = (await created.json()).data
    const res = await getJson(
      `${base(b.workspace.id)}/${procedure.id}`,
      b.user.cookie,
    )
    expect(res.status).toBe(404)
  })
})
