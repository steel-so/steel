import { describe, expect, it, vi } from 'vitest'
import {
  createFakeAiInsightDraft,
  seedAiInsight,
} from '@/src/__tests__/factories/ai-insight.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { planInsightReconcile } from '@/src/lib/ai/proactive/reconcile'
import { prisma } from '@/src/lib/prisma'
import {
  AiInsightRepository,
  insightStateWhere,
} from '../ai-insight.repository'

const NOW = new Date('2026-10-18T12:00:00.000Z')
const HOUR = 3_600_000
const ALL = ['SERVICE_DESK', 'CRM', 'COMMUNICATION'] as const

async function setup() {
  const [workspace, user, other] = await Promise.all([
    seedWorkspace(),
    seedUser(),
    seedUser(),
  ])
  return { workspace, user, other }
}

describe('AiInsightRepository — feed', () => {
  it('lists one state, most severe and most recent first, only the user own', async () => {
    const { workspace, user, other } = await setup()
    const info = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'a',
      severity: 'INFO',
      lastSeenAt: NOW,
    })
    const critical = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'b',
      severity: 'CRITICAL',
      module: 'SERVICE_DESK',
      kind: 'SD_SLA_BREACH_FORECAST',
      lastSeenAt: new Date(NOW.getTime() - HOUR),
    })
    const warning = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'c',
      severity: 'WARNING',
      snoozedUntil: new Date(NOW.getTime() - HOUR),
    })
    const snoozed = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'd',
      snoozedUntil: new Date(NOW.getTime() + HOUR),
    })
    const dismissed = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'e',
      dismissedAt: NOW,
    })
    await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'f',
      status: 'RESOLVED',
      resolvedAt: NOW,
    })
    await seedAiInsight(workspace.id, other.id, { dedupeKey: 'a' })

    const active = expectOk(
      await AiInsightRepository.listForUser(workspace.id, user.id, {
        state: 'active',
        modules: [...ALL],
        now: NOW,
        limit: 10,
      }),
    )
    expect(active.map((row) => row.id)).toEqual([
      critical.id,
      warning.id,
      info.id,
    ])

    const crmOnly = expectOk(
      await AiInsightRepository.listForUser(workspace.id, user.id, {
        state: 'active',
        modules: ['CRM'],
        now: NOW,
        limit: 1,
      }),
    )
    expect(crmOnly.map((row) => row.id)).toEqual([warning.id])

    expect(
      expectOk(
        await AiInsightRepository.listForUser(workspace.id, user.id, {
          state: 'snoozed',
          modules: [...ALL],
          now: NOW,
          limit: 10,
        }),
      ).map((row) => row.id),
    ).toEqual([snoozed.id])
    expect(
      expectOk(
        await AiInsightRepository.listForUser(workspace.id, user.id, {
          state: 'dismissed',
          modules: [...ALL],
          now: NOW,
          limit: 10,
        }),
      ).map((row) => row.id),
    ).toEqual([dismissed.id])

    expect(
      expectOk(
        await AiInsightRepository.countsForUser(
          workspace.id,
          user.id,
          [...ALL],
          NOW,
        ),
      ),
    ).toEqual({ active: 3, snoozed: 1, dismissed: 1 })
  })

  it('reads nothing without modules', async () => {
    const { workspace, user } = await setup()
    await seedAiInsight(workspace.id, user.id)
    expect(
      expectOk(
        await AiInsightRepository.listForUser(workspace.id, user.id, {
          state: 'active',
          modules: [],
          now: NOW,
          limit: 10,
        }),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await AiInsightRepository.countsForUser(workspace.id, user.id, [], NOW),
      ),
    ).toEqual({ active: 0, snoozed: 0, dismissed: 0 })
  })

  it('finds and updates only the user own insight', async () => {
    const { workspace, user, other } = await setup()
    const row = await seedAiInsight(workspace.id, user.id)

    expect(
      expectOk(
        await AiInsightRepository.findForUser(row.id, workspace.id, other.id),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await AiInsightRepository.findForUser(row.id, workspace.id, user.id),
      )?.id,
    ).toBe(row.id)

    const updated = expectOk(
      await AiInsightRepository.updateState(row.id, {
        dismissedAt: NOW,
        snoozedUntil: null,
      }),
    )
    expect(updated.dismissedAt).toEqual(NOW)
  })

  it('matches the state filter of the mapper', () => {
    expect(insightStateWhere('dismissed', NOW)).toEqual({
      status: 'ACTIVE',
      dismissedAt: { not: null },
    })
  })
})

describe('AiInsightRepository — reconcile', () => {
  it('applies a plan: create, refresh, reopen and resolve', async () => {
    const { workspace, user } = await setup()
    const active = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'crm-stale:owner:x',
      title: 'velho',
      snoozedUntil: new Date(NOW.getTime() + HOUR),
    })
    const resolved = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'crm-stage:s1',
      status: 'RESOLVED',
      resolvedAt: NOW,
      dismissedAt: NOW,
    })
    const gone = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'crm-forecast:2026-09',
    })

    const existing = expectOk(
      await AiInsightRepository.listForReconcile(workspace.id),
    )
    expect(existing).toHaveLength(3)

    const plan = planInsightReconcile(
      existing,
      [
        createFakeAiInsightDraft({
          userId: user.id,
          dedupeKey: 'crm-stale:owner:x',
          title: 'novo',
          severity: 'WARNING',
        }),
        createFakeAiInsightDraft({
          userId: user.id,
          dedupeKey: 'crm-stage:s1',
          kind: 'CRM_STALLED_STAGE',
        }),
        createFakeAiInsightDraft({
          userId: user.id,
          dedupeKey: 'crm-stale:all',
        }),
      ],
      ['CRM'],
    )
    const later = new Date(NOW.getTime() + HOUR)
    expect(
      expectOk(await AiInsightRepository.applyPlan(workspace.id, plan, later)),
    ).toEqual({ created: 1, refreshed: 1, reopened: 1, resolved: 1 })

    const rows = await prisma.aiInsight.findMany({
      where: { workspaceId: workspace.id },
    })
    const byKey = new Map(rows.map((row) => [row.dedupeKey, row]))
    expect(byKey.get('crm-stale:owner:x')).toMatchObject({
      id: active.id,
      title: 'novo',
      severity: 'WARNING',
      lastSeenAt: later,
      // The user's snooze survives a refresh.
      snoozedUntil: new Date(NOW.getTime() + HOUR),
    })
    expect(byKey.get('crm-stage:s1')).toMatchObject({
      id: resolved.id,
      status: 'ACTIVE',
      kind: 'CRM_STALLED_STAGE',
      firstSeenAt: later,
      dismissedAt: null,
      resolvedAt: null,
    })
    expect(byKey.get('crm-forecast:2026-09')).toMatchObject({
      id: gone.id,
      status: 'RESOLVED',
      resolvedAt: later,
    })
    expect(byKey.get('crm-stale:all')).toMatchObject({
      status: 'ACTIVE',
      firstSeenAt: later,
      facts: [
        { label: 'Oportunidades', value: '2' },
        { label: 'Mais parada', value: '12 dias' },
      ],
    })
  })

  it('applies an empty plan', async () => {
    const { workspace } = await setup()
    expect(
      expectOk(
        await AiInsightRepository.applyPlan(
          workspace.id,
          { create: [], refresh: [], reopen: [], resolveIds: [] },
          NOW,
        ),
      ),
    ).toEqual({ created: 0, refreshed: 0, reopened: 0, resolved: 0 })
  })

  it('resolves a whole workspace and prunes old resolved episodes', async () => {
    const { workspace, user } = await setup()
    await seedAiInsight(workspace.id, user.id, { dedupeKey: 'a' })
    await seedAiInsight(workspace.id, user.id, { dedupeKey: 'b' })
    const old = await seedAiInsight(workspace.id, user.id, {
      dedupeKey: 'c',
      status: 'RESOLVED',
      resolvedAt: new Date(NOW.getTime() - 40 * 24 * HOUR),
    })

    expect(
      expectOk(await AiInsightRepository.resolveAllActive(workspace.id, NOW)),
    ).toBe(2)
    expect(
      expectOk(
        await AiInsightRepository.deleteResolvedBefore(
          new Date(NOW.getTime() - 30 * 24 * HOUR),
        ),
      ),
    ).toBe(1)
    expect(
      await prisma.aiInsight.findUnique({ where: { id: old.id } }),
    ).toBeNull()
    expect(await prisma.aiInsight.count()).toBe(2)
  })

  it('cascades on user deletion (LGPD)', async () => {
    const { workspace, user } = await setup()
    await seedAiInsight(workspace.id, user.id)
    await prisma.user.delete({ where: { id: user.id } })
    expect(await prisma.aiInsight.count()).toBe(0)
  })
})

describe('AiInsightRepository — database errors', () => {
  it('returns DATABASE_ERROR instead of throwing', async () => {
    const boom = new Error('db down')
    vi.spyOn(prisma.aiInsight, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.aiInsight, 'count').mockRejectedValue(boom)
    vi.spyOn(prisma.aiInsight, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.aiInsight, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.aiInsight, 'updateMany').mockRejectedValue(boom)
    vi.spyOn(prisma.aiInsight, 'deleteMany').mockRejectedValue(boom)
    vi.spyOn(prisma, '$transaction').mockRejectedValue(boom)

    const filter = {
      state: 'active' as const,
      modules: [...ALL],
      now: NOW,
      limit: 1,
    }
    expectErr(
      await AiInsightRepository.listForUser('ws', 'u', filter),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiInsightRepository.countsForUser('ws', 'u', [...ALL], NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiInsightRepository.findForUser('i', 'ws', 'u'),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiInsightRepository.updateState('i', {
        dismissedAt: null,
        snoozedUntil: null,
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiInsightRepository.listForReconcile('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiInsightRepository.applyPlan(
        'ws',
        { create: [], refresh: [], reopen: [], resolveIds: [] },
        NOW,
      ),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiInsightRepository.resolveAllActive('ws', NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiInsightRepository.deleteResolvedBefore(NOW),
      'DATABASE_ERROR',
    )
    vi.restoreAllMocks()
  })
})
