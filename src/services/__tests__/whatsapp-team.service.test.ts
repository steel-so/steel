import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppTeam } from '@/src/__tests__/factories/whatsapp-team.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, whatsappTeamConflict } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/services/whatsapp-distribution.service', () => ({
  WhatsAppDistributionService: { distributeConversation: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-unassigned-alert.service', () => ({
  WhatsAppUnassignedAlertService: { notifySupervisors: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-notify')>()),
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { WhatsAppTeamSnapshotCache } from '@/src/cache/whatsapp-team.cache'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WhatsAppDistributionService } from '../whatsapp-distribution.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'
import { WhatsAppTeamService } from '../whatsapp-team.service'
import { WhatsAppUnassignedAlertService } from '../whatsapp-unassigned-alert.service'

const memberships = vi.mocked(MembershipRepository)
const teams = vi.mocked(WhatsAppTeamRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const cache = vi.mocked(WhatsAppTeamSnapshotCache)
const notify = vi.mocked(notifyWhatsAppUsers)

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ userId: 'actor', workspaceId: 'ws1', role })),
  )
}

function workspaceMembers(...userIds: string[]) {
  memberships.listWithUserByWorkspace.mockResolvedValue(
    ok(
      userIds.map((userId) => ({
        ...createFakeMembership({ userId, workspaceId: 'ws1' }),
        user: { id: userId, name: userId, email: `${userId}@x`, image: null },
      })),
    ),
  )
}

const TEAM = createFakeWhatsAppTeam({
  id: 'team1',
  workspaceId: 'ws1',
  name: 'Vendas',
  members: [
    { userId: 'ana', role: 'AGENT', name: 'Ana' },
    { userId: 'lia', role: 'LEADER', name: 'Lia' },
  ],
})

beforeEach(() => {
  teams.listByWorkspace.mockResolvedValue(ok([TEAM]))
  teams.findById.mockResolvedValue(ok(TEAM))
  teams.create.mockResolvedValue(ok(TEAM))
  teams.update.mockResolvedValue(ok(TEAM))
  teams.delete.mockResolvedValue(ok(undefined))
  teams.listMembershipSnapshot.mockResolvedValue(
    ok([
      {
        id: 'team1',
        members: [
          { userId: 'ana', role: 'AGENT' },
          { userId: 'lia', role: 'LEADER' },
        ],
      },
    ]),
  )
  cache.get.mockResolvedValue(null)
  workspaceMembers('ana', 'lia', 'actor')
})

describe('WhatsAppTeamService.list() / get()', () => {
  it('lets any module member read the teams, leaders first', async () => {
    asRole('MEMBER')
    const [team] = expectOk(await WhatsAppTeamService.list('actor', 'ws1'))
    expect(team.members.map((m) => m.role)).toEqual(['LEADER', 'AGENT'])
  })

  it('refuses a non-member', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await WhatsAppTeamService.list('actor', 'ws1'), 'FORBIDDEN')
    expectErr(
      await WhatsAppTeamService.get('actor', 'ws1', 'team1'),
      'FORBIDDEN',
    )
  })

  it('propagates a repository failure on list', async () => {
    asRole('MEMBER')
    teams.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppTeamService.list('actor', 'ws1'), 'DATABASE_ERROR')
  })

  it('gets one team, or WHATSAPP_TEAM_NOT_FOUND', async () => {
    asRole('MEMBER')
    expect(
      expectOk(await WhatsAppTeamService.get('actor', 'ws1', 'team1')).name,
    ).toBe('Vendas')

    teams.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppTeamService.get('actor', 'ws1', 'other'),
      'WHATSAPP_TEAM_NOT_FOUND',
    )
    teams.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppTeamService.get('actor', 'ws1', 'other'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppTeamService.me()', () => {
  it('reports ALL for the owner', async () => {
    asRole('OWNER')
    expect(expectOk(await WhatsAppTeamService.me('actor', 'ws1'))).toEqual({
      mode: 'ALL',
      leadsTeamIds: [],
      memberTeamIds: [],
    })
  })

  it('reports the teams a scoped leader leads, from the cache when warm', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ userId: 'lia', role: 'MEMBER' })),
    )
    cache.get.mockResolvedValue([
      { id: 'team1', members: [{ userId: 'lia', role: 'LEADER' }] },
    ])
    expect(expectOk(await WhatsAppTeamService.me('lia', 'ws1'))).toEqual({
      mode: 'SCOPED',
      leadsTeamIds: ['team1'],
      memberTeamIds: ['team1'],
    })
    expect(teams.listMembershipSnapshot).not.toHaveBeenCalled()
  })

  it('refuses a non-member and propagates a snapshot failure', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await WhatsAppTeamService.me('actor', 'ws1'), 'FORBIDDEN')

    asRole('MEMBER')
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppTeamService.me('actor', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('WhatsAppTeamService.create()', () => {
  const input = {
    name: 'Vendas',
    members: [
      { userId: 'ana', role: 'AGENT' as const },
      { userId: 'lia', role: 'LEADER' as const },
    ],
  }

  it('creates as admin, drops the cached snapshot and audits', async () => {
    asRole('ADMIN')
    const team = expectOk(
      await WhatsAppTeamService.create('actor', 'ws1', input),
    )
    expect(team.id).toBe('team1')
    expect(teams.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      name: 'Vendas',
      description: null,
      members: input.members,
    })
    expect(cache.invalidate).toHaveBeenCalledWith('ws1')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'whatsapp_team', action: 'create' }),
    )
  })

  it('creates an empty team without listing members', async () => {
    asRole('OWNER')
    expectOk(
      await WhatsAppTeamService.create('actor', 'ws1', {
        name: 'Suporte',
        description: 'N1',
        members: [],
      }),
    )
    expect(memberships.listWithUserByWorkspace).not.toHaveBeenCalled()
  })

  it('forbids members — leaders included — from managing teams', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppTeamService.create('actor', 'ws1', input),
      'FORBIDDEN',
    )
    expect(teams.create).not.toHaveBeenCalled()
  })

  it('rejects a repeated member and a user outside the workspace', async () => {
    asRole('ADMIN')
    expectErr(
      await WhatsAppTeamService.create('actor', 'ws1', {
        name: 'X',
        members: [
          { userId: 'ana', role: 'AGENT' },
          { userId: 'ana', role: 'LEADER' },
        ],
      }),
      'VALIDATION_ERROR',
    )
    expectErr(
      await WhatsAppTeamService.create('actor', 'ws1', {
        name: 'X',
        members: [{ userId: 'stranger', role: 'AGENT' }],
      }),
      'BAD_REQUEST',
    )
    memberships.listWithUserByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppTeamService.create('actor', 'ws1', input),
      'DATABASE_ERROR',
    )
    expect(teams.create).not.toHaveBeenCalled()
  })

  it('surfaces a duplicate name', async () => {
    asRole('ADMIN')
    teams.create.mockResolvedValue(err(whatsappTeamConflict()))
    expectErr(
      await WhatsAppTeamService.create('actor', 'ws1', input),
      'WHATSAPP_TEAM_CONFLICT',
    )
    expect(cache.invalidate).not.toHaveBeenCalled()
  })
})

describe('WhatsAppTeamService.update()', () => {
  it('replaces the members when given and invalidates the snapshot', async () => {
    asRole('ADMIN')
    expectOk(
      await WhatsAppTeamService.update('actor', 'ws1', 'team1', {
        name: 'Vendas B2B',
        members: [{ userId: 'lia', role: 'LEADER' }],
      }),
    )
    expect(teams.update).toHaveBeenCalledWith('team1', {
      name: 'Vendas B2B',
      description: undefined,
      members: [{ userId: 'lia', role: 'LEADER' }],
    })
    expect(cache.invalidate).toHaveBeenCalledWith('ws1')
  })

  it('keeps the members when not sent', async () => {
    asRole('ADMIN')
    expectOk(
      await WhatsAppTeamService.update('actor', 'ws1', 'team1', {
        description: null,
      }),
    )
    expect(teams.update).toHaveBeenCalledWith('team1', {
      name: undefined,
      description: null,
      members: undefined,
    })
  })

  it('refuses members, unknown teams, invalid members and failures', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppTeamService.update('actor', 'ws1', 'team1', { name: 'X' }),
      'FORBIDDEN',
    )

    asRole('ADMIN')
    teams.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppTeamService.update('actor', 'ws1', 'nope', { name: 'X' }),
      'WHATSAPP_TEAM_NOT_FOUND',
    )
    teams.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppTeamService.update('actor', 'ws1', 'team1', { name: 'X' }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppTeamService.update('actor', 'ws1', 'team1', {
        members: [{ userId: 'stranger', role: 'AGENT' }],
      }),
      'BAD_REQUEST',
    )
    teams.update.mockResolvedValueOnce(err(whatsappTeamConflict()))
    expectErr(
      await WhatsAppTeamService.update('actor', 'ws1', 'team1', { name: 'X' }),
      'WHATSAPP_TEAM_CONFLICT',
    )
  })
})

describe('WhatsAppTeamService.remove()', () => {
  it('deletes as owner and invalidates the snapshot', async () => {
    asRole('OWNER')
    expect(
      expectOk(await WhatsAppTeamService.remove('actor', 'ws1', 'team1')),
    ).toEqual({ id: 'team1' })
    expect(teams.delete).toHaveBeenCalledWith('team1')
    expect(cache.invalidate).toHaveBeenCalledWith('ws1')
  })

  it('refuses members, unknown teams and failures', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppTeamService.remove('actor', 'ws1', 'team1'),
      'FORBIDDEN',
    )
    asRole('ADMIN')
    teams.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppTeamService.remove('actor', 'ws1', 'team1'),
      'WHATSAPP_TEAM_NOT_FOUND',
    )
    teams.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppTeamService.remove('actor', 'ws1', 'team1'),
      'DATABASE_ERROR',
    )
    teams.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppTeamService.remove('actor', 'ws1', 'team1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppTeamService.notifyQueueOnInbound()', () => {
  const distribute = vi.mocked(
    WhatsAppDistributionService.distributeConversation,
  )
  const alertSupervisors = vi.mocked(
    WhatsAppUnassignedAlertService.notifySupervisors,
  )
  const settings = vi.mocked(WhatsAppSettingsRepository)

  beforeEach(() => {
    settings.findByWorkspace.mockResolvedValue(ok(null))
    distribute.mockResolvedValue(
      ok({ assigned: false, reason: 'disabled' as const }),
    )
    alertSupervisors.mockResolvedValue({ recipients: 1, inApp: 1, email: 0 })
  })

  function arrange(
    overrides: Parameters<typeof createFakeWhatsAppConversationWithPreview>[0],
  ) {
    conversations.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppConversationWithPreview({
          id: 'conv1',
          teamId: 'team1',
          team: { id: 'team1', name: 'Vendas' },
          assignedUserId: null,
          unreadCount: 1,
          ...overrides,
        }),
      ),
    )
  }

  it('tells the team about the first unread message of its queue', async () => {
    arrange({})
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
        userIds: ['ana', 'lia'],
        title: 'Nova mensagem na fila da equipe Vendas',
        path: '/zap?conversa=conv1',
      }),
    )
    // The team has people to tell: supervisors only hear when nobody can take it.
    expect(alertSupervisors).not.toHaveBeenCalled()
  })

  it('falls back to a generic title when the team name is not loaded', async () => {
    arrange({ team: null })
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    expect(notify.mock.calls[0][0].title).toBe(
      'Nova mensagem na fila da equipe',
    )
  })

  it('tells the supervisors about a conversation with no team and no assignee', async () => {
    arrange({ teamId: null, team: null })
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    expect(notify).not.toHaveBeenCalled()
    expect(alertSupervisors).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        notice: { kind: 'queued', reason: 'no_team' },
      }),
    )
  })

  it.each([
    'empty_pool',
    'nobody_available',
    'all_at_capacity',
    'outside_business_hours',
  ] as const)(
    'also tells the supervisors when distribution found nobody (%s)',
    async (reason) => {
      arrange({})
      distribute.mockResolvedValue(ok({ assigned: false, reason }))
      await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
      expect(notify).toHaveBeenCalledTimes(1)
      expect(alertSupervisors).toHaveBeenCalledWith(
        expect.objectContaining({
          notice: { kind: 'queued', reason: 'no_agent_available' },
        }),
      )
    },
  )

  it('stays quiet when the distribution gave the conversation to an agent', async () => {
    arrange({})
    distribute.mockResolvedValue(ok({ assigned: true, userId: 'ana' }))
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    expect(notify).not.toHaveBeenCalled()
    expect(alertSupervisors).not.toHaveBeenCalled()
  })

  it('retries the distribution on every message but notifies once per unread streak', async () => {
    arrange({ unreadCount: 3, teamId: null, team: null })
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    expect(distribute).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
    expect(alertSupervisors).not.toHaveBeenCalled()
  })

  it('does not treat a failed distribution as "nobody available"', async () => {
    arrange({})
    distribute.mockResolvedValue(err(databaseError()))
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(alertSupervisors).not.toHaveBeenCalled()
  })

  it.each([
    ['already assigned', { assignedUserId: 'ana' }],
    ['AI answering', { aiActive: true }],
    ['closed', { status: 'CLOSED' as const }],
    ['archived', { archivedAt: new Date() }],
    ['deleted', { deletedAt: new Date() }],
  ])('stays quiet when %s', async (_label, overrides) => {
    arrange(overrides)
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    expect(notify).not.toHaveBeenCalled()
    expect(alertSupervisors).not.toHaveBeenCalled()
    expect(distribute).not.toHaveBeenCalled()
  })

  it('stays quiet when the conversation or the settings cannot be read', async () => {
    conversations.findById.mockResolvedValue(ok(null))
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    conversations.findById.mockResolvedValue(err(databaseError()))
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    arrange({})
    settings.findByWorkspace.mockResolvedValue(err(databaseError()))
    await WhatsAppTeamService.notifyQueueOnInbound('ws1', 'conv1')
    expect(notify).not.toHaveBeenCalled()
    expect(distribute).not.toHaveBeenCalled()
  })
})
