import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import {
  authenticatedOwner,
  defaultHeaders,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { getSiteTemplate } from '@/src/lib/canvas-site/presets'

const document = (text: string) => createSiteDocument(text)

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

    // Sites have their own root layout without Suspense: a real 404.
    const missing = await fetch(`${BASE_URL}/s/${slug}/nao-existe`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('Página não encontrada')
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

  it('inlines only the element scripts a page uses, with the CSP nonce', async () => {
    const { slug, user, base, site } = await publishedSite()
    const plain = await (await fetch(`${BASE_URL}/s/${slug}/contato`)).text()
    expect(plain).not.toContain('data-site-runtime')

    const evento = getSiteTemplate('evento')?.document()
    await postJson(
      `${base}/${site.id}/pages`,
      { title: 'Evento', document: evento },
      user.cookie,
    )
    await postJson(`${base}/${site.id}/publish`, {}, user.cookie)
    const html = await (await fetch(`${BASE_URL}/s/${slug}/evento`)).text()
    for (const feature of ['carousel', 'tabs', 'actions', 'stats', 'map']) {
      expect(html).toMatch(
        new RegExp(`<script nonce="[^"]+" data-site-runtime="${feature}">`),
      )
    }
    expect(html).not.toContain('data-site-runtime="lightbox"')
    expect(html).toContain("classList.add('s-js')")
    expect(html).toContain('data-s-popup')
  })

  it('shows the new version right after a publish and goes away on unpublish', async () => {
    const { slug, user, base, site } = await publishedSite()
    expect((await fetch(`${BASE_URL}/s/${slug}`)).status).toBe(200)
    await fetch(`${BASE_URL}${base}/${site.id}/publish`, {
      method: 'DELETE',
      headers: { ...defaultHeaders, Cookie: user.cookie },
    })
    expect(await (await fetch(`${BASE_URL}/s/${slug}`)).text()).toContain(
      'Página não encontrada',
    )
  })
})
