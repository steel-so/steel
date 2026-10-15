import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  defaultHeaders,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const document = (text: string) => ({
  catalog: 'site',
  version: 1,
  rootId: 'root',
  nodes: {
    root: { id: 'root', type: 'site.page', props: {}, children: ['s1'] },
    s1: { id: 's1', type: 'site.section', props: {}, children: ['h1'] },
    h1: { id: 'h1', type: 'site.heading', props: { text, level: 1 } },
  },
})

async function publishedSite() {
  const { user, workspace } = await authenticatedOwner()
  const base = `/api/workspaces/${workspace.id}/crm/sites`
  const slug = `e2e-${createId().slice(0, 12)}`
  const site = (
    await (
      await postJson(
        base,
        {
          name: 'Clínica E2E',
          slug,
          settings: {
            seo: { titleTemplate: '%s | Clínica E2E', description: 'Saúde' },
          },
        },
        user.cookie,
      )
    ).json()
  ).data
  await postJson(
    `${base}/${site.id}/pages`,
    { title: 'Contato', document: document('Fale com a gente') },
    user.cookie,
  )
  await postJson(`${base}/${site.id}/publish`, {}, user.cookie)
  return { slug, user, base, site }
}

describe('public site runtime', () => {
  it('serves the published pages without a session', async () => {
    const { slug } = await publishedSite()

    const home = await fetch(`${BASE_URL}/s/${slug}`)
    expect(home.status).toBe(200)
    const contact = await fetch(`${BASE_URL}/s/${slug}/contato`)
    const html = await contact.text()
    expect(contact.status).toBe(200)
    expect(html).toContain('Fale com a gente')
    expect(html).toContain('<title>Contato | Clínica E2E</title>')
    expect(html).toContain(`/s/${slug}/contato`)

    const missing = await fetch(`${BASE_URL}/s/${slug}/nao-existe`)
    expect(missing.status).toBe(404)
  })

  it('serves sitemap.xml and robots.txt per site', async () => {
    const { slug } = await publishedSite()
    const sitemap = await fetch(`${BASE_URL}/s/${slug}/sitemap.xml`)
    expect(sitemap.status).toBe(200)
    expect(await sitemap.text()).toContain(`/s/${slug}/contato</loc>`)
    const robots = await fetch(`${BASE_URL}/s/${slug}/robots.txt`)
    expect(await robots.text()).toContain('Sitemap: ')

    const unknown = await fetch(
      `${BASE_URL}/s/nao-existe-${createId()}/robots.txt`,
    )
    expect(unknown.status).toBe(404)
  })

  it('records an anonymous view', async () => {
    const { slug } = await publishedSite()
    const res = await fetch(`${BASE_URL}/api/sites/${slug}/views`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ path: '/', utmSource: 'e2e' }),
    })
    expect(res.status).toBe(202)
    const unknown = await fetch(`${BASE_URL}/api/sites/nao-existe/views`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ path: '/' }),
    })
    expect(unknown.status).toBe(404)
  })

  it('shows the new version right after a publish and goes away on unpublish', async () => {
    const { slug, user, base, site } = await publishedSite()
    expect((await fetch(`${BASE_URL}/s/${slug}`)).status).toBe(200)
    await fetch(`${BASE_URL}${base}/${site.id}/publish`, {
      method: 'DELETE',
      headers: { ...defaultHeaders, Cookie: user.cookie },
    })
    expect((await fetch(`${BASE_URL}/s/${slug}`)).status).toBe(404)
  })
})
