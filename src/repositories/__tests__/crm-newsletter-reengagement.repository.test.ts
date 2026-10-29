import { describe, expect, it, vi } from 'vitest'
import { seedNewsletterScope } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  seedConfirmedSubscriber,
  seedReengagement,
  seedReengagementSettings,
  seedSentIssues,
} from '@/src/__tests__/factories/newsletter2-automation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS } from '@/src/schemas/crm-newsletter-automation.schema'
import { CrmNewsletterReengagementRepository as Repo } from '../crm-newsletter-reengagement.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)
const CRITERIA = { minIssues: 3, inactiveDays: 90, now: NOW }

describe('CrmNewsletterReengagementRepository — settings', () => {
  it('creates, updates and reads the settings', async () => {
    const { newsletter } = await seedNewsletterScope()
    expect(expectOk(await Repo.findSettings(newsletter.id))).toBeNull()
    const created = expectOk(
      await Repo.upsertSettings(newsletter.id, newsletter.workspaceId, {
        ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
        enabled: true,
      }),
    )
    expect(created.enabled).toBe(true)
    const updated = expectOk(
      await Repo.upsertSettings(newsletter.id, newsletter.workspaceId, {
        ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
        action: 'FLAG',
      }),
    )
    expect(updated).toMatchObject({ enabled: false, action: 'FLAG' })
    expect(expectOk(await Repo.findSettings(newsletter.id))?.action).toBe(
      'FLAG',
    )
  })

  it('lists only enabled settings of ACTIVE newsletters', async () => {
    const on = await seedNewsletterScope()
    await seedReengagementSettings(on.newsletter)
    const off = await seedNewsletterScope()
    await seedReengagementSettings(off.newsletter, { enabled: false })
    const archived = await seedNewsletterScope({ status: 'ARCHIVED' })
    await seedReengagementSettings(archived.newsletter)

    const list = expectOk(await Repo.listEnabled())
    expect(list.map((row) => row.newsletterId)).toEqual([on.newsletter.id])
    expect(list[0].newsletter.workspace.slug).toBeTruthy()
  })
})

describe('CrmNewsletterReengagementRepository — candidates', () => {
  it('counts and claims only the inactive subscribers, once per cycle', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    const recent = daysAgo(10)
    const inactive = await seedConfirmedSubscriber(
      newsletter,
      'inactive@example.com',
      { personId: 'p1' },
    )
    await seedSentIssues(newsletter, userId, inactive, 3, recent)

    const opened = await seedConfirmedSubscriber(newsletter, 'o@example.com', {
      lastOpenedAt: daysAgo(5),
    })
    await seedSentIssues(newsletter, userId, opened, 3, recent)
    const clicked = await seedConfirmedSubscriber(newsletter, 'c@example.com', {
      lastClickedAt: daysAgo(5),
    })
    await seedSentIssues(newsletter, userId, clicked, 3, recent)
    const few = await seedConfirmedSubscriber(newsletter, 'few@example.com')
    await seedSentIssues(newsletter, userId, few, 2, recent)
    const oldIssues = await seedConfirmedSubscriber(
      newsletter,
      'old@example.com',
    )
    await seedSentIssues(newsletter, userId, oldIssues, 3, daysAgo(200))
    const out = await seedConfirmedSubscriber(newsletter, 'out@example.com')
    await seedSentIssues(newsletter, userId, out, 3, recent)
    await prisma.crmEmailOptOut.create({
      data: {
        workspaceId: newsletter.workspaceId,
        email: 'out@example.com',
        source: 'LINK',
      },
    })
    const waiting = await seedConfirmedSubscriber(newsletter, 'w@example.com')
    await seedSentIssues(newsletter, userId, waiting, 3, recent)
    await seedReengagement(newsletter, waiting)
    const left = await seedConfirmedSubscriber(newsletter, 'left@example.com', {
      status: 'UNSUBSCRIBED',
    })
    await seedSentIssues(newsletter, userId, left, 3, recent)

    const criteria = { ...CRITERIA, newsletterId: newsletter.id }
    expect(expectOk(await Repo.countCandidates(criteria))).toBe(1)
    expect(
      expectOk(await Repo.countCandidates({ ...criteria, minIssues: 2 })),
    ).toBe(2)

    const claimed = expectOk(
      await Repo.claimCandidates({ ...criteria, cycle: '2026-10', limit: 10 }),
    )
    expect(claimed).toEqual([
      expect.objectContaining({
        subscriberId: inactive.id,
        email: 'inactive@example.com',
        name: 'inactive',
        personId: 'p1',
      }),
    ])
    // Claimed (SENDING): not a candidate anymore, a rerun adds nothing.
    expect(expectOk(await Repo.countCandidates(criteria))).toBe(0)
    expect(
      expectOk(
        await Repo.claimCandidates({
          ...criteria,
          cycle: '2026-10',
          limit: 10,
        }),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await Repo.claimCandidates({ ...criteria, cycle: '2026-11', limit: 0 }),
      ),
    ).toEqual([])
  })

  it('records sends and failures and gives up stuck attempts', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    const people = []
    for (const name of ['a', 'b', 'c']) {
      const subscriber = await seedConfirmedSubscriber(
        newsletter,
        `${name}@example.com`,
      )
      await seedSentIssues(newsletter, userId, subscriber, 3, daysAgo(10))
      people.push(subscriber)
    }
    const rows = expectOk(
      await Repo.claimCandidates({
        ...CRITERIA,
        newsletterId: newsletter.id,
        cycle: '2026-10',
        limit: 10,
      }),
    )
    const [a, b, c] = rows
    expectOk(
      await Repo.markSent(
        [{ id: a.id, subscriberId: a.subscriberId, providerMessageId: 'r-a' }],
        NOW,
      ),
    )
    expectOk(await Repo.markSent([], NOW))
    expectOk(await Repo.markFailed([b.id], 'x'.repeat(600)))
    expectOk(await Repo.markFailed([], 'x'))
    await prisma.crmNewsletterReengagement.update({
      where: { id: c.id },
      data: { updatedAt: daysAgo(1) },
    })
    expect(expectOk(await Repo.failStuck(daysAgo(0.5)))).toBe(1)

    const byId = (id: string) =>
      prisma.crmNewsletterReengagement.findUniqueOrThrow({ where: { id } })
    expect(await byId(a.id)).toMatchObject({
      status: 'WAITING',
      providerMessageId: 'r-a',
      sentAt: NOW,
    })
    expect((await byId(b.id)).error).toHaveLength(500)
    expect(await byId(c.id)).toMatchObject({
      status: 'FAILED',
      error: 'Envio interrompido',
    })
    const subscriber = await prisma.crmNewsletterSubscriber.findUniqueOrThrow({
      where: { id: a.subscriberId },
    })
    expect(subscriber.lastSentAt).toEqual(NOW)
  })
})

describe('CrmNewsletterReengagementRepository — grace period', () => {
  it('lists the due attempts of enabled newsletters and resolves them', async () => {
    const { newsletter } = await seedNewsletterScope()
    await seedReengagementSettings(newsletter, { graceDays: 30 })
    const due = await seedConfirmedSubscriber(newsletter, 'due@example.com', {
      lastOpenedAt: daysAgo(100),
    })
    const dueRow = await seedReengagement(newsletter, due, {
      sentAt: daysAgo(31),
      openedAt: daysAgo(30),
    })
    const young = await seedConfirmedSubscriber(newsletter, 'y@example.com')
    await seedReengagement(newsletter, young, { sentAt: daysAgo(5) })
    const done = await seedConfirmedSubscriber(newsletter, 'd@example.com')
    await seedReengagement(newsletter, done, {
      sentAt: daysAgo(40),
      status: 'REENGAGED',
    })
    const other = await seedNewsletterScope()
    await seedReengagementSettings(other.newsletter, { enabled: false })
    const otherSub = await seedConfirmedSubscriber(
      other.newsletter,
      'x@example.com',
    )
    await seedReengagement(other.newsletter, otherSub, { sentAt: daysAgo(40) })

    const list = expectOk(await Repo.listDue(NOW, 10))
    expect(list).toEqual([
      expect.objectContaining({
        id: dueRow.id,
        newsletterId: newsletter.id,
        subscriberId: due.id,
        subscriberStatus: 'ACTIVE',
        action: 'UNSUBSCRIBE',
        openedAt: daysAgo(30),
        lastOpenedAt: daysAgo(100),
        clickedAt: null,
        reengagedAt: null,
      }),
    ])

    expect(expectOk(await Repo.resolve([dueRow.id], 'UNSUBSCRIBED', NOW))).toBe(
      1,
    )
    expect(expectOk(await Repo.resolve([dueRow.id], 'FLAGGED', NOW))).toBe(0)
    expect(expectOk(await Repo.resolve([], 'FLAGGED', NOW))).toBe(0)
    expect(expectOk(await Repo.unsubscribeInactive([due.id], NOW))).toBe(1)
    expect(expectOk(await Repo.unsubscribeInactive([due.id], NOW))).toBe(0)
    expect(expectOk(await Repo.unsubscribeInactive([], NOW))).toBe(0)
    const saved = await prisma.crmNewsletterSubscriber.findUniqueOrThrow({
      where: { id: due.id },
    })
    expect(saved).toMatchObject({
      status: 'UNSUBSCRIBED',
      unsubscribeReason: 'inativo',
      unsubscribedAt: NOW,
    })
    expect(expectOk(await Repo.listDue(NOW, 10))).toEqual([])
  })

  it('counts waiting and due-now attempts and the totals', async () => {
    const { newsletter } = await seedNewsletterScope()
    const people = await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name) =>
        seedConfirmedSubscriber(newsletter, `${name}@example.com`),
      ),
    )
    // a: waiting; b: due now; c: past grace but opened; d: past grace but
    // came back to an issue after the e-mail; e/f: resolved.
    await seedReengagement(newsletter, people[0], { sentAt: daysAgo(5) })
    await seedReengagement(newsletter, people[1], { sentAt: daysAgo(40) })
    await seedReengagement(newsletter, people[2], {
      sentAt: daysAgo(40),
      openedAt: daysAgo(39),
    })
    await prisma.crmNewsletterSubscriber.update({
      where: { id: people[3].id },
      data: { lastClickedAt: daysAgo(10) },
    })
    await seedReengagement(newsletter, people[3], { sentAt: daysAgo(40) })
    await seedReengagement(newsletter, people[4], { status: 'REENGAGED' })
    await seedReengagement(newsletter, people[5], { status: 'UNSUBSCRIBED' })

    expect(expectOk(await Repo.countWaiting(newsletter.id, NOW, 30))).toEqual({
      waiting: 1,
      dueNow: 1,
    })
    expect(expectOk(await Repo.totals(newsletter.id))).toEqual({
      sent: 6,
      reengaged: 1,
      unsubscribed: 1,
      flagged: 0,
    })
  })
})

describe('CrmNewsletterReengagementRepository — tracking and the button', () => {
  it('finds by provider id, marks first events and reengages', async () => {
    const { newsletter } = await seedNewsletterScope()
    const active = await seedConfirmedSubscriber(newsletter, 'a@example.com')
    const row = await seedReengagement(newsletter, active, {
      providerMessageId: 'r-1',
    })
    expect(expectOk(await Repo.findByProviderMessageId('r-1'))?.id).toBe(row.id)
    expect(expectOk(await Repo.findByProviderMessageId('nope'))).toBeNull()
    expect(expectOk(await Repo.markFirst(row.id, 'clickedAt', NOW))).toBe(true)
    expect(expectOk(await Repo.markFirst(row.id, 'clickedAt', NOW))).toBe(false)

    const context = expectOk(await Repo.findWithContext(row.id))
    expect(context).toMatchObject({
      newsletter: { id: newsletter.id, name: newsletter.name },
      subscriber: { id: active.id, status: 'ACTIVE' },
    })
    expect(expectOk(await Repo.findWithContext('nope'))).toBeNull()

    expect(expectOk(await Repo.reengage(context as never, NOW))).toBe(false)
    expect(
      await prisma.crmNewsletterReengagement.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({ status: 'REENGAGED', reengagedAt: NOW, resolvedAt: NOW })
    expect(
      (
        await prisma.crmNewsletterSubscriber.findUniqueOrThrow({
          where: { id: active.id },
        })
      ).lastClickedAt,
    ).toEqual(NOW)
  })

  it('brings back a subscriber removed for inactivity', async () => {
    const { newsletter } = await seedNewsletterScope()
    const removed = await seedConfirmedSubscriber(newsletter, 'r@example.com', {
      status: 'UNSUBSCRIBED',
      unsubscribedAt: daysAgo(1),
      unsubscribeReason: 'inativo',
    })
    const row = await seedReengagement(newsletter, removed, {
      status: 'UNSUBSCRIBED',
    })
    const context = expectOk(await Repo.findWithContext(row.id))
    expect(expectOk(await Repo.reengage(context as never, NOW))).toBe(true)
    expect(
      await prisma.crmNewsletterSubscriber.findUniqueOrThrow({
        where: { id: removed.id },
      }),
    ).toMatchObject({
      status: 'ACTIVE',
      unsubscribedAt: null,
      unsubscribeReason: null,
    })
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const spies = [
      vi.spyOn(prisma, '$queryRaw').mockImplementation(down as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(down as never),
      ...(['findUnique', 'upsert', 'findMany'] as const).map((method) =>
        vi
          .spyOn(prisma.crmNewsletterReengagementSettings, method)
          .mockImplementation(down as never),
      ),
      ...(['updateMany', 'groupBy', 'findUnique'] as const).map((method) =>
        vi
          .spyOn(prisma.crmNewsletterReengagement, method)
          .mockImplementation(down as never),
      ),
      vi
        .spyOn(prisma.crmNewsletterSubscriber, 'updateMany')
        .mockImplementation(down as never),
    ]
    const code = 'DATABASE_ERROR'
    const criteria = { ...CRITERIA, newsletterId: 'n' }
    expectErr(await Repo.findSettings('n'), code)
    expectErr(
      await Repo.upsertSettings('n', 'w', CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS),
      code,
    )
    expectErr(await Repo.listEnabled(), code)
    expectErr(await Repo.countCandidates(criteria), code)
    expectErr(
      await Repo.claimCandidates({ ...criteria, cycle: 'c', limit: 1 }),
      code,
    )
    expectErr(
      await Repo.markSent(
        [{ id: 'r', subscriberId: 's', providerMessageId: 'm' }],
        NOW,
      ),
      code,
    )
    expectErr(await Repo.markFailed(['r'], 'x'), code)
    expectErr(await Repo.failStuck(NOW), code)
    expectErr(await Repo.listDue(NOW, 1), code)
    expectErr(await Repo.resolve(['r'], 'FLAGGED', NOW), code)
    expectErr(await Repo.unsubscribeInactive(['s'], NOW), code)
    expectErr(await Repo.countWaiting('n', NOW, 30), code)
    expectErr(await Repo.totals('n'), code)
    expectErr(await Repo.findByProviderMessageId('m'), code)
    expectErr(await Repo.markFirst('r', 'openedAt', NOW), code)
    expectErr(await Repo.findWithContext('r'), code)
    expectErr(
      await Repo.reengage(
        {
          id: 'r',
          subscriberId: 's',
          subscriber: { id: 's', status: 'ACTIVE', unsubscribeReason: null },
        },
        NOW,
      ),
      code,
    )
    for (const spy of spies) spy.mockRestore()
  })
})
