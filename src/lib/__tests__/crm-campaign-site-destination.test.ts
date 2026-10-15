import { describe, expect, it } from 'vitest'
import { createCampaignSiteSnapshot } from '@/src/__tests__/factories/campaign-site.factory'
import {
  campaignDestinationUrl,
  withCampaignParams,
} from '@/src/lib/crm-campaign/campaign-url'
import {
  findPublishedSitePage,
  publishedSitePages,
} from '@/src/lib/crm-campaign/site-destination'
import { siteBaseUrl } from '@/src/lib/sites/host'

const BASE = 'https://app.test/s/clinica'

describe('publishedSitePages()', () => {
  it('lists the live pages in order, the home page at the root', () => {
    const pages = publishedSitePages(createCampaignSiteSnapshot(), BASE)
    expect(pages.map((page) => [page.id, page.path, page.url])).toEqual([
      ['home', '', BASE],
      ['contato', 'contato', `${BASE}/contato`],
    ])
    expect(pages[0].isHome).toBe(true)
    expect(pages[1].isHome).toBe(false)
  })

  it('collects the forms of the page, its chrome and the symbols it uses', () => {
    const [home, contato] = publishedSitePages(
      createCampaignSiteSnapshot(),
      BASE,
    )
    expect(home.formTokens.sort()).toEqual(['tok-foot', 'tok-home'])
    expect(contato.formTokens.sort()).toEqual(['tok-foot', 'tok-sym'])
  })
})

describe('findPublishedSitePage()', () => {
  it('finds a live page and ignores unpublished ids', () => {
    const snapshot = createCampaignSiteSnapshot()
    expect(findPublishedSitePage(snapshot, BASE, 'contato')?.url).toBe(
      `${BASE}/contato`,
    )
    expect(findPublishedSitePage(snapshot, BASE, 'nova')).toBeNull()
  })

  it('builds subdomain URLs through the site URL helper', () => {
    const base = siteBaseUrl('clinica', {
      appUrl: 'https://app.test',
      rootDomain: 'sites.test',
    })
    const page = findPublishedSitePage(
      createCampaignSiteSnapshot(),
      base,
      'contato',
    )
    expect(page?.url).toBe('https://clinica.sites.test/contato')
  })
})

describe('campaignDestinationUrl()', () => {
  it('uses the site page URL as is and tokens for forms/landing pages', () => {
    expect(
      campaignDestinationUrl('https://app.test', {
        type: 'SITE_PAGE',
        url: `${BASE}/contato`,
      }),
    ).toBe(`${BASE}/contato`)
    expect(
      campaignDestinationUrl('https://app.test/', { type: 'FORM', token: 't' }),
    ).toBe('https://app.test/f/t')
  })

  it('adds the UTM parameters and the link token to a site page', () => {
    const url = new URL(
      withCampaignParams(`${BASE}/contato`, {
        source: 'whatsapp',
        medium: 'campanha',
        campaign: 'bf',
        ref: 'r1-w.sig',
      }),
    )
    expect(url.pathname).toBe('/s/clinica/contato')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'whatsapp',
      utm_medium: 'campanha',
      utm_campaign: 'bf',
      stc: 'r1-w.sig',
    })
  })
})
