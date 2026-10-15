import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/** Sites — "Buscadores": settings, report, robots.txt per bot, llms.txt,
 * IndexNow key file and verification tags on the published site. */

async function draftSite() {
  const { user, workspace } = await authenticatedOwner()
  const base = `/api/workspaces/${workspace.id}/crm/sites`
  const slug = `e2e-${createId().slice(0, 12)}`
  const site = (
    await (
      await postJson(base, { name: 'Clínica Busca', slug }, user.cookie)
    ).json()
  ).data
  const page = (
    await (
      await postJson(
        `${base}/${site.id}/pages`,
        {
          title: 'Implante',
          document: createSiteDocument('Implante dentário'),
          seo: {
            description: 'Implante dentário com garantia.',
            search: {
              focusKeyword: 'implante dentário',
              summary: 'Implante com garantia de 10 anos em São Paulo.',
              questions: [
                { question: 'Dói?', answer: 'Não: usamos anestesia.' },
              ],
              showUpdatedDate: true,
            },
          },
        },
        user.cookie,
      )
    ).json()
  ).data
  return { user, workspace, base, slug, site, page }
}

describe('search settings API', () => {
  it('prefills, saves and keeps the search block on other saves', async () => {
    const { user, base, site, page } = await draftSite()
    const url = `${base}/${site.id}/search`

    const initial = await getJson(url, user.cookie)
    expect(initial.status).toBe(200)
    const view = (await initial.json()).data
    expect(view.prefilled).toBe(true)
    expect(view.settings.business.name).toBeTruthy()

    const saved = await putJson(
      url,
      {
        business: { name: 'Clínica Busca', phone: '(11) 3333-4444' },
        crawlers: { GPTBot: false, CCBot: false },
        indexNow: { enabled: true },
        verification: { google: 'google-abc', bing: 'BING123' },
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    const after = (await saved.json()).data
    expect(after.prefilled).toBe(false)
    expect(after.settings.indexNow.key).toMatch(/^[a-f0-9]{32}$/)

    expect((await putJson(url, {}, user.cookie)).status).toBe(422)

    // The site settings dialog sends settings without `search`: kept.
    await patchJson(
      `${base}/${site.id}`,
      { settings: { seo: { description: 'Outra' } } },
      user.cookie,
    )
    const kept = (await (await getJson(url, user.cookie)).json()).data
    expect(kept.settings.crawlers).toEqual({ GPTBot: false, CCBot: false })

    // Same for the page SEO.
    await patchJson(
      `${base}/${site.id}/pages/${page.id}`,
      { seo: { title: 'Implante dentário' } },
      user.cookie,
    )
    const reread = (
      await (
        await getJson(`${base}/${site.id}/pages/${page.id}`, user.cookie)
      ).json()
    ).data
    expect(reread.seo.search.focusKeyword).toBe('implante dentário')
  })

  it('reports the three scores and blocks viewers from writing', async () => {
    const { user, workspace, base, site } = await draftSite()
    const report = await getJson(
      `${base}/${site.id}/search/report`,
      user.cookie,
    )
    expect(report.status).toBe(200)
    const data = (await report.json()).data
    expect(data.pages.length).toBeGreaterThan(0)
    expect(data.averages).toEqual({
      seo: expect.any(Number),
      aeo: expect.any(Number),
      geo: expect.any(Number),
    })

    const viewer = await addMember(workspace.id, 'VIEWER')
    expect(
      (await getJson(`${base}/${site.id}/search/report`, viewer.cookie)).status,
    ).toBe(200)
    expect(
      (
        await putJson(
          `${base}/${site.id}/search`,
          { llms: { enabled: false } },
          viewer.cookie,
        )
      ).status,
    ).toBe(403)
  })
})

describe('published site feeds', () => {
  it('serves robots.txt per bot, llms.txt, llms-full.txt and the IndexNow key', async () => {
    const { user, base, slug, site } = await draftSite()
    await putJson(
      `${base}/${site.id}/search`,
      {
        crawlers: { GPTBot: false },
        indexNow: { enabled: true },
        verification: { google: 'google-abc', bing: 'BING123' },
      },
      user.cookie,
    )
    await postJson(`${base}/${site.id}/publish`, {}, user.cookie)

    const robots = await fetch(`${BASE_URL}/s/${slug}/robots.txt`)
    expect(robots.status).toBe(200)
    const robotsTxt = await robots.text()
    expect(robotsTxt).toContain('User-agent: GPTBot\nDisallow: /')
    expect(robotsTxt).toContain('User-agent: *\nAllow: /')
    expect(robotsTxt).toContain(`/s/${slug}/llms.txt`)

    const llms = await fetch(`${BASE_URL}/s/${slug}/llms.txt`)
    expect(llms.status).toBe(200)
    expect(llms.headers.get('content-type')).toContain('text/markdown')
    const llmsTxt = await llms.text()
    expect(llmsTxt).toContain('# ')
    expect(llmsTxt).toContain('## Páginas')
    expect(llmsTxt).toContain('Implante com garantia de 10 anos')
    expect(llmsTxt).toContain('Dói? Não: usamos anestesia.')

    const full = await (
      await fetch(`${BASE_URL}/s/${slug}/llms-full.txt`)
    ).text()
    expect(full).toContain('Implante dentário')

    const key = await fetch(`${BASE_URL}/s/${slug}/indexnow-key.txt`)
    expect(key.status).toBe(200)
    expect(await key.text()).toMatch(/^[a-f0-9]{32}$/)

    const html = await (await fetch(`${BASE_URL}/s/${slug}/implante`)).text()
    expect(html).toContain(
      'name="google-site-verification" content="google-abc"',
    )
    expect(html).toContain('name="msvalidate.01" content="BING123"')
    expect(html).toContain(
      '"abstract":"Implante com garantia de 10 anos em São Paulo."',
    )
    expect(html).toContain('class="ss-updated"')

    const sitemap = await (
      await fetch(`${BASE_URL}/s/${slug}/sitemap.xml`)
    ).text()
    expect(sitemap).toContain('<lastmod>')
  })

  it('hides llms.txt when turned off and 404s for unknown sites', async () => {
    const { user, base, slug, site } = await draftSite()
    await putJson(
      `${base}/${site.id}/search`,
      { llms: { enabled: false } },
      user.cookie,
    )
    await postJson(`${base}/${site.id}/publish`, {}, user.cookie)
    expect((await fetch(`${BASE_URL}/s/${slug}/llms.txt`)).status).toBe(404)
    expect((await fetch(`${BASE_URL}/s/${slug}/llms-full.txt`)).status).toBe(
      404,
    )
    expect((await fetch(`${BASE_URL}/s/${slug}/indexnow-key.txt`)).status).toBe(
      404,
    )
    const robots = await (
      await fetch(`${BASE_URL}/s/${slug}/robots.txt`)
    ).text()
    expect(robots).not.toContain('llms.txt')

    const unknown = `nao-existe-${createId().slice(0, 10)}`
    expect((await fetch(`${BASE_URL}/s/${unknown}/llms.txt`)).status).toBe(404)
    expect((await fetch(`${BASE_URL}/s/${unknown}/robots.txt`)).status).toBe(
      404,
    )
  })
})
