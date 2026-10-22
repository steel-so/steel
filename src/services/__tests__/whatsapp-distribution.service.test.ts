import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppAgentPresence } from '@/src/__tests__/factories/whatsapp-agent-presence.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-agent-presence.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-distribution.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/services/whatsapp-conversation-scope.service', () => ({
  loadWhatsAppTeamSnapshot: vi.fn(),
}))
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-notify')>()),
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppAgentPresenceRepository } from '@/src/repositories/whatsapp-agent-presence.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppDistributionRepository } from '@/src/repositories/whatsapp-distribution.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { loadWhatsAppTeamSnapshot } from '../whatsapp-conversation-scope.service'
import { WhatsAppDistributionService } from '../whatsapp-distribution.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'

const memberships = vi.mocked(MembershipRepository)
const presence = vi.mocked(WhatsAppAgentPresenceRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const events = vi.mocked(WhatsAppConversationEventRepository)
const distribution = vi.mocked(WhatsAppDistributionRepository)
const settingsRepo = vi.mocked(WhatsAppSettingsRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const snapshot = vi.mocked(loadWhatsAppTeamSnapshot)
const notify = vi.mocked(notifyWhatsAppUsers)

const NOW = new Date('2026-10-22T15:00:00Z') // Thursday 12:00 in Sao Paulo

function members(...entries: [string, Role][]) {
  memberships.listWithUserByWorkspace.mockResolvedValue(
    ok(
      entries.map(([userId, role]) => ({
        ...createFakeMembership({ userId, workspaceId: 'ws1', role }),
        user: {
          id: userId,
          name: `Nome ${userId}`,
          email: `${userId}@x`,
          image: null,
        },
      })),
    ),
  )
}

function settings(overrides: Parameters<typeof createFakeWhatsAppSettings>[0]) {
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppSettings({
        workspaceId: 'ws1',
        distributionMode: 'ROUND_ROBIN',
        ...overrides,
      }),
    ),
  )
}

function conversation(
  overrides: Parameters<typeof createFakeWhatsAppConversationWithPreview>[0],
) {
  conversations.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        workspaceId: 'ws1',
        teamId: null,
        assignedUserId: null,
        ...overrides,
      }),
    ),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  distribution.withLock.mockImplementation(async (_key, fn) => fn())
  distribution.getTeamPointer.mockResolvedValue(ok(null))
  distribution.setTeamPointer.mockResolvedValue(ok(undefined))
  distribution.setWorkspacePointer.mockResolvedValue(ok(undefined))
  presence.list.mockResolvedValue(ok([]))
  presence.touchLastAssigned.mockResolvedValue(ok(undefined))
  conversations.countOpenByAssignees.mockResolvedValue(ok(new Map()))
  conversations.claimForAssignment.mockResolvedValue(ok(true))
  events.create.mockResolvedValue(ok({ id: 'evt1' } as never))
  snapshot.mockResolvedValue(
    ok([
      {
        id: 'team1',
        members: [
          { userId: 'ana', role: 'AGENT' },
          { userId: 'bia', role: 'AGENT' },
          { userId: 'lia', role: 'LEADER' },
          { userId: 'vic', role: 'AGENT' },
          { userId: 'gone', role: 'AGENT' },
        ],
      },
    ]),
  )
  members(
    ['owner', 'OWNER'],
    ['admin', 'ADMIN'],
    ['ana', 'MEMBER'],
    ['bia', 'MEMBER'],
    ['lia', 'MEMBER'],
    ['vic', 'VIEWER'],
    ['cao', 'MEMBER'],
  )
  settings({})
  conversation({})
})

describe('WhatsAppDistributionService.distributeConversation()', () => {
  it('does nothing while the distribution is off', async () => {
    settings({ distributionMode: 'OFF' })
    const result = expectOk(
      await WhatsAppDistributionService.distributeConversation('ws1', 'conv1'),
    )
    expect(result).toEqual({ assigned: false, reason: 'disabled' })
    expect(conversations.findById).not.toHaveBeenCalled()
  })

  it('uses the effective defaults for a workspace that never saved settings', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    const result = expectOk(
      await WhatsAppDistributionService.distributeConversation('ws1', 'conv1'),
    )
    expect(result).toEqual({ assigned: false, reason: 'disabled' })
  })

  it('reuses the settings handed in by a drain', async () => {
    const result = expectOk(
      await WhatsAppDistributionService.distributeConversation('ws1', 'conv1', {
        now: NOW,
        settings: {
          ...(
            await import('@/src/mappers/whatsapp-settings.mapper')
          ).toWhatsAppSettingsDTO('ws1', null),
          distributionMode: 'OFF',
        },
      }),
    )
    expect(result).toEqual({ assigned: false, reason: 'disabled' })
    expect(settingsRepo.findByWorkspace).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', null],
    ['assigned', { assignedUserId: 'ana' }],
    ['answered by the AI', { aiActive: true }],
    ['closed', { status: 'CLOSED' as const }],
    ['archived', { archivedAt: new Date() }],
    ['deleted', { deletedAt: new Date() }],
  ])('leaves a %s conversation alone', async (_label, overrides) => {
    if (overrides === null) {
      conversations.findById.mockResolvedValue(ok(null))
    } else {
      conversation(overrides)
    }
    const result = expectOk(
      await WhatsAppDistributionService.distributeConversation('ws1', 'conv1'),
    )
    expect(result).toEqual({ assigned: false, reason: 'not_eligible' })
    expect(conversations.claimForAssignment).not.toHaveBeenCalled()
  })

  describe('business hours', () => {
    const hours = {
      businessHoursEnabled: true,
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      businessHoursDays: [1, 2, 3, 4, 5],
    }

    it('keeps the conversation queued outside the hours', async () => {
      settings(hours)
      const night = new Date('2026-10-22T03:00:00Z') // 00:00 in Sao Paulo
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
          { now: night },
        ),
      )
      expect(result).toEqual({
        assigned: false,
        reason: 'outside_business_hours',
      })
      expect(conversations.claimForAssignment).not.toHaveBeenCalled()
    })

    it('distributes inside the hours', async () => {
      settings(hours)
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
          { now: NOW },
        ),
      )
      expect(result.assigned).toBe(true)
    })

    it('ignores the hours when the workspace asks not to respect them', async () => {
      settings({ ...hours, distributionRespectBusinessHours: false })
      const night = new Date('2026-10-22T03:00:00Z')
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
          { now: night },
        ),
      )
      expect(result.assigned).toBe(true)
    })
  })

  describe('team conversations', () => {
    beforeEach(() => conversation({ teamId: 'team1' }))

    it('gives the conversation to the first agent of the team in rotation', async () => {
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
          { now: NOW },
        ),
      )

      expect(result).toEqual({ assigned: true, userId: 'ana' })
      expect(conversations.claimForAssignment).toHaveBeenCalledWith(
        'conv1',
        'ws1',
        'ana',
      )
      expect(distribution.setTeamPointer).toHaveBeenCalledWith('team1', 'ana')
      expect(distribution.setWorkspacePointer).not.toHaveBeenCalled()
      expect(presence.touchLastAssigned).toHaveBeenCalledWith('ws1', 'ana', NOW)
      expect(distribution.withLock).toHaveBeenCalledWith(
        'whatsapp-distribution:ws1',
        expect.any(Function),
      )
    })

    it('continues from the pointer of the team', async () => {
      distribution.getTeamPointer.mockResolvedValue(ok('ana'))
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'bia' })
    })

    it('includes the leader but leaves out viewers and people who left the workspace', async () => {
      distribution.getTeamPointer.mockResolvedValue(ok('bia'))
      // Members of the pool: ana, bia, lia (vic is a VIEWER, "gone" left).
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'lia' })
      expect(conversations.countOpenByAssignees).toHaveBeenCalledWith('ws1', [
        'ana',
        'bia',
        'lia',
      ])
    })

    it('counts an admin who sits in the team as a member of the pool', async () => {
      members(['ana', 'ADMIN'])
      snapshot.mockResolvedValue(
        ok([{ id: 'team1', members: [{ userId: 'ana', role: 'AGENT' }] }]),
      )
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'ana' })
    })

    it('reports an empty pool for a team that no longer exists or has nobody', async () => {
      snapshot.mockResolvedValue(ok([]))
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: false, reason: 'empty_pool' })
      expect(conversations.claimForAssignment).not.toHaveBeenCalled()
    })
  })

  describe('conversations without a team', () => {
    it('rotates among the workspace members, never owners or admins', async () => {
      settings({ distributionLastAssignedUserId: 'ana' })
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      // MEMBER role: ana, bia, lia, cao (owner, admin, viewer are out).
      expect(conversations.countOpenByAssignees).toHaveBeenCalledWith('ws1', [
        'ana',
        'bia',
        'lia',
        'cao',
      ])
      expect(result).toEqual({ assigned: true, userId: 'bia' })
      expect(distribution.setWorkspacePointer).toHaveBeenCalledWith(
        'ws1',
        'bia',
      )
      expect(distribution.setTeamPointer).not.toHaveBeenCalled()
    })
  })

  describe('LEAST_LOADED', () => {
    beforeEach(() => settings({ distributionMode: 'LEAST_LOADED' }))

    it('picks the member with the fewest open conversations', async () => {
      conversations.countOpenByAssignees.mockResolvedValue(
        ok(
          new Map([
            ['ana', 4],
            ['bia', 2],
            ['lia', 3],
            ['cao', 5],
          ]),
        ),
      )
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'bia' })
    })

    it('breaks ties by the oldest last assignment', async () => {
      presence.list.mockResolvedValue(
        ok([
          createFakeWhatsAppAgentPresence({
            userId: 'ana',
            lastAssignedAt: new Date('2026-10-22T14:00:00Z'),
          }),
          createFakeWhatsAppAgentPresence({
            userId: 'bia',
            lastAssignedAt: new Date('2026-10-22T10:00:00Z'),
          }),
          createFakeWhatsAppAgentPresence({
            userId: 'lia',
            lastAssignedAt: new Date('2026-10-22T13:00:00Z'),
          }),
          createFakeWhatsAppAgentPresence({
            userId: 'cao',
            lastAssignedAt: new Date('2026-10-22T12:00:00Z'),
          }),
        ]),
      )
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'bia' })
    })
  })

  describe('who cannot receive', () => {
    it('skips agents who are away', async () => {
      presence.list.mockResolvedValue(
        ok([
          createFakeWhatsAppAgentPresence({ userId: 'ana', status: 'AWAY' }),
        ]),
      )
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'bia' })
    })

    it('counts away agents too when presence does not matter', async () => {
      settings({ distributionOnlyAvailable: false })
      presence.list.mockResolvedValue(
        ok(
          ['ana', 'bia', 'lia', 'cao'].map((userId) =>
            createFakeWhatsAppAgentPresence({ userId, status: 'AWAY' }),
          ),
        ),
      )
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'ana' })
    })

    it('leaves the conversation in the queue when everybody is away', async () => {
      presence.list.mockResolvedValue(
        ok(
          ['ana', 'bia', 'lia', 'cao'].map((userId) =>
            createFakeWhatsAppAgentPresence({ userId, status: 'AWAY' }),
          ),
        ),
      )
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: false, reason: 'nobody_available' })
      expect(conversations.claimForAssignment).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()
    })

    it('stops at the open-conversation cap', async () => {
      settings({ distributionMaxOpenPerAgent: 2 })
      conversations.countOpenByAssignees.mockResolvedValue(
        ok(
          new Map([
            ['ana', 2],
            ['bia', 1],
            ['lia', 2],
            ['cao', 7],
          ]),
        ),
      )
      const first = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(first).toEqual({ assigned: true, userId: 'bia' })

      conversations.countOpenByAssignees.mockResolvedValue(
        ok(
          new Map([
            ['ana', 2],
            ['bia', 2],
            ['lia', 2],
            ['cao', 2],
          ]),
        ),
      )
      const second = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(second).toEqual({ assigned: false, reason: 'all_at_capacity' })
    })
  })

  describe('races', () => {
    it('yields to a human who assigned the conversation first', async () => {
      conversations.claimForAssignment.mockResolvedValue(ok(false))
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: false, reason: 'already_assigned' })
      expect(distribution.setWorkspacePointer).not.toHaveBeenCalled()
      expect(presence.touchLastAssigned).not.toHaveBeenCalled()
      expect(events.create).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()
    })

    it('serialises two simultaneous messages through the lock', async () => {
      // A real lock: the second critical section waits for the first.
      let tail: Promise<unknown> = Promise.resolve()
      distribution.withLock.mockImplementation((_key, fn) => {
        const run = tail.then(() => fn())
        tail = run.catch(() => undefined)
        return run
      })
      // The pointer lives in the settings row, as in the database.
      let pointer: string | null = null
      settingsRepo.findByWorkspace.mockImplementation(async () =>
        ok(
          createFakeWhatsAppSettings({
            workspaceId: 'ws1',
            distributionMode: 'ROUND_ROBIN',
            distributionLastAssignedUserId: pointer,
          }),
        ),
      )
      distribution.setWorkspacePointer.mockImplementation(
        async (_ws, userId) => {
          pointer = userId
          return ok(undefined)
        },
      )

      const [one, two] = await Promise.all([
        WhatsAppDistributionService.distributeConversation('ws1', 'conv1'),
        WhatsAppDistributionService.distributeConversation('ws1', 'conv2'),
      ])
      const picked = [one, two].map(
        (r) => (expectOk(r) as { userId: string }).userId,
      )
      expect(new Set(picked).size).toBe(2)
    })
  })

  describe('after an assignment', () => {
    it('records the event, audits, publishes and tells the agent', async () => {
      conversation({
        contact: undefined,
        teamId: null,
      })
      expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )

      expect(events.create).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        conversationId: 'conv1',
        kind: 'ASSIGNED',
        source: 'DISTRIBUTION',
        actorUserId: null,
        reason: 'Nome ana',
      })
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'whatsapp_conversation',
          action: 'assign',
          actorId: null,
          meta: expect.objectContaining({
            assignedUserId: 'ana',
            via: 'distribution',
            mode: 'ROUND_ROBIN',
          }),
        }),
      )
      expect(publishWhatsAppEvent).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ type: 'conversation.updated' }),
      )
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
          userIds: ['ana'],
          path: '/zap?conversa=conv1',
        }),
      )
    })

    it('still assigns when the follow-ups fail', async () => {
      events.create.mockResolvedValue(err(databaseError()))
      distribution.setWorkspacePointer.mockResolvedValue(err(databaseError()))
      presence.touchLastAssigned.mockResolvedValue(err(databaseError()))
      conversations.findById
        .mockResolvedValueOnce(
          ok(
            createFakeWhatsAppConversationWithPreview({
              id: 'conv1',
              workspaceId: 'ws1',
            }),
          ),
        )
        .mockResolvedValueOnce(ok(null))

      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'ana' })
      expect(logger.error).toHaveBeenCalledWith(
        'whatsapp.distribution.event_failed',
        expect.any(Object),
      )
      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp.distribution.pointer_failed',
        expect.any(Object),
      )
      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp.distribution.last_assigned_failed',
        expect.any(Object),
      )
      expect(publishWhatsAppEvent).not.toHaveBeenCalled()
    })
  })

  describe('database failures', () => {
    it.each([
      ['settings', () => settingsRepo.findByWorkspace],
      ['conversation', () => conversations.findById],
      ['members', () => memberships.listWithUserByWorkspace],
      ['lock', () => distribution.withLock],
      ['load counts', () => conversations.countOpenByAssignees],
      ['presence', () => presence.list],
      ['team pointer', () => distribution.getTeamPointer],
      ['claim', () => conversations.claimForAssignment],
    ])('propagates a %s failure', async (_label, target) => {
      conversation({ teamId: 'team1' })
      target().mockResolvedValue(err(databaseError()) as never)
      expectErr(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
        'DATABASE_ERROR',
      )
    })

    it('propagates a team snapshot failure', async () => {
      snapshot.mockResolvedValue(err(databaseError()))
      expectErr(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
        'DATABASE_ERROR',
      )
    })

    it('propagates a workspace pointer read failure', async () => {
      settingsRepo.findByWorkspace
        .mockResolvedValueOnce(
          ok(
            createFakeWhatsAppSettings({
              workspaceId: 'ws1',
              distributionMode: 'ROUND_ROBIN',
            }),
          ),
        )
        .mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
        'DATABASE_ERROR',
      )
    })

    it('reads a missing settings row as no pointer', async () => {
      settingsRepo.findByWorkspace
        .mockResolvedValueOnce(
          ok(
            createFakeWhatsAppSettings({
              workspaceId: 'ws1',
              distributionMode: 'ROUND_ROBIN',
            }),
          ),
        )
        .mockResolvedValueOnce(ok(null))
      const result = expectOk(
        await WhatsAppDistributionService.distributeConversation(
          'ws1',
          'conv1',
        ),
      )
      expect(result).toEqual({ assigned: true, userId: 'ana' })
    })
  })
})

describe('WhatsAppDistributionService.drainQueue()', () => {
  function queue(...ids: string[]) {
    conversations.listAwaitingDistribution.mockResolvedValue(
      ok(ids.map((id) => ({ id })) as never),
    )
  }

  it('does nothing while the distribution is off', async () => {
    settings({ distributionMode: 'OFF' })
    const result = expectOk(await WhatsAppDistributionService.drainQueue('ws1'))
    expect(result).toEqual({ assigned: 0, examined: 0 })
    expect(conversations.listAwaitingDistribution).not.toHaveBeenCalled()
  })

  it('hands the queue out oldest first, rotating through the agents', async () => {
    queue('c1', 'c2', 'c3')
    // The pointer advances with every assignment, as the database would.
    let pointer: string | null = null
    settingsRepo.findByWorkspace.mockImplementation(async () =>
      ok(
        createFakeWhatsAppSettings({
          workspaceId: 'ws1',
          distributionMode: 'ROUND_ROBIN',
          distributionLastAssignedUserId: pointer,
        }),
      ),
    )
    distribution.setWorkspacePointer.mockImplementation(async (_ws, user) => {
      pointer = user
      return ok(undefined)
    })
    conversations.findById.mockImplementation(async (id) =>
      ok(
        createFakeWhatsAppConversationWithPreview({
          id,
          workspaceId: 'ws1',
          teamId: null,
        }),
      ),
    )

    const result = expectOk(
      await WhatsAppDistributionService.drainQueue('ws1', { limit: 10 }),
    )
    expect(result).toEqual({ assigned: 3, examined: 3 })
    expect(conversations.listAwaitingDistribution).toHaveBeenCalledWith(
      'ws1',
      10,
    )
    expect(
      conversations.claimForAssignment.mock.calls.map((call) => call[2]),
    ).toEqual(['ana', 'bia', 'cao'])
  })

  it('uses a bounded default batch', async () => {
    queue()
    await WhatsAppDistributionService.drainQueue('ws1')
    expect(conversations.listAwaitingDistribution).toHaveBeenCalledWith(
      'ws1',
      25,
    )
  })

  it('counts only the conversations that were assigned and keeps going after a failure', async () => {
    queue('c1', 'c2', 'c3')
    conversations.findById
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(
        ok(
          createFakeWhatsAppConversationWithPreview({
            id: 'c3',
            workspaceId: 'ws1',
          }),
        ),
      )
      .mockResolvedValue(
        ok(
          createFakeWhatsAppConversationWithPreview({
            id: 'c3',
            workspaceId: 'ws1',
          }),
        ),
      )
    const result = expectOk(await WhatsAppDistributionService.drainQueue('ws1'))
    expect(result).toEqual({ assigned: 1, examined: 3 })
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.distribution.drain_item_failed',
      expect.objectContaining({ conversationId: 'c1' }),
    )
  })

  it('stops at the first conversation held by the business hours', async () => {
    settings({
      businessHoursEnabled: true,
      businessHoursDays: [1],
    })
    queue('c1', 'c2')
    conversation({})
    const result = expectOk(
      await WhatsAppDistributionService.drainQueue('ws1', { now: NOW }),
    )
    expect(result).toEqual({ assigned: 0, examined: 2 })
    expect(conversations.findById).toHaveBeenCalledTimes(1)
  })

  it('propagates read failures', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppDistributionService.drainQueue('ws1'))

    settings({})
    conversations.listAwaitingDistribution.mockResolvedValue(
      err(databaseError()),
    )
    expectErr(await WhatsAppDistributionService.drainQueue('ws1'))
  })
})

describe('WhatsAppDistributionService.drainEnabledWorkspaces()', () => {
  it('drains only workspaces with the module and tolerates a failing one', async () => {
    distribution.listEnabledWorkspaceIds.mockResolvedValue(
      ok(['wsA', 'wsB', 'wsC', 'wsD']),
    )
    moduleAccess.isEnabled.mockImplementation(async (workspaceId) =>
      workspaceId === 'wsD' ? err(databaseError()) : ok(workspaceId !== 'wsB'),
    )
    settingsRepo.findByWorkspace.mockImplementation(async (workspaceId) =>
      workspaceId === 'wsC'
        ? err(databaseError())
        : ok(
            createFakeWhatsAppSettings({
              workspaceId,
              distributionMode: 'ROUND_ROBIN',
            }),
          ),
    )
    conversations.listAwaitingDistribution.mockResolvedValue(
      ok([{ id: 'c1' }] as never),
    )
    conversations.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppConversationWithPreview({
          id: 'c1',
          workspaceId: 'wsA',
        }),
      ),
    )

    const result = expectOk(
      await WhatsAppDistributionService.drainEnabledWorkspaces(NOW),
    )
    // wsA drained (1 conversation); wsB has no module, wsD errored, wsC failed.
    expect(result).toEqual({ assigned: 1, workspaces: 2 })
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.distribution.tick_workspace_failed',
      expect.objectContaining({ workspaceId: 'wsC' }),
    )
  })

  it('propagates a failure listing the workspaces', async () => {
    distribution.listEnabledWorkspaceIds.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppDistributionService.drainEnabledWorkspaces())
  })

  it('defaults to the current time', async () => {
    distribution.listEnabledWorkspaceIds.mockResolvedValue(ok([]))
    expect(
      expectOk(await WhatsAppDistributionService.drainEnabledWorkspaces()),
    ).toEqual({ assigned: 0, workspaces: 0 })
  })
})
