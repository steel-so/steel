import { describe, expect, it, vi } from 'vitest'
import { seedNewsletterScope } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  seedNewsletterDigest,
  seedSite,
  seedSitePost,
} from '@/src/__tests__/factories/newsletter2-digest-ai.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterDigestRepository as Repo } from '../crm-newsletter-digest.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')
const SETTINGS = {
  enabled: true,
  siteId: null,
  rssUrl: 'https://blog.acme.com.br/feed',
  cadence: 'MONTHLY' as const,
  weekday: 3,
  monthDay: 10,
  hour: 8,
  mode: 'AUTO_SEND' as const,
  maxItems: 3,
  subject: 'Resumo de {data}',
  intro: 'Oi',
}

describe('CrmNewsletterDigestRepository', () => {
  it('upserts (create then update), finds scoped and removes', async () => {
    const { workspaceId, userId, newsletter } = await seedNewsletterScope()
    const site = await seedSite(workspaceId, userId)
    const created = expectOk(
      await Repo.upsert({
        workspaceId,
        newsletterId: newsletter.id,
        actorId: userId,
        data: SETTINGS,
        nextRunAt: NOW,
      }),
    )
    // Weekday is cleared for a monthly cadence.
    expect(created).toMatchObject({
      weekday: null,
      monthDay: 10,
      createdById: userId,
    })
    const updated = expectOk(
      await Repo.upsert({
        workspaceId,
        newsletterId: newsletter.id,
        actorId: userId,
        data: { ...SETTINGS, cadence: 'WEEKLY', siteId: site.id },
        nextRunAt: null,
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated).toMatchObject({
      weekday: 3,
      monthDay: null,
      updatedById: userId,
    })
    expect(updated.site?.name).toBe('Site Acme')
    expect(
      expectOk(await Repo.findByNewsletter(workspaceId, newsletter.id))?.id,
    ).toBe(created.id)
    expect(
      expectOk(await Repo.findByNewsletter('other', newsletter.id)),
    ).toBeNull()
    expect(expectOk(await Repo.findByIdUnscoped(created.id))?.id).toBe(
      created.id,
    )
    expect(expectOk(await Repo.remove('other', newsletter.id))).toBe(false)
    expect(expectOk(await Repo.remove(workspaceId, newsletter.id))).toBe(true)
    expect(expectOk(await Repo.findByIdUnscoped(created.id))).toBeNull()
  })

  it('lists the workspace sites and finds one scoped', async () => {
    const { workspaceId, userId } = await seedNewsletterScope()
    const site = await seedSite(workspaceId, userId, { name: 'B' })
    await seedSite(workspaceId, userId, { name: 'Apagado', deletedAt: NOW })
    const sites = expectOk(await Repo.listSites(workspaceId))
    expect(sites.map((s) => s.name)).toEqual(['B'])
    expect(expectOk(await Repo.findSite(workspaceId, site.id))?.slug).toBe(
      site.slug,
    )
    expect(expectOk(await Repo.findSite('other', site.id))).toBeNull()
  })

  it('lists live posts in the window, newest first', async () => {
    const { workspaceId, userId } = await seedNewsletterScope()
    const site = await seedSite(workspaceId, userId)
    const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
    await seedSitePost(site.id, userId, {
      title: 'Velho',
      publishedAt: day(10),
    })
    await seedSitePost(site.id, userId, { title: 'Novo', publishedAt: day(1) })
    await seedSitePost(site.id, userId, { title: 'Meio', publishedAt: day(3) })
    await seedSitePost(site.id, userId, {
      title: 'Agendado vencido',
      status: 'SCHEDULED',
      publishedAt: day(2),
    })
    await seedSitePost(site.id, userId, {
      title: 'Rascunho',
      status: 'DRAFT',
      publishedAt: day(1),
    })
    await seedSitePost(site.id, userId, {
      title: 'Futuro',
      status: 'SCHEDULED',
      publishedAt: new Date(NOW.getTime() + 86_400_000),
    })
    const posts = expectOk(await Repo.listLivePosts(site.id, day(7), NOW, 10))
    expect(posts.map((p) => p.title)).toEqual([
      'Novo',
      'Agendado vencido',
      'Meio',
    ])
    expect(
      expectOk(await Repo.listLivePosts(site.id, day(7), NOW, 1)),
    ).toHaveLength(1)
  })

  it('lists due digests and claims a run only once', async () => {
    const { userId, newsletter } = await seedNewsletterScope()
    const digest = await seedNewsletterDigest(newsletter, userId, {
      nextRunAt: NOW,
    })
    const other = await seedNewsletterScope()
    await seedNewsletterDigest(other.newsletter, other.userId, {
      nextRunAt: NOW,
      enabled: false,
    })
    const due = expectOk(await Repo.listDue(NOW))
    expect(due.map((d) => d.id)).toEqual([digest.id])
    expect(expectOk(await Repo.listDue(new Date(NOW.getTime() - 1)))).toEqual(
      [],
    )
    const next = new Date(NOW.getTime() + 7 * 86_400_000)
    expect(expectOk(await Repo.claimRun(digest.id, NOW, next, NOW))).toBe(true)
    expect(expectOk(await Repo.claimRun(digest.id, NOW, next, NOW))).toBe(false)
    const after = await prisma.crmNewsletterDigest.findUniqueOrThrow({
      where: { id: digest.id },
    })
    expect(after).toMatchObject({ nextRunAt: next, lastRunAt: NOW })
  })

  it('records a run and creates the linked issue', async () => {
    const { workspaceId, userId, newsletter } = await seedNewsletterScope()
    const digest = await seedNewsletterDigest(newsletter, userId)
    const issue = expectOk(
      await Repo.createIssue({
        workspaceId,
        newsletterId: newsletter.id,
        digestId: digest.id,
        subject: 'Resumo',
        preheader: null,
        slug: 'resumo',
        builderDocument: createBlankEmailDocument() as never,
        createdById: userId,
      }),
    )
    expect(issue).toMatchObject({ digestId: digest.id, status: 'DRAFT' })
    expectOk(
      await Repo.recordRun(digest.id, {
        lastOutcome: 'DRAFT_CREATED',
        lastMessage: 'x'.repeat(600),
        lastIssueId: issue.id,
        lastItemAt: NOW,
      }),
    )
    const after = await prisma.crmNewsletterDigest.findUniqueOrThrow({
      where: { id: digest.id },
    })
    expect(after.lastMessage).toHaveLength(500)
    expect(after).toMatchObject({ lastIssueId: issue.id, lastItemAt: NOW })
    expectOk(
      await Repo.recordRun(digest.id, {
        lastOutcome: 'SKIPPED',
        lastMessage: null,
      }),
    )
    // The digest going away keeps its issues.
    await prisma.crmNewsletterDigest.delete({ where: { id: digest.id } })
    const kept = await prisma.crmNewsletterIssue.findUniqueOrThrow({
      where: { id: issue.id },
    })
    expect(kept.digestId).toBeNull()
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const spies = [
      vi
        .spyOn(prisma.crmNewsletterDigest, 'findFirst')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.crmNewsletterDigest, 'findUnique')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.crmNewsletterDigest, 'upsert')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.crmNewsletterDigest, 'deleteMany')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.crmNewsletterDigest, 'findMany')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.crmNewsletterDigest, 'updateMany')
        .mockRejectedValueOnce(new Error('x'))
        .mockRejectedValueOnce(new Error('x')),
      vi.spyOn(prisma.site, 'findMany').mockRejectedValueOnce(new Error('x')),
      vi.spyOn(prisma.site, 'findFirst').mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.sitePost, 'findMany')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.crmNewsletterIssue, 'create')
        .mockRejectedValueOnce(new Error('x')),
    ]
    expectErr(await Repo.findByNewsletter('w', 'n'), 'DATABASE_ERROR')
    expectErr(await Repo.findByIdUnscoped('d'), 'DATABASE_ERROR')
    expectErr(
      await Repo.upsert({
        workspaceId: 'w',
        newsletterId: 'n',
        actorId: 'u',
        data: SETTINGS,
        nextRunAt: null,
      }),
      'DATABASE_ERROR',
    )
    expectErr(await Repo.remove('w', 'n'), 'DATABASE_ERROR')
    expectErr(await Repo.listDue(NOW), 'DATABASE_ERROR')
    expectErr(await Repo.claimRun('d', NOW, null, NOW), 'DATABASE_ERROR')
    expectErr(
      await Repo.recordRun('d', { lastOutcome: 'SKIPPED', lastMessage: null }),
      'DATABASE_ERROR',
    )
    expectErr(await Repo.listSites('w'), 'DATABASE_ERROR')
    expectErr(await Repo.findSite('w', 's'), 'DATABASE_ERROR')
    expectErr(await Repo.listLivePosts('s', NOW, NOW, 1), 'DATABASE_ERROR')
    expectErr(
      await Repo.createIssue({
        workspaceId: 'w',
        newsletterId: 'n',
        digestId: 'd',
        subject: 's',
        preheader: null,
        slug: 's',
        builderDocument: {},
        createdById: 'u',
      }),
      'DATABASE_ERROR',
    )
    for (const spy of spies) spy.mockRestore()
  })
})
