import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppAgentPresence } from '@/src/__tests__/factories/whatsapp-agent-presence.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-agent-presence.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/services/whatsapp-conversation-scope.service', () => ({
  loadWhatsAppTeamSnapshot: vi.fn(),
  resolveConversationScope: vi.fn(),
}))
vi.mock('@/src/services/whatsapp-distribution.service', () => ({
  WhatsAppDistributionService: { drainQueue: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppAgentPresenceRepository } from '@/src/repositories/whatsapp-agent-presence.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  loadWhatsAppTeamSnapshot,
  resolveConversationScope,
} from '../whatsapp-conversation-scope.service'
import { WhatsAppDistributionService } from '../whatsapp-distribution.service'
import { WhatsAppPresenceService } from '../whatsapp-presence.service'

const memberships = vi.mocked(MembershipRepository)
const presence = vi.mocked(WhatsAppAgentPresenceRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const scope = vi.mocked(resolveConversationScope)
const snapshot = vi.mocked(loadWhatsAppTeamSnapshot)
const drain = vi.mocked(WhatsAppDistributionService.drainQueue)

function actingAs(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ userId: 'u1', workspaceId: 'ws1', role })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  actingAs('MEMBER')
  drain.mockResolvedValue(ok({ assigned: 0, examined: 0 }))
})

describe('WhatsAppPresenceService.getMine()', () => {
  it('is available by default', async () => {
    presence.find.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppPresenceService.getMine('u1', 'ws1')),
    ).toEqual({
      userId: 'u1',
      status: 'AVAILABLE',
      updatedAt: null,
    })
  })

  it('returns the saved status', async () => {
    const row = createFakeWhatsAppAgentPresence({
      userId: 'u1',
      status: 'AWAY',
    })
    presence.find.mockResolvedValue(ok(row))
    expect(
      expectOk(await WhatsAppPresenceService.getMine('u1', 'ws1')),
    ).toEqual({
      userId: 'u1',
      status: 'AWAY',
      updatedAt: row.updatedAt.toISOString(),
    })
  })

  it('refuses a non-member and a disabled module', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await WhatsAppPresenceService.getMine('u1', 'ws1'), 'FORBIDDEN')

    actingAs('MEMBER')
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(
      await WhatsAppPresenceService.getMine('u1', 'ws1'),
      'MODULE_DISABLED',
    )
  })

  it('propagates a database failure', async () => {
    presence.find.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppPresenceService.getMine('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppPresenceService.setMine()', () => {
  it('saves the status and audits it', async () => {
    presence.find.mockResolvedValue(ok(null))
    presence.setStatus.mockResolvedValue(
      ok(createFakeWhatsAppAgentPresence({ userId: 'u1', status: 'AWAY' })),
    )
    const result = expectOk(
      await WhatsAppPresenceService.setMine('u1', 'ws1', 'AWAY'),
    )
    expect(result.status).toBe('AWAY')
    expect(presence.setStatus).toHaveBeenCalledWith('ws1', 'u1', 'AWAY')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_agent_presence',
        actorId: 'u1',
        meta: { workspaceId: 'ws1', status: 'AWAY' },
      }),
    )
    expect(drain).not.toHaveBeenCalled()
  })

  it('drains the queue when an absent agent comes back', async () => {
    presence.find.mockResolvedValue(
      ok(createFakeWhatsAppAgentPresence({ userId: 'u1', status: 'AWAY' })),
    )
    presence.setStatus.mockResolvedValue(
      ok(
        createFakeWhatsAppAgentPresence({ userId: 'u1', status: 'AVAILABLE' }),
      ),
    )
    expectOk(await WhatsAppPresenceService.setMine('u1', 'ws1', 'AVAILABLE'))
    expect(drain).toHaveBeenCalledWith('ws1')
  })

  it('does not drain when the agent was already available', async () => {
    presence.find.mockResolvedValue(
      ok(
        createFakeWhatsAppAgentPresence({ userId: 'u1', status: 'AVAILABLE' }),
      ),
    )
    presence.setStatus.mockResolvedValue(
      ok(
        createFakeWhatsAppAgentPresence({ userId: 'u1', status: 'AVAILABLE' }),
      ),
    )
    expectOk(await WhatsAppPresenceService.setMine('u1', 'ws1', 'AVAILABLE'))
    expect(drain).not.toHaveBeenCalled()
  })

  it('answers even when the background drain fails', async () => {
    presence.find.mockResolvedValue(
      ok(createFakeWhatsAppAgentPresence({ userId: 'u1', status: 'AWAY' })),
    )
    presence.setStatus.mockResolvedValue(
      ok(
        createFakeWhatsAppAgentPresence({ userId: 'u1', status: 'AVAILABLE' }),
      ),
    )
    drain.mockResolvedValue(err(databaseError()))
    expectOk(await WhatsAppPresenceService.setMine('u1', 'ws1', 'AVAILABLE'))
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp.presence.drain_failed',
        expect.objectContaining({ workspaceId: 'ws1' }),
      ),
    )
  })

  it('refuses a viewer (no conversations:EDIT)', async () => {
    actingAs('VIEWER')
    expectErr(
      await WhatsAppPresenceService.setMine('u1', 'ws1', 'AWAY'),
      'FORBIDDEN',
    )
    expect(presence.setStatus).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    presence.find.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppPresenceService.setMine('u1', 'ws1', 'AWAY'),
      'DATABASE_ERROR',
    )

    presence.find.mockResolvedValue(ok(null))
    presence.setStatus.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppPresenceService.setMine('u1', 'ws1', 'AWAY'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppPresenceService.listTeamMembers()', () => {
  const TEAMS = [
    {
      id: 'sales',
      members: [
        { userId: 'lia', role: 'LEADER' as const },
        { userId: 'ana', role: 'AGENT' as const },
      ],
    },
    { id: 'support', members: [{ userId: 'sam', role: 'LEADER' as const }] },
  ]

  function withScope(leadsTeamIds: string[]) {
    scope.mockResolvedValue(
      ok({
        mode: 'SCOPED',
        userId: 'u1',
        leadsTeamIds,
        memberTeamIds: leadsTeamIds,
        ledAgentIds: [],
        ledTeamMemberIds: [],
      }),
    )
  }

  beforeEach(() => {
    snapshot.mockResolvedValue(ok(TEAMS))
    presence.list.mockResolvedValue(
      ok([createFakeWhatsAppAgentPresence({ userId: 'ana', status: 'AWAY' })]),
    )
  })

  it('shows an admin everyone who is in a team, available unless marked away', async () => {
    actingAs('ADMIN')
    withScope([])
    const result = expectOk(
      await WhatsAppPresenceService.listTeamMembers('u1', 'ws1'),
    )
    expect(result.map((row) => [row.userId, row.status])).toEqual([
      ['lia', 'AVAILABLE'],
      ['ana', 'AWAY'],
      ['sam', 'AVAILABLE'],
    ])
    expect(presence.list).toHaveBeenCalledWith('ws1', ['lia', 'ana', 'sam'])
  })

  it('shows a leader only the members of the teams they lead', async () => {
    actingAs('MEMBER')
    withScope(['sales'])
    const result = expectOk(
      await WhatsAppPresenceService.listTeamMembers('u1', 'ws1'),
    )
    expect(result.map((row) => row.userId)).toEqual(['lia', 'ana'])
  })

  it('refuses someone who neither administers nor leads a team', async () => {
    actingAs('MEMBER')
    withScope([])
    expectErr(
      await WhatsAppPresenceService.listTeamMembers('u1', 'ws1'),
      'FORBIDDEN',
    )
  })

  it('is empty when there are no teams', async () => {
    actingAs('OWNER')
    withScope([])
    snapshot.mockResolvedValue(ok([]))
    expect(
      expectOk(await WhatsAppPresenceService.listTeamMembers('u1', 'ws1')),
    ).toEqual([])
    expect(presence.list).not.toHaveBeenCalled()
  })

  it('propagates failures', async () => {
    actingAs('OWNER')
    scope.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppPresenceService.listTeamMembers('u1', 'ws1'))

    withScope([])
    snapshot.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppPresenceService.listTeamMembers('u1', 'ws1'))

    snapshot.mockResolvedValue(ok(TEAMS))
    presence.list.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppPresenceService.listTeamMembers('u1', 'ws1'))
  })
})
