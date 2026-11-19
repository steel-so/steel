import type { BioLink, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/bio-link.repository')
vi.mock('@/src/lib/bio-link/cache')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { revalidateBioLinks } from '@/src/lib/bio-link/cache'
import {
  BioLinkEventRepository,
  BioLinkLookupRepository,
  BioLinkRepository,
} from '@/src/repositories/bio-link.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { DEFAULT_BIO_THEME } from '@/src/schemas/bio-link.schema'
import {
  BioLinkService,
  MAX_BIO_LINKS_PER_WORKSPACE,
} from '../bio-link.service'

const membership = vi.mocked(MembershipRepository)
const pages = vi.mocked(BioLinkRepository)
const events = vi.mocked(BioLinkEventRepository)
const lookups = vi.mocked(BioLinkLookupRepository)
const audit = vi.mocked(auditMutation)
const revalidate = vi.mocked(revalidateBioLinks)

const WS = 'ws1'

function fakeBio(overrides: Partial<BioLink> = {}): BioLink {
  const now = new Date('2026-11-19T12:00:00.000Z')
  return {
    id: 'bio1',
    workspaceId: WS,
    name: 'Instagram da loja',
    slug: 'minha-loja',
    status: 'DRAFT',
    title: null,
    description: null,
    avatarUrl: null,
    theme: DEFAULT_BIO_THEME,
    blocks: [],
    noIndex: false,
    publishedAt: null,
    createdById: 'u1',
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as BioLink
}

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const page = fakeBio()

beforeEach(() => {
  vi.clearAllMocks()
  asRole('OWNER')
  pages.findById.mockResolvedValue(ok(page))
})

describe('BioLinkService authorization', () => {
  it('blocks non-members', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await BioLinkService.list('u1', WS), 'FORBIDDEN')
  })

  it('lets viewers read but not write, and members create but not delete', async () => {
    asRole('VIEWER')
    pages.listByWorkspace.mockResolvedValue(ok([]))
    events.totalsFor.mockResolvedValue(ok(new Map()))
    expectOk(await BioLinkService.list('u1', WS))
    expectOk(await BioLinkService.get('u1', WS, page.id))
    expectErr(await BioLinkService.create('u1', WS, { name: 'x' }), 'FORBIDDEN')
    expectErr(
      await BioLinkService.update('u1', WS, page.id, { name: 'x' }),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    expectErr(await BioLinkService.remove('u1', WS, page.id), 'FORBIDDEN')
    expect(pages.remove).not.toHaveBeenCalled()
  })

  it('scopes the page to the workspace', async () => {
    pages.findById.mockResolvedValue(
      err(appError('BIO_LINK_NOT_FOUND', 'Link da bio não encontrado')),
    )
    expectErr(
      await BioLinkService.get('u1', 'other', page.id),
      'BIO_LINK_NOT_FOUND',
    )
    expect(pages.findById).toHaveBeenCalledWith(page.id, 'other')
  })
})

describe('BioLinkService.list', () => {
  it('adds the public URL, the link count and the all-time totals', async () => {
    pages.listByWorkspace.mockResolvedValue(
      ok([
        fakeBio({
          blocks: [
            {
              id: 'a',
              type: 'link',
              active: true,
              network: 'custom',
              title: 'Loja',
              value: 'loja.com.br',
            },
            { id: 'h', type: 'header', active: true, title: 'Seção' },
          ] as never,
        }),
        fakeBio({ id: 'bio2', slug: 'outra' }),
      ]),
    )
    events.totalsFor.mockResolvedValue(
      ok(new Map([['bio1', { views: 10, clicks: 4 }]])),
    )

    const list = expectOk(await BioLinkService.list('u1', WS))
    expect(list[0]).toMatchObject({
      slug: 'minha-loja',
      linkCount: 1,
      views: 10,
      clicks: 4,
    })
    expect(list[0].url).toMatch(/\/b\/minha-loja$/)
    expect(list[1]).toMatchObject({ views: 0, clicks: 0, linkCount: 0 })
  })

  it('propagates database failures', async () => {
    pages.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await BioLinkService.list('u1', WS), 'DATABASE_ERROR')

    pages.listByWorkspace.mockResolvedValue(ok([page]))
    events.totalsFor.mockResolvedValue(err(databaseError()))
    expectErr(await BioLinkService.list('u1', WS), 'DATABASE_ERROR')
  })
})

describe('BioLinkService.create', () => {
  beforeEach(() => {
    pages.countByWorkspace.mockResolvedValue(ok(0))
    pages.isSlugTaken.mockResolvedValue(ok(false))
    pages.create.mockImplementation(async (data) =>
      ok(fakeBio({ name: data.name, slug: data.slug })),
    )
  })

  it('creates a draft with a slug derived from the name and the default theme', async () => {
    const dto = expectOk(
      await BioLinkService.create('u1', WS, { name: 'Clínica São Lucas' }),
    )
    expect(dto.slug).toBe('clinica-sao-lucas')
    expect(pages.create.mock.calls[0][0]).toMatchObject({
      workspaceId: WS,
      createdById: 'u1',
      slug: 'clinica-sao-lucas',
      title: 'Clínica São Lucas',
      theme: DEFAULT_BIO_THEME,
      blocks: [],
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'bio_link', action: 'create' }),
    )
  })

  it('takes the next free suffix when the derived slug is used', async () => {
    pages.isSlugTaken
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok(false))
    const dto = expectOk(
      await BioLinkService.create('u1', WS, { name: 'Loja' }),
    )
    expect(dto.slug).toBe('loja-2')
  })

  it('rejects a given slug that is taken', async () => {
    pages.isSlugTaken.mockResolvedValue(ok(true))
    expectErr(
      await BioLinkService.create('u1', WS, { name: 'x', slug: 'minha-loja' }),
      'BIO_LINK_SLUG_TAKEN',
    )
    expect(pages.create).not.toHaveBeenCalled()
  })

  it('enforces the per-workspace guard', async () => {
    pages.countByWorkspace.mockResolvedValue(ok(MAX_BIO_LINKS_PER_WORKSPACE))
    expectErr(
      await BioLinkService.create('u1', WS, { name: 'x' }),
      'BIO_LINK_LIMIT_REACHED',
    )
  })

  it('audits and returns the insert failure', async () => {
    pages.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await BioLinkService.create('u1', WS, { name: 'x' }),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', outcome: 'failure' }),
    )
  })
})

describe('BioLinkService.update', () => {
  beforeEach(() => {
    pages.isSlugTaken.mockResolvedValue(ok(false))
    pages.update.mockImplementation(async (_id, _ws, data) =>
      ok(
        fakeBio({
          slug: typeof data.slug === 'string' ? data.slug : page.slug,
          status: data.status === 'PUBLISHED' ? 'PUBLISHED' : page.status,
        }),
      ),
    )
    lookups.publishedForms.mockResolvedValue(
      ok([{ id: 'f1', name: 'Contato', publicToken: 'tok' }]),
    )
  })

  it('stamps publishedAt when publishing and clears it when unpublishing', async () => {
    expectOk(
      await BioLinkService.update('u1', WS, page.id, { status: 'PUBLISHED' }),
    )
    const published = pages.update.mock.calls[0][2]
    expect(published.status).toBe('PUBLISHED')
    expect(published.publishedAt).toBeInstanceOf(Date)
    expect(published.updatedById).toBe('u1')

    pages.findById.mockResolvedValue(ok(fakeBio({ status: 'PUBLISHED' })))
    expectOk(
      await BioLinkService.update('u1', WS, page.id, { status: 'DRAFT' }),
    )
    expect(pages.update.mock.calls[1][2]).toMatchObject({
      status: 'DRAFT',
      publishedAt: null,
    })
  })

  it('does not touch the publication when the status is unchanged', async () => {
    expectOk(
      await BioLinkService.update('u1', WS, page.id, { status: 'DRAFT' }),
    )
    const data = pages.update.mock.calls[0][2]
    expect(data.status).toBeUndefined()
    expect(data.publishedAt).toBeUndefined()
  })

  it('only writes the fields that came in, turning blanks into null', async () => {
    expectOk(
      await BioLinkService.update('u1', WS, page.id, {
        title: '',
        description: 'Oi',
        noIndex: true,
      }),
    )
    const data = pages.update.mock.calls[0][2]
    expect(data).toMatchObject({
      title: null,
      description: 'Oi',
      noIndex: true,
    })
    expect(data.name).toBeUndefined()
    expect(data.blocks).toBeUndefined()
  })

  it('refuses a slug used by another page and skips the check for the same one', async () => {
    pages.isSlugTaken.mockResolvedValueOnce(ok(true))
    expectErr(
      await BioLinkService.update('u1', WS, page.id, { slug: 'ocupado' }),
      'BIO_LINK_SLUG_TAKEN',
    )
    expect(pages.isSlugTaken).toHaveBeenCalledWith('ocupado', page.id)

    pages.isSlugTaken.mockClear()
    expectOk(
      await BioLinkService.update('u1', WS, page.id, { slug: page.slug }),
    )
    expect(pages.isSlugTaken).not.toHaveBeenCalled()
  })

  it('refuses a form block that is not a published form of the workspace', async () => {
    const block = (formToken: string) => ({
      id: 'f',
      type: 'form' as const,
      active: true,
      title: 'Contato',
      formToken,
      mode: 'link' as const,
    })
    expectErr(
      await BioLinkService.update('u1', WS, page.id, {
        blocks: [block('de-outro-workspace')],
      }),
      'BIO_LINK_FORM_INVALID',
    )
    expectOk(
      await BioLinkService.update('u1', WS, page.id, {
        blocks: [block('tok')],
      }),
    )
  })

  it('expires the cache of the old and the new address', async () => {
    expectOk(await BioLinkService.update('u1', WS, page.id, { slug: 'nova' }))
    expect(revalidate).toHaveBeenCalledWith('minha-loja', 'nova')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'bio_link', action: 'update' }),
    )
  })

  it('audits and returns the update failure without expiring the cache', async () => {
    pages.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await BioLinkService.update('u1', WS, page.id, { name: 'x' }),
      'DATABASE_ERROR',
    )
    expect(revalidate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', outcome: 'failure' }),
    )
  })
})

describe('BioLinkService.remove', () => {
  it('deletes the page, expires its cache and audits', async () => {
    pages.remove.mockResolvedValue(ok(page))
    expectOk(await BioLinkService.remove('u1', WS, page.id))
    expect(pages.remove).toHaveBeenCalledWith(page.id, WS)
    expect(revalidate).toHaveBeenCalledWith('minha-loja')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'bio_link', action: 'delete' }),
    )
  })
})

describe('BioLinkService.slugAvailability and options', () => {
  it('reports availability, ignoring the page itself', async () => {
    pages.isSlugTaken.mockResolvedValue(ok(true))
    expect(
      expectOk(await BioLinkService.slugAvailability('u1', WS, 'x-y', 'bio1')),
    ).toEqual({ slug: 'x-y', available: false })
    expect(pages.isSlugTaken).toHaveBeenCalledWith('x-y', 'bio1')
  })

  it('lists lines, published sites with their address, and forms', async () => {
    lookups.whatsappLines.mockResolvedValue(
      ok([{ id: 'c1', label: 'Vendas', phone: '+5511912345678' }]),
    )
    lookups.publishedSites.mockResolvedValue(
      ok([{ id: 's1', name: 'Clínica', slug: 'clinica' }]),
    )
    lookups.publishedForms.mockResolvedValue(
      ok([{ id: 'f1', name: 'Contato', publicToken: 'tok' }]),
    )
    const options = expectOk(await BioLinkService.options('u1', WS))
    expect(options.whatsapp).toHaveLength(1)
    expect(options.sites[0].url).toMatch(/clinica/)
    expect(options.forms[0].publicToken).toBe('tok')

    lookups.publishedSites.mockResolvedValue(err(databaseError()))
    expectErr(await BioLinkService.options('u1', WS), 'DATABASE_ERROR')
  })
})

describe('BioLinkService.analytics', () => {
  const NOW = new Date('2026-11-19T15:00:00.000Z')

  beforeEach(() => {
    pages.findById.mockResolvedValue(
      ok(
        fakeBio({
          blocks: [
            {
              id: 'a',
              type: 'link',
              active: true,
              network: 'custom',
              title: 'Loja',
              value: 'loja.com.br',
            },
            {
              id: 'b',
              type: 'link',
              active: true,
              network: 'custom',
              title: 'Blog',
              value: 'blog.com.br',
            },
          ] as never,
        }),
      ),
    )
    events.daily.mockResolvedValue(
      ok([
        { day: '2026-11-18', kind: 'VIEW', count: 8 },
        { day: '2026-11-18', kind: 'CLICK', count: 3 },
        { day: '2026-11-19', kind: 'VIEW', count: 2 },
        { day: '2026-10-01', kind: 'VIEW', count: 99 },
      ]),
    )
    events.visitors.mockResolvedValue(ok(7))
    events.clicksByLink.mockResolvedValue(
      ok([
        { linkId: 'a', linkTitle: 'Loja antiga', count: 3 },
        { linkId: 'gone', linkTitle: 'Removido', count: 1 },
      ]),
    )
    events.breakdown.mockResolvedValue(ok([{ key: null, count: 5 }]))
  })

  it('builds a zero-filled daily series and the totals', async () => {
    const data = expectOk(
      await BioLinkService.analytics('u1', WS, page.id, { days: 7 }, NOW),
    )
    expect(data.daily).toHaveLength(7)
    expect(data.daily.at(-1)).toEqual({
      day: '2026-11-19',
      views: 2,
      clicks: 0,
    })
    expect(data.daily.find((d) => d.day === '2026-11-18')).toEqual({
      day: '2026-11-18',
      views: 8,
      clicks: 3,
    })
    // The row outside the window is ignored.
    expect(data.totals).toEqual({
      views: 10,
      visitors: 7,
      clicks: 3,
      clickRate: 0.3,
    })
    expect(data.from).toBe('2026-11-13')
    expect(data.to).toBe('2026-11-19')
  })

  it('ranks links with current titles, flags removed ones and lists unclicked buttons', async () => {
    const data = expectOk(
      await BioLinkService.analytics('u1', WS, page.id, { days: 30 }, NOW),
    )
    expect(data.links).toEqual([
      { linkId: 'a', title: 'Loja', clicks: 3, exists: true },
      { linkId: 'gone', title: 'Removido', clicks: 1, exists: false },
      { linkId: 'b', title: 'Blog', clicks: 0, exists: true },
    ])
  })

  it('has a zero click rate without visits', async () => {
    events.daily.mockResolvedValue(ok([]))
    const data = expectOk(
      await BioLinkService.analytics('u1', WS, page.id, { days: 7 }, NOW),
    )
    expect(data.totals).toMatchObject({ views: 0, clicks: 0, clickRate: 0 })
  })

  it('propagates any failing read and respects the permission', async () => {
    events.visitors.mockResolvedValue(err(databaseError()))
    expectErr(
      await BioLinkService.analytics('u1', WS, page.id, { days: 7 }, NOW),
      'DATABASE_ERROR',
    )
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await BioLinkService.analytics('u1', WS, page.id, { days: 7 }, NOW),
      'FORBIDDEN',
    )
  })
})
