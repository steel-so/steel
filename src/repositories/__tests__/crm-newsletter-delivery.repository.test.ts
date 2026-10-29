import type { CrmNewsletter } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  seedNewsletterIssue,
  seedNewsletterScope,
  seedNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterDeliveryRepository as Repo } from '../crm-newsletter-delivery.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')

async function seedSending(emails: string[]) {
  const scope = await seedNewsletterScope()
  const issue = await seedNewsletterIssue(scope.newsletter, scope.userId, {
    status: 'SENDING',
  })
  const rows = []
  for (const email of emails) {
    const subscriber = await seedNewsletterSubscriber(scope.newsletter, email)
    rows.push(
      await prisma.crmNewsletterIssueRecipient.create({
        data: {
          issueId: issue.id,
          workspaceId: scope.workspaceId,
          subscriberId: subscriber.id,
          email,
          name: email.split('@')[0],
        },
      }),
    )
  }
  return { ...scope, issue, rows }
}

describe('CrmNewsletterDeliveryRepository', () => {
  it('claims pending rows once, with the subscriber facts', async () => {
    const { issue } = await seedSending([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ])
    const first = expectOk(await Repo.claimBatch(issue.id, 2))
    expect(first).toHaveLength(2)
    expect(first[0]).toMatchObject({
      personId: null,
      subscriberStatus: 'ACTIVE',
    })
    const second = expectOk(await Repo.claimBatch(issue.id, 2))
    expect(second).toHaveLength(1)
    expect(expectOk(await Repo.claimBatch(issue.id, 2))).toEqual([])
    expect(expectOk(await Repo.countOpen(issue.id))).toBe(3)
  })

  it('records sent, failed, skipped and released rows', async () => {
    const { issue, rows } = await seedSending([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ])
    const [a, b, c, d] = rows
    expectOk(await Repo.claimBatch(issue.id, 4))
    expectOk(
      await Repo.markSent(
        [{ id: a.id, subscriberId: a.subscriberId, providerMessageId: 'm1' }],
        NOW,
      ),
    )
    expectOk(await Repo.markFailed([b.id], 'boom'))
    expectOk(await Repo.markSkipped([c.id], 'OPTED_OUT'))
    expectOk(await Repo.release([d.id]))
    // Empty inputs are no-ops.
    expectOk(await Repo.markSent([], NOW))
    expectOk(await Repo.markFailed([], 'x'))
    expectOk(await Repo.markSkipped([], 'x'))
    expectOk(await Repo.release([]))

    const byId = new Map(
      (
        await prisma.crmNewsletterIssueRecipient.findMany({
          where: { issueId: issue.id },
        })
      ).map((row) => [row.id, row]),
    )
    expect(byId.get(a.id)).toMatchObject({
      status: 'SENT',
      providerMessageId: 'm1',
    })
    expect(byId.get(b.id)).toMatchObject({ status: 'FAILED', error: 'boom' })
    expect(byId.get(c.id)).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'OPTED_OUT',
    })
    expect(byId.get(d.id)?.status).toBe('PENDING')
    const subscriber = await prisma.crmNewsletterSubscriber.findUnique({
      where: { id: a.subscriberId },
    })
    expect(subscriber?.lastSentAt).toEqual(NOW)

    expect(expectOk(await Repo.skipPending(issue.id, 'STOPPED'))).toBe(1)
    expect(expectOk(await Repo.countOpen(issue.id))).toBe(0)
  })

  it('gives stuck SENDING rows back', async () => {
    const { issue } = await seedSending(['a@example.com'])
    expectOk(await Repo.claimBatch(issue.id, 1))
    expect(
      expectOk(await Repo.releaseStuck(new Date(Date.now() - 60_000))),
    ).toBe(0)
    expect(
      expectOk(await Repo.releaseStuck(new Date(Date.now() + 60_000))),
    ).toBe(1)
  })

  it('computes stats, link stats and lists recipients with filters', async () => {
    const { issue, rows } = await seedSending([
      'ana@example.com',
      'bia@example.com',
    ])
    const [ana, bia] = rows
    await prisma.crmNewsletterIssueRecipient.update({
      where: { id: ana.id },
      data: {
        status: 'SENT',
        deliveredAt: NOW,
        openedAt: NOW,
        clickedAt: NOW,
      },
    })
    await prisma.crmNewsletterIssueRecipient.update({
      where: { id: bia.id },
      data: { status: 'SENT', bouncedAt: NOW },
    })
    expectOk(
      await Repo.recordClick({
        issueId: issue.id,
        recipientId: ana.id,
        url: 'https://acme.com/a',
        clickedAt: NOW,
      }),
    )
    expectOk(
      await Repo.recordClick({
        issueId: issue.id,
        recipientId: ana.id,
        url: 'https://acme.com/a',
        clickedAt: NOW,
      }),
    )

    const stats = expectOk(await Repo.statsFor([issue.id]))
    expect(stats.get(issue.id)).toEqual({
      recipients: 2,
      sent: 2,
      skipped: 0,
      failed: 0,
      delivered: 1,
      opened: 1,
      clicked: 1,
      bounced: 1,
      complained: 0,
      unsubscribed: 0,
    })
    expect(expectOk(await Repo.statsFor([])).size).toBe(0)
    expect(expectOk(await Repo.linkStats(issue.id))).toEqual([
      { url: 'https://acme.com/a', clicks: 2, uniqueClickers: 1 },
    ])

    const list = async (
      filter: Parameters<typeof Repo.listRecipients>[1]['filter'],
      search?: string,
    ) =>
      expectOk(
        await Repo.listRecipients(issue.id, {
          page: 1,
          pageSize: 10,
          filter,
          search,
        }),
      ).items.map((row) => row.email)

    expect(await list('all')).toEqual(['ana@example.com', 'bia@example.com'])
    expect(await list('opened')).toEqual(['ana@example.com'])
    expect(await list('not_opened')).toEqual(['bia@example.com'])
    expect(await list('clicked')).toEqual(['ana@example.com'])
    expect(await list('delivered')).toEqual(['ana@example.com'])
    expect(await list('bounced')).toEqual(['bia@example.com'])
    expect(await list('complained')).toEqual([])
    expect(await list('unsubscribed')).toEqual([])
    expect(await list('failed')).toEqual([])
    expect(await list('skipped')).toEqual([])
    expect(await list('all', 'BIA')).toEqual(['bia@example.com'])
  })

  it('serves the webhook: lookup, first marks and subscriber effects', async () => {
    const { workspaceId, newsletter, issue, rows } = await seedSending([
      'ana@example.com',
    ])
    const [row] = rows
    await prisma.crmNewsletterIssueRecipient.update({
      where: { id: row.id },
      data: { providerMessageId: 'msg-1' },
    })
    const found = expectOk(await Repo.findByProviderMessageId('msg-1'))
    expect(found?.issue).toEqual({
      id: issue.id,
      workspaceId,
      newsletterId: newsletter.id,
    })
    expect(expectOk(await Repo.findByProviderMessageId('nope'))).toBeNull()

    expect(expectOk(await Repo.markFirst(row.id, 'openedAt', NOW))).toBe(true)
    expect(expectOk(await Repo.markFirst(row.id, 'openedAt', NOW))).toBe(false)
    expectOk(await Repo.touchSubscriber(row.subscriberId, 'lastOpenedAt', NOW))

    // Same address in another newsletter of the workspace bounces too.
    const other = (await prisma.crmNewsletter.create({
      data: {
        workspaceId,
        createdById: newsletter.createdById,
        name: 'Outra',
        slug: 'outra',
        fromName: 'Acme',
        fromEmail: 'news@news.acme.com.br',
      },
    })) as CrmNewsletter
    await seedNewsletterSubscriber(other, 'ana@example.com')
    expect(
      expectOk(
        await Repo.bounceEverywhere(workspaceId, 'ANA@example.com', NOW),
      ),
    ).toBe(2)
    expectOk(await Repo.complain(row.subscriberId, NOW))
    const subscriber = await prisma.crmNewsletterSubscriber.findUnique({
      where: { id: row.subscriberId },
    })
    expect(subscriber).toMatchObject({
      status: 'COMPLAINED',
      lastOpenedAt: NOW,
    })
  })

  it('reads the workspace opt-outs of a batch', async () => {
    const { workspaceId } = await seedNewsletterScope()
    await prisma.crmEmailOptOut.create({
      data: { workspaceId, email: 'out@example.com', source: 'LINK' },
    })
    const set = expectOk(
      await Repo.optedOut(workspaceId, ['OUT@example.com', 'in@example.com']),
    )
    expect([...set]).toEqual(['out@example.com'])
    expect(expectOk(await Repo.optedOut(workspaceId, [])).size).toBe(0)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const spies = [
      vi.spyOn(prisma, '$queryRaw').mockImplementation(down as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterIssueRecipient, 'updateMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterIssueRecipient, 'count')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterIssueRecipient, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterLinkClick, 'create')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterSubscriber, 'updateMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmEmailOptOut, 'findMany')
        .mockImplementation(down as never),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(await Repo.claimBatch('i', 1), code)
    expectErr(
      await Repo.markSent(
        [{ id: 'r', subscriberId: 's', providerMessageId: 'm' }],
        NOW,
      ),
      code,
    )
    expectErr(await Repo.markFailed(['r'], 'x'), code)
    expectErr(await Repo.markSkipped(['r'], 'x'), code)
    expectErr(await Repo.skipPending('i', 'x'), code)
    expectErr(await Repo.release(['r']), code)
    expectErr(await Repo.releaseStuck(NOW), code)
    expectErr(await Repo.countOpen('i'), code)
    expectErr(await Repo.statsFor(['i']), code)
    expectErr(await Repo.linkStats('i'), code)
    expectErr(
      await Repo.listRecipients('i', { page: 1, pageSize: 1, filter: 'all' }),
      code,
    )
    expectErr(await Repo.findByProviderMessageId('m'), code)
    expectErr(await Repo.markFirst('r', 'openedAt', NOW), code)
    expectErr(
      await Repo.recordClick({
        issueId: 'i',
        recipientId: 'r',
        url: 'u',
        clickedAt: NOW,
      }),
      code,
    )
    expectErr(await Repo.touchSubscriber('s', 'lastOpenedAt', NOW), code)
    expectErr(await Repo.bounceEverywhere('w', 'e', NOW), code)
    expectErr(await Repo.complain('s', NOW), code)
    expectErr(await Repo.optedOut('w', ['e']), code)
    for (const spy of spies) spy.mockRestore()
  })
})
