import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/** Site editor routes (site-ui): templates, duplicate, publish summary and
 * the media library. */

// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

describe('site from a template', () => {
  it('creates the home page and the header/footer globals', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/sites`

    const unknown = await postJson(
      `${base}/from-template`,
      { name: 'X', templateId: 'nope' },
      user.cookie,
    )
    expect(unknown.status).toBe(422)

    const created = await postJson(
      `${base}/from-template`,
      { name: 'Agência Norte', templateId: 'agencia' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const site = (await created.json()).data
    expect(site.status).toBe('DRAFT')

    const globals = (
      await (await getJson(`${base}/${site.id}/globals`, user.cookie)).json()
    ).data
    expect(
      globals.map((global: { kind: string }) => global.kind).sort(),
    ).toEqual(['FOOTER', 'HEADER'])

    // Nothing published yet: everything shows up as new.
    const changes = (
      await (await getJson(`${base}/${site.id}/changes`, user.cookie)).json()
    ).data
    expect(changes.firstPublish).toBe(true)
    expect(changes.total).toBe(3)

    const published = await postJson(
      `${base}/${site.id}/publish`,
      {},
      user.cookie,
    )
    expect(published.status).toBe(200)
    const after = (
      await (await getJson(`${base}/${site.id}/changes`, user.cookie)).json()
    ).data
    expect(after).toMatchObject({ firstPublish: false, total: 0 })

    const renamed = await patchJson(
      `${base}/${site.id}`,
      { theme: { colors: { primary: '#000000' } } },
      user.cookie,
    )
    expect(renamed.status).toBe(200)
    const pending = (
      await (await getJson(`${base}/${site.id}/changes`, user.cookie)).json()
    ).data
    expect(pending).toMatchObject({ theme: true, total: 1 })

    const copy = await postJson(`${base}/${site.id}/duplicate`, {}, user.cookie)
    expect(copy.status).toBe(201)
    const copied = (await copy.json()).data
    expect(copied.name).toBe('Agência Norte (cópia)')
    expect(copied.status).toBe('DRAFT')
    expect(copied.slug).toBe(`${site.slug}-copia`)
  })

  it('refuses viewers and other workspaces', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/sites`
    const viewer = await addMember(workspace.id, 'VIEWER')
    const denied = await postJson(
      `${base}/from-template`,
      { name: 'X', templateId: 'agencia' },
      viewer.cookie,
    )
    expect(denied.status).toBe(403)

    const site = (
      await (await postJson(base, { name: 'Clínica' }, user.cookie)).json()
    ).data
    const other = await authenticatedOwner()
    const foreign = await getJson(
      `/api/workspaces/${other.workspace.id}/crm/sites/${site.id}/changes`,
      other.user.cookie,
    )
    expect(foreign.status).toBe(404)
    const foreignCopy = await postJson(
      `/api/workspaces/${other.workspace.id}/crm/sites/${site.id}/duplicate`,
      {},
      other.user.cookie,
    )
    expect(foreignCopy.status).toBe(404)
  })
})

describe('site media library', () => {
  it('uploads, lists and deletes images', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/sites/media`

    const anonymous = await fetch(`${BASE_URL}${base}`, {
      headers: defaultHeaders,
    })
    expect(anonymous.status).toBe(401)

    const wrongType = await fetch(`${BASE_URL}${base}`, {
      method: 'POST',
      headers: {
        ...defaultHeaders,
        Cookie: user.cookie,
        'Content-Type': 'image/gif',
      },
      body: PNG,
    })
    expect(wrongType.status).toBe(422)

    const uploaded = await fetch(`${BASE_URL}${base}`, {
      method: 'POST',
      headers: {
        ...defaultHeaders,
        Cookie: user.cookie,
        'Content-Type': 'image/png',
      },
      body: PNG,
    })
    expect(uploaded.status).toBe(201)
    const item = (await uploaded.json()).data
    expect(item).toMatchObject({ source: 'site' })
    expect(item.id).toMatch(/\.png$/)

    const listed = (await (await getJson(base, user.cookie)).json()).data
    expect(listed.map((media: { id: string }) => media.id)).toContain(item.id)

    const bad = await deleteJson(`${base}?id=../x.png`, user.cookie)
    expect(bad.status).toBe(422)
    const removed = await deleteJson(`${base}?id=${item.id}`, user.cookie)
    expect(removed.status).toBe(200)
    const after = (await (await getJson(base, user.cookie)).json()).data
    expect(after.map((media: { id: string }) => media.id)).not.toContain(
      item.id,
    )
  })

  it('lets viewers list but not upload', async () => {
    const { workspace } = await authenticatedOwner()
    const viewer = await addMember(workspace.id, 'VIEWER')
    const base = `/api/workspaces/${workspace.id}/crm/sites/media`
    expect((await getJson(base, viewer.cookie)).status).toBe(200)
    const upload = await fetch(`${BASE_URL}${base}`, {
      method: 'POST',
      headers: {
        ...defaultHeaders,
        Cookie: viewer.cookie,
        'Content-Type': 'image/png',
      },
      body: PNG,
    })
    expect(upload.status).toBe(403)
  })
})
