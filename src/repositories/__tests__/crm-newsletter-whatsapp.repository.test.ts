import { describe, expect, it, vi } from 'vitest'
import {
  seedNewsletterIssue,
  seedNewsletterScope,
  seedNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  seedIssueRecipient,
  seedPerson,
} from '@/src/__tests__/factories/newsletter2-engage.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterWhatsAppRepository as Repo } from '../crm-newsletter-whatsapp.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')

async function seedScope() {
  const scope = await seedNewsletterScope()
  const issue = await seedNewsletterIssue(scope.newsletter, scope.userId, {
    status: 'SENDING',
  })
  const ana = await seedPerson(scope.workspaceId, scope.userId, {
    name: 'Ana Lima',
    phones: ['11999990000'],
  })
  const gone = await seedPerson(scope.workspaceId, scope.userId, {
    name: 'Removida',
    phones: ['11977770000'],
    deletedAt: NOW,
  })
  const subscribers = []
  for (const [email, personId, status] of [
    ['ana@example.com', ana.id, 'ACTIVE'],
    ['gone@example.com', gone.id, 'ACTIVE'],
    ['solo@example.com', null, 'ACTIVE'],
    ['out@example.com', ana.id, 'UNSUBSCRIBED'],
  ] as const) {
    const subscriber = await seedNewsletterSubscriber(
      scope.newsletter,
      email,
      status,
    )
    await prisma.crmNewsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { personId },
    })
    subscribers.push(subscriber)
  }
  return { ...scope, issue, ana, subscribers }
}

describe('CrmNewsletterWhatsAppRepository', () => {
  it('saves the settings and marks the start once', async () => {
    const { workspaceId, issue } = await seedScope()
    expect(expectOk(await Repo.findConfig(issue.id))).toBeNull()
    const saved = expectOk(
      await Repo.upsertConfig(issue.id, workspaceId, {
        enabled: true,
        text: 'Leia {link}',
      }),
    )
    expect(saved).toMatchObject({ enabled: true, text: 'Leia {link}' })
    expectOk(await Repo.upsertConfig(issue.id, workspaceId, { enabled: true }))
    expect(expectOk(await Repo.markStarted(issue.id, NOW))).toBe(true)
    expect(expectOk(await Repo.markStarted(issue.id, NOW))).toBe(false)
    expect(expectOk(await Repo.findConfig(issue.id))?.startedAt).toEqual(NOW)
  })

  it('collects linked people with phones (subscribers and issue snapshot)', async () => {
    const { workspaceId, newsletter, issue, ana, subscribers } =
      await seedScope()
    const preview = expectOk(
      await Repo.subscriberCandidates(workspaceId, newsletter.id),
    )
    expect(preview.candidates).toEqual([
      {
        subscriberId: subscribers[0].id,
        personId: ana.id,
        name: 'Ana Lima',
        phones: ['11999990000'],
      },
    ])
    expect(preview.linked).toBe(1)

    for (const subscriber of subscribers.slice(0, 3)) {
      await seedIssueRecipient(newsletter, issue.id, subscriber)
    }
    const snapshot = expectOk(await Repo.issueCandidates(workspaceId, issue.id))
    expect(snapshot.map((row) => row.subscriberId)).toEqual([subscribers[0].id])
  })

  it('reads WhatsApp opt-outs of the workspace', async () => {
    const { workspaceId } = await seedScope()
    await prisma.whatsAppContact.createMany({
      data: [
        { workspaceId, waId: '5511999990000', broadcastOptedOutAt: NOW },
        { workspaceId, waId: '5511888880000' },
      ],
    })
    const out = expectOk(
      await Repo.optedOut(workspaceId, ['5511999990000', '5511888880000']),
    )
    expect([...out]).toEqual(['5511999990000'])
    expect(expectOk(await Repo.optedOut(workspaceId, [])).size).toBe(0)
  })

  it('claims, records, skips and reports the rows', async () => {
    const { workspaceId, issue, subscribers } = await seedScope()
    expect(
      expectOk(await Repo.createRecipients(issue.id, workspaceId, [])),
    ).toBe(0)
    const rows = [
      '5511900000001',
      '5511900000002',
      '5511900000003',
      '5511900000004',
    ].map((waId, index) => ({
      subscriberId: subscribers[index % 3].id,
      personId: null,
      name: `N${index}`,
      waId,
      status: index === 3 ? ('SKIPPED' as const) : ('PENDING' as const),
      skipReason: index === 3 ? 'OPTED_OUT' : null,
    }))
    expect(
      expectOk(await Repo.createRecipients(issue.id, workspaceId, rows)),
    ).toBe(4)
    expect(
      expectOk(await Repo.createRecipients(issue.id, workspaceId, rows)),
    ).toBe(0)
    expect(expectOk(await Repo.stats(issue.id))).toMatchObject({
      total: 4,
      pending: 3,
    })

    const first = expectOk(await Repo.claimBatch(issue.id, 2))
    expect(first.map((row) => row.waId)).toEqual([
      '5511900000001',
      '5511900000002',
    ])
    expect(expectOk(await Repo.claimBatch(issue.id, 5))).toHaveLength(1)
    expect(expectOk(await Repo.claimBatch(issue.id, 5))).toEqual([])

    const [a, b] = first
    expectOk(await Repo.markSent(a.id, 'wamid.1', NOW))
    expectOk(await Repo.markFailed(b.id, 'x'.repeat(600)))
    const third = (await prisma.crmNewsletterWhatsAppRecipient.findFirst({
      where: { issueId: issue.id, status: 'SENDING' },
    })) as { id: string }
    expectOk(await Repo.release([third.id]))
    expectOk(await Repo.release([]))
    expect(expectOk(await Repo.skipPending(issue.id, 'STOPPED'))).toBe(1)

    const failed = await prisma.crmNewsletterWhatsAppRecipient.findUnique({
      where: { id: b.id },
    })
    expect(failed?.error).toHaveLength(500)

    expect(expectOk(await Repo.stats(issue.id))).toEqual({
      total: 4,
      pending: 0,
      sent: 1,
      failed: 1,
      skipped: 2,
      delivered: 0,
      read: 0,
    })
    const page = expectOk(
      await Repo.listRecipients(issue.id, { page: 1, pageSize: 2 }),
    )
    expect(page.total).toBe(4)
    expect(page.items).toHaveLength(2)
    const skipped = expectOk(
      await Repo.listRecipients(issue.id, {
        page: 1,
        pageSize: 10,
        status: 'SKIPPED',
      }),
    )
    expect(skipped.items.map((row) => row.skipReason).sort()).toEqual([
      'OPTED_OUT',
      'STOPPED',
    ])
  })

  it('skips claimed rows, releases stuck ones and counts sends per connection', async () => {
    const { workspaceId, issue, subscribers } = await seedScope()
    const connection = await prisma.whatsAppConnection.create({
      data: {
        workspaceId,
        provider: 'META',
        label: 'Marketing',
        phoneNumber: '5511999999999',
        createdById: issue.createdById,
      },
    })
    await Repo.upsertConfig(issue.id, workspaceId, {
      enabled: true,
      connectionId: connection.id,
    })
    await Repo.createRecipients(issue.id, workspaceId, [
      {
        subscriberId: subscribers[0].id,
        personId: null,
        name: 'A',
        waId: '5511911110000',
        status: 'PENDING',
        skipReason: null,
      },
      {
        subscriberId: subscribers[1].id,
        personId: null,
        name: 'B',
        waId: '5511922220000',
        status: 'PENDING',
        skipReason: null,
      },
    ])
    const [a, b] = expectOk(await Repo.claimBatch(issue.id, 2))
    expectOk(await Repo.markSkipped([a.id], 'OPTED_OUT'))
    expectOk(await Repo.markSkipped([], 'OPTED_OUT'))
    expect(
      expectOk(
        await Repo.releaseStuck(issue.id, new Date(Date.now() + 60_000)),
      ),
    ).toBe(1)
    const [again] = expectOk(await Repo.claimBatch(issue.id, 1))
    expect(again.id).toBe(b.id)
    expectOk(await Repo.markSent(b.id, 'wamid.9', new Date()))
    const since = new Date(Date.now() - 60_000)
    expect(expectOk(await Repo.countSentSince(connection.id, since))).toBe(1)
    expect(expectOk(await Repo.countSentSince('other', since))).toBe(0)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const model = prisma.crmNewsletterWhatsAppRecipient
    const spies = [
      vi.spyOn(prisma, '$queryRaw').mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterIssueWhatsApp, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterIssueWhatsApp, 'upsert')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterIssueWhatsApp, 'updateMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterSubscriber, 'findMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterIssueRecipient, 'findMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.whatsAppContact, 'findMany')
        .mockImplementation(down as never),
      vi.spyOn(model, 'createMany').mockImplementation(down as never),
      vi.spyOn(model, 'updateMany').mockImplementation(down as never),
      vi.spyOn(model, 'count').mockImplementation(down as never),
      vi.spyOn(model, 'groupBy').mockImplementation(down as never),
      vi.spyOn(model, 'findMany').mockImplementation(down as never),
    ]
    const code = 'DATABASE_ERROR'
    const row = {
      subscriberId: 's',
      personId: null,
      name: 'n',
      waId: '1',
      status: 'PENDING' as const,
      skipReason: null,
    }
    expectErr(await Repo.findConfig('i'), code)
    expectErr(await Repo.upsertConfig('i', 'w', { enabled: true }), code)
    expectErr(await Repo.markStarted('i', NOW), code)
    expectErr(await Repo.subscriberCandidates('w', 'n'), code)
    expectErr(await Repo.issueCandidates('w', 'i'), code)
    expectErr(await Repo.optedOut('w', ['1']), code)
    expectErr(await Repo.createRecipients('i', 'w', [row]), code)
    expectErr(await Repo.claimBatch('i', 1), code)
    expectErr(await Repo.releaseStuck('i', NOW), code)
    expectErr(await Repo.release(['r']), code)
    expectErr(await Repo.markSent('r', 'm', NOW), code)
    expectErr(await Repo.markFailed('r', 'e'), code)
    expectErr(await Repo.markSkipped(['r'], 'x'), code)
    expectErr(await Repo.skipPending('i', 'x'), code)
    expectErr(await Repo.countSentSince('c', NOW), code)
    expectErr(await Repo.stats('i'), code)
    expectErr(await Repo.listRecipients('i', { page: 1, pageSize: 1 }), code)
    for (const spy of spies) spy.mockRestore()
  })
})
