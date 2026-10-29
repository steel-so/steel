import { describe, expect, it, vi } from 'vitest'
import {
  seedNewsletterIssue,
  seedNewsletterScope,
  seedNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterAbRepository as Repo } from '../crm-newsletter-ab.repository'
import { CrmNewsletterDeliveryRepository } from '../crm-newsletter-delivery.repository'
import { CrmNewsletterIssueRepository } from '../crm-newsletter-issue.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')

async function scopeWithAudience(count: number) {
  const scope = await seedNewsletterScope()
  for (let i = 0; i < count; i++) {
    await seedNewsletterSubscriber(scope.newsletter, `p${i}@acme.com.br`)
  }
  return scope
}

describe('A/B split at the audience snapshot', () => {
  it('splits the test share half A, half B and holds the rest', async () => {
    const { userId, newsletter } = await scopeWithAudience(10)
    const issue = await seedNewsletterIssue(newsletter, userId, {
      abSubjectB: 'B',
      abTestPercent: 40,
    })
    const started = expectOk(
      await CrmNewsletterIssueRepository.startSending(issue.id, {
        webHtml: '<p>web</p>',
        excerpt: 'web',
        now: NOW,
        abShare: () => 4,
      }),
    )
    expect(started?.recipients).toBe(10)
    const rows = await prisma.crmNewsletterIssueRecipient.findMany({
      where: { issueId: issue.id },
    })
    expect(rows.filter((r) => r.abVariant === 'A')).toHaveLength(2)
    expect(rows.filter((r) => r.abVariant === 'B')).toHaveLength(2)
    expect(rows.filter((r) => r.abHeld)).toHaveLength(6)
    expect(rows.filter((r) => r.abHeld && r.abVariant)).toHaveLength(0)

    // Held rows are never claimed, but keep the issue open.
    const claimed = expectOk(
      await CrmNewsletterDeliveryRepository.claimBatch(issue.id, 100),
    )
    expect(claimed).toHaveLength(4)
    expect(new Set(claimed.map((row) => row.abVariant))).toEqual(
      new Set(['A', 'B']),
    )
    expect(
      expectOk(await CrmNewsletterDeliveryRepository.countOpen(issue.id)),
    ).toBe(10)
    expect(expectOk(await Repo.countHeld(issue.id))).toBe(6)
  })

  it('does not split without a test', async () => {
    const { userId, newsletter } = await scopeWithAudience(3)
    const issue = await seedNewsletterIssue(newsletter, userId)
    expectOk(
      await CrmNewsletterIssueRepository.startSending(issue.id, {
        webHtml: '',
        excerpt: '',
        now: NOW,
      }),
    )
    const rows = await prisma.crmNewsletterIssueRecipient.findMany({
      where: { issueId: issue.id },
    })
    expect(rows.every((r) => r.abVariant === null && !r.abHeld)).toBe(true)
  })
})

describe('CrmNewsletterAbRepository', () => {
  it('saves settings only while editable', async () => {
    const { userId, newsletter } = await seedNewsletterScope()
    const issue = await seedNewsletterIssue(newsletter, userId)
    const saved = expectOk(
      await Repo.setSettings(issue.id, {
        abSubjectB: 'B',
        abTestPercent: 20,
        abMetric: 'CLICKS',
        abWaitHours: 2,
        updatedById: userId,
      }),
    )
    expect(saved).toMatchObject({ abSubjectB: 'B', abMetric: 'CLICKS' })
    await prisma.crmNewsletterIssue.update({
      where: { id: issue.id },
      data: { status: 'SENT' },
    })
    expect(
      expectOk(
        await Repo.setSettings(issue.id, {
          abSubjectB: null,
          abTestPercent: null,
          abMetric: null,
          abWaitHours: null,
          updatedById: userId,
        }),
      ),
    ).toBeNull()
  })

  it('counts the variants and decides due tests once', async () => {
    const { userId, newsletter } = await scopeWithAudience(6)
    const issue = await seedNewsletterIssue(newsletter, userId, {
      abSubjectB: 'B',
      abTestPercent: 50,
      abWaitHours: 4,
    })
    expectOk(
      await CrmNewsletterIssueRepository.startSending(issue.id, {
        webHtml: '',
        excerpt: '',
        now: NOW,
        abShare: () => 2,
      }),
    )
    const [a, b] = await prisma.crmNewsletterIssueRecipient.findMany({
      where: { issueId: issue.id, abVariant: { not: null } },
      orderBy: { abVariant: 'asc' },
    })
    await prisma.crmNewsletterIssueRecipient.update({
      where: { id: a.id },
      data: { status: 'SENT' },
    })
    await prisma.crmNewsletterIssueRecipient.update({
      where: { id: b.id },
      data: { status: 'SENT', openedAt: NOW, clickedAt: NOW },
    })
    expect(expectOk(await Repo.variantCounts(issue.id))).toEqual([
      { variant: 'A', recipients: 1, sent: 1, opened: 0, clicked: 0 },
      { variant: 'B', recipients: 1, sent: 1, opened: 1, clicked: 1 },
    ])

    const later = new Date(NOW.getTime() + 4 * 3_600_000)
    expect(
      expectOk(await Repo.listDueDecisions(new Date(later.getTime() - 1))),
    ).toEqual([])
    const due = expectOk(await Repo.listDueDecisions(later))
    expect(due.map((d) => d.id)).toEqual([issue.id])

    expect(expectOk(await Repo.decide(issue.id, 'B', later))).toEqual({
      released: 4,
    })
    expect(expectOk(await Repo.decide(issue.id, 'A', later))).toBeNull()
    expect(expectOk(await Repo.countHeld(issue.id))).toBe(0)
    const decided = await prisma.crmNewsletterIssue.findUniqueOrThrow({
      where: { id: issue.id },
    })
    expect(decided).toMatchObject({ abWinner: 'B', abDecidedAt: later })
    expect(expectOk(await Repo.listDueDecisions(later))).toEqual([])
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const spies = [
      vi
        .spyOn(prisma.crmNewsletterIssue, 'updateMany')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma, '$queryRaw')
        .mockRejectedValueOnce(new Error('x'))
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.crmNewsletterIssueRecipient, 'count')
        .mockRejectedValueOnce(new Error('x')),
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('x')),
    ]
    expectErr(
      await Repo.setSettings('i', {
        abSubjectB: null,
        abTestPercent: null,
        abMetric: null,
        abWaitHours: null,
        updatedById: 'u',
      }),
      'DATABASE_ERROR',
    )
    expectErr(await Repo.variantCounts('i'), 'DATABASE_ERROR')
    expectErr(await Repo.listDueDecisions(NOW), 'DATABASE_ERROR')
    expectErr(await Repo.countHeld('i'), 'DATABASE_ERROR')
    expectErr(await Repo.decide('i', 'A', NOW), 'DATABASE_ERROR')
    for (const spy of spies) spy.mockRestore()
  })
})
