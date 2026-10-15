import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'

async function createCanvasTemplate(workspaceId: string, cookie: string) {
  const res = await postJson(
    `/api/workspaces/${workspaceId}/crm/email-templates`,
    {
      name: 'Histórico',
      subject: 'Primeiro assunto',
      builderDocument: createBlankEmailDocument(),
    },
    cookie,
  )
  expect(res.status).toBe(201)
  return (await res.json()).data
}

describe('e-mail editor — template versions', () => {
  it('saves a version, skips unchanged content, previews and restores', async () => {
    const { user, workspace } = await authenticatedOwner()
    const template = await createCanvasTemplate(workspace.id, user.cookie)
    const path = `/api/workspaces/${workspace.id}/crm/email-templates/${template.id}`

    const saved = await postJson(
      `${path}/versions`,
      { label: 'Antes da revisão' },
      user.cookie,
    )
    expect(saved.status).toBe(201)
    const first = (await saved.json()).data
    expect(first).toMatchObject({ reason: 'SAVE', label: 'Antes da revisão' })

    const unchanged = await postJson(`${path}/versions`, {}, user.cookie)
    expect(unchanged.status).toBe(200)
    expect((await unchanged.json()).data).toBeNull()

    const edited = await patchJson(
      path,
      { subject: 'Assunto novo' },
      user.cookie,
    )
    expect(edited.status).toBe(200)

    const detail = await getJson(`${path}/versions/${first.id}`, user.cookie)
    expect(detail.status).toBe(200)
    expect((await detail.json()).data.document.catalog).toBe('email')

    const restored = await postJson(
      `${path}/versions/${first.id}/restore`,
      {},
      user.cookie,
    )
    expect(restored.status).toBe(200)
    const body = (await restored.json()).data
    expect(body.template.subject).toBe('Primeiro assunto')
    expect(body.version).toMatchObject({
      reason: 'RESTORE',
      restoredFromId: first.id,
    })

    const list = await getJson(`${path}/versions`, user.cookie)
    expect(list.status).toBe(200)
    const versions = (await list.json()).data
    expect(versions.map((v: { reason: string }) => v.reason)).toEqual([
      'RESTORE',
      'SAVE',
    ])
  })

  it('refuses legacy templates, unknown versions and viewers', async () => {
    const { user, workspace } = await authenticatedOwner()
    const legacy = await postJson(
      `/api/workspaces/${workspace.id}/crm/email-templates`,
      { name: 'HTML', subject: 'Oi', contentHtml: '<p>Oi</p>' },
      user.cookie,
    )
    const legacyId = (await legacy.json()).data.id
    const base = `/api/workspaces/${workspace.id}/crm/email-templates`
    const notBuilder = await postJson(
      `${base}/${legacyId}/versions`,
      {},
      user.cookie,
    )
    expect(notBuilder.status).toBe(409)

    const template = await createCanvasTemplate(workspace.id, user.cookie)
    const unknown = await getJson(
      `${base}/${template.id}/versions/nope`,
      user.cookie,
    )
    expect(unknown.status).toBe(404)

    const viewer = await addMember(workspace.id, 'VIEWER')
    const denied = await postJson(
      `${base}/${template.id}/versions`,
      {},
      viewer.cookie,
    )
    expect(denied.status).toBe(403)
    const read = await getJson(`${base}/${template.id}/versions`, viewer.cookie)
    expect(read.status).toBe(200)
  })
})
