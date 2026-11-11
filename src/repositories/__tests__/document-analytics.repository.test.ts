import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedDocument,
  seedRecipient,
  seedSectionStat,
  seedSession,
} from '@/src/__tests__/factories/document-analytics.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  DocumentAnalyticsRepository,
  type DocumentAnalyticsScope,
} from '../document-analytics.repository'

const TZ = 'America/Sao_Paulo'

/**
 * Doc with 3 sessions: Maria (personal link) twice on 10/11 and 11/11, and
 * an anonymous visitor at 01:00Z on 11/11, which is still 10/11 in São
 * Paulo. A second document's session must never leak in.
 */
async function fixture() {
  const { document, workspaceId } = await seedDocument()
  const other = await seedDocument({ workspaceId })
  const maria = await seedRecipient(document.id, workspaceId)
  const base = { documentId: document.id, workspaceId }

  const s1 = await seedSession({
    ...base,
    recipientId: maria.id,
    visitorId: 'v-maria',
    device: 'desktop',
    startedAt: new Date('2026-11-10T13:00:00Z'),
    activeMs: 60_000,
    maxScrollPct: 100,
    reachedEnd: true,
  })
  const s2 = await seedSession({
    ...base,
    recipientId: maria.id,
    visitorId: 'v-maria',
    device: 'mobile',
    startedAt: new Date('2026-11-11T14:00:00Z'),
    lastSeenAt: new Date('2026-11-11T14:05:00Z'),
    activeMs: 30_000,
    maxScrollPct: 50,
  })
  const s3 = await seedSession({
    ...base,
    visitorId: 'v-anon',
    device: null,
    startedAt: new Date('2026-11-11T01:00:00Z'),
    activeMs: 0,
    maxScrollPct: 0,
  })
  await seedSession({
    documentId: other.document.id,
    workspaceId,
    activeMs: 999_000,
  })

  const stat = (sessionId: string, sectionId: string, activeMs: number) =>
    seedSectionStat({
      documentId: document.id,
      sessionId,
      sectionId,
      activeMs,
    })
  await stat(s1.id, 'a', 40_000)
  await stat(s1.id, 'b', 20_000)
  await stat(s2.id, 'a', 30_000)
  await stat(s3.id, 'a', 0)

  await prisma.documentEvent.createMany({
    data: [
      {
        documentId: document.id,
        workspaceId,
        type: 'FORWARDED',
        createdAt: new Date('2026-11-01T12:00:00Z'),
      },
      {
        documentId: document.id,
        workspaceId,
        type: 'FORWARDED',
        createdAt: new Date('2026-11-11T12:00:00Z'),
      },
      { documentId: document.id, workspaceId, type: 'OPENED' },
    ],
  })

  const all: DocumentAnalyticsScope = {
    documentIds: [document.id],
    since: null,
  }
  const today: DocumentAnalyticsScope = {
    documentIds: [document.id],
    since: new Date('2026-11-11T03:00:00Z'),
  }
  return { document, workspaceId, maria, all, today }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DocumentAnalyticsRepository', () => {
  it('sums sessions, visitors, time, scroll and completion', async () => {
    const { all, today } = await fixture()
    expect(expectOk(await DocumentAnalyticsRepository.totals(all))).toEqual({
      sessions: 3,
      uniqueVisitors: 2,
      totalActiveMs: 90_000,
      avgScrollPct: 50,
      reachedEnd: 1,
    })
    expect(expectOk(await DocumentAnalyticsRepository.totals(today))).toEqual({
      sessions: 1,
      uniqueVisitors: 1,
      totalActiveMs: 30_000,
      avgScrollPct: 50,
      reachedEnd: 0,
    })
  })

  it('answers zeros when nothing was read', async () => {
    const { document } = await seedDocument()
    const scope = { documentIds: [document.id], since: null }
    expect(expectOk(await DocumentAnalyticsRepository.totals(scope))).toEqual({
      sessions: 0,
      uniqueVisitors: 0,
      totalActiveMs: 0,
      avgScrollPct: 0,
      reachedEnd: 0,
    })
    expect(expectOk(await DocumentAnalyticsRepository.forwards(scope))).toBe(0)
  })

  it('counts forwards in the period', async () => {
    const { all, today } = await fixture()
    expect(expectOk(await DocumentAnalyticsRepository.forwards(all))).toBe(2)
    expect(expectOk(await DocumentAnalyticsRepository.forwards(today))).toBe(1)
  })

  it('sums time and readers per section', async () => {
    const { all } = await fixture()
    const rows = expectOk(await DocumentAnalyticsRepository.sections(all))
    const sorted = rows.sort((x, y) => x.sectionId.localeCompare(y.sectionId))
    expect(sorted).toEqual([
      { sectionId: 'a', totalActiveMs: 70_000, readers: 3 },
      { sectionId: 'b', totalActiveMs: 20_000, readers: 1 },
    ])
  })

  it('groups sessions by device', async () => {
    const { all } = await fixture()
    const rows = expectOk(await DocumentAnalyticsRepository.devices(all))
    expect(rows).toEqual(
      expect.arrayContaining([
        { device: 'desktop', sessions: 1 },
        { device: 'mobile', sessions: 1 },
        { device: null, sessions: 1 },
      ]),
    )
    expect(rows).toHaveLength(3)
  })

  it('lists readers by visitor and recipient, most recent first', async () => {
    const { all, maria } = await fixture()
    const rows = expectOk(await DocumentAnalyticsRepository.readers(all))
    expect(rows).toEqual([
      {
        recipientId: maria.id,
        name: 'Maria Souza',
        visitorId: 'v-maria',
        sessions: 2,
        activeMs: 90_000,
        device: 'mobile',
        lastSeenAt: new Date('2026-11-11T14:05:00Z'),
      },
      {
        recipientId: null,
        name: null,
        visitorId: 'v-anon',
        sessions: 1,
        activeMs: 0,
        device: null,
        lastSeenAt: new Date('2026-11-11T01:00:00Z'),
      },
    ])
    expect(
      expectOk(await DocumentAnalyticsRepository.readers(all, 1)),
    ).toHaveLength(1)
  })

  it('counts sessions per local day', async () => {
    const { all } = await fixture()
    expect(expectOk(await DocumentAnalyticsRepository.daily(all, TZ))).toEqual([
      { date: '2026-11-10', sessions: 2, activeMs: 60_000 },
      { date: '2026-11-11', sessions: 1, activeMs: 30_000 },
    ])
  })

  it('finds the target in its workspace with the current version', async () => {
    const { document, workspaceId } = await seedDocument()
    const target = expectOk(
      await DocumentAnalyticsRepository.findTarget(workspaceId, document.id),
    )
    expect(target).toMatchObject({ id: document.id, isTemplate: false })
    expect(target?.currentVersionContent).toEqual(document.content)

    const find = async (documentId: string) =>
      expectOk(
        await DocumentAnalyticsRepository.findTarget(workspaceId, documentId),
      )

    const draft = await seedDocument({ workspaceId, sent: false })
    expect((await find(draft.document.id))?.currentVersionContent).toBeNull()
    const other = await seedDocument()
    expect(await find(other.document.id)).toBeNull()
    const deleted = await seedDocument({ workspaceId, deletedAt: new Date() })
    expect(await find(deleted.document.id)).toBeNull()
  })

  it('lists the live documents created from a template', async () => {
    const template = await seedDocument({ isTemplate: true })
    const { workspaceId } = template
    const a = await seedDocument({
      workspaceId,
      templateId: template.document.id,
    })
    await seedDocument({
      workspaceId,
      templateId: template.document.id,
      deletedAt: new Date(),
    })
    await seedDocument({ workspaceId })

    expect(
      expectOk(
        await DocumentAnalyticsRepository.documentIdsFromTemplate(
          workspaceId,
          template.document.id,
        ),
      ),
    ).toEqual([a.document.id])
  })

  it('returns DATABASE_ERROR when a query fails', async () => {
    const scope = { documentIds: ['d'], since: null }
    const raw = vi
      .spyOn(prisma, '$queryRaw')
      .mockImplementation((() => Promise.reject(new Error('boom'))) as never)
    for (const result of [
      await DocumentAnalyticsRepository.totals(scope),
      await DocumentAnalyticsRepository.sections(scope),
      await DocumentAnalyticsRepository.devices(scope),
      await DocumentAnalyticsRepository.readers(scope),
      await DocumentAnalyticsRepository.daily(scope, TZ),
    ]) {
      expectErr(result, 'DATABASE_ERROR')
    }
    raw.mockRestore()

    vi.spyOn(prisma.documentEvent, 'count').mockRejectedValue(new Error('x'))
    expectErr(
      await DocumentAnalyticsRepository.forwards(scope),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.document, 'findFirst').mockRejectedValue(new Error('x'))
    expectErr(
      await DocumentAnalyticsRepository.findTarget('w', 'd'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.document, 'findMany').mockRejectedValue(new Error('x'))
    expectErr(
      await DocumentAnalyticsRepository.documentIdsFromTemplate('w', 't'),
      'DATABASE_ERROR',
    )
  })
})
