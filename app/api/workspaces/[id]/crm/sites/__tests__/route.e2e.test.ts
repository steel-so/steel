import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
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

const document = {
  catalog: 'site',
  version: 1,
  rootId: 'root',
  nodes: {
    root: { id: 'root', type: 'site.page', props: {}, children: ['s1'] },
    s1: { id: 's1', type: 'site.section', props: {}, children: ['h1'] },
    h1: { id: 'h1', type: 'site.heading', props: { text: 'Olá', level: 1 } },
  },
}

const uniqueSlug = () => `e2e-${createId().slice(0, 12)}`

describe('GET /api/workspaces/[id]/crm/sites', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(`${BASE_URL}/api/workspaces/x/crm/sites`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 to a non-member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/sites`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})

describe('site lifecycle', () => {
  it('creates a site, edits pages and globals, publishes and restores', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/sites`
    const slug = uniqueSlug()

    const invalid = await postJson(base, { name: '' }, user.cookie)
    expect(invalid.status).toBe(422)

    const created = await postJson(base, { name: 'Clínica', slug }, user.cookie)
    expect(created.status).toBe(201)
    const site = (await created.json()).data
    expect(site.slug).toBe(slug)
    expect(site.homePageId).toBeTruthy()

    const availability = await getJson(
      `${base}/slug-availability?slug=${slug}`,
      user.cookie,
    )
    expect((await availability.json()).data.available).toBe(false)
    const badSlug = await getJson(
      `${base}/slug-availability?slug=www`,
      user.cookie,
    )
    expect(badSlug.status).toBe(422)

    const listed = await getJson(base, user.cookie)
    expect((await listed.json()).data).toHaveLength(1)

    const page = await postJson(
      `${base}/${site.id}/pages`,
      { title: 'Contato', document },
      user.cookie,
    )
    expect(page.status).toBe(201)
    const pageBody = (await page.json()).data
    expect(pageBody.path).toBe('contato')

    const badDoc = await patchJson(
      `${base}/${site.id}/pages/${pageBody.id}`,
      { document: { ...document, catalog: 'email' } },
      user.cookie,
    )
    expect(badDoc.status).toBe(422)
    expect((await badDoc.json()).error.code).toBe('SITE_DOCUMENT_INVALID')

    const renamed = await patchJson(
      `${base}/${site.id}/pages/${pageBody.id}`,
      { slug: 'fale-conosco', seo: { title: 'Fale conosco' } },
      user.cookie,
    )
    expect((await renamed.json()).data.path).toBe('fale-conosco')

    const copy = await postJson(
      `${base}/${site.id}/pages/${pageBody.id}/duplicate`,
      {},
      user.cookie,
    )
    expect(copy.status).toBe(201)
    const copyBody = (await copy.json()).data

    const pages = await getJson(`${base}/${site.id}/pages`, user.cookie)
    const ids = (await pages.json()).data.map((p: { id: string }) => p.id)
    expect(ids).toHaveLength(3)
    const reordered = await patchJson(
      `${base}/${site.id}/pages/reorder`,
      { orderedIds: [...ids].reverse() },
      user.cookie,
    )
    expect(reordered.status).toBe(200)

    const header = await postJson(
      `${base}/${site.id}/globals`,
      { kind: 'HEADER', name: 'Topo', document },
      user.cookie,
    )
    expect(header.status).toBe(201)
    const headerBody = (await header.json()).data
    const secondHeader = await postJson(
      `${base}/${site.id}/globals`,
      { kind: 'HEADER', name: 'Outro' },
      user.cookie,
    )
    expect(secondHeader.status).toBe(409)

    const published = await postJson(
      `${base}/${site.id}/publish`,
      {},
      user.cookie,
    )
    expect(published.status).toBe(200)
    const publishedBody = (await published.json()).data
    expect(publishedBody.site.status).toBe('PUBLISHED')
    expect(publishedBody.version.number).toBe(1)

    const removedCopy = await deleteJson(
      `${base}/${site.id}/pages/${copyBody.id}`,
      user.cookie,
    )
    expect(removedCopy.status).toBe(200)
    const homeDelete = await deleteJson(
      `${base}/${site.id}/pages/${site.homePageId}`,
      user.cookie,
    )
    expect(homeDelete.status).toBe(409)

    const versions = await getJson(`${base}/${site.id}/versions`, user.cookie)
    const [version] = (await versions.json()).data
    expect(version.isLive).toBe(true)

    const restored = await postJson(
      `${base}/${site.id}/versions/${version.id}/restore`,
      {},
      user.cookie,
    )
    expect(restored.status).toBe(200)
    const afterRestore = await getJson(`${base}/${site.id}/pages`, user.cookie)
    expect((await afterRestore.json()).data).toHaveLength(3)

    const headerPatch = await patchJson(
      `${base}/${site.id}/globals/${headerBody.id}`,
      { name: 'Cabeçalho' },
      user.cookie,
    )
    expect(headerPatch.status).toBe(200)

    const unpublished = await deleteJson(
      `${base}/${site.id}/publish`,
      user.cookie,
    )
    expect((await unpublished.json()).data.status).toBe('DRAFT')

    const deleted = await deleteJson(`${base}/${site.id}`, user.cookie)
    expect(deleted.status).toBe(200)
    const gone = await getJson(`${base}/${site.id}`, user.cookie)
    expect(gone.status).toBe(404)
  })

  it('lets a viewer read but not create', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/sites`
    const created = await postJson(base, { name: 'Leitura' }, user.cookie)
    const site = (await created.json()).data
    const viewer = await addMember(workspace.id, 'VIEWER')

    expect((await getJson(`${base}/${site.id}`, viewer.cookie)).status).toBe(
      200,
    )
    expect((await postJson(base, { name: 'x' }, viewer.cookie)).status).toBe(
      403,
    )
    expect(
      (await postJson(`${base}/${site.id}/publish`, {}, viewer.cookie)).status,
    ).toBe(403)
  })

  it('migrates landing pages for admins only', async () => {
    const { user, workspace } = await authenticatedOwner()
    const path = `/api/workspaces/${workspace.id}/crm/sites/migrate-landing-pages`
    const migrated = await postJson(path, {}, user.cookie)
    expect(migrated.status).toBe(200)
    expect((await migrated.json()).data).toMatchObject({
      created: 0,
      failed: 0,
    })

    const member = await addMember(workspace.id, 'MEMBER')
    expect((await postJson(path, {}, member.cookie)).status).toBe(403)
  })
})
