import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSiteGlobal,
  createSiteDocument,
} from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { siteCatalog } from '@/src/lib/canvas-site'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-global.repository')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { MAX_GLOBALS_PER_SITE, SiteGlobalService } from '../site-global.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const globals = vi.mocked(SiteGlobalRepository)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const SITE = 'site1'
const header = createFakeSiteGlobal({ id: 'g1', siteId: SITE })

beforeEach(() => {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
  sites.findById.mockResolvedValue(
    ok(createFakeSite({ id: SITE, workspaceId: WS })),
  )
  globals.findById.mockResolvedValue(ok(header))
  globals.countByKind.mockResolvedValue(ok(0))
  globals.create.mockImplementation(async (data) =>
    ok(createFakeSiteGlobal({ ...data, document: data.document as never })),
  )
  globals.update.mockResolvedValue(ok(header))
  globals.delete.mockResolvedValue(ok(undefined))
})

describe('SiteGlobalService', () => {
  it('lists and gets globals', async () => {
    globals.listBySite.mockResolvedValue(ok([header]))
    expect(expectOk(await SiteGlobalService.list('u1', WS, SITE))).toHaveLength(
      1,
    )
    expect(expectOk(await SiteGlobalService.get('u1', WS, SITE, 'g1')).id).toBe(
      'g1',
    )
    globals.listBySite.mockResolvedValue(err(databaseError()))
    expectErr(await SiteGlobalService.list('u1', WS, SITE), 'DATABASE_ERROR')
    globals.findById.mockResolvedValueOnce(
      err(appError('SITE_GLOBAL_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteGlobalService.get('u1', WS, SITE, 'x'),
      'SITE_GLOBAL_NOT_FOUND',
    )
  })

  it('creates a header with an empty document and symbols freely', async () => {
    const created = expectOk(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'HEADER',
        name: 'Topo',
      }),
    )
    expect(created.kind).toBe('HEADER')
    expect(globals.countByKind).toHaveBeenCalledWith(SITE, 'HEADER')
    globals.countByKind.mockClear()
    await SiteGlobalService.create('u1', WS, SITE, {
      kind: 'SYMBOL',
      name: 'CTA',
      document: createSiteDocument(),
    })
    expect(globals.countByKind).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_global', action: 'create' }),
    )
  })

  it('allows one header and one footer', async () => {
    globals.countByKind.mockImplementation(async (_siteId, kind) =>
      ok(kind ? 1 : 2),
    )
    const headerTaken = expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'HEADER',
        name: 'x',
      }),
      'SITE_GLOBAL_KIND_TAKEN',
    )
    expect(headerTaken.message).toContain('cabeçalho')
    const footerTaken = expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'FOOTER',
        name: 'x',
      }),
      'SITE_GLOBAL_KIND_TAKEN',
    )
    expect(footerTaken.message).toContain('rodapé')
  })

  it('enforces limits and validates documents on create', async () => {
    globals.countByKind.mockResolvedValueOnce(ok(MAX_GLOBALS_PER_SITE))
    expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'SYMBOL',
        name: 'x',
      }),
      'SITE_LIMIT_REACHED',
    )
    globals.countByKind.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'SYMBOL',
        name: 'x',
      }),
      'DATABASE_ERROR',
    )
    globals.countByKind
      .mockResolvedValueOnce(ok(0))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'FOOTER',
        name: 'x',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'SYMBOL',
        name: 'x',
        document: { catalog: 'email' } as never,
      }),
      'SITE_DOCUMENT_INVALID',
    )
    globals.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'SYMBOL',
        name: 'x',
      }),
      'DATABASE_ERROR',
    )
  })

  it('updates name and document', async () => {
    expectOk(
      await SiteGlobalService.update('u1', WS, SITE, 'g1', {
        name: 'Novo',
        document: createSiteDocument(),
      }),
    )
    expect(globals.update.mock.calls[0][1].name).toBe('Novo')
    await SiteGlobalService.update('u1', WS, SITE, 'g1', { name: 'Só nome' })
    expect(globals.update.mock.calls[1][1].document).toBeUndefined()
    expectErr(
      await SiteGlobalService.update('u1', WS, SITE, 'g1', {
        document: {} as never,
      }),
      'SITE_DOCUMENT_INVALID',
    )
    globals.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteGlobalService.update('u1', WS, SITE, 'g1', { name: 'x' }),
      'DATABASE_ERROR',
    )
    globals.findById.mockResolvedValueOnce(
      err(appError('SITE_GLOBAL_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteGlobalService.update('u1', WS, SITE, 'x', { name: 'x' }),
      'SITE_GLOBAL_NOT_FOUND',
    )
  })

  it('removes a global', async () => {
    expectOk(await SiteGlobalService.remove('u1', WS, SITE, 'g1'))
    expect(globals.delete).toHaveBeenCalledWith('g1')
    globals.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteGlobalService.remove('u1', WS, SITE, 'g1'),
      'DATABASE_ERROR',
    )
    globals.findById.mockResolvedValueOnce(
      err(appError('SITE_GLOBAL_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteGlobalService.remove('u1', WS, SITE, 'x'),
      'SITE_GLOBAL_NOT_FOUND',
    )
  })

  it('blocks viewers and foreign sites', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'VIEWER' })),
    )
    expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'SYMBOL',
        name: 'x',
      }),
      'FORBIDDEN',
    )
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'OWNER' })),
    )
    sites.findById.mockResolvedValue(err(appError('SITE_NOT_FOUND', 'x')))
    for (const call of [
      () => SiteGlobalService.list('u1', WS, SITE),
      () => SiteGlobalService.get('u1', WS, SITE, 'g1'),
      () => SiteGlobalService.update('u1', WS, SITE, 'g1', { name: 'x' }),
      () => SiteGlobalService.remove('u1', WS, SITE, 'g1'),
    ]) {
      expectErr(await call(), 'SITE_NOT_FOUND')
    }
  })
})

describe('SiteGlobalService admin-only elements', () => {
  const withEmbed = () => {
    const doc = createSiteDocument()
    doc.nodes.s1.children = ['h1', 'e1']
    doc.nodes.e1 = {
      id: 'e1',
      type: 'site.embed',
      props: siteCatalog.components['site.embed'].defaultProps(),
    }
    return doc
  }

  it('blocks members and keeps untouched embeds on update', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'SYMBOL',
        name: 'x',
        document: withEmbed(),
      }),
      'FORBIDDEN',
    )
    globals.findById.mockResolvedValue(
      ok({ ...header, document: withEmbed() as never }),
    )
    expectOk(
      await SiteGlobalService.update('u1', WS, SITE, 'g1', {
        document: withEmbed(),
      }),
    )
  })
})

describe('SiteGlobalService reusable components', () => {
  const withInstance = () => {
    const doc = createSiteDocument()
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        root: { ...doc.nodes.root, children: ['s1', 'i1'] },
        i1: {
          id: 'i1',
          type: 'site.symbol',
          props: { symbolId: 'other', overrides: {} },
        },
      },
    }
  }

  it('refuses a component inside a component', async () => {
    expectErr(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'SYMBOL',
        name: 'CTA',
        document: withInstance(),
      }),
      'SITE_DOCUMENT_INVALID',
    )
    globals.findById.mockResolvedValueOnce(
      ok(createFakeSiteGlobal({ id: 'g2', siteId: SITE, kind: 'SYMBOL' })),
    )
    expectErr(
      await SiteGlobalService.update('u1', WS, SITE, 'g2', {
        document: withInstance(),
      }),
      'SITE_DOCUMENT_INVALID',
    )
    expect(globals.create).not.toHaveBeenCalled()
    expect(globals.update).not.toHaveBeenCalled()
  })

  it('lets a header hold component instances', async () => {
    expectOk(
      await SiteGlobalService.create('u1', WS, SITE, {
        kind: 'HEADER',
        name: 'Topo',
        document: withInstance(),
      }),
    )
    expectOk(
      await SiteGlobalService.update('u1', WS, SITE, 'g1', {
        document: withInstance(),
      }),
    )
  })
})
