import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmForm } from '@/src/__tests__/factories/crm-form.factory'
import {
  createFakeSite,
  createFakeSnapshot,
} from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/crm-newsletter.repository')
vi.mock('@/src/services/crm-campaign-tracking.service', () => ({
  CrmCampaignTrackingService: { attribute: vi.fn() },
}))
vi.mock('@/src/repositories/site-redirect.repository')
vi.mock('@/src/services/site-blog-public.service', () => ({
  SiteBlogPublicService: {
    routePaths: vi.fn(async () => ({ ok: true, value: [] })),
  },
}))
vi.mock('@/src/cache/site-route.cache', () => ({
  siteRouteCache: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    invalidate: vi.fn(async () => {}),
  },
}))

import { siteRouteCache } from '@/src/cache/site-route.cache'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteRedirectRepository } from '@/src/repositories/site-redirect.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { crmFormNewsletterConsentText } from '@/src/schemas/crm-newsletter.schema'
import { SiteBlogPublicService } from '@/src/services/site-blog-public.service'
import { CrmCampaignTrackingService } from '../crm-campaign-tracking.service'
import { SitePublicService } from '../site-public.service'

const sites = vi.mocked(SiteRepository)
const newsletters = vi.mocked(CrmNewsletterRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const createdAt = new Date('2026-10-14T12:00:00Z')
const live = {
  ...createFakeSite({ id: 'site1', slug: 'clinica', status: 'PUBLISHED' }),
  publishedVersion: {
    id: 'v1',
    snapshot: createFakeSnapshot() as never,
    createdAt,
  },
}

beforeEach(() => {
  sites.findPublishedBySlug.mockResolvedValue(ok(live))
  sites.recordView.mockResolvedValue(ok(undefined))
})

describe('SitePublicService.getPublished', () => {
  it('returns the live snapshot', async () => {
    const site = expectOk(await SitePublicService.getPublished('clinica'))
    expect(site).toMatchObject({
      id: 'site1',
      slug: 'clinica',
      publishedAt: createdAt.toISOString(),
    })
    expect(site.baseUrl).toMatch(/\/s\/clinica$/)
    expect(site.snapshot.pages[0].id).toBe('home')
  })

  it('hides sites of a disabled module, unreadable snapshots and misses', async () => {
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(await SitePublicService.getPublished('clinica'), 'SITE_NOT_FOUND')

    sites.findPublishedBySlug.mockResolvedValueOnce(
      ok({
        ...live,
        publishedVersion: { ...live.publishedVersion, snapshot: {} },
      }),
    )
    expectErr(await SitePublicService.getPublished('clinica'), 'SITE_NOT_FOUND')

    sites.findPublishedBySlug.mockResolvedValueOnce(
      err(appError('SITE_NOT_FOUND', 'x')),
    )
    expectErr(await SitePublicService.getPublished('nope'), 'SITE_NOT_FOUND')
  })
})

describe('SitePublicService.getForms', () => {
  it('maps published forms by their public token in the catalog shape', async () => {
    const form = createFakeCrmForm({
      id: 'f1',
      publicToken: 'tok',
      successMessage: 'Valeu',
      fields: [
        {
          key: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          mapping: { target: 'person', attribute: 'name' },
        },
        {
          key: 'plano',
          label: 'Plano',
          type: 'select',
          required: false,
          placeholder: 'Escolha',
          options: [{ label: 'A', value: 'a' }],
          mapping: { target: 'person', attribute: 'name' },
        },
      ] as never,
    })
    sites.findPublishedForms.mockResolvedValue(ok([form]))
    const forms = expectOk(
      await SitePublicService.getForms('ws1', ['tok', 'other']),
    )
    expect(Object.keys(forms)).toEqual(['tok'])
    expect(forms.tok).toEqual({
      fields: [
        { key: 'nome', label: 'Nome', type: 'text', required: true },
        {
          key: 'plano',
          label: 'Plano',
          type: 'select',
          required: false,
          placeholder: 'Escolha',
          options: [{ label: 'A', value: 'a' }],
        },
      ],
      successMessage: 'Valeu',
      redirectUrl: null,
    })
    sites.findPublishedForms.mockResolvedValue(err(databaseError()))
    expectErr(
      await SitePublicService.getForms('ws1', ['tok']),
      'DATABASE_ERROR',
    )
  })
})

describe('SitePublicService.getForms — newsletter consent', () => {
  it('adds the consent text only for forms of an ACTIVE newsletter', async () => {
    sites.findPublishedForms.mockResolvedValue(
      ok([
        createFakeCrmForm({ publicToken: 'a', newsletterId: 'n1' }),
        createFakeCrmForm({ publicToken: 'b', newsletterId: 'n-paused' }),
        createFakeCrmForm({ publicToken: 'c', newsletterId: null }),
      ]),
    )
    newsletters.listActiveByWorkspace.mockResolvedValue(
      ok([{ id: 'n1', name: 'Boletim' }] as never),
    )
    const forms = expectOk(
      await SitePublicService.getForms('ws1', ['a', 'b', 'c']),
    )
    expect(newsletters.listActiveByWorkspace).toHaveBeenCalledWith('ws1')
    expect(forms.a.newsletter).toEqual({
      name: 'Boletim',
      consentText: crmFormNewsletterConsentText('Boletim'),
    })
    expect(forms.b).not.toHaveProperty('newsletter')
    expect(forms.c).not.toHaveProperty('newsletter')
  })

  it('skips the newsletter lookup when no form has one', async () => {
    newsletters.listActiveByWorkspace.mockClear()
    sites.findPublishedForms.mockResolvedValue(
      ok([createFakeCrmForm({ publicToken: 'c', newsletterId: null })]),
    )
    expectOk(await SitePublicService.getForms('ws1', ['c']))
    expect(newsletters.listActiveByWorkspace).not.toHaveBeenCalled()
  })

  it('propagates a database error of the newsletter lookup', async () => {
    sites.findPublishedForms.mockResolvedValue(
      ok([createFakeCrmForm({ publicToken: 'a', newsletterId: 'n1' })]),
    )
    newsletters.listActiveByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await SitePublicService.getForms('ws1', ['a']), 'DATABASE_ERROR')
  })
})

describe('SitePublicService.recordView', () => {
  const request = {
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    host: 'clinica.sites.app',
    now: new Date('2026-10-14T10:00:00Z'),
  }

  it('records an anonymous view of a known page', async () => {
    expectOk(
      await SitePublicService.recordView('clinica', request, {
        pageId: 'home',
        path: '/',
        referrer: 'https://www.google.com/search?q=x',
        utmSource: 'instagram',
      }),
    )
    const view = sites.recordView.mock.calls[0][0]
    expect(view).toMatchObject({
      siteId: 'site1',
      pageId: 'home',
      path: '/',
      referrer: 'www.google.com',
      utmSource: 'instagram',
    })
    expect(view.visitorHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(view)).not.toContain(request.ip)
  })

  it('drops unknown page ids and same-site referrers', async () => {
    const { now: _now, ...withoutClock } = request
    await SitePublicService.recordView('clinica', withoutClock, {
      pageId: 'ghost',
      path: '/x',
      referrer: 'https://clinica.sites.app/a',
    })
    expect(sites.recordView.mock.calls[0][0]).toMatchObject({
      pageId: null,
      referrer: null,
    })
    await SitePublicService.recordView('clinica', request, { path: '' })
    expect(sites.recordView.mock.calls[1][0].pageId).toBeNull()
  })

  it('records form conversions with their token only', async () => {
    await SitePublicService.recordView('clinica', request, {
      pageId: 'home',
      path: '/',
      kind: 'CONVERSION',
      formToken: 'tok',
    })
    expect(sites.recordView.mock.calls[0][0]).toMatchObject({
      kind: 'CONVERSION',
      formToken: 'tok',
    })
    await SitePublicService.recordView('clinica', request, {
      path: '/',
      kind: 'VIEW',
      formToken: 'tok',
    })
    expect(sites.recordView.mock.calls[1][0]).toMatchObject({
      kind: 'VIEW',
      formToken: undefined,
    })
  })

  it('attributes campaign views once per visitor, page and day', async () => {
    const attribute = vi.mocked(CrmCampaignTrackingService.attribute)
    attribute.mockResolvedValue(ok(true))
    expectOk(
      await SitePublicService.recordView('clinica', request, {
        pageId: 'home',
        path: '/',
        utmCampaign: 'bf',
        utmSource: 'email',
        ref: 'r1-e.sig',
      }),
    )
    const hash = sites.recordView.mock.calls[0][0].visitorHash
    expect(attribute).toHaveBeenCalledWith(
      {
        workspaceId: live.workspaceId,
        kind: 'SITE_VIEW',
        sourceRef: `${hash}:home`,
        ref: { ref: 'r1-e.sig', utmCampaign: 'bf', utmSource: 'email' },
        siteId: 'site1',
        sitePageId: 'home',
      },
      request.now,
    )

    // An unknown page keys on the path; a failed attribution never fails
    // the beacon.
    attribute.mockResolvedValueOnce(err(databaseError('x')))
    expectOk(
      await SitePublicService.recordView('clinica', request, {
        path: '/x',
        utmCampaign: 'bf',
      }),
    )
    expect(attribute.mock.lastCall?.[0]).toMatchObject({
      sourceRef: `${hash}:/x`,
      sitePageId: undefined,
    })
  })

  it('skips attribution without campaign parameters, for conversions and on failures', async () => {
    const attribute = vi.mocked(CrmCampaignTrackingService.attribute)
    await SitePublicService.recordView('clinica', request, {
      pageId: 'home',
      path: '/',
      utmSource: 'instagram',
    })
    await SitePublicService.recordView('clinica', request, {
      pageId: 'home',
      path: '/',
      kind: 'CONVERSION',
      formToken: 'tok',
      utmCampaign: 'bf',
    })
    sites.recordView.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SitePublicService.recordView('clinica', request, {
        path: '/',
        utmCampaign: 'bf',
      }),
      'DATABASE_ERROR',
    )
    expect(attribute).not.toHaveBeenCalled()
  })

  it('refuses unpublished sites', async () => {
    sites.findPublishedBySlug.mockResolvedValueOnce(
      err(appError('SITE_NOT_FOUND', 'x')),
    )
    expectErr(
      await SitePublicService.recordView('x', request, { path: '' }),
      'SITE_NOT_FOUND',
    )
    expect(sites.recordView).not.toHaveBeenCalled()
  })
})

describe('SitePublicService.landingRedirect', () => {
  it('points migrated landing pages to their site', async () => {
    sites.findPublishedSlugByLandingShareToken.mockResolvedValueOnce(
      ok('clinica'),
    )
    expect(expectOk(await SitePublicService.landingRedirect('tok'))).toMatch(
      /\/s\/clinica$/,
    )
    sites.findPublishedSlugByLandingShareToken.mockResolvedValueOnce(ok(null))
    expect(expectOk(await SitePublicService.landingRedirect('tok'))).toBeNull()
    sites.findPublishedSlugByLandingShareToken.mockResolvedValueOnce(
      err(databaseError()),
    )
    expectErr(await SitePublicService.landingRedirect('tok'), 'DATABASE_ERROR')
  })
})

describe('SitePublicService.routeIndex', () => {
  const cache = vi.mocked(siteRouteCache)
  const redirects = vi.mocked(SiteRedirectRepository)

  it('builds the index of a live site and caches it', async () => {
    cache.get.mockResolvedValueOnce(null)
    redirects.listBySiteSlug.mockResolvedValueOnce(
      ok([
        {
          id: 'r1',
          siteId: 'site1',
          fromPath: '/antigo',
          toPath: '/',
          permanent: true,
          createdAt,
          updatedAt: createdAt,
        },
      ]),
    )
    const index = expectOk(await SitePublicService.routeIndex('clinica'))
    expect(index).toEqual({
      published: true,
      name: 'Clínica',
      paths: ['/'],
      redirects: [{ fromPath: '/antigo', toPath: '/', permanent: true }],
    })
    expect(cache.set).toHaveBeenCalledWith('clinica', index)
  })

  it('adds the blog and collection paths', async () => {
    cache.get.mockResolvedValueOnce(null)
    redirects.listBySiteSlug.mockResolvedValueOnce(ok([]))
    vi.mocked(SiteBlogPublicService.routePaths).mockResolvedValueOnce(
      ok(['/blog', '/blog/Ola']),
    )
    expect(
      expectOk(await SitePublicService.routeIndex('clinica')).paths,
    ).toEqual(['/', '/blog', '/blog/ola'])
    cache.get.mockResolvedValueOnce(null)
    redirects.listBySiteSlug.mockResolvedValueOnce(ok([]))
    vi.mocked(SiteBlogPublicService.routePaths).mockResolvedValueOnce(
      err(databaseError()),
    )
    expectErr(await SitePublicService.routeIndex('clinica'), 'DATABASE_ERROR')
  })

  it('serves the cache and marks unknown sites unpublished', async () => {
    const cached = { published: true, paths: ['/x'], redirects: [] }
    cache.get.mockResolvedValueOnce(cached)
    expect(expectOk(await SitePublicService.routeIndex('clinica'))).toBe(cached)
    expect(sites.findPublishedBySlug).not.toHaveBeenCalled()

    cache.get.mockResolvedValueOnce(null)
    sites.findPublishedBySlug.mockResolvedValueOnce(
      err(appError('SITE_NOT_FOUND', 'x')),
    )
    expect(expectOk(await SitePublicService.routeIndex('nada')).published).toBe(
      false,
    )
  })

  it('propagates database failures without caching them', async () => {
    cache.get.mockResolvedValue(null)
    sites.findPublishedBySlug.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SitePublicService.routeIndex('clinica'), 'DATABASE_ERROR')
    redirects.listBySiteSlug.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SitePublicService.routeIndex('clinica'), 'DATABASE_ERROR')
    expect(cache.set).not.toHaveBeenCalled()
  })
})
