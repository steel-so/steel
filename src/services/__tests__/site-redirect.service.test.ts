import type { Role, SiteRedirect } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeSite } from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-redirect.repository')
vi.mock('@/src/lib/sites/cache')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { revalidateSites } from '@/src/lib/sites/cache'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteRedirectRepository } from '@/src/repositories/site-redirect.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  MAX_REDIRECTS_PER_SITE,
  SiteRedirectService,
} from '../site-redirect.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const redirects = vi.mocked(SiteRedirectRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const audit = vi.mocked(auditMutation)
const revalidate = vi.mocked(revalidateSites)

const WS = 'ws1'
const SITE = 'site1'
const site = createFakeSite({ id: SITE, workspaceId: WS, slug: 'clinica' })

function redirect(overrides: Partial<SiteRedirect> = {}): SiteRedirect {
  const now = new Date('2026-10-15T00:00:00Z')
  return {
    id: 'r1',
    siteId: SITE,
    fromPath: '/antigo',
    toPath: '/novo',
    permanent: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  asRole('MEMBER')
  sites.findById.mockResolvedValue(ok(site))
  redirects.listBySite.mockResolvedValue(ok([redirect()]))
  redirects.findById.mockResolvedValue(ok(redirect()))
  redirects.create.mockImplementation(async (data) =>
    ok(redirect({ id: 'r2', ...data })),
  )
  redirects.update.mockImplementation(async (id, data) =>
    ok(redirect({ id, ...data })),
  )
  redirects.delete.mockResolvedValue(ok(undefined))
})

describe('SiteRedirectService authorization', () => {
  it('blocks non-members, a disabled module, viewers and other workspaces', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await SiteRedirectService.list('u1', WS, SITE), 'FORBIDDEN')

    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(await SiteRedirectService.list('u1', WS, SITE), 'MODULE_DISABLED')

    asRole('VIEWER')
    expectOk(await SiteRedirectService.list('u1', WS, SITE))
    expectErr(
      await SiteRedirectService.create('u1', WS, SITE, {
        fromPath: '/a',
        toPath: '/b',
        permanent: true,
      }),
      'FORBIDDEN',
    )
    expectErr(
      await SiteRedirectService.update('u1', WS, SITE, 'r1', { toPath: '/x' }),
      'FORBIDDEN',
    )
    expectErr(
      await SiteRedirectService.remove('u1', WS, SITE, 'r1'),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    sites.findById.mockResolvedValueOnce(err(appError('SITE_NOT_FOUND', 'x')))
    expectErr(
      await SiteRedirectService.list('u1', 'other-ws', SITE),
      'SITE_NOT_FOUND',
    )
    expect(redirects.create).not.toHaveBeenCalled()
  })
})

describe('SiteRedirectService', () => {
  it('lists the redirects of the site', async () => {
    const list = expectOk(await SiteRedirectService.list('u1', WS, SITE))
    expect(list).toEqual([
      expect.objectContaining({ fromPath: '/antigo', toPath: '/novo' }),
    ])
    expect(redirects.listBySite).toHaveBeenCalledWith(SITE)
    redirects.listBySite.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteRedirectService.list('u1', WS, SITE), 'DATABASE_ERROR')
  })

  it('creates a redirect, expires the site cache and audits it', async () => {
    const created = expectOk(
      await SiteRedirectService.create('u1', WS, SITE, {
        fromPath: '/blog/*',
        toPath: '/novidades/*',
        permanent: false,
      }),
    )
    expect(created).toMatchObject({ id: 'r2', permanent: false })
    expect(redirects.create).toHaveBeenCalledWith({
      siteId: SITE,
      fromPath: '/blog/*',
      toPath: '/novidades/*',
      permanent: false,
    })
    expect(revalidate).toHaveBeenCalledWith('clinica')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_redirect', action: 'create' }),
    )
  })

  it('refuses loops, the limit and propagates repository errors', async () => {
    expectErr(
      await SiteRedirectService.create('u1', WS, SITE, {
        fromPath: '/novo',
        toPath: '/antigo',
        permanent: true,
      }),
      'SITE_REDIRECT_LOOP',
    )
    redirects.listBySite.mockResolvedValueOnce(
      ok(
        Array.from({ length: MAX_REDIRECTS_PER_SITE }, (_, i) =>
          redirect({ id: `r${i}`, fromPath: `/p${i}` }),
        ),
      ),
    )
    expectErr(
      await SiteRedirectService.create('u1', WS, SITE, {
        fromPath: '/a',
        toPath: '/b',
        permanent: true,
      }),
      'SITE_LIMIT_REACHED',
    )
    redirects.listBySite.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteRedirectService.create('u1', WS, SITE, {
        fromPath: '/a',
        toPath: '/b',
        permanent: true,
      }),
      'DATABASE_ERROR',
    )
    redirects.create.mockResolvedValueOnce(
      err(appError('SITE_REDIRECT_PATH_TAKEN', 'x')),
    )
    expectErr(
      await SiteRedirectService.create('u1', WS, SITE, {
        fromPath: '/antigo',
        toPath: '/b',
        permanent: true,
      }),
      'SITE_REDIRECT_PATH_TAKEN',
    )
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('updates a redirect checking loops against the others', async () => {
    redirects.listBySite.mockResolvedValue(
      ok([redirect(), redirect({ id: 'r2', fromPath: '/b', toPath: '/c' })]),
    )
    const updated = expectOk(
      await SiteRedirectService.update('u1', WS, SITE, 'r1', {
        toPath: '/b',
      }),
    )
    expect(updated.toPath).toBe('/b')
    expect(redirects.update).toHaveBeenCalledWith('r1', { toPath: '/b' })
    expect(revalidate).toHaveBeenCalledWith('clinica')

    // Its own old rule does not count: /antigo → /antigo2 is fine.
    expectOk(
      await SiteRedirectService.update('u1', WS, SITE, 'r1', {
        fromPath: '/antigo',
        toPath: '/antigo2',
        permanent: false,
      }),
    )
    expectOk(
      await SiteRedirectService.update('u1', WS, SITE, 'r1', {
        permanent: false,
      }),
    )
    // r2 (/b → /c) + r1 (/c → /b) closes a loop.
    expectErr(
      await SiteRedirectService.update('u1', WS, SITE, 'r1', {
        fromPath: '/c',
        toPath: '/b',
      }),
      'SITE_REDIRECT_LOOP',
    )
  })

  it('propagates update failures', async () => {
    redirects.findById.mockResolvedValueOnce(
      err(appError('SITE_REDIRECT_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteRedirectService.update('u1', WS, SITE, 'x', { toPath: '/a' }),
      'SITE_REDIRECT_NOT_FOUND',
    )
    redirects.listBySite.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteRedirectService.update('u1', WS, SITE, 'r1', { toPath: '/a' }),
      'DATABASE_ERROR',
    )
    redirects.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteRedirectService.update('u1', WS, SITE, 'r1', { toPath: '/a' }),
      'DATABASE_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
  })

  it('removes a redirect', async () => {
    expectOk(await SiteRedirectService.remove('u1', WS, SITE, 'r1'))
    expect(redirects.delete).toHaveBeenCalledWith('r1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_redirect', action: 'delete' }),
    )
    redirects.findById.mockResolvedValueOnce(
      err(appError('SITE_REDIRECT_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteRedirectService.remove('u1', WS, SITE, 'x'),
      'SITE_REDIRECT_NOT_FOUND',
    )
    redirects.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteRedirectService.remove('u1', WS, SITE, 'r1'),
      'DATABASE_ERROR',
    )
  })

  it('serves the rules of a slug to the runtime', async () => {
    redirects.listBySiteSlug.mockResolvedValueOnce(ok([redirect()]))
    expect(expectOk(await SiteRedirectService.rulesForSlug('clinica'))).toEqual(
      [{ fromPath: '/antigo', toPath: '/novo', permanent: true }],
    )
    redirects.listBySiteSlug.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteRedirectService.rulesForSlug('clinica'),
      'DATABASE_ERROR',
    )
  })
})
