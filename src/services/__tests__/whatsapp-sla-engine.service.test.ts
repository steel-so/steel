import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import {
  createFakeWhatsAppSlaCycle,
  createFakeWhatsAppSlaPolicy,
} from '@/src/__tests__/factories/whatsapp-sla.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/env/env', () => ({ NEXT_PUBLIC_URL: 'https://steel.test' }))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/mail/workspace/send-whatsapp-sla-alert', () => ({
  sendWhatsAppSlaAlertEmail: vi.fn(async () => ({})),
}))
vi.mock('../whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(
    async (input: { userIds: string[] }) => input.userIds.length,
  ),
  whatsAppAdminIds: vi.fn(async () => ['admin1']),
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-sla-policy.repository')
vi.mock(
  '@/src/repositories/whatsapp-sla-cycle.repository',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/src/repositories/whatsapp-sla-cycle.repository')
    >()),
    WhatsAppSlaCycleRepository: {
      listDue: vi.fn(),
      claim: vi.fn(),
      resolveOpen: vi.fn(),
    },
  }),
)

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sendWhatsAppSlaAlertEmail } from '@/src/lib/mail/workspace/send-whatsapp-sla-alert'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import {
  type WhatsAppSlaCycleForScan,
  WhatsAppSlaCycleRepository,
} from '@/src/repositories/whatsapp-sla-cycle.repository'
import { WhatsAppSlaPolicyRepository } from '@/src/repositories/whatsapp-sla-policy.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { notifyWhatsAppUsers } from '../whatsapp-notify'
import {
  formatSlaDue,
  WHATSAPP_SLA_SCAN_BATCH,
  WhatsAppSlaEngineService,
} from '../whatsapp-sla-engine.service'

const cycleRepo = vi.mocked(WhatsAppSlaCycleRepository)
const policyRepo = vi.mocked(WhatsAppSlaPolicyRepository)
const membershipRepo = vi.mocked(MembershipRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const eventRepo = vi.mocked(WhatsAppConversationEventRepository)
const teamRepo = vi.mocked(WhatsAppTeamRepository)
const notify = vi.mocked(notifyWhatsAppUsers)
const sendEmail = vi.mocked(sendWhatsAppSlaAlertEmail)

const now = new Date('2026-10-21T13:20:00Z')

function scanCycle(
  overrides: Partial<WhatsAppSlaCycleForScan> = {},
  conversation: Partial<WhatsAppSlaCycleForScan['conversation']> = {},
): WhatsAppSlaCycleForScan {
  return {
    ...createFakeWhatsAppSlaCycle({
      id: 'cycle1',
      workspaceId: 'ws1',
      conversationId: 'conv1',
      policyId: 'p1',
      startedAt: new Date('2026-10-21T13:00:00Z'),
    }),
    conversation: {
      id: 'conv1',
      workspaceId: 'ws1',
      assignedUserId: 'agent1',
      teamId: 't1',
      status: 'IN_PROGRESS',
      deletedAt: null,
      contact: { name: 'Maria', waId: '5511999990000' },
      team: { name: 'Suporte' },
      ...conversation,
    },
    ...overrides,
  }
}

function member(
  userId: string,
  role: 'OWNER' | 'ADMIN' | 'MEMBER',
  email = `${userId}@x.com`,
) {
  return {
    ...createFakeMembership({ userId, workspaceId: 'ws1', role }),
    user: { id: userId, name: userId.toUpperCase(), email, image: null },
  }
}

/** Only the given (kind, transition) pass returns cycles. */
function due(
  kind: 'firstResponse' | 'resolution',
  transition: 'warn' | 'breach',
  cycles: WhatsAppSlaCycleForScan[],
) {
  cycleRepo.listDue.mockImplementation(async (k, t) =>
    ok(k === kind && t === transition ? cycles : []),
  )
}

beforeEach(() => {
  cycleRepo.listDue.mockResolvedValue(ok([]))
  cycleRepo.claim.mockResolvedValue(ok(true))
  cycleRepo.resolveOpen.mockResolvedValue(ok(1))
  policyRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppSlaPolicy({ id: 'p1', workspaceId: 'ws1' })),
  )
  membershipRepo.listWithUserByWorkspace.mockResolvedValue(
    ok([
      member('agent1', 'MEMBER'),
      member('lead1', 'MEMBER'),
      member('admin1', 'ADMIN'),
      member('other', 'MEMBER'),
    ]),
  )
  teamRepo.listMembershipSnapshot.mockResolvedValue(
    ok([
      {
        id: 't1',
        members: [
          { userId: 'lead1', role: 'LEADER' },
          { userId: 'agent1', role: 'AGENT' },
        ],
      },
    ]),
  )
  workspaceRepo.findById.mockResolvedValue(
    ok({ id: 'ws1', slug: 'acme', name: 'Acme' } as never),
  )
  eventRepo.create.mockResolvedValue(ok({} as never))
  conversationRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        workspaceId: 'ws1',
      }),
    ),
  )
})

describe('formatSlaDue()', () => {
  it('should format in the Sao Paulo time zone', () => {
    expect(formatSlaDue(new Date('2026-10-23T17:35:00Z'))).toBe(
      '23/10 às 14:35',
    )
  })
})

describe('WhatsAppSlaEngineService.scanDue()', () => {
  it('should do nothing when no cycle is due', async () => {
    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now))).toEqual({
      warned: 0,
      breached: 0,
    })
    expect(cycleRepo.listDue).toHaveBeenCalledTimes(4)
    expect(cycleRepo.listDue).toHaveBeenCalledWith(
      'firstResponse',
      'breach',
      now,
      WHATSAPP_SLA_SCAN_BATCH,
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('should warn the assignee, team leaders and administrators once', async () => {
    due('firstResponse', 'warn', [scanCycle()])

    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now))).toEqual({
      warned: 1,
      breached: 0,
    })

    expect(cycleRepo.claim).toHaveBeenCalledWith(
      'cycle1',
      'firstResponse',
      'warn',
      now,
      'agent1',
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        kind: 'WHATSAPP_SLA_AT_RISK',
        title: 'SLA em risco: Maria',
        path: '/zap?conversa=conv1',
      }),
    )
    const recipients = notify.mock.calls[0][0].userIds as string[]
    expect(recipients.sort()).toEqual(['admin1', 'agent1', 'lead1'])
    expect(notify.mock.calls[0][0].body).toContain('primeira resposta')
    expect(eventRepo.create).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_sla_cycle',
        action: 'alert',
        actorId: null,
        meta: expect.objectContaining({
          transition: 'warn',
          target: 'firstResponse',
        }),
      }),
    )
  })

  it('should flag a breach on the timeline and notify', async () => {
    due('firstResponse', 'breach', [scanCycle()])

    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now))).toEqual({
      warned: 0,
      breached: 1,
    })

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_SLA_BREACHED',
        title: 'SLA estourado: Maria',
      }),
    )
    expect(eventRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      conversationId: 'conv1',
      kind: 'SLA_BREACHED',
      source: 'SLA',
      actorUserId: null,
      reason: 'Primeira resposta',
    })
    expect(publishWhatsAppEvent).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'conversation.updated' }),
    )
  })

  it('should handle the resolution target', async () => {
    due('resolution', 'breach', [scanCycle()])
    await WhatsAppSlaEngineService.scanDue(now)
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Resolução' }),
    )
    expect(notify.mock.calls[0][0].body).toContain('resolução')

    due('resolution', 'warn', [scanCycle()])
    notify.mockClear()
    await WhatsAppSlaEngineService.scanDue(now)
    expect(notify.mock.calls[0][0].kind).toBe('WHATSAPP_SLA_AT_RISK')
  })

  it('should not notify twice when another worker already claimed the cycle', async () => {
    due('firstResponse', 'breach', [scanCycle()])
    cycleRepo.claim.mockResolvedValue(ok(false))

    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now))).toEqual({
      warned: 0,
      breached: 0,
    })
    expect(notify).not.toHaveBeenCalled()
    expect(eventRepo.create).not.toHaveBeenCalled()
  })

  it('should self-heal a cycle whose conversation is closed or deleted', async () => {
    due('firstResponse', 'breach', [
      scanCycle({}, { status: 'CLOSED' }),
      scanCycle({ id: 'cycle2' }, { deletedAt: new Date() }),
    ])
    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now))).toEqual({
      warned: 0,
      breached: 0,
    })
    expect(cycleRepo.resolveOpen).toHaveBeenCalledTimes(2)
    expect(cycleRepo.claim).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('should respect the policy recipients and in-app flag, and e-mail when asked', async () => {
    policyRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppSlaPolicy({
          notifyAssignee: false,
          notifyTeamLeaders: false,
          notifySupervisors: true,
          supervisorIds: ['other', 'admin1'],
          notifyInApp: false,
          notifyEmail: true,
        }),
      ),
    )
    due('firstResponse', 'breach', [scanCycle()])

    await WhatsAppSlaEngineService.scanDue(now)

    expect(notify).not.toHaveBeenCalled()
    // `other` is a plain member outside the team: cannot see the conversation.
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin1@x.com',
        breached: true,
        targetLabel: 'primeira resposta',
        workspaceName: 'Acme',
        redirectUrl: 'https://steel.test/acme/zap?conversa=conv1',
      }),
    )
  })

  it('should log a failed e-mail without failing the scan', async () => {
    policyRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppSlaPolicy({ notifyEmail: true })),
    )
    sendEmail.mockRejectedValue(new Error('smtp'))
    due('firstResponse', 'warn', [scanCycle()])

    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now)).warned).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.sla.email_failed',
      expect.objectContaining({ failed: 3 }),
    )
  })

  it('should use the default notice rules when the policy is gone', async () => {
    policyRepo.findById.mockResolvedValue(ok(null))
    due('firstResponse', 'warn', [scanCycle()])
    await WhatsAppSlaEngineService.scanDue(now)
    expect(notify).toHaveBeenCalled()

    notify.mockClear()
    due('firstResponse', 'warn', [scanCycle({ policyId: null })])
    await WhatsAppSlaEngineService.scanDue(now)
    expect(policyRepo.findById).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalled()
  })

  it('should stop notifying for a policy turned off after the cycle began', async () => {
    policyRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppSlaPolicy({ enabled: false })),
    )
    due('firstResponse', 'breach', [scanCycle()])
    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now)).breached).toBe(
      0,
    )
    expect(notify).not.toHaveBeenCalled()
    expect(eventRepo.create).not.toHaveBeenCalled()
  })

  it('should skip the notice when nobody can be told but still flag the breach', async () => {
    membershipRepo.listWithUserByWorkspace.mockResolvedValue(ok([]))
    due('firstResponse', 'breach', [scanCycle()])
    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now)).breached).toBe(
      1,
    )
    expect(notify).not.toHaveBeenCalled()
    expect(workspaceRepo.findById).not.toHaveBeenCalled()
    expect(eventRepo.create).toHaveBeenCalled()
  })

  it('should keep the conversation visible rule for a conversation without a team', async () => {
    due('firstResponse', 'warn', [
      scanCycle({}, { teamId: null, assignedUserId: null }),
    ])
    await WhatsAppSlaEngineService.scanDue(now)
    expect(notify.mock.calls[0][0].userIds).toEqual(['admin1'])
  })

  it('should name the contact by number when it has no name', async () => {
    due('firstResponse', 'warn', [
      scanCycle({}, { contact: { name: null, waId: '5511900000000' } }),
    ])
    await WhatsAppSlaEngineService.scanDue(now)
    expect(notify.mock.calls[0][0].title).toBe('SLA em risco: 5511900000000')
  })

  it('should keep going when one cycle fails', async () => {
    due('firstResponse', 'warn', [scanCycle(), scanCycle({ id: 'cycle2' })])
    cycleRepo.claim
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValueOnce(ok(true))

    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now)).warned).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.sla.cycle_failed',
      expect.objectContaining({ cycleId: 'cycle1', reason: 'DATABASE_ERROR' }),
    )
  })

  it('should survive a thrown error on a cycle', async () => {
    due('firstResponse', 'warn', [scanCycle()])
    cycleRepo.claim.mockRejectedValue(new Error('boom'))
    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now)).warned).toBe(0)
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.sla.cycle_threw',
      expect.objectContaining({ error: 'boom' }),
    )

    cycleRepo.claim.mockRejectedValue('weird')
    await WhatsAppSlaEngineService.scanDue(now)
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.sla.cycle_threw',
      expect.objectContaining({ error: 'weird' }),
    )
  })

  it('should log notice failures without retrying the reserved notice', async () => {
    due('firstResponse', 'warn', [scanCycle()])
    membershipRepo.listWithUserByWorkspace.mockResolvedValue(
      err(databaseError('x')),
    )
    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now)).warned).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.sla.notify_failed',
      expect.objectContaining({ reason: 'DATABASE_ERROR' }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ inApp: 0, email: 0 }),
      }),
    )
  })

  it.each([
    [
      'team snapshot',
      () =>
        teamRepo.listMembershipSnapshot.mockResolvedValue(
          err(databaseError('x')),
        ),
    ],
    [
      'workspace lookup',
      () => workspaceRepo.findById.mockResolvedValue(err(databaseError('x'))),
    ],
  ])('should log a notice failure on %s', async (_label, fail) => {
    fail()
    due('firstResponse', 'warn', [scanCycle()])
    await WhatsAppSlaEngineService.scanDue(now)
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.sla.notify_failed',
      expect.anything(),
    )
  })

  it('should surface a failed scan query', async () => {
    cycleRepo.listDue.mockResolvedValue(err(databaseError('x')))
    expectErr(await WhatsAppSlaEngineService.scanDue(now), 'DATABASE_ERROR')
  })

  it('should surface failures resolving a closed conversation, the policy lookup and the timeline event', async () => {
    due('firstResponse', 'breach', [scanCycle({}, { status: 'CLOSED' })])
    cycleRepo.resolveOpen.mockResolvedValue(err(databaseError('x')))
    await WhatsAppSlaEngineService.scanDue(now)

    due('firstResponse', 'breach', [scanCycle()])
    policyRepo.findById.mockResolvedValue(err(databaseError('x')))
    await WhatsAppSlaEngineService.scanDue(now)

    policyRepo.findById.mockResolvedValue(ok(null))
    eventRepo.create.mockResolvedValue(err(databaseError('x')))
    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now)).breached).toBe(
      0,
    )

    expect(logger.warn).toHaveBeenCalledTimes(3)
  })

  it('should not break when the refreshed conversation cannot be read', async () => {
    conversationRepo.findById.mockResolvedValue(ok(null))
    due('firstResponse', 'breach', [scanCycle()])
    expect(expectOk(await WhatsAppSlaEngineService.scanDue(now)).breached).toBe(
      1,
    )
    expect(publishWhatsAppEvent).not.toHaveBeenCalled()
  })
})
