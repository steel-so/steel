import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeCrmNewsletter } from '@/src/__tests__/factories/newsletter-nl-core.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterNotFound,
  crmNewsletterSlugTaken,
  databaseError,
  sendingDomainNotVerified,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-newsletter.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/lib/sending-domain/resolve-sender')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger')

import { auditMutation } from '@/lib/axiom/audit'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  CrmNewsletterService,
  slugifyNewsletterName,
} from '../crm-newsletter.service'

const repo = vi.mocked(CrmNewsletterRepository)
const membershipRepo = vi.mocked(MembershipRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const resolveSender = vi.mocked(resolveVerifiedSender)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'

function asRole(role: Role) {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const input = {
  name: 'Novidades da Acme',
  fromName: 'Acme',
  fromEmail: 'News@News.Acme.com.br',
  doubleOptIn: true,
  legalBasis: 'CONSENT' as const,
  archiveEnabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole('OWNER')
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  workspaceRepo.findById.mockResolvedValue(
    ok(createFakeWorkspace({ id: WS, slug: 'acme' })),
  )
  resolveSender.mockResolvedValue(ok({ sendingDomainId: 'dom1' }))
  repo.statsFor.mockResolvedValue(ok(new Map()))
  repo.slugExists.mockResolvedValue(ok(false))
  repo.update.mockImplementation(async (id, data) =>
    ok(createFakeCrmNewsletter({ id, ...(data as object) })),
  )
})

describe('slugifyNewsletterName', () => {
  it('strips accents and symbols', () => {
    expect(slugifyNewsletterName('  Notícias & Ações!  ')).toBe(
      'noticias-acoes',
    )
  })
  it('falls back when nothing is left', () => {
    expect(slugifyNewsletterName('!!')).toBe('newsletter')
  })
})

describe('CrmNewsletterService.list', () => {
  it('returns the DTOs with stats, live sender state and archive URL', async () => {
    const a = createFakeCrmNewsletter({
      workspaceId: WS,
      sendingDomainId: 'dom1',
    })
    const b = createFakeCrmNewsletter({
      workspaceId: WS,
      slug: 'b',
      fromEmail: 'x@unverified.com',
      sendingDomainId: 'stale',
    })
    repo.listByWorkspace.mockResolvedValue(ok([a, b]))
    repo.statsFor.mockResolvedValue(
      ok(
        new Map([
          [
            a.id,
            { active: 5, pending: 1, issuesSent: 2, lastIssueSentAt: null },
          ],
        ]),
      ),
    )
    resolveSender.mockImplementation(async (_ws, email) =>
      email === a.fromEmail
        ? ok({ sendingDomainId: 'dom1' })
        : err(sendingDomainNotVerified()),
    )

    const list = expectOk(await CrmNewsletterService.list('u1', WS))
    expect(list[0]).toMatchObject({
      senderVerified: true,
      counts: { active: 5 },
      archiveUrl: expect.stringContaining(`/n/acme/${a.slug}`),
    })
    expect(list[1]).toMatchObject({
      senderVerified: false,
      sendingDomainId: null,
    })
    // b had a stale domain: synced, a was already right.
    expect(repo.update).toHaveBeenCalledTimes(1)
    expect(repo.update).toHaveBeenCalledWith(b.id, { sendingDomainId: null })
  })

  it('keeps answering when the sender sync fails', async () => {
    repo.listByWorkspace.mockResolvedValue(
      ok([createFakeCrmNewsletter({ sendingDomainId: null })]),
    )
    repo.update.mockResolvedValue(err(databaseError()))
    expectOk(await CrmNewsletterService.list('u1', WS))
  })

  it.each([
    [
      'membership',
      () =>
        membershipRepo.findByUserAndWorkspace.mockResolvedValue(
          err(databaseError()),
        ),
    ],
    [
      'list',
      () => repo.listByWorkspace.mockResolvedValue(err(databaseError())),
    ],
    [
      'workspace',
      () => {
        repo.listByWorkspace.mockResolvedValue(ok([]))
        workspaceRepo.findById.mockResolvedValue(err(databaseError()))
      },
    ],
    [
      'stats',
      () => {
        repo.listByWorkspace.mockResolvedValue(ok([]))
        repo.statsFor.mockResolvedValue(err(databaseError()))
      },
    ],
    [
      'sender',
      () => {
        repo.listByWorkspace.mockResolvedValue(ok([createFakeCrmNewsletter()]))
        resolveSender.mockResolvedValue(err(databaseError()))
      },
    ],
  ])('propagates a %s failure', async (_name, arrange) => {
    arrange()
    expectErr(await CrmNewsletterService.list('u1', WS), 'DATABASE_ERROR')
  })

  it('denies when the CRM module is off', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(await CrmNewsletterService.list('u1', WS), 'MODULE_DISABLED')
  })
})

describe('CrmNewsletterService.get', () => {
  it('returns one newsletter', async () => {
    const newsletter = createFakeCrmNewsletter({ sendingDomainId: 'dom1' })
    repo.findById.mockResolvedValue(ok(newsletter))
    const dto = expectOk(
      await CrmNewsletterService.get('u1', WS, newsletter.id),
    )
    expect(dto.id).toBe(newsletter.id)
  })

  it('propagates not found and forbidden', async () => {
    repo.findById.mockResolvedValue(err(crmNewsletterNotFound()))
    expectErr(
      await CrmNewsletterService.get('u1', WS, 'x'),
      'CRM_NEWSLETTER_NOT_FOUND',
    )
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmNewsletterService.get('u1', WS, 'x'), 'FORBIDDEN')
  })
})

describe('CrmNewsletterService.create', () => {
  beforeEach(() => {
    repo.create.mockImplementation(async (data) =>
      ok(createFakeCrmNewsletter({ ...data, id: 'nl1' })),
    )
  })

  it('derives a free slug, lower-cases the sender and audits', async () => {
    repo.slugExists.mockImplementation(async (_ws, slug) =>
      ok(slug === 'novidades-da-acme'),
    )
    const dto = expectOk(
      await CrmNewsletterService.create('u1', WS, {
        ...input,
        replyTo: 'Contato@Acme.com',
      }),
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'novidades-da-acme-2',
        fromEmail: 'news@news.acme.com.br',
        replyTo: 'contato@acme.com',
        sendingDomainId: 'dom1',
        createdById: 'u1',
      }),
    )
    expect(dto.senderVerified).toBe(true)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_newsletter', action: 'create' }),
    )
  })

  it('saves an unverified sender (sending stays blocked)', async () => {
    resolveSender.mockResolvedValue(err(sendingDomainNotVerified()))
    const dto = expectOk(await CrmNewsletterService.create('u1', WS, input))
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ sendingDomainId: null }),
    )
    expect(dto.senderVerified).toBe(false)
  })

  it('refuses an explicit slug already taken', async () => {
    repo.slugExists.mockResolvedValue(ok(true))
    expectErr(
      await CrmNewsletterService.create('u1', WS, { ...input, slug: 'taken' }),
      'CRM_NEWSLETTER_SLUG_TAKEN',
    )
  })

  it('accepts a free explicit slug', async () => {
    expectOk(
      await CrmNewsletterService.create('u1', WS, { ...input, slug: 'livre' }),
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'livre' }),
    )
  })

  it('gives up after 50 taken derived slugs', async () => {
    repo.slugExists.mockResolvedValue(ok(true))
    expectErr(
      await CrmNewsletterService.create('u1', WS, input),
      'CRM_NEWSLETTER_SLUG_TAKEN',
    )
  })

  it.each([
    [
      'explicit slug check',
      () => repo.slugExists.mockResolvedValue(err(databaseError())),
      { slug: 'x-y' },
    ],
    [
      'derived slug check',
      () => repo.slugExists.mockResolvedValue(err(databaseError())),
      {},
    ],
    ['sender', () => resolveSender.mockResolvedValue(err(databaseError())), {}],
  ])('propagates a %s failure', async (_n, arrange, extra) => {
    arrange()
    expectErr(
      await CrmNewsletterService.create('u1', WS, { ...input, ...extra }),
      'DATABASE_ERROR',
    )
  })

  it('audits a failed insert', async () => {
    repo.create.mockResolvedValue(err(crmNewsletterSlugTaken()))
    expectErr(
      await CrmNewsletterService.create('u1', WS, input),
      'CRM_NEWSLETTER_SLUG_TAKEN',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })

  it('denies a VIEWER', async () => {
    asRole('VIEWER')
    expectErr(await CrmNewsletterService.create('u1', WS, input), 'FORBIDDEN')
    expect(repo.create).not.toHaveBeenCalled()
  })
})

describe('CrmNewsletterService.update', () => {
  const existing = createFakeCrmNewsletter({
    id: 'nl1',
    workspaceId: WS,
    slug: 'old',
  })
  beforeEach(() => {
    repo.findById.mockResolvedValue(ok(existing))
  })

  it('re-resolves the sender when fromEmail changes', async () => {
    resolveSender.mockResolvedValue(err(sendingDomainNotVerified()))
    expectOk(
      await CrmNewsletterService.update('u1', WS, 'nl1', {
        fromEmail: 'A@Other.com',
        replyTo: null,
        slug: 'new-slug',
      }),
    )
    expect(repo.update).toHaveBeenCalledWith(
      'nl1',
      expect.objectContaining({
        fromEmail: 'a@other.com',
        sendingDomainId: null,
        replyTo: null,
        slug: 'new-slug',
        updatedById: 'u1',
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update' }),
    )
  })

  it('lower-cases a new replyTo and keeps the domain when the sender stays', async () => {
    expectOk(
      await CrmNewsletterService.update('u1', WS, 'nl1', {
        replyTo: 'X@Y.com',
        slug: 'old',
      }),
    )
    expect(repo.slugExists).not.toHaveBeenCalled()
    expect(repo.update).toHaveBeenCalledWith(
      'nl1',
      expect.objectContaining({
        replyTo: 'x@y.com',
        sendingDomainId: undefined,
      }),
    )
  })

  it.each([
    ['ARCHIVED', 'archive'],
    ['ACTIVE', 'update'],
  ] as const)('status %s audits as %s', async (status, action) => {
    expectOk(await CrmNewsletterService.update('u1', WS, 'nl1', { status }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action }))
  })

  it('audits a reactivation', async () => {
    repo.findById.mockResolvedValue(
      ok(createFakeCrmNewsletter({ ...existing, status: 'ARCHIVED' })),
    )
    expectOk(
      await CrmNewsletterService.update('u1', WS, 'nl1', { status: 'ACTIVE' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reactivate' }),
    )
  })

  it('refuses a slug taken by another newsletter', async () => {
    repo.slugExists.mockResolvedValue(ok(true))
    expectErr(
      await CrmNewsletterService.update('u1', WS, 'nl1', { slug: 'other' }),
      'CRM_NEWSLETTER_SLUG_TAKEN',
    )
    expect(repo.slugExists).toHaveBeenCalledWith(WS, 'other', 'nl1')
  })

  it.each([
    ['find', () => repo.findById.mockResolvedValue(err(databaseError())), {}],
    [
      'slug',
      () => repo.slugExists.mockResolvedValue(err(databaseError())),
      { slug: 'zz' },
    ],
    [
      'sender',
      () => resolveSender.mockResolvedValue(err(databaseError())),
      { fromEmail: 'a@b.com' },
    ],
    [
      'update',
      () => repo.update.mockResolvedValue(err(databaseError())),
      { name: 'N' },
    ],
  ])('propagates a %s failure', async (_n, arrange, dto) => {
    arrange()
    expectErr(
      await CrmNewsletterService.update('u1', WS, 'nl1', { name: 'x', ...dto }),
      'DATABASE_ERROR',
    )
  })

  it('denies a VIEWER', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmNewsletterService.update('u1', WS, 'nl1', { name: 'x' }),
      'FORBIDDEN',
    )
  })
})

describe('CrmNewsletterService.remove', () => {
  it('soft deletes and audits', async () => {
    const now = new Date('2026-10-28T00:00:00Z')
    repo.findById.mockResolvedValue(ok(createFakeCrmNewsletter({ id: 'nl1' })))
    repo.softDelete.mockResolvedValue(ok(undefined))
    expectOk(await CrmNewsletterService.remove('u1', WS, 'nl1', now))
    expect(repo.softDelete).toHaveBeenCalledWith('nl1', now)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 'nl1' }),
    )
  })

  it('propagates lookup and delete failures', async () => {
    repo.findById.mockResolvedValue(err(crmNewsletterNotFound()))
    expectErr(
      await CrmNewsletterService.remove('u1', WS, 'nl1'),
      'CRM_NEWSLETTER_NOT_FOUND',
    )
    repo.findById.mockResolvedValue(ok(createFakeCrmNewsletter()))
    repo.softDelete.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmNewsletterService.remove('u1', WS, 'nl1'),
      'DATABASE_ERROR',
    )
  })

  it('denies a MEMBER (DELETE is not granted by default)', async () => {
    asRole('MEMBER')
    const result = await CrmNewsletterService.remove('u1', WS, 'nl1')
    expect(result.ok).toBe(false)
  })
})
