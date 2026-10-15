import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

const fragment = {
  rootId: 'h1',
  nodes: {
    h1: {
      id: 'h1',
      type: 'email.heading',
      props: {
        text: 'Novidades do mês',
        level: 'h2',
        align: 'left',
        padding: { top: 8, right: 0, bottom: 8, left: 0 },
        visibility: { base: true, tablet: true, mobile: true },
      },
    },
  },
}

describe('e-mail editor — saved blocks', () => {
  it('saves, lists, searches, renames and deletes a block', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/email-saved-blocks`

    const created = await postJson(
      base,
      { name: 'Título do mês', category: 'Cabeçalhos', fragment },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const block = (await created.json()).data
    expect(block).toMatchObject({ kind: 'block', nodeCount: 1 })

    const list = await getJson(`${base}?q=mês`, user.cookie)
    expect(list.status).toBe(200)
    expect((await list.json()).data.map((b: { id: string }) => b.id)).toEqual([
      block.id,
    ])

    const renamed = await patchJson(
      `${base}/${block.id}`,
      { name: 'Título' },
      user.cookie,
    )
    expect(renamed.status).toBe(200)
    expect((await renamed.json()).data.name).toBe('Título')

    const removed = await deleteJson(`${base}/${block.id}`, user.cookie)
    expect(removed.status).toBe(200)
    const missing = await patchJson(
      `${base}/${block.id}`,
      { name: 'x' },
      user.cookie,
    )
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe(
      'CRM_EMAIL_SAVED_BLOCK_NOT_FOUND',
    )
  })

  it('refuses invalid fragments and non-admin HTML blocks', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/email-saved-blocks`

    const column = await postJson(
      base,
      {
        name: 'Coluna',
        fragment: {
          rootId: 'c',
          nodes: { c: { id: 'c', type: 'email.column', props: {} } },
        },
      },
      user.cookie,
    )
    expect(column.status).toBe(422)
    expect((await column.json()).error.code).toBe(
      'CRM_EMAIL_SAVED_BLOCK_INVALID',
    )

    const member = await addMember(workspace.id, 'MEMBER')
    const html = await postJson(
      base,
      {
        name: 'HTML',
        fragment: {
          rootId: 'x',
          nodes: {
            x: {
              id: 'x',
              type: 'email.html',
              props: {
                html: '<b>oi</b>',
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                visibility: { base: true, tablet: true, mobile: true },
              },
            },
          },
        },
      },
      member.cookie,
    )
    expect(html.status).toBe(403)
    expect((await html.json()).error.code).toBe(
      'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
    )
  })

  it('validates input and keeps viewers and strangers out', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/email-saved-blocks`
    const invalid = await postJson(base, { name: '' }, user.cookie)
    expect(invalid.status).toBe(422)

    const viewer = await addMember(workspace.id, 'VIEWER')
    const denied = await postJson(base, { name: 'x', fragment }, viewer.cookie)
    expect(denied.status).toBe(403)
    const read = await getJson(base, viewer.cookie)
    expect(read.status).toBe(200)

    const stranger = await authenticatedOwner()
    const foreign = await getJson(base, stranger.user.cookie)
    expect(foreign.status).toBe(403)
  })
})
