import { describe, expect, it, vi } from 'vitest'
import { seedQaReview } from '@/src/__tests__/factories/nov-t2-qa.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { QaReviewRepository as Repo } from '../qa-review.repository'

const criterion = (key: string, overrides: object = {}) => ({
  key,
  name: key.toUpperCase(),
  description: `Descrição de ${key}`,
  weight: 1,
  appliesTo: 'BOTH' as const,
  active: true,
  ...overrides,
})

describe('QaReviewRepository config', () => {
  it('upserts one rule per workspace', async () => {
    const ws = await seedWorkspace()
    expect(expectOk(await Repo.findConfig(ws.id))).toBeNull()
    const first = expectOk(await Repo.upsertConfig(ws.id, { enabled: true }))
    const second = expectOk(
      await Repo.upsertConfig(ws.id, { lowScoreThreshold: 75 }),
    )
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ enabled: true, lowScoreThreshold: 75 })
    expect(expectOk(await Repo.findConfig(ws.id))?.id).toBe(first.id)
  })

  it('maps failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.qaReviewConfig, 'findUnique').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.findConfig('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.qaReviewConfig, 'upsert').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.upsertConfig('ws', {}), 'DATABASE_ERROR')
  })
})

describe('QaReviewRepository criteria', () => {
  it('replaces the whole set, keeping the given order', async () => {
    const ws = await seedWorkspace()
    expect(expectOk(await Repo.listCriteria(ws.id))).toEqual([])

    expectOk(
      await Repo.replaceCriteria(ws.id, [criterion('a'), criterion('b')]),
    )
    const replaced = expectOk(
      await Repo.replaceCriteria(ws.id, [
        criterion('c'),
        criterion('a', { weight: 5, name: 'Novo A' }),
      ]),
    )
    expect(replaced.map((c) => c.key)).toEqual(['c', 'a'])
    expect(replaced[1]).toMatchObject({ weight: 5, name: 'Novo A', position: 1 })
  })

  it('does not touch another workspace', async () => {
    const [one, two] = [await seedWorkspace(), await seedWorkspace()]
    expectOk(await Repo.replaceCriteria(one.id, [criterion('a')]))
    expectOk(await Repo.replaceCriteria(two.id, [criterion('z')]))
    expect(expectOk(await Repo.listCriteria(one.id)).map((c) => c.key)).toEqual([
      'a',
    ])
  })

  it('maps failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.qaCriterion, 'findMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.listCriteria('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.replaceCriteria('ws', [criterion('a')]), 'DATABASE_ERROR')
  })
})

describe('QaReviewRepository reviews', () => {
  it('creates a PENDING review per subject and resets it on a re-run', async () => {
    const ws = await seedWorkspace()
    const first = expectOk(
      await Repo.upsertPending({
        workspaceId: ws.id,
        subjectType: 'CONVERSATION',
        conversationId: 'conv-1',
      }),
    )
    expect(first.status).toBe('PENDING')

    await Repo.update(first.id, { status: 'COMPLETED', score: 80 })
    const again = expectOk(
      await Repo.upsertPending({
        workspaceId: ws.id,
        subjectType: 'CONVERSATION',
        conversationId: 'conv-1',
      }),
    )
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ status: 'PENDING', score: null })

    const ticket = expectOk(
      await Repo.upsertPending({
        workspaceId: ws.id,
        subjectType: 'TICKET',
        ticketId: 't-1',
        subjectLabel: '#1 Erro',
      }),
    )
    expect(ticket).toMatchObject({ ticketId: 't-1', subjectLabel: '#1 Erro' })
    const sameTicket = expectOk(
      await Repo.upsertPending({
        workspaceId: ws.id,
        subjectType: 'TICKET',
        ticketId: 't-1',
      }),
    )
    expect(sameTicket.id).toBe(ticket.id)
  })

  it('rejects a review without a subject id', async () => {
    const ws = await seedWorkspace()
    expectErr(
      await Repo.upsertPending({ workspaceId: ws.id, subjectType: 'TICKET' }),
      'DATABASE_ERROR',
    )
  })

  it('finds by id, scoped to the workspace', async () => {
    const [one, two] = [await seedWorkspace(), await seedWorkspace()]
    const review = await seedQaReview(one.id)
    expect(expectOk(await Repo.findById(review.id))?.id).toBe(review.id)
    expect(expectOk(await Repo.findInWorkspace(one.id, review.id))?.id).toBe(
      review.id,
    )
    expect(expectOk(await Repo.findInWorkspace(two.id, review.id))).toBeNull()
  })

  it('lists newest first with filters and a cursor', async () => {
    const ws = await seedWorkspace()
    const day = 86_400_000
    const base = Date.now() - 10 * day
    const a = await seedQaReview(ws.id, {
      agentUserId: 'u1',
      score: 40,
      lowScore: true,
      reviewedAt: new Date(base),
    })
    const b = await seedQaReview(ws.id, {
      agentUserId: 'u2',
      handlerKind: 'BOT',
      subjectType: 'TICKET',
      conversationId: null,
      ticketId: 'tt-1',
      reviewedAt: new Date(base + 5 * day),
    })
    const c = await seedQaReview(ws.id, {
      status: 'SKIPPED',
      score: null,
      reviewedAt: new Date(base + 8 * day),
    })

    const all = expectOk(await Repo.list(ws.id, {}, { limit: 2 }))
    expect(all.items).toHaveLength(2)
    expect(all.nextCursor).toBe(all.items[1].id)
    const next = expectOk(
      await Repo.list(ws.id, {}, { limit: 2, cursor: all.nextCursor as string }),
    )
    expect(next.items).toHaveLength(1)
    expect(next.nextCursor).toBeNull()
    expect(
      [...all.items, ...next.items].map((r) => r.id).sort(),
    ).toEqual([a.id, b.id, c.id].sort())

    const ids = async (filters: Parameters<typeof Repo.list>[1]) =>
      expectOk(await Repo.list(ws.id, filters, { limit: 10 })).items.map(
        (r) => r.id,
      )
    expect(await ids({ lowOnly: true })).toEqual([a.id])
    expect(await ids({ agentUserId: 'u2' })).toEqual([b.id])
    expect(await ids({ subjectType: 'TICKET' })).toEqual([b.id])
    expect(await ids({ handlerKind: 'BOT' })).toEqual([b.id])
    expect(await ids({ status: 'SKIPPED' })).toEqual([c.id])
    expect(
      await ids({
        from: new Date(base + 4 * day),
        to: new Date(base + 6 * day),
      }),
    ).toEqual([b.id])
    expect(await ids({ from: new Date(base + 7 * day) })).toEqual([c.id])
    expect(await ids({ to: new Date(base + day) })).toEqual([a.id])
  })

  it('reads only completed reviews of the period, optionally by agent', async () => {
    const ws = await seedWorkspace()
    const inside = new Date('2026-11-03T12:00:00.000Z')
    const hit = await seedQaReview(ws.id, { agentUserId: 'u1', reviewedAt: inside })
    await seedQaReview(ws.id, { agentUserId: 'u2', reviewedAt: inside })
    await seedQaReview(ws.id, { status: 'FAILED', reviewedAt: inside })
    await seedQaReview(ws.id, {
      reviewedAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    const range = {
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-11-30T00:00:00.000Z'),
    }
    expect(expectOk(await Repo.listCompleted(ws.id, range))).toHaveLength(2)
    expect(
      expectOk(await Repo.listCompleted(ws.id, range, 'u1')).map((r) => r.id),
    ).toEqual([hit.id])
  })

  it('maps failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.qaReview, 'upsert').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await Repo.upsertPending({
        workspaceId: 'ws',
        subjectType: 'CONVERSATION',
        conversationId: 'c',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.qaReview, 'findUnique').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.findById('x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.qaReview, 'findFirst').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.findInWorkspace('ws', 'x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.qaReview, 'update').mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.update('x', {}), 'DATABASE_ERROR')
    vi.spyOn(prisma.qaReview, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.list('ws', {}, { limit: 5 }), 'DATABASE_ERROR')
    vi.spyOn(prisma.qaReview, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await Repo.listCompleted('ws', { from: new Date(), to: new Date() }),
      'DATABASE_ERROR',
    )
  })
})
