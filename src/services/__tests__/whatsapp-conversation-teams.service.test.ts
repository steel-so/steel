import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppTeam } from '@/src/__tests__/factories/whatsapp-team.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { SearchDocumentHit } from '@/src/lib/search/search-document'

/**
 * Equipes authz matrix across every service that exposes a Comunicação
 * conversation: owner / admin outside a team / admin inside a team /
 * leader / agent / member without a team.
 */

// Fire-and-forget webhook: the real emitter would outlive the test.
vi.mock('@/src/services/whatsapp-conversation-waiting', () => ({
  emitWhatsAppConversationWaiting: vi.fn(),
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-phone-call.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-usage.service', () => ({
  WhatsAppUsageService: {
    assertCanSend: vi.fn(async () => ({ ok: true, value: undefined })),
    record: vi.fn(async () => undefined),
  },
}))
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-notify')>()),
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { SearchService } from '../search.service'
import { WhatsAppConversationService } from '../whatsapp-conversation.service'
import { WhatsAppMessageService } from '../whatsapp-message.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'
import { WhatsAppPhoneCallService } from '../whatsapp-phone-call.service'

const memberships = vi.mocked(MembershipRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const events = vi.mocked(WhatsAppConversationEventRepository)
const teams = vi.mocked(WhatsAppTeamRepository)
const users = vi.mocked(UserRepository)
const notify = vi.mocked(notifyWhatsAppUsers)

const ROLES: Record<string, Role> = {
  own: 'OWNER',
  admOut: 'ADMIN',
  admIn: 'ADMIN',
  lia: 'MEMBER',
  ana: 'MEMBER',
  bia: 'MEMBER',
  zed: 'MEMBER',
}

// sales: leader lia, agent ana · support: agents bia and admIn.
const SNAPSHOT = [
  {
    id: 'sales',
    members: [
      { userId: 'lia', role: 'LEADER' as const },
      { userId: 'ana', role: 'AGENT' as const },
    ],
  },
  {
    id: 'support',
    members: [
      { userId: 'bia', role: 'AGENT' as const },
      { userId: 'admIn', role: 'AGENT' as const },
    ],
  },
]

type Overrides = Parameters<typeof createFakeWhatsAppConversationWithPreview>[0]

function conversation(overrides: Overrides = {}) {
  const value = createFakeWhatsAppConversationWithPreview({
    id: 'conv1',
    workspaceId: 'ws1',
    ...overrides,
  })
  conversations.findById.mockResolvedValue(ok(value))
  conversations.update.mockResolvedValue(ok(value))
  return value
}

beforeEach(() => {
  memberships.findByUserAndWorkspace.mockImplementation(async (userId) =>
    ok(
      ROLES[userId]
        ? createFakeMembership({
            userId,
            workspaceId: 'ws1',
            role: ROLES[userId],
          })
        : null,
    ),
  )
  teams.listMembershipSnapshot.mockResolvedValue(ok(SNAPSHOT))
  teams.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppTeam({
        id: 'sales',
        workspaceId: 'ws1',
        name: 'Vendas',
      }),
    ),
  )
  conversations.listByWorkspace.mockResolvedValue(ok([]))
  events.create.mockResolvedValue(
    ok({
      id: 'ev1',
      workspaceId: 'ws1',
      conversationId: 'conv1',
      kind: 'ASSIGNED',
      source: 'AGENT',
      actorUserId: 'x',
      reason: null,
      closeOutcome: null,
      closeStatusLabels: [],
      createdAt: new Date(),
    }),
  )
  events.listByConversation.mockResolvedValue(ok([]))
  users.findById.mockImplementation(async (id) =>
    ok({ id, name: `Nome ${id}` } as never),
  )
})

describe('list() — what each role asks the repository for', () => {
  it.each([
    ['own', undefined],
    ['admOut', undefined],
  ])('%s lists every conversation', async (actor, expected) => {
    expectOk(await WhatsAppConversationService.list(actor, 'ws1'))
    expect(conversations.listByWorkspace).toHaveBeenCalledWith(
      'ws1',
      {},
      expected,
    )
  })

  it.each([
    [
      'admIn',
      { leadsTeamIds: [], memberTeamIds: ['support'], ledAgentIds: [] },
    ],
    [
      'lia',
      {
        leadsTeamIds: ['sales'],
        memberTeamIds: ['sales'],
        ledAgentIds: ['ana'],
      },
    ],
    ['ana', { leadsTeamIds: [], memberTeamIds: ['sales'], ledAgentIds: [] }],
    ['zed', { leadsTeamIds: [], memberTeamIds: [], ledAgentIds: [] }],
  ])('%s is scoped', async (actor, expected) => {
    expectOk(await WhatsAppConversationService.list(actor, 'ws1'))
    expect(conversations.listByWorkspace).toHaveBeenCalledWith(
      'ws1',
      {},
      {
        userId: actor,
        ...expected,
      },
    )
  })

  it('propagates a team snapshot failure', async () => {
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppConversationService.list('ana', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('get() / listEvents() / mutations — a hidden conversation is a 404', () => {
  const bias = { assignedUserId: 'bia', teamId: 'support' }

  it.each([
    ['own', true],
    ['admOut', true],
    ['admIn', false],
    ['lia', false],
    ['ana', false],
    ['zed', false],
    ['bia', true],
  ])('%s sees a support agent conversation → %s', async (actor, visible) => {
    conversation(bias)
    const result = await WhatsAppConversationService.get(actor, 'ws1', 'conv1')
    if (visible) expectOk(result)
    else expectErr(result, 'WHATSAPP_CONVERSATION_NOT_FOUND')
  })

  it('does not read the timeline of a hidden conversation', async () => {
    conversation(bias)
    expectErr(
      await WhatsAppConversationService.listEvents('ana', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expect(events.listByConversation).not.toHaveBeenCalled()
  })

  it.each([
    [
      'markRead',
      () => WhatsAppConversationService.markRead('ana', 'ws1', 'conv1'),
    ],
    [
      'setPinned',
      () => WhatsAppConversationService.setPinned('ana', 'ws1', 'conv1', true),
    ],
    [
      'setArchived',
      () =>
        WhatsAppConversationService.setArchived('ana', 'ws1', 'conv1', true),
    ],
    [
      'removeFromAi',
      () => WhatsAppConversationService.removeFromAi('ana', 'ws1', 'conv1'),
    ],
    [
      'resumeAi',
      () => WhatsAppConversationService.resumeAi('ana', 'ws1', 'conv1'),
    ],
    [
      'close',
      () => WhatsAppConversationService.close('ana', 'ws1', 'conv1', {}),
    ],
    ['reopen', () => WhatsAppConversationService.reopen('ana', 'ws1', 'conv1')],
  ])('%s refuses a hidden conversation without writing', async (_name, run) => {
    conversation({ ...bias, unreadCount: 3, status: 'CLOSED' })
    expectErr(await run(), 'WHATSAPP_CONVERSATION_NOT_FOUND')
    expect(conversations.update).not.toHaveBeenCalled()
  })

  it('lets admins delete/clear only what they see', async () => {
    conversation(bias)
    expectErr(
      await WhatsAppConversationService.remove('admIn', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expectErr(
      await WhatsAppConversationService.clear('admIn', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expectOk(await WhatsAppConversationService.remove('admOut', 'ws1', 'conv1'))
  })
})

describe('start()', () => {
  beforeEach(() => {
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(
      ok(createFakeWhatsAppContact({ id: 'contact1' })),
    )
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1' })),
    )
  })

  it('refuses to reveal a contact conversation served by someone hidden', async () => {
    conversations.findActiveByContact.mockResolvedValue(
      ok(conversation({ assignedUserId: 'bia', teamId: 'support' })),
    )
    const error = expectErr(
      await WhatsAppConversationService.start('ana', 'ws1', {
        contactId: 'contact1',
        connectionId: 'conn1',
      }),
      'FORBIDDEN',
    )
    expect(error.message).toBe(
      'Este contato já está em atendimento com outra pessoa',
    )
  })

  it('returns the active conversation the actor can see', async () => {
    conversations.findActiveByContact.mockResolvedValue(
      ok(conversation({ assignedUserId: 'ana' })),
    )
    expectOk(
      await WhatsAppConversationService.start('ana', 'ws1', {
        contactId: 'contact1',
        connectionId: 'conn1',
      }),
    )
    expect(conversations.create).not.toHaveBeenCalled()
  })

  it('propagates a scope failure', async () => {
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppConversationService.start('ana', 'ws1', {
        contactId: 'contact1',
        connectionId: 'conn1',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('assign()', () => {
  it('lets an agent take a queue item of their team', async () => {
    conversation({ assignedUserId: null, teamId: 'sales' })
    expectOk(
      await WhatsAppConversationService.assign('ana', 'ws1', 'conv1', 'ana'),
    )
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      assignedUserId: 'ana',
      status: 'IN_PROGRESS',
    })
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ASSIGNED',
        source: 'AGENT',
        actorUserId: 'ana',
        reason: 'Nome ana',
      }),
    )
  })

  it('lets an agent hand their conversation back to the queue', async () => {
    conversation({ assignedUserId: 'ana', status: 'IN_PROGRESS' })
    expectOk(
      await WhatsAppConversationService.assign('ana', 'ws1', 'conv1', null),
    )
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      assignedUserId: null,
      status: 'NEW',
    })
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ASSIGNED', reason: null }),
    )
  })

  it('forbids an agent from assigning someone else', async () => {
    conversation({ assignedUserId: null, teamId: 'sales' })
    expectErr(
      await WhatsAppConversationService.assign('ana', 'ws1', 'conv1', 'lia'),
      'FORBIDDEN',
    )
    expect(conversations.update).not.toHaveBeenCalled()
  })

  it('lets a leader assign a team conversation to their agent', async () => {
    conversation({ assignedUserId: null, teamId: 'sales' })
    expectOk(
      await WhatsAppConversationService.assign('lia', 'ws1', 'conv1', 'ana'),
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['ana'], actorId: 'lia' }),
    )
  })

  it('forbids a leader from assigning outside their teams', async () => {
    conversation({ assignedUserId: 'ana', teamId: 'sales' })
    expectErr(
      await WhatsAppConversationService.assign('lia', 'ws1', 'conv1', 'bia'),
      'FORBIDDEN',
    )
  })

  it('keeps a closed conversation closed and skips the event when nothing changed', async () => {
    conversation({ assignedUserId: 'ana', status: 'CLOSED' })
    expectOk(
      await WhatsAppConversationService.assign('own', 'ws1', 'conv1', 'ana'),
    )
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      assignedUserId: 'ana',
      status: 'CLOSED',
    })
    expect(events.create).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('records the event without a name when the user cannot be read', async () => {
    conversation({ assignedUserId: null })
    users.findById.mockResolvedValueOnce(err(databaseError()))
    expectOk(
      await WhatsAppConversationService.assign('own', 'ws1', 'conv1', 'ana'),
    )
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason: null }),
    )
  })

  it('propagates an event failure', async () => {
    conversation({ assignedUserId: null })
    events.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppConversationService.assign('own', 'ws1', 'conv1', 'ana'),
      'DATABASE_ERROR',
    )
  })
})

describe('setTeam()', () => {
  it('moves an unassigned conversation to a team and tells its members', async () => {
    conversation({ assignedUserId: null, teamId: null })
    expectOk(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', 'sales'),
    )
    expect(conversations.update).toHaveBeenCalledWith('conv1', {
      teamId: 'sales',
    })
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'TEAM_CHANGED',
        actorUserId: 'own',
        reason: 'Vendas',
      }),
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
        userIds: ['lia', 'ana'],
        actorId: 'own',
        title: 'Nova conversa na fila da equipe Vendas',
      }),
    )
  })

  it('does not notify when the conversation has an assignee or leaves its team', async () => {
    conversation({ assignedUserId: 'ana', teamId: null })
    expectOk(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', 'sales'),
    )
    conversation({ assignedUserId: null, teamId: 'sales' })
    expectOk(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', null),
    )
    expect(events.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'TEAM_CHANGED', reason: null }),
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('is a no-op when the team does not change', async () => {
    conversation({ teamId: 'sales' })
    expectOk(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', 'sales'),
    )
    expect(conversations.update).not.toHaveBeenCalled()
  })

  it('lets a leader move between no team and the teams they lead', async () => {
    conversation({ assignedUserId: null, teamId: null })
    expectOk(
      await WhatsAppConversationService.setTeam('lia', 'ws1', 'conv1', 'sales'),
    )
  })

  it('forbids agents and leaders outside their teams', async () => {
    conversation({ assignedUserId: 'ana', teamId: null })
    expectErr(
      await WhatsAppConversationService.setTeam('ana', 'ws1', 'conv1', 'sales'),
      'FORBIDDEN',
    )
    teams.findById.mockResolvedValue(
      ok(createFakeWhatsAppTeam({ id: 'support', name: 'Suporte' })),
    )
    conversation({ assignedUserId: null, teamId: 'sales' })
    expectErr(
      await WhatsAppConversationService.setTeam(
        'lia',
        'ws1',
        'conv1',
        'support',
      ),
      'FORBIDDEN',
    )
  })

  it('answers WHATSAPP_TEAM_NOT_FOUND / propagates failures', async () => {
    conversation({ teamId: null })
    teams.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', 'nope'),
      'WHATSAPP_TEAM_NOT_FOUND',
    )
    teams.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', 'x'),
      'DATABASE_ERROR',
    )
    conversations.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', 'sales'),
      'DATABASE_ERROR',
    )
    events.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', 'sales'),
      'DATABASE_ERROR',
    )
  })

  it('propagates a failure re-reading the conversation', async () => {
    const value = conversation({ teamId: null })
    conversations.findById
      .mockResolvedValueOnce(ok(value))
      .mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppConversationService.setTeam('own', 'ws1', 'conv1', 'sales'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('hides a conversation the actor cannot see', async () => {
    conversation({ assignedUserId: 'bia', teamId: 'support' })
    expectErr(
      await WhatsAppConversationService.setTeam('lia', 'ws1', 'conv1', 'sales'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })
})

describe('messages and phone calls follow the same rule', () => {
  it('does not list or send messages in a hidden conversation', async () => {
    conversation({ assignedUserId: 'bia', teamId: 'support' })
    expectErr(
      await WhatsAppMessageService.list('ana', 'ws1', 'conv1', { limit: 50 }),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expectErr(
      await WhatsAppMessageService.sendText('ana', 'ws1', 'conv1', {
        text: 'oi',
      }),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expect(WhatsAppMessageRepository.listByConversation).not.toHaveBeenCalled()
    expect(WhatsAppSend.text).not.toHaveBeenCalled()
  })

  it('propagates a scope failure in the message service', async () => {
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppMessageService.list('ana', 'ws1', 'conv1', { limit: 50 }),
      'DATABASE_ERROR',
    )
  })

  it('does not read or place calls of a hidden conversation', async () => {
    conversation({ assignedUserId: 'bia', teamId: 'support' })
    expectErr(
      await WhatsAppPhoneCallService.latest('ana', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expectErr(
      await WhatsAppPhoneCallService.start('ana', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expect(
      WhatsAppPhoneCallRepository.findLatestByConversation,
    ).not.toHaveBeenCalled()
  })

  it('reads the latest call of a visible conversation', async () => {
    conversation({ assignedUserId: 'ana' })
    vi.mocked(
      WhatsAppPhoneCallRepository.findLatestByConversation,
    ).mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppPhoneCallService.latest('ana', 'ws1', 'conv1')),
    ).toBeNull()
  })
})

describe('SearchService.dropUnviewableConversations()', () => {
  const hit = (entityType: string, entityId: string) =>
    ({ entityType, entityId }) as SearchDocumentHit
  const hits = [
    hit('zap-conversation', 'mine'),
    hit('zap-conversation', 'theirs'),
    hit('crm-lead', 'lead1'),
  ]

  beforeEach(() => {
    conversations.listVisibilityTargets.mockResolvedValue(
      ok([
        { id: 'mine', assignedUserId: 'ana', teamId: null },
        { id: 'theirs', assignedUserId: 'bia', teamId: 'support' },
      ]),
    )
  })

  it('keeps only the conversations a scoped viewer can open', async () => {
    const kept = expectOk(
      await SearchService.dropUnviewableConversations(
        'ana',
        'ws1',
        'MEMBER',
        hits,
      ),
    )
    expect(kept.map((h) => h.entityId)).toEqual(['mine', 'lead1'])
  })

  it('keeps everything for the owner and when no conversation matched', async () => {
    expect(
      expectOk(
        await SearchService.dropUnviewableConversations(
          'own',
          'ws1',
          'OWNER',
          hits,
        ),
      ),
    ).toHaveLength(3)
    const leads = [hit('crm-lead', 'l')]
    expect(
      expectOk(
        await SearchService.dropUnviewableConversations(
          'ana',
          'ws1',
          'MEMBER',
          leads,
        ),
      ),
    ).toBe(leads)
    expect(conversations.listVisibilityTargets).not.toHaveBeenCalled()
  })

  it('propagates failures', async () => {
    conversations.listVisibilityTargets.mockResolvedValue(err(databaseError()))
    expectErr(
      await SearchService.dropUnviewableConversations(
        'ana',
        'ws1',
        'MEMBER',
        hits,
      ),
      'DATABASE_ERROR',
    )
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expectErr(
      await SearchService.dropUnviewableConversations(
        'ana',
        'ws1',
        'MEMBER',
        hits,
      ),
      'DATABASE_ERROR',
    )
  })
})
