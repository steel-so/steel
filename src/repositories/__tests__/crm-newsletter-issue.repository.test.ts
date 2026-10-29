import { describe, expect, it, vi } from 'vitest'
import {
  seedNewsletterIssue,
  seedNewsletterScope,
  seedNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterIssueRepository as Repo } from '../crm-newsletter-issue.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')

describe('CrmNewsletterIssueRepository', () => {
  it('finds the newsletter with its workspace, scoped and not deleted', async () => {
    const { workspaceId, newsletter } = await seedNewsletterScope()
    const found = expectOk(
      await Repo.findNewsletter(workspaceId, newsletter.id),
    )
    expect(found?.workspace.slug).toBeTruthy()
    expect(
      expectOk(await Repo.findNewsletter('other', newsletter.id)),
    ).toBeNull()
    await prisma.crmNewsletter.update({
      where: { id: newsletter.id },
      data: { deletedAt: NOW },
    })
    expect(
      expectOk(await Repo.findNewsletter(workspaceId, newsletter.id)),
    ).toBeNull()
  })

  it('creates, lists (drafts first, then by number) and finds issues', async () => {
    const { workspaceId, userId, newsletter } = await seedNewsletterScope()
    const sent = await seedNewsletterIssue(newsletter, userId, {
      status: 'SENT',
      number: 1,
    })
    const draft = expectOk(
      await Repo.create({
        workspaceId,
        newsletterId: newsletter.id,
        subject: 'Rascunho',
        preheader: null,
        slug: 'rascunho',
        builderDocument: {},
        createdById: userId,
      }),
    )
    const page = expectOk(
      await Repo.list(workspaceId, newsletter.id, { page: 1, pageSize: 10 }),
    )
    expect(page.total).toBe(2)
    expect(page.items.map((issue) => issue.id)).toEqual([draft.id, sent.id])

    const onlySent = expectOk(
      await Repo.list(workspaceId, newsletter.id, {
        page: 1,
        pageSize: 10,
        status: 'SENT',
      }),
    )
    expect(onlySent.items).toHaveLength(1)

    expect(
      expectOk(await Repo.findById(workspaceId, newsletter.id, draft.id))?.id,
    ).toBe(draft.id)
    expect(
      expectOk(await Repo.findById('other', newsletter.id, draft.id)),
    ).toBeNull()
    const unscoped = expectOk(await Repo.findByIdUnscoped(draft.id))
    expect(unscoped?.newsletter.id).toBe(newsletter.id)
  })

  it('checks slugs, except the issue itself', async () => {
    const { userId, newsletter } = await seedNewsletterScope()
    const issue = await seedNewsletterIssue(newsletter, userId, {
      slug: 'outubro',
    })
    expect(expectOk(await Repo.slugTaken(newsletter.id, 'outubro'))).toBe(true)
    expect(
      expectOk(await Repo.slugTaken(newsletter.id, 'outubro', issue.id)),
    ).toBe(false)
    expect(expectOk(await Repo.slugTaken(newsletter.id, 'novembro'))).toBe(
      false,
    )
  })

  it('updates only editable issues and soft-deletes only drafts', async () => {
    const { userId, newsletter } = await seedNewsletterScope()
    const draft = await seedNewsletterIssue(newsletter, userId)
    const sent = await seedNewsletterIssue(newsletter, userId, {
      status: 'SENT',
    })
    const updated = expectOk(
      await Repo.updateEditable(draft.id, {
        subject: 'Novo',
        updatedById: userId,
      }),
    )
    expect(updated?.subject).toBe('Novo')
    expect(
      expectOk(
        await Repo.updateEditable(sent.id, {
          subject: 'x',
          updatedById: userId,
        }),
      ),
    ).toBeNull()

    expect(expectOk(await Repo.softDeleteDraft(sent.id, NOW))).toBe(false)
    expect(expectOk(await Repo.softDeleteDraft(draft.id, NOW))).toBe(true)
  })

  it('transitions conditionally', async () => {
    const { userId, newsletter } = await seedNewsletterScope()
    const issue = await seedNewsletterIssue(newsletter, userId)
    const scheduled = expectOk(
      await Repo.transition(issue.id, ['DRAFT'], {
        status: 'SCHEDULED',
        scheduledAt: NOW,
      }),
    )
    expect(scheduled?.status).toBe('SCHEDULED')
    expect(
      expectOk(await Repo.transition(issue.id, ['DRAFT'], { status: 'SENT' })),
    ).toBeNull()
  })

  it('counts the audience without opt-outs and other statuses', async () => {
    const { workspaceId, newsletter } = await seedNewsletterScope()
    await seedNewsletterSubscriber(newsletter, 'a@example.com')
    await seedNewsletterSubscriber(newsletter, 'b@example.com')
    await seedNewsletterSubscriber(newsletter, 'c@example.com', 'UNSUBSCRIBED')
    await prisma.crmEmailOptOut.create({
      data: { workspaceId, email: 'b@example.com', source: 'LINK' },
    })
    expect(expectOk(await Repo.countAudience(workspaceId, newsletter.id))).toBe(
      1,
    )
  })

  it('starts sending: numbers, snapshots and freezes the issue', async () => {
    const { workspaceId, userId, newsletter } = await seedNewsletterScope()
    await seedNewsletterIssue(newsletter, userId, {
      status: 'SENT',
      number: 4,
    })
    const issue = await seedNewsletterIssue(newsletter, userId, {
      status: 'SCHEDULED',
    })
    await seedNewsletterSubscriber(newsletter, 'a@example.com')
    await seedNewsletterSubscriber(newsletter, 'b@example.com')
    await seedNewsletterSubscriber(newsletter, 'gone@example.com', 'BOUNCED')
    await prisma.crmEmailOptOut.create({
      data: { workspaceId, email: 'b@example.com', source: 'LINK' },
    })

    const started = expectOk(
      await Repo.startSending(issue.id, {
        webHtml: '<p>web</p>',
        excerpt: 'web',
        now: NOW,
      }),
    )
    expect(started?.recipients).toBe(1)
    expect(started?.issue).toMatchObject({
      status: 'SENDING',
      number: 5,
      webHtml: '<p>web</p>',
      excerpt: 'web',
    })
    const rows = await prisma.crmNewsletterIssueRecipient.findMany({
      where: { issueId: issue.id },
    })
    expect(rows.map((row) => row.email)).toEqual(['a@example.com'])

    // A second start loses (already SENDING); a missing issue too.
    expect(
      expectOk(
        await Repo.startSending(issue.id, {
          webHtml: '',
          excerpt: '',
          now: NOW,
        }),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await Repo.startSending('missing', {
          webHtml: '',
          excerpt: '',
          now: NOW,
        }),
      ),
    ).toBeNull()
  })

  it('numbers the first issue of a newsletter as 1', async () => {
    const { userId, newsletter } = await seedNewsletterScope()
    const issue = await seedNewsletterIssue(newsletter, userId)
    const started = expectOk(
      await Repo.startSending(issue.id, { webHtml: '', excerpt: '', now: NOW }),
    )
    expect(started).toMatchObject({ recipients: 0, issue: { number: 1 } })
  })

  it('lists due, sending and last sent issues', async () => {
    const { workspaceId, userId, newsletter } = await seedNewsletterScope()
    const due = await seedNewsletterIssue(newsletter, userId, {
      status: 'SCHEDULED',
      scheduledAt: new Date(NOW.getTime() - 1000),
    })
    await seedNewsletterIssue(newsletter, userId, {
      status: 'SCHEDULED',
      scheduledAt: new Date(NOW.getTime() + 60_000),
    })
    const sending = await seedNewsletterIssue(newsletter, userId, {
      status: 'SENDING',
      sendingStartedAt: NOW,
    })
    const sent = await seedNewsletterIssue(newsletter, userId, {
      status: 'SENT',
      sentAt: NOW,
      number: 1,
    })
    expect(expectOk(await Repo.listDue(NOW)).map((i) => i.id)).toEqual([due.id])
    expect(expectOk(await Repo.listSending()).map((i) => i.id)).toEqual([
      sending.id,
    ])
    expect(
      expectOk(await Repo.listLastSent(workspaceId, newsletter.id, 5)).map(
        (i) => i.id,
      ),
    ).toEqual([sent.id])
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const spies = [
      vi
        .spyOn(prisma.crmNewsletter, 'findFirst')
        .mockRejectedValueOnce(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterIssue, 'findFirst')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterIssue, 'findMany')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterIssue, 'create')
        .mockRejectedValueOnce(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterIssue, 'updateMany')
        .mockRejectedValue(new Error('down')),
      vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('down')),
      vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('down')),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(await Repo.findNewsletter('w', 'n'), code)
    expectErr(await Repo.list('w', 'n', { page: 1, pageSize: 1 }), code)
    expectErr(await Repo.findById('w', 'n', 'i'), code)
    expectErr(await Repo.findByIdUnscoped('i'), code)
    expectErr(await Repo.slugTaken('n', 's'), code)
    expectErr(
      await Repo.create({
        workspaceId: 'w',
        newsletterId: 'n',
        subject: 's',
        preheader: null,
        slug: 's',
        builderDocument: {},
        createdById: 'u',
      }),
      code,
    )
    expectErr(await Repo.updateEditable('i', { updatedById: 'u' }), code)
    expectErr(await Repo.softDeleteDraft('i', NOW), code)
    expectErr(await Repo.transition('i', ['DRAFT'], {}), code)
    expectErr(await Repo.countAudience('w', 'n'), code)
    expectErr(
      await Repo.startSending('i', { webHtml: '', excerpt: '', now: NOW }),
      code,
    )
    expectErr(await Repo.listDue(NOW), code)
    expectErr(await Repo.listSending(), code)
    expectErr(await Repo.listLastSent('w', 'n', 1), code)
    for (const spy of spies) spy.mockRestore()
  })
})
