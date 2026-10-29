import { describe, expect, it, vi } from 'vitest'
import {
  seedNewsletterIssue,
  seedNewsletterScope,
  seedNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterWhatsAppRepository as Repo } from '../crm-newsletter-whatsapp.repository'

const T1 = new Date('2026-10-29T12:00:00.000Z')
const T2 = new Date('2026-10-29T12:05:00.000Z')
const T3 = new Date('2026-10-29T12:10:00.000Z')

/** An issue with SENT rows `wamid.0..n-1` (one subscriber each). */
async function seedSent(count: number) {
  const scope = await seedNewsletterScope()
  const issue = await seedNewsletterIssue(scope.newsletter, scope.userId, {
    status: 'SENT',
  })
  const ids: string[] = []
  for (let index = 0; index < count; index++) {
    const subscriber = await seedNewsletterSubscriber(
      scope.newsletter,
      `n${index}@example.com`,
      'ACTIVE',
    )
    const row = await prisma.crmNewsletterWhatsAppRecipient.create({
      data: {
        issueId: issue.id,
        workspaceId: scope.workspaceId,
        subscriberId: subscriber.id,
        name: `N${index}`,
        waId: `55119000000${index}`,
        status: 'SENT',
        providerMessageId: `wamid.${index}`,
        sentAt: T1,
      },
    })
    ids.push(row.id)
  }
  return { ...scope, issue, ids }
}

const read = (id: string) =>
  prisma.crmNewsletterWhatsAppRecipient.findUniqueOrThrow({ where: { id } })

describe('CrmNewsletterWhatsAppRepository receipts (nl3)', () => {
  it('finds the recipient by provider message id', async () => {
    const { issue, workspaceId, ids } = await seedSent(1)
    expect(expectOk(await Repo.findByProviderMessageId('wamid.0'))).toEqual({
      id: ids[0],
      issueId: issue.id,
      workspaceId,
      subscriberId: expect.any(String),
    })
    expect(expectOk(await Repo.findByProviderMessageId('other'))).toBeNull()
  })

  it('moves forward only and stamps each receipt once', async () => {
    const { issue, ids } = await seedSent(4)
    const [a, b, c, d] = ids

    // a: delivered, then read, then repeats and a late failure.
    expect(expectOk(await Repo.applyReceipt(a, 'DELIVERED', T1))).toBe(true)
    expect(expectOk(await Repo.applyReceipt(a, 'DELIVERED', T2))).toBe(false)
    expect(expectOk(await Repo.applyReceipt(a, 'READ', T2))).toBe(true)
    expect(expectOk(await Repo.applyReceipt(a, 'READ', T3))).toBe(false)
    expect(expectOk(await Repo.applyReceipt(a, 'FAILED', T3, 'x'))).toBe(false)
    expect(await read(a)).toMatchObject({
      status: 'SENT',
      deliveredAt: T1,
      readAt: T2,
      failedAt: null,
    })

    // b: read without a delivered webhook implies delivered.
    expect(expectOk(await Repo.applyReceipt(b, 'READ', T2))).toBe(true)
    expect(await read(b)).toMatchObject({ deliveredAt: T2, readAt: T2 })

    // c: provider failure; later receipts do not resurrect it.
    expect(
      expectOk(await Repo.applyReceipt(c, 'FAILED', T2, 'y'.repeat(600))),
    ).toBe(true)
    expect(expectOk(await Repo.applyReceipt(c, 'DELIVERED', T3))).toBe(false)
    const failed = await read(c)
    expect(failed).toMatchObject({
      status: 'FAILED',
      failedAt: T2,
      deliveredAt: null,
    })
    expect(failed.error).toHaveLength(500)

    // d: failure without detail gets a readable default.
    expect(expectOk(await Repo.applyReceipt(d, 'FAILED', T2, null))).toBe(true)
    expect((await read(d)).error).toBe('Falha informada pelo WhatsApp')

    expect(expectOk(await Repo.stats(issue.id))).toEqual({
      total: 4,
      pending: 0,
      sent: 2,
      failed: 2,
      skipped: 0,
      delivered: 2,
      read: 2,
    })
    const page = expectOk(
      await Repo.listRecipients(issue.id, { page: 1, pageSize: 10 }),
    )
    expect(page.items.find((row) => row.id === a)?.readAt).toEqual(T2)
  })

  it('ignores rows that were not sent', async () => {
    const { ids } = await seedSent(1)
    await prisma.crmNewsletterWhatsAppRecipient.update({
      where: { id: ids[0] },
      data: { status: 'SENDING' },
    })
    expect(expectOk(await Repo.applyReceipt(ids[0], 'READ', T1))).toBe(false)
    expect(expectOk(await Repo.applyReceipt(ids[0], 'FAILED', T1))).toBe(false)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const model = prisma.crmNewsletterWhatsAppRecipient
    const spies = [
      vi.spyOn(model, 'findFirst').mockImplementation(down as never),
      vi.spyOn(model, 'updateMany').mockImplementation(down as never),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(await Repo.findByProviderMessageId('wamid.x'), code)
    expectErr(await Repo.applyReceipt('r', 'DELIVERED', T1), code)
    expectErr(await Repo.applyReceipt('r', 'FAILED', T1), code)
    for (const spy of spies) spy.mockRestore()
  })
})
