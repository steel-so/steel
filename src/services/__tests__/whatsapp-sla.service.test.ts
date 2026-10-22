import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import {
  createFakeWhatsAppSlaCycle,
  createFakeWhatsAppSlaPolicy,
} from '@/src/__tests__/factories/whatsapp-sla.factory'
import { createFakeWhatsAppTeam } from '@/src/__tests__/factories/whatsapp-team.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-sla-policy.repository')
vi.mock(
  '@/src/repositories/whatsapp-sla-cycle.repository',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/src/repositories/whatsapp-sla-cycle.repository')
    >()),
    WhatsAppSlaCycleRepository: {
      findOpenByConversation: vi.fn(),
      create: vi.fn(),
      recordFirstResponse: vi.fn(),
      resolveOpen: vi.fn(),
      listOpenByWorkspace: vi.fn(),
      listForReport: vi.fn(),
    },
  }),
)
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')

import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppSlaCycleRepository } from '@/src/repositories/whatsapp-sla-cycle.repository'
import { WhatsAppSlaPolicyRepository } from '@/src/repositories/whatsapp-sla-policy.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import {
  resolveSlaReportPeriod,
  slaReportToCsv,
  WhatsAppSlaService,
} from '../whatsapp-sla.service'

const membershipRepo = vi.mocked(MembershipRepository)
const policyRepo = vi.mocked(WhatsAppSlaPolicyRepository)
const cycleRepo = vi.mocked(WhatsAppSlaCycleRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const settingsRepo = vi.mocked(WhatsAppSettingsRepository)
const teamRepo = vi.mocked(WhatsAppTeamRepository)

// Wed 2026-10-21 10:00 America/Sao_Paulo
const now = new Date('2026-10-21T13:00:00Z')
const conversation = {
  id: 'conv1',
  workspaceId: 'ws1',
  teamId: null,
  assignedUserId: 'u9',
}

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER') {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function businessHours(enabled: boolean, days = [1, 2, 3, 4, 5]) {
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppSettings({
        workspaceId: 'ws1',
        businessHoursEnabled: enabled,
        businessHoursDays: days,
      }),
    ),
  )
}

beforeEach(() => {
  asRole('OWNER')
  businessHours(false)
  cycleRepo.findOpenByConversation.mockResolvedValue(ok(null))
  cycleRepo.create.mockImplementation(async (data) =>
    ok(createFakeWhatsAppSlaCycle(data as never)),
  )
  cycleRepo.recordFirstResponse.mockResolvedValue(ok(true))
  cycleRepo.resolveOpen.mockResolvedValue(ok(1))
  cycleRepo.listOpenByWorkspace.mockResolvedValue(ok([]))
  cycleRepo.listForReport.mockResolvedValue(ok([]))
  policyRepo.resolveForTeam.mockResolvedValue(
    ok(createFakeWhatsAppSlaPolicy({ id: 'p1', workspaceId: 'ws1' })),
  )
  conversationRepo.update.mockResolvedValue(ok({} as never))
  membershipRepo.listWithUserByWorkspace.mockResolvedValue(ok([]))
  teamRepo.listByWorkspace.mockResolvedValue(ok([]))
  teamRepo.listMembershipSnapshot.mockResolvedValue(ok([]))
})

describe('WhatsAppSlaService.onInbound()', () => {
  it('should open a cycle with deadlines from the policy and stamp the conversation', async () => {
    await WhatsAppSlaService.onInbound(conversation, now)

    expect(policyRepo.resolveForTeam).toHaveBeenCalledWith('ws1', null)
    expect(cycleRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        conversationId: 'conv1',
        policyId: 'p1',
        agentUserId: 'u9',
        businessHoursOnly: false,
        firstResponseMinutes: 15,
        resolutionMinutes: 240,
        startedAt: now,
        firstResponseDueAt: new Date('2026-10-21T13:15:00Z'),
        firstResponseWarnAt: new Date('2026-10-21T13:12:00Z'),
        resolutionDueAt: new Date('2026-10-21T17:00:00Z'),
      }),
    )
    expect(conversationRepo.update).toHaveBeenCalledWith('conv1', {
      firstInboundAt: now,
      firstResponseAt: null,
    })
  })

  it('should resolve the policy of the conversation team', async () => {
    await WhatsAppSlaService.onInbound({ ...conversation, teamId: 't1' }, now)
    expect(policyRepo.resolveForTeam).toHaveBeenCalledWith('ws1', 't1')
    expect(cycleRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 't1' }),
    )
  })

  it('should only count business hours when the workspace has them on', async () => {
    policyRepo.resolveForTeam.mockResolvedValue(
      ok(
        createFakeWhatsAppSlaPolicy({
          businessHoursOnly: true,
          firstResponseMinutes: 60,
          resolutionMinutes: null,
        }),
      ),
    )
    // Fri 17:30 local; window closes 18:00 -> due Mon 08:30
    await WhatsAppSlaService.onInbound(
      conversation,
      new Date('2026-10-23T20:30:00Z'),
    )
    expect(cycleRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ businessHoursOnly: false }),
    )

    businessHours(true)
    cycleRepo.create.mockClear()
    await WhatsAppSlaService.onInbound(
      conversation,
      new Date('2026-10-23T20:30:00Z'),
    )
    expect(cycleRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessHoursOnly: true,
        firstResponseDueAt: new Date('2026-10-26T11:30:00Z'),
        resolutionDueAt: null,
      }),
    )
  })

  it('should do nothing when a cycle is already open', async () => {
    cycleRepo.findOpenByConversation.mockResolvedValue(
      ok(createFakeWhatsAppSlaCycle()),
    )
    await WhatsAppSlaService.onInbound(conversation, now)
    expect(policyRepo.resolveForTeam).not.toHaveBeenCalled()
    expect(cycleRepo.create).not.toHaveBeenCalled()
  })

  it.each([
    ['no policy', ok(null)],
    ['a disabled policy', ok(createFakeWhatsAppSlaPolicy({ enabled: false }))],
  ])('should track nothing with %s', async (_label, resolved) => {
    policyRepo.resolveForTeam.mockResolvedValue(resolved as never)
    await WhatsAppSlaService.onInbound(conversation, now)
    expect(cycleRepo.create).not.toHaveBeenCalled()
    expect(conversationRepo.update).not.toHaveBeenCalled()
  })

  it('should skip a policy that can never be met (hours never open)', async () => {
    policyRepo.resolveForTeam.mockResolvedValue(
      ok(createFakeWhatsAppSlaPolicy({ businessHoursOnly: true })),
    )
    businessHours(true, [])
    await WhatsAppSlaService.onInbound(conversation, now)
    expect(cycleRepo.create).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.sla.never_opens',
      expect.anything(),
    )
  })

  it('should not stamp the conversation when another writer opened the cycle first', async () => {
    cycleRepo.create.mockResolvedValue(ok(null))
    await WhatsAppSlaService.onInbound(conversation, now)
    expect(conversationRepo.update).not.toHaveBeenCalled()
  })

  it.each([
    [
      'open lookup',
      () =>
        cycleRepo.findOpenByConversation.mockResolvedValue(
          err(databaseError('x')),
        ),
    ],
    [
      'policy lookup',
      () =>
        policyRepo.resolveForTeam.mockResolvedValue(err(databaseError('x'))),
    ],
    [
      'settings',
      () =>
        settingsRepo.findByWorkspace.mockResolvedValue(err(databaseError('x'))),
    ],
    [
      'create',
      () => cycleRepo.create.mockResolvedValue(err(databaseError('x'))),
    ],
    [
      'conversation update',
      () => conversationRepo.update.mockResolvedValue(err(databaseError('x'))),
    ],
  ])('should log and swallow a failure on %s', async (_label, fail) => {
    fail()
    await expect(
      WhatsAppSlaService.onInbound(conversation, now),
    ).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.sla.bookkeeping_failed',
      expect.objectContaining({
        operation: 'inbound',
        reason: 'DATABASE_ERROR',
      }),
    )
  })

  it('should swallow a thrown error', async () => {
    cycleRepo.findOpenByConversation.mockRejectedValue(new Error('boom'))
    await expect(
      WhatsAppSlaService.onInbound(conversation, now),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.sla.bookkeeping_threw',
      expect.objectContaining({ error: 'boom' }),
    )
  })

  it('should swallow a non-Error throw', async () => {
    cycleRepo.findOpenByConversation.mockRejectedValue('weird')
    await WhatsAppSlaService.onInbound(conversation, now)
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.sla.bookkeeping_threw',
      expect.objectContaining({ error: 'weird' }),
    )
  })
})

describe('WhatsAppSlaService.onOutbound()', () => {
  const startedAt = new Date('2026-10-21T13:00:00Z')
  const answeredAt = new Date('2026-10-21T13:07:00Z')
  const input = {
    workspaceId: 'ws1',
    conversationId: 'conv1',
    senderUserId: 'u1',
    byAi: false,
  }

  function openCycle(overrides = {}) {
    cycleRepo.findOpenByConversation.mockResolvedValue(
      ok(createFakeWhatsAppSlaCycle({ startedAt, ...overrides })),
    )
  }

  it('should record the first human answer with the elapsed seconds', async () => {
    openCycle({ id: 'c1' })
    await WhatsAppSlaService.onOutbound(input, answeredAt)

    expect(cycleRepo.recordFirstResponse).toHaveBeenCalledWith('c1', {
      at: answeredAt,
      seconds: 420,
      agentUserId: 'u1',
    })
    expect(conversationRepo.update).toHaveBeenCalledWith('conv1', {
      firstResponseAt: answeredAt,
    })
  })

  it('should count business time only for a business-hours cycle', async () => {
    businessHours(true)
    // Fri 17:50 local -> Mon 08:10 local = 10 + 10 open minutes
    openCycle({
      businessHoursOnly: true,
      startedAt: new Date('2026-10-23T20:50:00Z'),
    })
    await WhatsAppSlaService.onOutbound(input, new Date('2026-10-26T11:10:00Z'))
    expect(cycleRepo.recordFirstResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ seconds: 1200 }),
    )
  })

  it('should ignore later answers, missing cycles and lost races', async () => {
    cycleRepo.findOpenByConversation.mockResolvedValue(ok(null))
    await WhatsAppSlaService.onOutbound(input, answeredAt)

    openCycle({ firstResponseAt: new Date('2026-10-21T13:01:00Z') })
    await WhatsAppSlaService.onOutbound(input, answeredAt)
    expect(cycleRepo.recordFirstResponse).not.toHaveBeenCalled()

    openCycle()
    cycleRepo.recordFirstResponse.mockResolvedValue(ok(false))
    await WhatsAppSlaService.onOutbound(input, answeredAt)
    expect(conversationRepo.update).not.toHaveBeenCalled()
  })

  it('should not count an AI answer unless the policy says so', async () => {
    openCycle({ countAiAsResponse: false })
    await WhatsAppSlaService.onOutbound(
      { ...input, senderUserId: null, byAi: true },
      answeredAt,
    )
    expect(cycleRepo.recordFirstResponse).not.toHaveBeenCalled()

    openCycle({ countAiAsResponse: true })
    await WhatsAppSlaService.onOutbound(
      { ...input, senderUserId: null, byAi: true },
      answeredAt,
    )
    expect(cycleRepo.recordFirstResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ agentUserId: null }),
    )
  })

  it('should log and swallow failures', async () => {
    cycleRepo.findOpenByConversation.mockResolvedValue(err(databaseError('x')))
    await WhatsAppSlaService.onOutbound(input, answeredAt)

    businessHours(true)
    openCycle({ businessHoursOnly: true })
    settingsRepo.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    await WhatsAppSlaService.onOutbound(input, answeredAt)

    businessHours(false)
    openCycle()
    cycleRepo.recordFirstResponse.mockResolvedValue(err(databaseError('x')))
    await WhatsAppSlaService.onOutbound(input, answeredAt)

    expect(cycleRepo.recordFirstResponse).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledTimes(3)
  })
})

describe('WhatsAppSlaService.onClosed()', () => {
  it('should end the open cycle and keep the assignee as the agent', async () => {
    await WhatsAppSlaService.onClosed(
      { id: 'conv1', assignedUserId: 'u9' },
      now,
    )
    expect(cycleRepo.resolveOpen).toHaveBeenCalledWith('conv1', {
      at: now,
      agentUserId: 'u9',
    })
  })

  it('should swallow a failure', async () => {
    cycleRepo.resolveOpen.mockResolvedValue(err(databaseError('x')))
    await expect(
      WhatsAppSlaService.onClosed({ id: 'conv1', assignedUserId: null }, now),
    ).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('WhatsAppSlaService.listOpen()', () => {
  const startedAt = new Date('2026-10-21T12:00:00Z')

  function openRow(
    id: string,
    conversationOwner: { assignedUserId: string | null; teamId: string | null },
    overrides = {},
  ) {
    return {
      ...createFakeWhatsAppSlaCycle({
        id: `cycle-${id}`,
        conversationId: id,
        startedAt,
        ...overrides,
      }),
      conversation: { id, ...conversationOwner },
    }
  }

  it('should list the open cycles with the state at now', async () => {
    cycleRepo.listOpenByWorkspace.mockResolvedValue(
      ok([
        openRow('a', { assignedUserId: null, teamId: null }),
        openRow(
          'b',
          { assignedUserId: null, teamId: null },
          {
            firstResponseDueAt: new Date('2026-10-21T12:30:00Z'),
            firstResponseWarnAt: new Date('2026-10-21T12:20:00Z'),
          },
        ),
      ]),
    )

    const cycles = expectOk(
      await WhatsAppSlaService.listOpen('u1', 'ws1', {}, now),
    )

    expect(cycles.map((c) => [c.conversationId, c.state])).toEqual([
      ['a', 'BREACHED'],
      ['b', 'BREACHED'],
    ])
  })

  it('should filter by state', async () => {
    const atRisk = {
      firstResponseWarnAt: new Date('2026-10-21T12:55:00Z'),
      firstResponseDueAt: new Date('2026-10-21T13:05:00Z'),
      resolutionDueAt: null,
      resolutionWarnAt: null,
    }
    const fine = {
      firstResponseWarnAt: new Date('2026-10-21T13:30:00Z'),
      firstResponseDueAt: new Date('2026-10-21T13:45:00Z'),
      resolutionDueAt: null,
      resolutionWarnAt: null,
    }
    cycleRepo.listOpenByWorkspace.mockResolvedValue(
      ok([
        openRow('risk', { assignedUserId: null, teamId: null }, atRisk),
        openRow('fine', { assignedUserId: null, teamId: null }, fine),
        openRow('late', { assignedUserId: null, teamId: null }),
      ]),
    )

    const atRiskOrWorse = expectOk(
      await WhatsAppSlaService.listOpen('u1', 'ws1', { state: 'AT_RISK' }, now),
    )
    expect(atRiskOrWorse.map((c) => c.conversationId)).toEqual(['risk', 'late'])

    const breached = expectOk(
      await WhatsAppSlaService.listOpen(
        'u1',
        'ws1',
        { state: 'BREACHED' },
        now,
      ),
    )
    expect(breached.map((c) => c.conversationId)).toEqual(['late'])
  })

  it('should hide cycles of conversations the viewer cannot see', async () => {
    asRole('MEMBER')
    cycleRepo.listOpenByWorkspace.mockResolvedValue(
      ok([
        openRow('mine', { assignedUserId: 'u1', teamId: null }),
        openRow('theirs', { assignedUserId: 'u2', teamId: null }),
        openRow('queue', { assignedUserId: null, teamId: null }),
      ]),
    )
    const cycles = expectOk(
      await WhatsAppSlaService.listOpen('u1', 'ws1', {}, now),
    )
    expect(cycles.map((c) => c.conversationId)).toEqual(['mine', 'queue'])
  })

  it('should refuse a non-member and propagate errors', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await WhatsAppSlaService.listOpen('u1', 'ws1'), 'FORBIDDEN')

    asRole('OWNER')
    cycleRepo.listOpenByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await WhatsAppSlaService.listOpen('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('resolveSlaReportPeriod()', () => {
  it('should default to the last 30 days ending now', () => {
    const period = expectOk(resolveSlaReportPeriod({}, now))
    expect(period.to.getTime()).toBe(now.getTime() + 1)
    expect(period.to.getTime() - period.from.getTime()).toBe(30 * 86_400_000)
  })

  it('should read plain dates in Sao Paulo time with an inclusive end', () => {
    const period = expectOk(
      resolveSlaReportPeriod({ from: '2026-10-01', to: '2026-10-02' }, now),
    )
    expect(period.from.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(period.to.toISOString()).toBe('2026-10-03T03:00:00.000Z')
  })

  it('should accept full datetimes', () => {
    const period = expectOk(
      resolveSlaReportPeriod(
        { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' },
        now,
      ),
    )
    expect(period.from.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(period.to.toISOString()).toBe('2026-10-02T00:00:00.000Z')
  })

  it('should refuse a reversed or too long period', () => {
    expectErr(
      resolveSlaReportPeriod({ from: '2026-10-05', to: '2026-10-01' }, now),
      'VALIDATION_ERROR',
    )
    expectErr(
      resolveSlaReportPeriod({ from: '2024-01-01', to: '2026-10-01' }, now),
      'VALIDATION_ERROR',
    )
  })
})

describe('WhatsAppSlaService.report()', () => {
  const row = {
    teamId: 't1',
    agentUserId: 'u1',
    startedAt: new Date('2026-10-20T12:00:00Z'),
    firstResponseDueAt: new Date('2026-10-20T12:15:00Z'),
    firstResponseAt: new Date('2026-10-20T12:05:00Z'),
    firstResponseSeconds: 300,
    resolutionDueAt: null,
    resolvedAt: new Date('2026-10-20T13:00:00Z'),
    firstResponseBreachedAt: null,
    resolutionBreachedAt: null,
  }

  beforeEach(() => {
    membershipRepo.listWithUserByWorkspace.mockResolvedValue(
      ok([
        {
          ...createFakeMembership({ userId: 'u1', workspaceId: 'ws1' }),
          user: { id: 'u1', name: 'Ana', email: 'a@x.com', image: null },
        },
      ]),
    )
    teamRepo.listByWorkspace.mockResolvedValue(
      ok([createFakeWhatsAppTeam({ id: 't1', name: 'Suporte' })]),
    )
    cycleRepo.listForReport.mockResolvedValue(
      ok([row, { ...row, teamId: 't2', agentUserId: 'u2' }]),
    )
  })

  it('should summarize the workspace for an admin', async () => {
    const report = expectOk(
      await WhatsAppSlaService.report(
        'u1',
        'ws1',
        { from: '2026-10-01', to: '2026-10-22' },
        now,
      ),
    )
    expect(report).toMatchObject({
      timeZone: 'America/Sao_Paulo',
      teamId: null,
      firstResponse: { evaluated: 2, withinTarget: 2, withinPercent: 100 },
    })
    expect(report.byAgent.map((r) => r.label).sort()).toEqual([
      'Ana',
      'Removido',
    ])
    expect(cycleRepo.listForReport).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', teamId: undefined }),
    )
  })

  it('should pass the team filter', async () => {
    const report = expectOk(
      await WhatsAppSlaService.report('u1', 'ws1', { teamId: 't1' }, now),
    )
    expect(report.teamId).toBe('t1')
    expect(cycleRepo.listForReport).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 't1' }),
    )
  })

  it('should limit a team leader to the teams they lead', async () => {
    asRole('MEMBER')
    teamRepo.listMembershipSnapshot.mockResolvedValue(
      ok([{ id: 't1', members: [{ userId: 'u1', role: 'LEADER' }] }]),
    )
    const report = expectOk(
      await WhatsAppSlaService.report('u1', 'ws1', {}, now),
    )
    expect(report.firstResponse.evaluated).toBe(1)
    expect(report.byTeam.map((r) => r.id)).toEqual(['t1'])
  })

  it('should refuse a plain agent', async () => {
    asRole('MEMBER')
    const error = expectErr(
      await WhatsAppSlaService.report('u1', 'ws1', {}, now),
      'FORBIDDEN',
    )
    expect(error.message).toContain('líderes')
  })

  it('should refuse a non-member, a bad period and propagate errors', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSlaService.report('u1', 'ws1', {}, now),
      'FORBIDDEN',
    )

    asRole('OWNER')
    expectErr(
      await WhatsAppSlaService.report(
        'u1',
        'ws1',
        { from: '2026-10-05', to: '2026-10-01' },
        now,
      ),
      'VALIDATION_ERROR',
    )

    membershipRepo.listWithUserByWorkspace.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppSlaService.report('u1', 'ws1', {}, now),
      'DATABASE_ERROR',
    )

    membershipRepo.listWithUserByWorkspace.mockResolvedValue(ok([]))
    teamRepo.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaService.report('u1', 'ws1', {}, now),
      'DATABASE_ERROR',
    )

    teamRepo.listByWorkspace.mockResolvedValue(ok([]))
    cycleRepo.listForReport.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppSlaService.report('u1', 'ws1', {}, now),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppSlaService.reportCsv() and slaReportToCsv()', () => {
  it('should render the summary, agents and teams as CSV', async () => {
    cycleRepo.listForReport.mockResolvedValue(
      ok([
        {
          teamId: null,
          agentUserId: null,
          startedAt: new Date('2026-10-20T12:00:00Z'),
          firstResponseDueAt: new Date('2026-10-20T12:15:00Z'),
          firstResponseAt: new Date('2026-10-20T12:30:00Z'),
          firstResponseSeconds: 1800,
          resolutionDueAt: null,
          resolvedAt: null,
          firstResponseBreachedAt: null,
          resolutionBreachedAt: null,
        },
      ]),
    )
    const csv = expectOk(
      await WhatsAppSlaService.reportCsv('u1', 'ws1', {}, now),
    )

    expect(csv.startsWith('﻿Seção,Nome')).toBe(true)
    expect(csv).toContain('Primeira resposta,Total,1,0,0,"30,0","30,0",1')
    expect(csv).toContain('Atendente,Sem responsável,1,,,,,1')
    expect(csv).toContain('Equipe,Sem equipe,1,,,,,1')
  })

  it('should leave empty cells when nothing was evaluated', () => {
    const csv = slaReportToCsv({
      from: '2026-10-01T03:00:00.000Z',
      to: '2026-10-02T03:00:00.000Z',
      timeZone: 'America/Sao_Paulo',
      teamId: null,
      firstResponse: {
        evaluated: 0,
        withinTarget: 0,
        withinPercent: null,
        averageSeconds: null,
        p90Seconds: null,
      },
      resolution: { evaluated: 0, withinTarget: 0, withinPercent: null },
      byAgent: [],
      byTeam: [],
    })
    expect(csv).toContain('Primeira resposta,Total,0,0,,,,0')
    expect(csv).toContain('Resolução,Total,0,0,,,,0')
  })

  it('should use decimal commas', () => {
    const csv = slaReportToCsv({
      from: '',
      to: '',
      timeZone: 'America/Sao_Paulo',
      teamId: null,
      firstResponse: {
        evaluated: 3,
        withinTarget: 2,
        withinPercent: 66.7,
        averageSeconds: 90,
        p90Seconds: 150,
      },
      resolution: { evaluated: 0, withinTarget: 0, withinPercent: null },
      byAgent: [],
      byTeam: [],
    })
    expect(csv).toContain('Primeira resposta,Total,3,2,"66,7","1,5","2,5",1')
  })

  it('should propagate a report error', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppSlaService.reportCsv('u1', 'ws1', {}, now),
      'FORBIDDEN',
    )
  })
})
