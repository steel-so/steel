import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppAgentReportSettings } from '@/src/__tests__/factories/whatsapp-agent-report.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { ERROR_CODES } from '@/src/errors/codes'
import { err, ok } from '@/src/lib/result'
import {
  scopeFromSnapshot,
  type WhatsAppTeamSnapshot,
} from '@/src/lib/whatsapp/conversation-scope'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/repositories/whatsapp-agent-report.repository', () => ({
  WhatsAppAgentReportRepository: {
    getSettings: vi.fn(),
    upsertSettings: vi.fn(),
    closedByAgent: vi.fn(),
    openByAgent: vi.fn(),
    statusesByAgent: vi.fn(),
  },
}))
vi.mock('@/src/services/whatsapp-conversation-scope.service', () => ({
  resolveConversationScope: vi.fn(),
}))
vi.mock('@/src/lib/admin-audit', () => ({ recordAdminAction: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { recordAdminAction } from '@/src/lib/admin-audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppAgentReportRepository } from '@/src/repositories/whatsapp-agent-report.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { resolveConversationScope } from '@/src/services/whatsapp-conversation-scope.service'
import { WhatsAppAgentReportService as Service } from '../whatsapp-agent-report.service'

const membershipRepo = vi.mocked(MembershipRepository)
const userRepo = vi.mocked(UserRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const repo = vi.mocked(WhatsAppAgentReportRepository)
const scopeOf = vi.mocked(resolveConversationScope)

const ACTOR = 'u1'
const WS = 'ws1'
// 06/11/2026 23:30 in São Paulo (already the 7th in UTC).
const NOW = new Date('2026-11-07T02:30:00.000Z')
const workspace = createFakeWorkspace({ id: WS, slug: 'fidelizza-atendimento' })
const platformAdmin = createFakeUser({
  id: 'admin1',
  isPlatformAdmin: true,
  email: 'ops@stratustelecom.com.br',
})

const TEAMS: WhatsAppTeamSnapshot[] = [
  {
    id: 't1',
    members: [
      { userId: 'leader', role: 'LEADER' },
      { userId: 'agent1', role: 'AGENT' },
      { userId: 'agent2', role: 'AGENT' },
    ],
  },
  { id: 't2', members: [{ userId: 'other', role: 'AGENT' }] },
]

function actAs(userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role, userId, workspaceId: WS })),
  )
  scopeOf.mockImplementation(async (actor, _workspace, memberRole) =>
    ok(scopeFromSnapshot(actor, memberRole, TEAMS)),
  )
}

function lastRestriction() {
  return repo.closedByAgent.mock.calls.at(-1)?.[0].restriction
}

beforeEach(() => {
  vi.clearAllMocks()
  actAs(ACTOR, 'OWNER')
  userRepo.findById.mockResolvedValue(ok(platformAdmin))
  workspaceRepo.findById.mockResolvedValue(ok(workspace))
  membershipRepo.listWithUserByWorkspace.mockResolvedValue(
    ok([
      {
        ...createFakeMembership({ userId: 'agent1', workspaceId: WS }),
        user: { id: 'agent1', name: 'Ana', email: 'ana@x.com', image: null },
      },
    ]),
  )
  repo.getSettings.mockResolvedValue(
    ok(createFakeWhatsAppAgentReportSettings()),
  )
  repo.closedByAgent.mockResolvedValue(
    ok([
      {
        agentId: 'agent1',
        closed: 2,
        success: 1,
        failure: 1,
        untabulated: 0,
        handlingSeconds: 600,
      },
    ]),
  )
  repo.openByAgent.mockResolvedValue(ok([{ agentId: 'agent1', open: 1 }]))
  repo.statusesByAgent.mockResolvedValue(
    ok([
      { agentId: 'agent1', label: 'Venda', outcome: 'SUCCESS', count: 1 },
      {
        agentId: 'agent1',
        label: 'Sem interesse',
        outcome: 'FAILURE',
        count: 1,
      },
    ]),
  )
})

describe('report', () => {
  it('builds the report of the default last 7 days (São Paulo)', async () => {
    const report = expectOk(await Service.report(ACTOR, WS, {}, NOW))
    expect(report).toMatchObject({
      fromDay: '2026-10-31',
      toDay: '2026-11-06',
      timeZone: 'America/Sao_Paulo',
      teamId: null,
      connectionId: null,
      visibility: 'ALL',
    })
    expect(report.rows).toEqual([
      expect.objectContaining({
        agentId: 'agent1',
        agentName: 'Ana',
        closed: 2,
        successRate: 50,
        avgHandlingSeconds: 300,
        open: 1,
      }),
    ])
    expect(report.totals.closed).toBe(2)
    expect(report.statuses.map((status) => status.label)).toEqual([
      'Sem interesse',
      'Venda',
    ])
    const range = repo.closedByAgent.mock.calls[0][0]
    expect(range.start.toISOString()).toBe('2026-10-31T03:00:00.000Z')
    expect(range.endExclusive.toISOString()).toBe('2026-11-07T03:00:00.000Z')
  })

  it('passes the team and connection filters down', async () => {
    const report = expectOk(
      await Service.report(
        ACTOR,
        WS,
        {
          from: '2026-11-01',
          to: '2026-11-02',
          teamId: 't1',
          connectionId: 'c1',
        },
        NOW,
      ),
    )
    expect(report.teamId).toBe('t1')
    expect(report.connectionId).toBe('c1')
    expect(repo.closedByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 't1', connectionId: 'c1' }),
    )
    expect(repo.openByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 't1', connectionId: 'c1' }),
    )
  })

  it('rejects an inverted period', async () => {
    expectErr(
      await Service.report(
        ACTOR,
        WS,
        { from: '2026-11-05', to: '2026-11-01' },
        NOW,
      ),
      'VALIDATION_ERROR',
    )
    expect(repo.closedByAgent).not.toHaveBeenCalled()
  })

  it('propagates repository failures', async () => {
    repo.closedByAgent.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.report(ACTOR, WS, {}, NOW), 'DATABASE_ERROR')
    repo.openByAgent.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.report(ACTOR, WS, {}, NOW), 'DATABASE_ERROR')
    repo.statusesByAgent.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.report(ACTOR, WS, {}, NOW), 'DATABASE_ERROR')
    membershipRepo.listWithUserByWorkspace.mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expectErr(await Service.report(ACTOR, WS, {}, NOW), 'DATABASE_ERROR')
    repo.getSettings.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.report(ACTOR, WS, {}, NOW), 'DATABASE_ERROR')
  })

  describe('feature gate', () => {
    it('answers 404 when the platform admin never enabled it', async () => {
      repo.getSettings.mockResolvedValue(ok(null))
      expectErr(
        await Service.report(ACTOR, WS, {}, NOW),
        'WHATSAPP_AGENT_REPORT_DISABLED',
      )
      expect(ERROR_CODES.WHATSAPP_AGENT_REPORT_DISABLED.status).toBe(404)
      expect(repo.closedByAgent).not.toHaveBeenCalled()
    })

    it('answers 404 when it was switched off', async () => {
      repo.getSettings.mockResolvedValue(
        ok(createFakeWhatsAppAgentReportSettings({ enabled: false })),
      )
      expectErr(
        await Service.report(ACTOR, WS, {}, NOW),
        'WHATSAPP_AGENT_REPORT_DISABLED',
      )
      expectErr(
        await Service.reportCsv(ACTOR, WS, {}, NOW),
        'WHATSAPP_AGENT_REPORT_DISABLED',
      )
    })

    it('still refuses a non-member first (no leak of the feature state)', async () => {
      repo.getSettings.mockResolvedValue(ok(null))
      membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await Service.report(ACTOR, WS, {}, NOW), 'FORBIDDEN')
    })

    it('refuses when Comunicação is off for the workspace', async () => {
      vi.mocked(
        WorkspaceModuleAccessRepository.isEnabled,
      ).mockResolvedValueOnce(ok(false))
      expectErr(await Service.report(ACTOR, WS, {}, NOW), 'MODULE_DISABLED')
    })

    it('isEnabled reflects the settings and treats errors as off', async () => {
      expect(await Service.isEnabled(WS)).toBe(true)
      repo.getSettings.mockResolvedValueOnce(ok(null))
      expect(await Service.isEnabled(WS)).toBe(false)
      repo.getSettings.mockResolvedValueOnce(err(databaseError('x')))
      expect(await Service.isEnabled(WS)).toBe(false)
    })
  })

  describe('visibility', () => {
    it('OWNER sees every agent', async () => {
      actAs('boss', 'OWNER')
      const report = expectOk(await Service.report('boss', WS, {}, NOW))
      expect(report.visibility).toBe('ALL')
      expect(lastRestriction()).toBeUndefined()
    })

    it('ADMIN sees every agent, even when they belong to a team', async () => {
      actAs('leader', 'ADMIN')
      const report = expectOk(await Service.report('leader', WS, {}, NOW))
      expect(report.visibility).toBe('ALL')
      expect(lastRestriction()).toBeUndefined()
      expect(scopeOf).not.toHaveBeenCalled()
    })

    it('a team leader sees the agents of the teams they lead, and themselves', async () => {
      actAs('leader', 'MEMBER')
      const report = expectOk(await Service.report('leader', WS, {}, NOW))
      expect(report.visibility).toBe('TEAMS')
      const restriction = lastRestriction()
      expect([...(restriction?.agentIds ?? [])].sort()).toEqual([
        'agent1',
        'agent2',
        'leader',
      ])
      expect(restriction?.unassignedTeamIds).toEqual(['t1'])
      expect(repo.openByAgent).toHaveBeenCalledWith(
        expect.objectContaining({ restriction }),
      )
      expect(repo.statusesByAgent).toHaveBeenCalledWith(
        expect.objectContaining({ restriction }),
      )
    })

    it('a plain agent sees only themselves', async () => {
      actAs('agent1', 'MEMBER')
      const report = expectOk(await Service.report('agent1', WS, {}, NOW))
      expect(report.visibility).toBe('SELF')
      expect(lastRestriction()).toEqual({
        agentIds: ['agent1'],
        unassignedTeamIds: [],
      })
    })

    it('a member of no team is also limited to themselves', async () => {
      actAs('loner', 'MEMBER')
      expectOk(await Service.report('loner', WS, {}, NOW))
      expect(lastRestriction()).toEqual({
        agentIds: ['loner'],
        unassignedTeamIds: [],
      })
    })

    it('propagates a scope failure', async () => {
      actAs('agent1', 'MEMBER')
      scopeOf.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(await Service.report('agent1', WS, {}, NOW), 'DATABASE_ERROR')
    })
  })
})

describe('reportCsv', () => {
  it('returns the spreadsheet and audits the export', async () => {
    const { csv, fileName } = expectOk(
      await Service.reportCsv(
        ACTOR,
        WS,
        { from: '2026-11-01', to: '2026-11-07' },
        NOW,
      ),
    )
    expect(fileName).toBe('relatorio-atendentes-2026-11-01-a-2026-11-07.csv')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Ana;2;2;1;1;50;0;5,0;1')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_agent_report',
        action: 'export',
        actorId: ACTOR,
      }),
    )
  })

  it('does not audit a refused export', async () => {
    repo.getSettings.mockResolvedValue(ok(null))
    expectErr(await Service.reportCsv(ACTOR, WS, {}, NOW))
    expect(auditMutation).not.toHaveBeenCalled()
  })
})

describe('admin settings', () => {
  it('reads the settings (off when never saved)', async () => {
    repo.getSettings.mockResolvedValueOnce(ok(null))
    expect(expectOk(await Service.adminGetSettings('admin1', WS))).toEqual({
      enabled: false,
      updatedAt: null,
    })
    expect(expectOk(await Service.adminGetSettings('admin1', WS)).enabled).toBe(
      true,
    )
  })

  it('turns the report on and audits it', async () => {
    repo.upsertSettings.mockResolvedValue(
      ok(createFakeWhatsAppAgentReportSettings({ enabled: true })),
    )
    const dto = expectOk(
      await Service.adminUpdateSettings('admin1', WS, { enabled: true }),
    )
    expect(dto.enabled).toBe(true)
    expect(repo.upsertSettings).toHaveBeenCalledWith(WS, {
      enabled: true,
      updatedById: 'admin1',
    })
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'whatsapp_agent_report.settings',
        targetId: WS,
        targetLabel: 'fidelizza-atendimento',
        meta: { enabled: true },
      }),
    )
  })

  it.each([
    ['not a platform admin', createFakeUser({ isPlatformAdmin: false })],
    [
      'a platform admin flag with a foreign e-mail',
      createFakeUser({ isPlatformAdmin: true, email: 'x@gmail.com' }),
    ],
  ])('refuses %s', async (_name, user) => {
    userRepo.findById.mockResolvedValue(ok(user))
    expectErr(
      await Service.adminUpdateSettings('someone', WS, { enabled: true }),
      'FORBIDDEN',
    )
    expectErr(await Service.adminGetSettings('someone', WS), 'FORBIDDEN')
    expect(repo.upsertSettings).not.toHaveBeenCalled()
    expect(recordAdminAction).not.toHaveBeenCalled()
  })

  it('refuses a workspace owner who is not a platform admin', async () => {
    userRepo.findById.mockResolvedValue(
      ok(createFakeUser({ isPlatformAdmin: false })),
    )
    actAs(ACTOR, 'OWNER')
    expectErr(
      await Service.adminUpdateSettings(ACTOR, WS, { enabled: true }),
      'FORBIDDEN',
    )
  })

  it('propagates a missing workspace and a save failure', async () => {
    workspaceRepo.findById.mockResolvedValueOnce(err(notFound('Workspace')))
    expectErr(
      await Service.adminUpdateSettings('admin1', WS, { enabled: true }),
      'RESOURCE_NOT_FOUND',
    )
    workspaceRepo.findById.mockResolvedValueOnce(err(notFound('Workspace')))
    expectErr(
      await Service.adminGetSettings('admin1', WS),
      'RESOURCE_NOT_FOUND',
    )
    repo.upsertSettings.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await Service.adminUpdateSettings('admin1', WS, { enabled: true }),
      'DATABASE_ERROR',
    )
    repo.getSettings.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.adminGetSettings('admin1', WS), 'DATABASE_ERROR')
  })
})
