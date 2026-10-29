import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { seedNewsletterScope } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  seedConfirmedSubscriber,
  seedWelcomeStep,
} from '@/src/__tests__/factories/newsletter2-automation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterWelcomeRepository as Repo } from '../crm-newsletter-welcome.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const STUCK = new Date(NOW.getTime() - 15 * 60 * 1000)

describe('CrmNewsletterWelcomeRepository — steps', () => {
  it('creates steps at the end, lists, updates, reorders and deletes', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    const input = {
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      preheader: null,
      delayValue: 0,
      delayUnit: 'DAYS' as const,
      builderDocument:
        createBlankEmailDocument() as unknown as Prisma.InputJsonValue,
      createdById: userId,
    }
    const a = expectOk(await Repo.createStep({ ...input, subject: 'A' }))
    const b = expectOk(await Repo.createStep({ ...input, subject: 'B' }))
    const c = expectOk(await Repo.createStep({ ...input, subject: 'C' }))
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2])
    expect(expectOk(await Repo.countSteps(newsletter.id))).toBe(3)

    expect(expectOk(await Repo.findStep(newsletter.id, b.id))?.subject).toBe(
      'B',
    )
    expect(expectOk(await Repo.findStep('other', b.id))).toBeNull()
    expect(
      expectOk(await Repo.findStepsByIds([a.id, c.id])).map((s) => s.subject),
    ).toEqual(expect.arrayContaining(['A', 'C']))
    expect(expectOk(await Repo.findStepsByIds([]))).toEqual([])

    const updated = expectOk(
      await Repo.updateStep(b.id, { subject: 'B2', enabled: false }),
    )
    expect(updated).toMatchObject({ subject: 'B2', enabled: false })

    expectOk(await Repo.reorderSteps([c.id, a.id, b.id]))
    expect(
      expectOk(await Repo.listSteps(newsletter.id)).map((s) => s.subject),
    ).toEqual(['C', 'A', 'B2'])

    expectOk(await Repo.deleteStep(newsletter.id, a.id))
    const rest = expectOk(await Repo.listSteps(newsletter.id))
    expect(rest.map((s) => [s.subject, s.position])).toEqual([
      ['C', 0],
      ['B2', 1],
    ])
  })

  it('counts sent, opened and clicked per step', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    const step = await seedWelcomeStep(newsletter, userId)
    const empty = await seedWelcomeStep(newsletter, userId)
    const people = await Promise.all(
      ['a', 'b', 'c'].map((name) =>
        seedConfirmedSubscriber(newsletter, `${name}@example.com`),
      ),
    )
    const rows: Prisma.CrmNewsletterWelcomeDeliveryCreateManyInput[] = [
      { status: 'SENT', openedAt: NOW, clickedAt: NOW },
      { status: 'SENT', openedAt: NOW },
      { status: 'SKIPPED' },
    ].map((extra, index) => ({
      stepId: step.id,
      newsletterId: newsletter.id,
      workspaceId: newsletter.workspaceId,
      subscriberId: people[index].id,
      email: people[index].email,
      ...extra,
    })) as never
    await prisma.crmNewsletterWelcomeDelivery.createMany({ data: rows })

    const stats = expectOk(await Repo.statsFor([step.id, empty.id]))
    expect(stats.get(step.id)).toEqual({ sent: 2, opened: 2, clicked: 1 })
    expect(stats.has(empty.id)).toBe(false)
    expect(expectOk(await Repo.statsFor([])).size).toBe(0)
  })
})

describe('CrmNewsletterWelcomeRepository — worker', () => {
  it('lists only ACTIVE, non-deleted newsletters with an enabled step', async () => {
    const on = await seedNewsletterScope()
    await seedWelcomeStep(on.newsletter, on.userId)
    const off = await seedNewsletterScope()
    await seedWelcomeStep(off.newsletter, off.userId, { enabled: false })
    const archived = await seedNewsletterScope({ status: 'ARCHIVED' })
    await seedWelcomeStep(archived.newsletter, archived.userId)
    await seedNewsletterScope()

    const list = expectOk(await Repo.listNewslettersWithSeries())
    expect(list.map((n) => n.id)).toEqual([on.newsletter.id])
    expect(list[0].workspace.slug).toBeTruthy()
  })

  it('claims each due (step, subscriber) once, following the rules', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    const now0 = await seedWelcomeStep(newsletter, userId, { delayValue: 0 })
    const twoDays = await seedWelcomeStep(newsletter, userId, {
      delayValue: 2,
      delayUnit: 'DAYS',
    })
    const sixHours = await seedWelcomeStep(newsletter, userId, {
      delayValue: 6,
      delayUnit: 'HOURS',
    })
    await seedWelcomeStep(newsletter, userId, { enabled: false })

    // Confirmed 3 days ago: all three enabled steps are due.
    const old = await seedConfirmedSubscriber(newsletter, 'old@example.com', {
      confirmedAt: new Date(NOW.getTime() - 3 * DAY),
    })
    // Confirmed 1 hour ago: only the immediate step.
    const fresh = await seedConfirmedSubscriber(
      newsletter,
      'fresh@example.com',
      { confirmedAt: new Date(NOW.getTime() - HOUR), personId: 'p1' },
    )
    // Never: stale, imported, pending, unconfirmed, opted out.
    await seedConfirmedSubscriber(newsletter, 'stale@example.com', {
      confirmedAt: new Date(NOW.getTime() - 30 * DAY),
    })
    await seedConfirmedSubscriber(newsletter, 'import@example.com', {
      source: 'IMPORT',
    })
    await seedConfirmedSubscriber(newsletter, 'pending@example.com', {
      status: 'PENDING',
    })
    await seedConfirmedSubscriber(newsletter, 'noconfirm@example.com', {
      confirmedAt: null,
    })
    await seedConfirmedSubscriber(newsletter, 'out@example.com')
    await prisma.crmEmailOptOut.create({
      data: {
        workspaceId: newsletter.workspaceId,
        email: 'out@example.com',
        source: 'LINK',
      },
    })

    const claimed = expectOk(await Repo.claimDue(newsletter.id, NOW, STUCK, 50))
    const pairs = claimed.map((row) => `${row.email}:${row.stepId}`).sort()
    expect(pairs).toEqual(
      [
        `old@example.com:${now0.id}`,
        `old@example.com:${twoDays.id}`,
        `old@example.com:${sixHours.id}`,
        `fresh@example.com:${now0.id}`,
      ].sort(),
    )
    const freshRow = claimed.find((row) => row.subscriberId === fresh.id)
    expect(freshRow).toMatchObject({
      personId: 'p1',
      subscriberStatus: 'ACTIVE',
      name: 'fresh',
    })
    expect(claimed.some((row) => row.subscriberId === old.id)).toBe(true)

    // Claimed rows are never claimed again (not stuck yet).
    expect(
      expectOk(await Repo.claimDue(newsletter.id, NOW, STUCK, 50)),
    ).toEqual([])
    // A zero limit claims nothing.
    expect(expectOk(await Repo.claimDue(newsletter.id, NOW, STUCK, 0))).toEqual(
      [],
    )
  })

  it('respects the limit and reclaims rows stuck in SENDING', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    await seedWelcomeStep(newsletter, userId)
    for (const name of ['a', 'b', 'c']) {
      await seedConfirmedSubscriber(newsletter, `${name}@example.com`)
    }
    const first = expectOk(await Repo.claimDue(newsletter.id, NOW, STUCK, 2))
    expect(first).toHaveLength(2)

    // Give one back (transient failure) → stuck → reclaimed first.
    expectOk(await Repo.release([first[0].id]))
    const second = expectOk(await Repo.claimDue(newsletter.id, NOW, STUCK, 1))
    expect(second.map((row) => row.id)).toEqual([first[0].id])
    const third = expectOk(await Repo.claimDue(newsletter.id, NOW, STUCK, 5))
    expect(third).toHaveLength(1)
    expect(third[0].email).toBe('c@example.com')
    expectOk(await Repo.release([]))
  })

  it('records sent, failed and skipped rows and the webhook marks', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    await seedWelcomeStep(newsletter, userId)
    for (const name of ['a', 'b', 'c']) {
      await seedConfirmedSubscriber(newsletter, `${name}@example.com`)
    }
    const rows = expectOk(await Repo.claimDue(newsletter.id, NOW, STUCK, 5))
    const [a, b, c] = rows

    expectOk(
      await Repo.markSent(
        [{ id: a.id, subscriberId: a.subscriberId, providerMessageId: 'm-a' }],
        NOW,
      ),
    )
    expectOk(await Repo.markSent([], NOW))
    expectOk(await Repo.markFailed([b.id], 'x'.repeat(600)))
    expectOk(await Repo.markFailed([], 'x'))
    expectOk(await Repo.markSkipped([c.id], 'OPTED_OUT'))
    expectOk(await Repo.markSkipped([], 'x'))

    const byId = async (id: string) =>
      prisma.crmNewsletterWelcomeDelivery.findUniqueOrThrow({ where: { id } })
    expect((await byId(a.id)).status).toBe('SENT')
    expect(await byId(b.id)).toMatchObject({ status: 'FAILED' })
    expect((await byId(b.id)).error).toHaveLength(500)
    expect(await byId(c.id)).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'OPTED_OUT',
    })
    const subscriber = await prisma.crmNewsletterSubscriber.findUnique({
      where: { id: a.subscriberId },
    })
    expect(subscriber?.lastSentAt).toEqual(NOW)

    const found = expectOk(await Repo.findByProviderMessageId('m-a'))
    expect(found?.id).toBe(a.id)
    expect(expectOk(await Repo.findByProviderMessageId('nope'))).toBeNull()
    expect(expectOk(await Repo.markFirst(a.id, 'openedAt', NOW))).toBe(true)
    expect(expectOk(await Repo.markFirst(a.id, 'openedAt', NOW))).toBe(false)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const spies = [
      vi.spyOn(prisma, '$queryRaw').mockImplementation(down as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(down as never),
      ...(['findMany', 'findFirst', 'count', 'update'] as const).map((method) =>
        vi
          .spyOn(prisma.crmNewsletterWelcomeStep, method)
          .mockImplementation(down as never),
      ),
      ...(['updateMany', 'findUnique'] as const).map((method) =>
        vi
          .spyOn(prisma.crmNewsletterWelcomeDelivery, method)
          .mockImplementation(down as never),
      ),
      vi
        .spyOn(prisma.crmNewsletter, 'findMany')
        .mockImplementation(down as never),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(await Repo.listSteps('n'), code)
    expectErr(await Repo.findStep('n', 's'), code)
    expectErr(await Repo.findStepsByIds(['s']), code)
    expectErr(await Repo.countSteps('n'), code)
    expectErr(
      await Repo.createStep({
        newsletterId: 'n',
        workspaceId: 'w',
        subject: 's',
        preheader: null,
        delayValue: 0,
        delayUnit: 'DAYS',
        builderDocument: {},
        createdById: 'u',
      }),
      code,
    )
    expectErr(await Repo.updateStep('s', { subject: 'x' }), code)
    expectErr(await Repo.deleteStep('n', 's'), code)
    expectErr(await Repo.reorderSteps(['s']), code)
    expectErr(await Repo.statsFor(['s']), code)
    expectErr(await Repo.listNewslettersWithSeries(), code)
    expectErr(await Repo.claimDue('n', NOW, STUCK, 1), code)
    expectErr(
      await Repo.markSent(
        [{ id: 'r', subscriberId: 's', providerMessageId: 'm' }],
        NOW,
      ),
      code,
    )
    expectErr(await Repo.markFailed(['r'], 'x'), code)
    expectErr(await Repo.markSkipped(['r'], 'x'), code)
    expectErr(await Repo.release(['r']), code)
    expectErr(await Repo.findByProviderMessageId('m'), code)
    expectErr(await Repo.markFirst('r', 'openedAt', NOW), code)
    for (const spy of spies) spy.mockRestore()
  })
})
