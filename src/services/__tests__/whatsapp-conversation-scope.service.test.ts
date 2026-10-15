import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { WhatsAppRealtimeEvent } from '@/src/lib/whatsapp/realtime'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')

import { WhatsAppTeamSnapshotCache } from '@/src/cache/whatsapp-team.cache'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import {
  loadConversationForViewer,
  loadWhatsAppTeamSnapshot,
  openWhatsAppRealtimeViewer,
  resolveConversationScope,
  whatsAppTeamMemberIds,
} from '../whatsapp-conversation-scope.service'

const memberships = vi.mocked(MembershipRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const teams = vi.mocked(WhatsAppTeamRepository)
const cache = vi.mocked(WhatsAppTeamSnapshotCache)

const SNAPSHOT = [
  {
    id: 'sales',
    members: [
      { userId: 'lia', role: 'LEADER' as const },
      { userId: 'ana', role: 'AGENT' as const },
    ],
  },
]

beforeEach(() => {
  cache.get.mockResolvedValue(null)
  teams.listMembershipSnapshot.mockResolvedValue(ok(SNAPSHOT))
})

describe('loadWhatsAppTeamSnapshot()', () => {
  it('reads through the cache: miss loads and stores, hit skips the database', async () => {
    expect(expectOk(await loadWhatsAppTeamSnapshot('ws1'))).toEqual(SNAPSHOT)
    expect(cache.set).toHaveBeenCalledWith('ws1', SNAPSHOT)

    cache.get.mockResolvedValue(SNAPSHOT)
    teams.listMembershipSnapshot.mockClear()
    expectOk(await loadWhatsAppTeamSnapshot('ws1'))
    expect(teams.listMembershipSnapshot).not.toHaveBeenCalled()
  })

  it('does not cache a failure', async () => {
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expectErr(await loadWhatsAppTeamSnapshot('ws1'), 'DATABASE_ERROR')
    expect(cache.set).not.toHaveBeenCalled()
  })
})

describe('resolveConversationScope()', () => {
  it('builds the scope from the role and the snapshot', async () => {
    const scope = expectOk(
      await resolveConversationScope('ana', 'ws1', 'MEMBER'),
    )
    expect(scope).toMatchObject({ mode: 'SCOPED', memberTeamIds: ['sales'] })
  })
})

describe('loadConversationForViewer()', () => {
  it('returns a visible conversation with the scope', async () => {
    conversations.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppConversationWithPreview({
          id: 'c1',
          assignedUserId: 'ana',
        }),
      ),
    )
    const loaded = expectOk(
      await loadConversationForViewer(
        { userId: 'lia', role: 'MEMBER' },
        'ws1',
        'c1',
      ),
    )
    expect(loaded.conversation.id).toBe('c1')
    expect(loaded.scope.leadsTeamIds).toEqual(['sales'])
  })

  it('answers 404 for a hidden conversation, a missing one and propagates failures', async () => {
    conversations.findById.mockResolvedValue(
      ok(createFakeWhatsAppConversationWithPreview({ assignedUserId: 'zed' })),
    )
    expectErr(
      await loadConversationForViewer(
        { userId: 'ana', role: 'MEMBER' },
        'ws1',
        'c1',
      ),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    conversations.findById.mockResolvedValue(ok(null))
    expectErr(
      await loadConversationForViewer(
        { userId: 'ana', role: 'MEMBER' },
        'ws1',
        'c1',
      ),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    conversations.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await loadConversationForViewer(
        { userId: 'ana', role: 'MEMBER' },
        'ws1',
        'c1',
      ),
      'DATABASE_ERROR',
    )
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expectErr(
      await loadConversationForViewer(
        { userId: 'ana', role: 'MEMBER' },
        'ws1',
        'c1',
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('whatsAppTeamMemberIds()', () => {
  it('lists every member of the team, none for an unknown team or a failure', async () => {
    expect(await whatsAppTeamMemberIds('ws1', 'sales')).toEqual(['lia', 'ana'])
    expect(await whatsAppTeamMemberIds('ws1', 'nope')).toEqual([])
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expect(await whatsAppTeamMemberIds('ws1', 'sales')).toEqual([])
  })
})

describe('openWhatsAppRealtimeViewer()', () => {
  const message = (conversationId: string): WhatsAppRealtimeEvent => ({
    type: 'message.created',
    conversationId,
    message: { id: 'm1' } as WhatsAppMessageDTO,
  })

  it('refuses a non-member and propagates a scope failure', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await openWhatsAppRealtimeViewer('ana', 'ws1'), 'FORBIDDEN')

    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ userId: 'ana', role: 'MEMBER' })),
    )
    teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
    expectErr(await openWhatsAppRealtimeViewer('ana', 'ws1'), 'DATABASE_ERROR')
  })

  it('filters messages by the conversation looked up in the database', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ userId: 'ana', role: 'MEMBER' })),
    )
    conversations.listVisibilityTargets.mockImplementation(async (_ws, ids) =>
      ok(
        ids[0] === 'mine'
          ? [{ id: 'mine', assignedUserId: 'ana', teamId: null }]
          : [],
      ),
    )
    const filter = expectOk(await openWhatsAppRealtimeViewer('ana', 'ws1'))

    expect(await filter(message('mine'))).toEqual(message('mine'))
    expect(await filter(message('ghost'))).toBeNull()

    conversations.listVisibilityTargets.mockResolvedValue(err(databaseError()))
    expect(await filter(message('other'))).toBeNull()
  })

  it('re-reads the scope after the TTL: revoked, failed or refreshed', async () => {
    vi.useFakeTimers()
    try {
      memberships.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ userId: 'ana', role: 'MEMBER' })),
      )
      const filter = expectOk(await openWhatsAppRealtimeViewer('ana', 'ws1'))
      const update: WhatsAppRealtimeEvent = {
        type: 'conversation.updated',
        conversation: {
          id: 'c1',
          assignedUserId: 'ana',
          teamId: null,
        } as WhatsAppConversationDTO,
      }

      // Transient database failure: keeps the last scope.
      memberships.findByUserAndWorkspace.mockResolvedValue(err(databaseError()))
      vi.advanceTimersByTime(31_000)
      expect(await filter(update)).toEqual(update)

      // Scope failure on refresh: keeps the last scope too.
      memberships.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ userId: 'ana', role: 'MEMBER' })),
      )
      teams.listMembershipSnapshot.mockResolvedValue(err(databaseError()))
      vi.advanceTimersByTime(31_000)
      expect(await filter(update)).toEqual(update)

      // Refreshed: now the owner.
      teams.listMembershipSnapshot.mockResolvedValue(ok(SNAPSHOT))
      memberships.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ userId: 'ana', role: 'OWNER' })),
      )
      vi.advanceTimersByTime(31_000)
      expect(await filter(message('any'))).toEqual(message('any'))

      // Removed from the workspace: nothing else goes through.
      memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
      vi.advanceTimersByTime(31_000)
      expect(await filter(update)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
