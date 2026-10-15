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

import { SiteRepository } from '@/src/repositories/site.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { SitePublicService } from '../site-public.service'

const sites = vi.mocked(SiteRepository)
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
  it('maps published forms by id with their token', async () => {
    const form = createFakeCrmForm({ id: 'f1', publicToken: 'tok' })
    sites.findPublishedForms.mockResolvedValue(ok([form]))
    const forms = expectOk(
      await SitePublicService.getForms('ws1', ['f1', 'f2']),
    )
    expect(Object.keys(forms)).toEqual(['f1'])
    expect(forms.f1.publicToken).toBe('tok')
    expect(forms.f1.form.id).toBe('f1')
    sites.findPublishedForms.mockResolvedValue(err(databaseError()))
    expectErr(await SitePublicService.getForms('ws1', ['f1']), 'DATABASE_ERROR')
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
