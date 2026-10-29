import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { createFakeNewsletterDigest } from '@/src/__tests__/factories/newsletter2-digest-ai.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterIssueIncomplete,
  databaseError,
  forbidden,
} from '@/src/errors'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/crm-newsletter-issue.service', () => ({
  loadNewsletterScope: vi.fn(),
}))
vi.mock('@/src/services/crm-newsletter-send.service', () => ({
  CrmNewsletterSendService: { sendNowAsSystem: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-digest-notifications', () => ({
  notifyDigestReady: vi.fn(async () => 1),
  notifyDigestSkipped: vi.fn(async () => 1),
}))
vi.mock('@/src/services/crm-newsletter-render', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../crm-newsletter-render')>()
  return {
    ...original,
    validateIssueDocument: vi.fn(original.validateIssueDocument),
  }
})
vi.mock('@/src/repositories/crm-newsletter-digest.repository')
vi.mock('@/src/repositories/crm-email-template.repository')
vi.mock(
  '@/src/repositories/crm-newsletter-issue.repository',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    CrmNewsletterIssueRepository: {
      findNewsletter: vi.fn(),
      slugTaken: vi.fn(),
    },
  }),
)
vi.mock('@/src/lib/crm-newsletter/feed-fetch', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchFeed: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/outbound-url', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPublicHttpsUrl: vi.fn(),
}))
vi.mock('@/src/lib/sites/public-url', () => ({
  publicSiteUrl: (slug: string) => `https://${slug}.sites.test`,
}))

import { auditMutation } from '@/lib/axiom/audit'
import { fetchFeed } from '@/src/lib/crm-newsletter/feed-fetch'
import {
  assertPublicHttpsUrl,
  OutboundUrlError,
} from '@/src/lib/whatsapp/outbound-url'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { CrmNewsletterDigestRepository } from '@/src/repositories/crm-newsletter-digest.repository'
import { CrmNewsletterIssueRepository } from '@/src/repositories/crm-newsletter-issue.repository'
import {
  collectDigestItems,
  digestPreheader,
  digestSince,
  runDigest,
  CrmNewsletterDigestService as Service,
} from '../crm-newsletter-digest.service'
import {
  notifyDigestReady,
  notifyDigestSkipped,
} from '../crm-newsletter-digest-notifications'
import { loadNewsletterScope } from '../crm-newsletter-issue.service'
import { validateIssueDocument } from '../crm-newsletter-render'
import { CrmNewsletterSendService } from '../crm-newsletter-send.service'

const repo = vi.mocked(CrmNewsletterDigestRepository)
const issues = vi.mocked(CrmNewsletterIssueRepository)
const templates = vi.mocked(CrmEmailTemplateRepository)
const scope = vi.mocked(loadNewsletterScope)
const feed = vi.mocked(fetchFeed)
const guard = vi.mocked(assertPublicHttpsUrl)
const send = vi.mocked(CrmNewsletterSendService)

const NOW = new Date('2026-10-28T13:00:00.000Z')
const A = ['u1', 'ws1', 'nl1'] as const
const newsletter = createFakeNewsletter()
const site = { id: 'site1', name: 'Site Acme', slug: 'acme', publishedAt: NOW }
const post = (
  n: number,
  publishedAt: Date | null = new Date(NOW.getTime() - n * 3_600_000),
) => ({
  id: `p${n}`,
  title: `Post ${n}`,
  slug: `post-${n}`,
  excerpt: n === 1 ? null : `Resumo ${n}`,
  autoExcerpt: `Auto ${n}`,
  coverImageUrl: n === 1 ? 'https://cdn.acme/p1.png' : null,
  publishedAt,
})
const DIGEST_INPUT = {
  enabled: true,
  siteId: 'site1',
  rssUrl: null,
  cadence: 'WEEKLY' as const,
  weekday: 1,
  monthDay: null,
  hour: 9,
  mode: 'DRAFT' as const,
  maxItems: 5,
  subject: 'Resumo de {data}',
  intro: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  scope.mockResolvedValue(
    ok({
      membership: { isPrivileged: false } as never,
      newsletter,
    }),
  )
  repo.findSite.mockResolvedValue(ok(site))
  repo.listLivePosts.mockResolvedValue(ok([post(1), post(2)]))
  repo.listSites.mockResolvedValue(ok([{ ...site }]))
  repo.findByNewsletter.mockResolvedValue(ok(null))
  repo.recordRun.mockResolvedValue(ok(undefined))
  repo.createIssue.mockResolvedValue(
    ok(createFakeNewsletterIssue({ id: 'dig-issue' })),
  )
  repo.upsert.mockImplementation(async (input) =>
    ok(
      createFakeNewsletterDigest({ ...input.data, nextRunAt: input.nextRunAt }),
    ),
  )
  issues.findNewsletter.mockResolvedValue(ok(newsletter))
  issues.slugTaken.mockResolvedValue(ok(false))
  guard.mockImplementation(async (raw: string) => new URL(raw))
  feed.mockResolvedValue({
    ok: true,
    url: 'https://blog.x/feed',
    feed: {
      title: 'X',
      items: [
        {
          title: 'Do feed',
          url: 'https://blog.x/a',
          excerpt: 'feed',
          imageUrl: null,
          publishedAt: new Date(NOW.getTime() - 30 * 60_000),
        },
        {
          title: 'Sem data',
          url: 'https://blog.x/b',
          excerpt: '',
          imageUrl: null,
          publishedAt: null,
        },
        {
          title: 'Antigo',
          url: 'https://blog.x/c',
          excerpt: '',
          imageUrl: null,
          publishedAt: new Date('2020-01-01'),
        },
        {
          title: 'Futuro',
          url: 'https://blog.x/d',
          excerpt: '',
          imageUrl: null,
          publishedAt: new Date('2030-01-01'),
        },
      ],
    },
  })
  send.sendNowAsSystem.mockResolvedValue(ok({ started: true }))
})

describe('collectDigestItems()', () => {
  const since = new Date('2026-10-21T13:00:00.000Z')

  it('merges site posts and feed entries, newest first, within the window', async () => {
    const result = expectOk(
      await collectDigestItems({
        workspaceId: 'ws1',
        siteId: 'site1',
        rssUrl: 'https://blog.x/feed',
        maxItems: 5,
        since,
        now: NOW,
      }),
    )
    expect(result.warnings).toEqual([])
    expect(result.items.map((item) => item.title)).toEqual([
      'Do feed',
      'Post 1',
      'Post 2',
    ])
    expect(result.items[1]).toMatchObject({
      source: 'SITE',
      url: 'https://acme.sites.test/blog/post-1',
      excerpt: 'Auto 1',
      imageUrl: 'https://cdn.acme/p1.png',
    })
    expect(repo.listLivePosts).toHaveBeenCalledWith('site1', since, NOW, 5)
  })

  it('caps at maxItems and skips posts without a date', async () => {
    repo.listLivePosts.mockResolvedValue(ok([post(1), post(2, null), post(3)]))
    const result = expectOk(
      await collectDigestItems({
        workspaceId: 'ws1',
        siteId: 'site1',
        rssUrl: null,
        maxItems: 1,
        since,
        now: NOW,
      }),
    )
    expect(result.items.map((item) => item.title)).toEqual(['Post 1'])
  })

  it('turns source problems into warnings', async () => {
    repo.findSite.mockResolvedValueOnce(ok(null))
    feed.mockResolvedValueOnce({ ok: false, reason: 'timeout' })
    const missing = expectOk(
      await collectDigestItems({
        workspaceId: 'ws1',
        siteId: 'gone',
        rssUrl: 'https://blog.x/feed',
        maxItems: 5,
        since,
        now: NOW,
      }),
    )
    expect(missing.items).toEqual([])
    expect(missing.warnings).toEqual([
      'O site escolhido não existe mais.',
      'O servidor do feed demorou demais para responder.',
    ])
    repo.findSite.mockResolvedValueOnce(ok({ ...site, publishedAt: null }))
    const unpublished = expectOk(
      await collectDigestItems({
        workspaceId: 'ws1',
        siteId: 'site1',
        rssUrl: null,
        maxItems: 5,
        since,
        now: NOW,
      }),
    )
    expect(unpublished.warnings[0]).toContain('ainda não foi publicado')
  })

  it('propagates database errors', async () => {
    repo.findSite.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await collectDigestItems({
        workspaceId: 'ws1',
        siteId: 'site1',
        rssUrl: null,
        maxItems: 5,
        since,
        now: NOW,
      }),
      'DATABASE_ERROR',
    )
    repo.listLivePosts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await collectDigestItems({
        workspaceId: 'ws1',
        siteId: 'site1',
        rssUrl: null,
        maxItems: 5,
        since,
        now: NOW,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('helpers', () => {
  it('starts from the last item or looks back a cadence', () => {
    expect(digestSince({ lastItemAt: NOW, cadence: 'WEEKLY' }, NOW)).toBe(NOW)
    expect(
      digestSince({ lastItemAt: null, cadence: 'MONTHLY' }, NOW).toISOString(),
    ).toBe('2026-09-27T13:00:00.000Z')
    expect(digestSince(null, NOW).toISOString()).toBe(
      '2026-10-21T13:00:00.000Z',
    )
  })

  it('joins the titles into a preheader of at most 150 characters', () => {
    expect(digestPreheader([{ title: 'A' }, { title: 'B' }])).toBe('A · B')
    const long = digestPreheader(
      Array.from({ length: 20 }, (_, i) => ({ title: `Título longo ${i}` })),
    )
    expect(long.length).toBeLessThanOrEqual(150)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('runDigest()', () => {
  it('DRAFT: creates the issue, moves the mark and notifies the creator', async () => {
    const digest = createFakeNewsletterDigest({ intro: 'Oi' })
    const outcome = expectOk(await runDigest(digest, NOW))
    expect(outcome).toEqual({
      outcome: 'DRAFT_CREATED',
      issueId: 'dig-issue',
      items: 2,
      message: 'Rascunho criado com 2 posts.',
    })
    const created = repo.createIssue.mock.calls[0][0]
    expect(created).toMatchObject({
      digestId: 'dg1',
      newsletterId: 'nl1',
      subject: 'Resumo de 28 de outubro de 2026',
      preheader: 'Post 1 · Post 2',
      slug: 'resumo-de-28-de-outubro-de-2026',
      createdById: 'u1',
    })
    expect(repo.recordRun).toHaveBeenCalledWith('dg1', {
      lastOutcome: 'DRAFT_CREATED',
      lastMessage: 'Rascunho criado com 2 posts.',
      lastIssueId: 'dig-issue',
      lastItemAt: post(1).publishedAt,
    })
    expect(notifyDigestReady).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'dig-issue',
        items: 2,
        recipientId: 'u1',
      }),
    )
    expect(send.sendNowAsSystem).not.toHaveBeenCalled()
  })

  it('uses the newsletter template and a free slug', async () => {
    issues.findNewsletter.mockResolvedValueOnce(
      ok(createFakeNewsletter({ templateId: 'tpl1' })),
    )
    templates.findById.mockResolvedValueOnce(
      ok({ builderDocument: createBlankEmailDocument() } as never),
    )
    issues.slugTaken.mockResolvedValueOnce(ok(true))
    repo.listLivePosts.mockResolvedValueOnce(ok([post(1)]))
    const outcome = expectOk(await runDigest(createFakeNewsletterDigest(), NOW))
    expect(outcome.message).toBe('Rascunho criado com 1 post.')
    expect(repo.createIssue.mock.calls[0][0].slug).toBe(
      'resumo-de-28-de-outubro-de-2026-2',
    )
    expect(templates.findById).toHaveBeenCalledWith('tpl1', 'ws1')
  })

  it('AUTO_SEND: sends through the system send', async () => {
    const outcome = expectOk(
      await runDigest(createFakeNewsletterDigest({ mode: 'AUTO_SEND' }), NOW),
    )
    expect(outcome.outcome).toBe('SENT')
    expect(send.sendNowAsSystem).toHaveBeenCalledWith('dig-issue', NOW)
    expect(notifyDigestReady).not.toHaveBeenCalled()
  })

  it('AUTO_SEND refused: keeps the draft, records and notifies the reason', async () => {
    send.sendNowAsSystem.mockResolvedValueOnce(
      ok({ started: false, refused: 'Limite do mês atingido' }),
    )
    const outcome = expectOk(
      await runDigest(createFakeNewsletterDigest({ mode: 'AUTO_SEND' }), NOW),
    )
    expect(outcome).toMatchObject({
      outcome: 'FAILED',
      issueId: 'dig-issue',
      message: 'Limite do mês atingido',
    })
    expect(repo.recordRun).toHaveBeenCalledWith(
      'dg1',
      expect.objectContaining({
        lastOutcome: 'FAILED',
        lastIssueId: 'dig-issue',
      }),
    )
    expect(notifyDigestSkipped).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'dig-issue',
        reason: 'Limite do mês atingido',
      }),
    )
  })

  it('AUTO_SEND database failure propagates', async () => {
    send.sendNowAsSystem.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await runDigest(createFakeNewsletterDigest({ mode: 'AUTO_SEND' }), NOW),
      'DATABASE_ERROR',
    )
  })

  it('skips without new items, with a notice', async () => {
    repo.listLivePosts.mockResolvedValueOnce(ok([]))
    const outcome = expectOk(await runDigest(createFakeNewsletterDigest(), NOW))
    expect(outcome).toMatchObject({ outcome: 'SKIPPED', issueId: null })
    expect(outcome.message).toContain('Nenhum post novo')
    expect(repo.createIssue).not.toHaveBeenCalled()
    expect(notifyDigestSkipped).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: null,
        newsletterName: newsletter.name,
      }),
    )
  })

  it('skips an archived newsletter and fails a missing one', async () => {
    issues.findNewsletter.mockResolvedValueOnce(
      ok(createFakeNewsletter({ status: 'ARCHIVED' })),
    )
    expect(
      expectOk(await runDigest(createFakeNewsletterDigest(), NOW)).outcome,
    ).toBe('SKIPPED')
    issues.findNewsletter.mockResolvedValueOnce(ok(null))
    expectErr(
      await runDigest(createFakeNewsletterDigest(), NOW),
      'RESOURCE_NOT_FOUND',
    )
    issues.findNewsletter.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await runDigest(createFakeNewsletterDigest(), NOW),
      'DATABASE_ERROR',
    )
  })

  it('manual run: draft only, no mark moved, no notice', async () => {
    const outcome = expectOk(
      await runDigest(createFakeNewsletterDigest({ mode: 'AUTO_SEND' }), NOW, {
        manual: true,
      }),
    )
    expect(outcome.outcome).toBe('DRAFT_CREATED')
    expect(repo.recordRun).not.toHaveBeenCalled()
    expect(notifyDigestReady).not.toHaveBeenCalled()
    expect(send.sendNowAsSystem).not.toHaveBeenCalled()
    repo.listLivePosts.mockResolvedValueOnce(ok([]))
    expect(
      expectOk(
        await runDigest(createFakeNewsletterDigest(), NOW, { manual: true }),
      ).issueId,
    ).toBeNull()
    expect(notifyDigestSkipped).not.toHaveBeenCalled()
  })

  it('handles failures while creating the issue', async () => {
    repo.createIssue.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await runDigest(createFakeNewsletterDigest(), NOW),
      'DATABASE_ERROR',
    )
    issues.slugTaken.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await runDigest(createFakeNewsletterDigest(), NOW),
      'DATABASE_ERROR',
    )
    repo.listLivePosts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await runDigest(createFakeNewsletterDigest(), NOW),
      'DATABASE_ERROR',
    )
  })

  it('logs (and carries on) when recording the run fails', async () => {
    repo.recordRun.mockResolvedValueOnce(err(databaseError('x')))
    expect(
      expectOk(await runDigest(createFakeNewsletterDigest(), NOW)).outcome,
    ).toBe('DRAFT_CREATED')
  })

  it('falls back to a timestamped slug when every candidate is taken', async () => {
    issues.slugTaken.mockResolvedValue(ok(true))
    expectOk(await runDigest(createFakeNewsletterDigest(), NOW))
    expect(repo.createIssue.mock.calls[0][0].slug).toMatch(
      /^resumo-de-28-de-outubro-/,
    )
    expect(repo.createIssue.mock.calls[0][0].slug).not.toBe(
      'resumo-de-28-de-outubro-de-2026',
    )
  })
})

describe('CrmNewsletterDigestService', () => {
  it('get: settings and sites, VIEW permission', async () => {
    repo.findByNewsletter.mockResolvedValueOnce(
      ok(createFakeNewsletterDigest({ site: { ...site, deletedAt: null } })),
    )
    const result = expectOk(await Service.get(...A))
    expect(result.digest?.siteName).toBe('Site Acme')
    expect(result.sites).toEqual([
      { id: 'site1', name: 'Site Acme', published: true },
    ])
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'VIEW')
    expect(expectOk(await Service.get(...A)).digest).toBeNull()
  })

  it('get: denials and database errors', async () => {
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.get(...A), 'FORBIDDEN')
    repo.findByNewsletter.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.get(...A), 'DATABASE_ERROR')
    repo.listSites.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.get(...A), 'DATABASE_ERROR')
  })

  it('save: validates the sources, computes the next run and audits', async () => {
    const result = expectOk(await Service.save(...A, DIGEST_INPUT, NOW))
    expect(result.digest?.nextRunAt).toBe('2026-11-02T12:00:00.000Z')
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'EDIT')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_newsletter_digest',
        action: 'update',
      }),
    )
    expectOk(await Service.save(...A, { ...DIGEST_INPUT, enabled: false }, NOW))
    expect(repo.upsert.mock.calls[1][0].nextRunAt).toBeNull()
  })

  it('save: refuses a foreign site and a private feed', async () => {
    repo.findSite.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.save(...A, DIGEST_INPUT, NOW),
      'CRM_NEWSLETTER_DIGEST_SOURCE_INVALID',
    )
    guard.mockRejectedValueOnce(new OutboundUrlError('private_host'))
    const error = expectErr(
      await Service.save(
        ...A,
        { ...DIGEST_INPUT, siteId: null, rssUrl: 'https://10.0.0.1/feed' },
        NOW,
      ),
      'CRM_NEWSLETTER_DIGEST_SOURCE_INVALID',
    )
    expect(error.message).toContain('endereço privado')
    guard.mockRejectedValueOnce(new Error('weird'))
    expect(
      expectErr(
        await Service.save(
          ...A,
          { ...DIGEST_INPUT, siteId: null, rssUrl: 'https://x.com/feed' },
          NOW,
        ),
      ).message,
    ).toBe('O endereço do feed é inválido.')
  })

  it('save: denials and database errors', async () => {
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.save(...A, DIGEST_INPUT, NOW), 'FORBIDDEN')
    repo.findSite.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.save(...A, DIGEST_INPUT, NOW), 'DATABASE_ERROR')
    repo.upsert.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.save(...A, DIGEST_INPUT, NOW), 'DATABASE_ERROR')
  })

  it('remove: DELETE permission, 404 when absent, audit', async () => {
    repo.remove.mockResolvedValueOnce(ok(true))
    expectOk(await Service.remove(...A))
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'DELETE')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    )
    repo.remove.mockResolvedValueOnce(ok(false))
    expectErr(await Service.remove(...A), 'RESOURCE_NOT_FOUND')
    repo.remove.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.remove(...A), 'DATABASE_ERROR')
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.remove(...A), 'FORBIDDEN')
  })

  it('preview: items since the saved mark, warnings, no dates leak', async () => {
    repo.findByNewsletter.mockResolvedValueOnce(
      ok(
        createFakeNewsletterDigest({
          lastItemAt: new Date('2026-10-27T00:00:00Z'),
        }),
      ),
    )
    const result = expectOk(
      await Service.preview(
        ...A,
        { siteId: 'site1', rssUrl: 'https://blog.x/feed', maxItems: 5 },
        NOW,
      ),
    )
    expect(result.since).toBe('2026-10-27T00:00:00.000Z')
    expect(result.items).toHaveLength(3)
    expect(result.items[0]).not.toHaveProperty('date')
  })

  it('preview: refusals and errors', async () => {
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await Service.preview(
        ...A,
        { siteId: 's', rssUrl: null, maxItems: 5 },
        NOW,
      ),
      'FORBIDDEN',
    )
    guard.mockRejectedValueOnce(new OutboundUrlError('not_https'))
    expectErr(
      await Service.preview(
        ...A,
        { siteId: null, rssUrl: 'https://x.com', maxItems: 5 },
        NOW,
      ),
      'CRM_NEWSLETTER_DIGEST_SOURCE_INVALID',
    )
    repo.findByNewsletter.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await Service.preview(
        ...A,
        { siteId: 's', rssUrl: null, maxItems: 5 },
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.findSite.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await Service.preview(
        ...A,
        { siteId: 's', rssUrl: null, maxItems: 5 },
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })

  it('runNow: a manual draft from the saved settings', async () => {
    repo.findByNewsletter.mockResolvedValueOnce(
      ok(createFakeNewsletterDigest()),
    )
    const result = expectOk(await Service.runNow(...A, NOW))
    expect(result).toEqual({
      issueId: 'dig-issue',
      items: 2,
      message: 'Rascunho criado com 2 posts.',
    })
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'CREATE')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_newsletter_digest',
        action: 'create',
      }),
    )
  })

  it('runNow: refusals', async () => {
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.runNow(...A, NOW), 'FORBIDDEN')
    scope.mockResolvedValueOnce(
      ok({
        membership: {} as never,
        newsletter: createFakeNewsletter({ status: 'ARCHIVED' }),
      }),
    )
    expectErr(await Service.runNow(...A, NOW), 'CRM_NEWSLETTER_ARCHIVED')
    expectErr(await Service.runNow(...A, NOW), 'RESOURCE_NOT_FOUND')
    repo.findByNewsletter.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.runNow(...A, NOW), 'DATABASE_ERROR')
    repo.findByNewsletter.mockResolvedValueOnce(
      ok(createFakeNewsletterDigest()),
    )
    issues.findNewsletter.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.runNow(...A, NOW), 'DATABASE_ERROR')
  })

  it('tick: claims each due digest once and runs it', async () => {
    const due = createFakeNewsletterDigest({ nextRunAt: NOW })
    repo.listDue.mockResolvedValueOnce(
      ok([
        due,
        createFakeNewsletterDigest({ id: 'dg2', nextRunAt: NOW }),
        createFakeNewsletterDigest({ id: 'dg3', nextRunAt: null }),
      ]),
    )
    repo.claimRun
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok(false))
    const result = expectOk(await Service.tick(NOW))
    expect(result).toEqual({ due: 3, ran: 1, failed: 0 })
    expect(repo.claimRun).toHaveBeenCalledWith(
      'dg1',
      NOW,
      new Date('2026-11-02T12:00:00.000Z'),
      NOW,
    )
  })

  it('tick: a failing digest is recorded and the others go on', async () => {
    repo.listDue.mockResolvedValueOnce(
      ok([createFakeNewsletterDigest({ nextRunAt: NOW })]),
    )
    repo.claimRun.mockResolvedValueOnce(ok(true))
    issues.findNewsletter.mockResolvedValueOnce(err(databaseError('x')))
    expect(expectOk(await Service.tick(NOW))).toEqual({
      due: 1,
      ran: 0,
      failed: 1,
    })
    expect(repo.recordRun).toHaveBeenCalledWith(
      'dg1',
      expect.objectContaining({ lastOutcome: 'FAILED' }),
    )
  })

  it('tick: database errors of the list and the claim fail the tick', async () => {
    repo.listDue.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.tick(NOW), 'DATABASE_ERROR')
    repo.listDue.mockResolvedValueOnce(
      ok([createFakeNewsletterDigest({ nextRunAt: NOW })]),
    )
    repo.claimRun.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.tick(NOW), 'DATABASE_ERROR')
  })
})

describe('newsletter2 digest: edge branches', () => {
  it('reads only the feed when no site is set and falls back on empty excerpts', async () => {
    const result = expectOk(
      await collectDigestItems({
        workspaceId: 'ws1',
        siteId: null,
        rssUrl: 'https://blog.x/feed',
        maxItems: 5,
        since: new Date('2026-10-21T13:00:00.000Z'),
        now: NOW,
      }),
    )
    expect(result.items.map((item) => item.source)).toEqual(['RSS'])
    expect(repo.findSite).not.toHaveBeenCalled()
    repo.listLivePosts.mockResolvedValueOnce(
      ok([{ ...post(5), excerpt: null, autoExcerpt: '' }]),
    )
    const empty = expectOk(
      await collectDigestItems({
        workspaceId: 'ws1',
        siteId: 'site1',
        rssUrl: null,
        maxItems: 5,
        since: new Date('2026-10-21T13:00:00.000Z'),
        now: NOW,
      }),
    )
    expect(empty.items[0].excerpt).toBe('')
  })

  it('uses the newsletter name for a blank subject and ignores a missing template', async () => {
    issues.findNewsletter.mockResolvedValueOnce(
      ok(createFakeNewsletter({ templateId: 'gone' })),
    )
    templates.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectOk(
      await runDigest(createFakeNewsletterDigest({ subject: '   ' }), NOW),
    )
    expect(repo.createIssue.mock.calls[0][0].subject).toBe(newsletter.name)
  })

  it('skips when the built document does not validate', async () => {
    vi.mocked(validateIssueDocument).mockReturnValueOnce(
      err(crmNewsletterIssueIncomplete('Documento inválido')),
    )
    const outcome = expectOk(await runDigest(createFakeNewsletterDigest(), NOW))
    expect(outcome).toMatchObject({
      outcome: 'SKIPPED',
      message: 'Documento inválido',
    })
  })

  it('AUTO_SEND with a single post', async () => {
    repo.listLivePosts.mockResolvedValueOnce(ok([post(1)]))
    expect(
      expectOk(
        await runDigest(createFakeNewsletterDigest({ mode: 'AUTO_SEND' }), NOW),
      ).message,
    ).toBe('Resumo enviado com 1 post.')
  })

  it('saves a feed that passes the guard', async () => {
    expectOk(
      await Service.save(
        ...A,
        { ...DIGEST_INPUT, siteId: null, rssUrl: 'https://blog.x/feed' },
        NOW,
      ),
    )
    expect(guard).toHaveBeenCalledWith('https://blog.x/feed')
  })
})
