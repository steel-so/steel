import type { ModuleKind } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeAiDigestSetting,
  createFakeAiInsight,
} from '@/src/__tests__/factories/ai-insight.factory'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeProfile } from '@/src/__tests__/factories/profile.factory'
import { createFakeWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/ai-insight.repository')
vi.mock('@/src/repositories/ai-digest-setting.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { AiDigestSettingRepository } from '@/src/repositories/ai-digest-setting.repository'
import { AiInsightRepository } from '@/src/repositories/ai-insight.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { AiInsightService } from '../ai-insight.service'
import {
  canReadInsightModule,
  resolveAiInsightAccess,
} from '../ai-insight-access'

const memberships = vi.mocked(MembershipRepository)
const settings = vi.mocked(WorkspaceAiSettingsRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const insights = vi.mocked(AiInsightRepository)
const digest = vi.mocked(AiDigestSettingRepository)
const audit = vi.mocked(auditMutation)

const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'down' }
const NOW = new Date('2026-10-18T12:00:00.000Z')
const QUERY = { state: 'active' as const, limit: 20 }

function enableModules(...modules: ModuleKind[]) {
  moduleAccess.listByWorkspace.mockResolvedValue(
    ok(
      (['SERVICE_DESK', 'CRM', 'COMMUNICATION'] as ModuleKind[]).map((module) =>
        createFakeWorkspaceModuleAccess({
          workspaceId: 'ws1',
          module,
          enabled: modules.includes(module),
        }),
      ),
    ),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  settings.findByWorkspace.mockResolvedValue(ok(null))
  enableModules('SERVICE_DESK', 'CRM', 'COMMUNICATION')
  insights.listForUser.mockResolvedValue(ok([]))
  insights.countsForUser.mockResolvedValue(
    ok({ active: 0, snoozed: 0, dismissed: 0 }),
  )
})

describe('resolveAiInsightAccess', () => {
  it('reads the modules that are enabled and viewable', async () => {
    enableModules('CRM', 'COMMUNICATION')
    const access = expectOk(await resolveAiInsightAccess('u1', 'ws1'))
    expect(access.enabled).toBe(true)
    expect(access.modules).toEqual(['CRM', 'COMMUNICATION'])
  })

  it('drops a module without VIEW on its resource (custom profile)', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          role: 'MEMBER',
          profile: createFakeProfile({
            permissions: { opportunities: ['VIEW'], conversations: [] },
          }),
        }),
      ),
    )
    const access = expectOk(await resolveAiInsightAccess('u1', 'ws1'))
    expect(access.modules).toEqual(['CRM'])
  })

  it('reports the proactive switch and the AI master switch', async () => {
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ proactiveEnabled: false })),
    )
    expect(expectOk(await resolveAiInsightAccess('u1', 'ws1')).enabled).toBe(
      false,
    )
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ aiEnabled: false })),
    )
    expect(expectOk(await resolveAiInsightAccess('u1', 'ws1')).enabled).toBe(
      false,
    )
  })

  it('forbids non-members and propagates database errors', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await resolveAiInsightAccess('u1', 'ws1'), 'FORBIDDEN')

    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership()),
    )
    settings.findByWorkspace.mockResolvedValue(err(DB_ERROR))
    expectErr(await resolveAiInsightAccess('u1', 'ws1'), 'DATABASE_ERROR')

    settings.findByWorkspace.mockResolvedValue(ok(null))
    moduleAccess.listByWorkspace.mockResolvedValue(err(DB_ERROR))
    expectErr(await resolveAiInsightAccess('u1', 'ws1'), 'DATABASE_ERROR')
  })

  it('lets OWNER/ADMIN read every module and denies a profile with no matrix', () => {
    expect(
      canReadInsightModule(
        { role: 'ADMIN', isPrivileged: true, permissions: null },
        'SERVICE_DESK',
      ),
    ).toBe(true)
    expect(
      canReadInsightModule(
        { role: 'MEMBER', isPrivileged: false, permissions: null },
        'CRM',
      ),
    ).toBe(false)
  })
})

describe('AiInsightService.list', () => {
  it('returns the actor own insights of the readable modules', async () => {
    const row = createFakeAiInsight({ userId: 'u1' })
    insights.listForUser.mockResolvedValue(ok([row]))
    insights.countsForUser.mockResolvedValue(
      ok({ active: 1, snoozed: 2, dismissed: 0 }),
    )

    const feed = expectOk(await AiInsightService.list('u1', 'ws1', QUERY, NOW))

    expect(feed.enabled).toBe(true)
    expect(feed.items.map((item) => item.id)).toEqual([row.id])
    expect(feed.counts).toEqual({ active: 1, snoozed: 2, dismissed: 0 })
    expect(insights.listForUser).toHaveBeenCalledWith('ws1', 'u1', {
      state: 'active',
      modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
      now: NOW,
      limit: 20,
    })
  })

  it('narrows to one module, and to nothing when that module is off', async () => {
    enableModules('SERVICE_DESK')
    expectOk(
      await AiInsightService.list('u1', 'ws1', { ...QUERY, module: 'CRM' }),
    )
    expect(insights.listForUser).toHaveBeenCalledWith(
      'ws1',
      'u1',
      expect.objectContaining({ modules: [] }),
    )
  })

  it('answers disabled (and reads nothing) with the proactive AI off', async () => {
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ proactiveEnabled: false })),
    )
    const feed = expectOk(await AiInsightService.list('u1', 'ws1', QUERY))
    expect(feed).toEqual({
      enabled: false,
      items: [],
      counts: { active: 0, snoozed: 0, dismissed: 0 },
    })
    expect(insights.listForUser).not.toHaveBeenCalled()
  })

  it('forbids non-members and propagates repository errors', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await AiInsightService.list('u1', 'ws1', QUERY), 'FORBIDDEN')

    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership()),
    )
    insights.listForUser.mockResolvedValue(err(DB_ERROR))
    expectErr(await AiInsightService.list('u1', 'ws1', QUERY), 'DATABASE_ERROR')

    insights.listForUser.mockResolvedValue(ok([]))
    insights.countsForUser.mockResolvedValue(err(DB_ERROR))
    expectErr(await AiInsightService.list('u1', 'ws1', QUERY), 'DATABASE_ERROR')
  })
})

describe('AiInsightService.act', () => {
  const row = createFakeAiInsight({ id: 'i1', userId: 'u1', module: 'CRM' })

  beforeEach(() => {
    insights.findForUser.mockResolvedValue(ok(row))
    insights.updateState.mockImplementation(async (_id, data) =>
      ok({ ...row, ...data }),
    )
  })

  it('dismisses, snoozes and restores, with an audit trail', async () => {
    const dismissed = expectOk(
      await AiInsightService.act('u1', 'ws1', 'i1', { action: 'dismiss' }, NOW),
    )
    expect(dismissed.state).toBe('dismissed')
    expect(insights.updateState).toHaveBeenLastCalledWith('i1', {
      dismissedAt: NOW,
      snoozedUntil: null,
    })

    const snoozed = expectOk(
      await AiInsightService.act(
        'u1',
        'ws1',
        'i1',
        { action: 'snooze', hours: 4 },
        NOW,
      ),
    )
    expect(snoozed.state).toBe('snoozed')
    expect(snoozed.snoozedUntil).toBe('2026-10-18T16:00:00.000Z')

    const restored = expectOk(
      await AiInsightService.act('u1', 'ws1', 'i1', { action: 'restore' }, NOW),
    )
    expect(restored.state).toBe('active')
    expect(insights.updateState).toHaveBeenLastCalledWith('i1', {
      dismissedAt: null,
      snoozedUntil: null,
    })

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_insight',
        action: 'update',
        actorId: 'u1',
        targetId: 'i1',
        meta: {
          workspaceId: 'ws1',
          action: 'snooze',
          kind: 'CRM_STALE_OPPORTUNITIES',
          hours: 4,
        },
      }),
    )
  })

  it("answers 404 for someone else's insight (the repository scopes by user)", async () => {
    insights.findForUser.mockResolvedValue(ok(null))
    expectErr(
      await AiInsightService.act('u2', 'ws1', 'i1', { action: 'dismiss' }),
      'AI_INSIGHT_NOT_FOUND',
    )
    expect(insights.findForUser).toHaveBeenCalledWith('i1', 'ws1', 'u2')
    expect(insights.updateState).not.toHaveBeenCalled()
  })

  it('answers 404 for an insight of a module the actor lost', async () => {
    enableModules('SERVICE_DESK')
    expectErr(
      await AiInsightService.act('u1', 'ws1', 'i1', { action: 'dismiss' }),
      'AI_INSIGHT_NOT_FOUND',
    )
  })

  it('forbids non-members and audits a failed write', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await AiInsightService.act('u1', 'ws1', 'i1', { action: 'dismiss' }),
      'FORBIDDEN',
    )

    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership()),
    )
    insights.findForUser.mockResolvedValue(err(DB_ERROR))
    expectErr(
      await AiInsightService.act('u1', 'ws1', 'i1', { action: 'dismiss' }),
      'DATABASE_ERROR',
    )

    insights.findForUser.mockResolvedValue(ok(row))
    insights.updateState.mockResolvedValue(err(DB_ERROR))
    expectErr(
      await AiInsightService.act('u1', 'ws1', 'i1', { action: 'dismiss' }),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'DATABASE_ERROR' }),
    )
  })
})

describe('AiInsightService digest settings', () => {
  it('reads the channels, both on without a row', async () => {
    digest.find.mockResolvedValue(ok(null))
    expect(
      expectOk(await AiInsightService.getDigestSettings('u1', 'ws1')),
    ).toEqual({ inApp: true, email: true, workspaceEnabled: true })
    expect(digest.find).toHaveBeenCalledWith('ws1', 'u1')
  })

  it('saves only the channels sent and audits the change', async () => {
    digest.upsert.mockResolvedValue(
      ok(createFakeAiDigestSetting({ id: 'd1', email: false })),
    )
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ proactiveEnabled: false })),
    )
    const saved = expectOk(
      await AiInsightService.updateDigestSettings('u1', 'ws1', {
        email: false,
      }),
    )
    expect(saved).toEqual({
      inApp: true,
      email: false,
      workspaceEnabled: false,
    })
    expect(digest.upsert).toHaveBeenCalledWith('ws1', 'u1', { email: false })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_digest_setting',
        targetId: 'd1',
        meta: { workspaceId: 'ws1', inApp: true, email: false },
      }),
    )

    digest.upsert.mockResolvedValue(ok(createFakeAiDigestSetting()))
    expectOk(
      await AiInsightService.updateDigestSettings('u1', 'ws1', { inApp: true }),
    )
    expect(digest.upsert).toHaveBeenLastCalledWith('ws1', 'u1', { inApp: true })
  })

  it('forbids non-members and propagates errors', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await AiInsightService.getDigestSettings('u1', 'ws1'),
      'FORBIDDEN',
    )
    expectErr(
      await AiInsightService.updateDigestSettings('u1', 'ws1', { email: true }),
      'FORBIDDEN',
    )

    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership()),
    )
    digest.find.mockResolvedValue(err(DB_ERROR))
    expectErr(
      await AiInsightService.getDigestSettings('u1', 'ws1'),
      'DATABASE_ERROR',
    )
    digest.find.mockResolvedValue(ok(null))
    settings.findByWorkspace.mockResolvedValue(err(DB_ERROR))
    expectErr(
      await AiInsightService.getDigestSettings('u1', 'ws1'),
      'DATABASE_ERROR',
    )

    digest.upsert.mockResolvedValue(err(DB_ERROR))
    expectErr(
      await AiInsightService.updateDigestSettings('u1', 'ws1', { email: true }),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )

    digest.upsert.mockResolvedValue(ok(createFakeAiDigestSetting()))
    expectErr(
      await AiInsightService.updateDigestSettings('u1', 'ws1', { email: true }),
      'DATABASE_ERROR',
    )
  })
})
