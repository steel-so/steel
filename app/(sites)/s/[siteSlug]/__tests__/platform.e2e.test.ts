import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
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

/** Sites wave S2 (platform): own root layout, CSP, SEO, redirects,
 * metrics and conversions. */

async function publishedSite(settings: Record<string, unknown> = {}) {
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
            ...settings,
          },
        },
        user.cookie,
      )
    ).json()
  ).data
  const page = (
    await (
      await postJson(
        `${base}/${site.id}/pages`,
        {
          title: 'Contato',
          document: createSiteDocument('Fale com a gente'),
          seo: { sitemapPriority: 0.8, changeFrequency: 'weekly' },
        },
        user.cookie,
      )
    ).json()
  ).data
  await postJson(`${base}/${site.id}/publish`, {}, user.cookie)
  return { slug, user, workspace, base, site, page }
}

describe('published site document', () => {
  it('has its own head: lang, CSP, JSON-LD, icon and no Steel markup', async () => {
    const { slug } = await publishedSite({
      tracking: { metaPixelId: '1234567' },
    })
    const res = await fetch(`${BASE_URL}/s/${slug}/contato`)
    expect(res.status).toBe(200)
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain('https://connect.facebook.net')
    expect(csp).not.toContain('axiom.co')
    const html = await res.text()
    expect(html).toContain('<html lang="pt-BR"')
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain('"@type":"BreadcrumbList"')
    expect(html).toContain('/_og?page=')
    expect(html).toContain('data:image/svg+xml')
    expect(html).toContain('id="ss-cookie"')
    expect(html).not.toContain('theme-init.js')
    expect(html).not.toContain('Steel — ServiceDesk')
  })

  it('serves the generated social card and sitemap priorities', async () => {
    const { slug, page } = await publishedSite()
    const card = await fetch(`${BASE_URL}/s/${slug}/_og?page=${page.id}`)
    expect(card.status).toBe(200)
    expect(card.headers.get('content-type')).toContain('image/png')
    const sitemap = await (
      await fetch(`${BASE_URL}/s/${slug}/sitemap.xml`)
    ).text()
    expect(sitemap).toContain(
      '<changefreq>weekly</changefreq><priority>0.8</priority>',
    )
    const missing = await fetch(`${BASE_URL}/s/${slug}/_og?page=x`)
    expect(missing.status).toBe(200)
    expect(
      (await fetch(`${BASE_URL}/s/nao-existe-${createId()}/_og`)).status,
    ).toBe(404)
  })
})

describe('site redirects', () => {
  it('manages redirects that apply right away', async () => {
    const { slug, user, base, site } = await publishedSite()
    const redirects = `${base}/${site.id}/redirects`

    const created = await postJson(
      redirects,
      { fromPath: '/Fale-Conosco/', toPath: '/contato' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const redirect = (await created.json()).data
    expect(redirect.fromPath).toBe('/fale-conosco')

    const moved = await fetch(`${BASE_URL}/s/${slug}/fale-conosco`, {
      redirect: 'manual',
    })
    expect(moved.status).toBe(308)
    expect(moved.headers.get('location')).toContain(`/s/${slug}/contato`)

    expect(
      (
        await postJson(
          redirects,
          { fromPath: '/contato', toPath: '/fale-conosco' },
          user.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (
        await postJson(
          redirects,
          { fromPath: '/fale-conosco', toPath: '/x' },
          user.cookie,
        )
      ).status,
    ).toBe(409)
    expect(
      (await postJson(redirects, { fromPath: 'x', toPath: 'y' }, user.cookie))
        .status,
    ).toBe(422)

    const updated = await patchJson(
      `${redirects}/${redirect.id}`,
      { permanent: false },
      user.cookie,
    )
    expect((await updated.json()).data.permanent).toBe(false)
    const temporary = await fetch(`${BASE_URL}/s/${slug}/fale-conosco`, {
      redirect: 'manual',
    })
    expect(temporary.status).toBe(307)

    const list = await getJson(redirects, user.cookie)
    expect((await list.json()).data).toHaveLength(1)
    expect(
      (await deleteJson(`${redirects}/${redirect.id}`, user.cookie)).status,
    ).toBe(200)
    const gone = await fetch(`${BASE_URL}/s/${slug}/fale-conosco`, {
      redirect: 'manual',
    })
    expect(gone.status).toBe(404)
  })

  it('denies strangers and viewers', async () => {
    const { workspace, base, site } = await publishedSite()
    const redirects = `${base}/${site.id}/redirects`
    const stranger = await createAuthenticatedUser()
    expect((await getJson(redirects, stranger.cookie)).status).toBe(403)
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(redirects, viewer.cookie)).status).toBe(200)
    expect(
      (
        await postJson(
          redirects,
          { fromPath: '/a', toPath: '/b' },
          viewer.cookie,
        )
      ).status,
    ).toBe(403)
    const res = await fetch(`${BASE_URL}${redirects}`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })
})

describe('site metrics', () => {
  it('counts views and conversions and summarizes every site', async () => {
    const { slug, user, base, site, page } = await publishedSite()
    const beacon = `${BASE_URL}/api/sites/${slug}/views`
    for (const body of [
      { pageId: page.id, path: '/contato', utmSource: 'ig' },
      { pageId: page.id, path: '/contato', referrer: 'https://google.com/' },
      {
        pageId: page.id,
        path: '/contato',
        kind: 'CONVERSION',
        formToken: 'tok',
      },
    ]) {
      const res = await fetch(beacon, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(202)
    }

    const res = await getJson(`${base}/${site.id}/analytics`, user.cookie)
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.totals.views).toBe(2)
    expect(data.totals.conversions).toBe(1)
    expect(data.days).toHaveLength(30)
    expect(data.topPages[0]).toMatchObject({
      key: '/contato',
      label: 'Contato',
    })
    expect(data.utmSources[0].key).toBe('ig')
    expect(data.conversionsByPage[0]).toMatchObject({
      path: '/contato',
      conversions: 1,
    })

    expect(
      (
        await getJson(
          `${base}/${site.id}/analytics?from=2026-13-01`,
          user.cookie,
        )
      ).status,
    ).toBe(422)

    const summary = await getJson(`${base}/analytics?days=7`, user.cookie)
    const sites = (await summary.json()).data.sites
    expect(sites[0]).toMatchObject({ siteId: site.id, total: 2 })
    expect(sites[0].views).toHaveLength(7)
    expect(
      (await getJson(`${base}/analytics?days=2`, user.cookie)).status,
    ).toBe(422)
  })
})
