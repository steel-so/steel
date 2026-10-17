import type { AiPendingAction } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/inbox-ai-pending.repository')
vi.mock('../notification-emitter', () => ({
  emitNotification: vi.fn(),
  workspaceAdminIds: vi.fn().mockResolvedValue([]),
}))

import type {
  InboxAgentPendingRow,
  InboxAssistantPendingRow,
} from '@/src/repositories/inbox-ai-pending.repository'
import { InboxAiPendingRepository } from '@/src/repositories/inbox-ai-pending.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  AI_ACTION_EXPIRY_NOTICE_MS,
  InboxAiPendingService,
} from '../inbox-ai-pending.service'
import { emitNotification } from '../notification-emitter'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedRepo = vi.mocked(InboxAiPendingRepository)
const mockedEmit = vi.mocked(emitNotification)

const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'down' }
const NOW = new Date('2026-10-07T12:00:00Z')

function action(overrides: Partial<AiPendingAction> = {}): AiPendingAction {
  return {
    id: 'a1',
    workspaceId: 'ws1',
    requestedById: 'u1',
    conversationId: 'c1',
    agentRunId: null,
    toolName: 'sd_update_ticket',
    toolCallId: null,
    kind: 'UPDATE',
    module: 'SERVICE_DESK',
    args: {},
    preview: { title: 'Alterar prioridade', summary: 's' },
    status: 'PENDING',
    requiresDoubleConfirm: false,
    autoExecuted: false,
    integrationGrantId: null,
    result: null,
    error: null,
    expiresAt: new Date('2026-10-07T12:20:00Z'),
    decidedById: null,
    decidedAt: null,
    executedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function assistantRow(
  overrides: Partial<InboxAssistantPendingRow> = {},
): InboxAssistantPendingRow {
  return {
    ...action(),
    conversation: { id: 'c1', title: 'Priorizar VPN' },
    integrationGrant: null,
    ...overrides,
  }
}

function agentRow(
  overrides: Partial<InboxAgentPendingRow> = {},
): InboxAgentPendingRow {
  return {
    ...action({
      id: 'g1',
      requestedById: null,
      conversationId: null,
      agentRunId: 'r1',
      expiresAt: new Date('2026-10-07T12:10:00Z'),
    }),
    agentRun: {
      id: 'r1',
      agentId: 'ag1',
      agent: { id: 'ag1', name: 'Triagem', ownerId: 'u9' },
    },
    ...overrides,
  }
}

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRepo.listAssistant.mockResolvedValue(ok([]))
  mockedRepo.listAgent.mockResolvedValue(ok([]))
  mockedRepo.listExpiringAssistant.mockResolvedValue(ok([]))
  mockedEmit.mockResolvedValue(1)
})

describe('InboxAiPendingService.list', () => {
  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(await InboxAiPendingService.list('x', 'ws1', NOW), 'FORBIDDEN')
    expect(mockedRepo.listAssistant).not.toHaveBeenCalled()
  })

  it('should list only the actor own assistant actions', async () => {
    asRole('MEMBER')
    mockedRepo.listAssistant.mockResolvedValue(ok([assistantRow()]))

    const result = expectOk(await InboxAiPendingService.list('u1', 'ws1', NOW))

    expect(mockedRepo.listAssistant).toHaveBeenCalledWith('ws1', 'u1', NOW)
    expect(result.count).toBe(1)
    expect(result.items[0]).toEqual({
      source: 'ASSISTANT',
      action: expect.objectContaining({ id: 'a1', status: 'PENDING' }),
      path: '/ai/c1',
      conversation: { id: 'c1', title: 'Priorizar VPN' },
      agent: null,
      runId: null,
      client: null,
    })
  })

  it('should tag MCP actions with the client and decide them in the inbox', async () => {
    asRole('MEMBER')
    mockedRepo.listAssistant.mockResolvedValue(
      ok([
        assistantRow({
          conversation: null,
          integrationGrantId: 'grant1',
          integrationGrant: { client: { clientId: 'cl1', name: 'Claude' } },
        }),
      ]),
    )

    const result = expectOk(await InboxAiPendingService.list('u1', 'ws1', NOW))

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        source: 'ASSISTANT',
        path: '/inbox?view=ai',
        conversation: null,
        client: { id: 'cl1', name: 'Claude' },
      }),
    )
  })

  it('should fall back to /ai when the action has no conversation', async () => {
    asRole('MEMBER')
    mockedRepo.listAssistant.mockResolvedValue(
      ok([assistantRow({ conversation: null })]),
    )

    const result = expectOk(await InboxAiPendingService.list('u1', 'ws1', NOW))

    expect(result.items[0].path).toBe('/ai')
    expect(result.items[0].conversation).toBeNull()
  })

  it('should narrow agent approvals to the agents a plain member owns', async () => {
    asRole('MEMBER')

    expectOk(await InboxAiPendingService.list('u1', 'ws1', NOW))

    expect(mockedRepo.listAgent).toHaveBeenCalledWith('ws1', NOW, 'u1')
  })

  it.each(['OWNER', 'ADMIN'] as const)(
    'should show every agent approval to a %s',
    async (role) => {
      asRole(role)

      expectOk(await InboxAiPendingService.list('u1', 'ws1', NOW))

      expect(mockedRepo.listAgent).toHaveBeenCalledWith('ws1', NOW, undefined)
    },
  )

  it('should map agent items and sort everything by expiry', async () => {
    asRole('OWNER')
    mockedRepo.listAssistant.mockResolvedValue(ok([assistantRow()]))
    mockedRepo.listAgent.mockResolvedValue(
      ok([
        agentRow(),
        agentRow({
          id: 'g2',
          expiresAt: new Date('2026-10-09T12:00:00Z'),
          agentRun: null,
        }),
      ]),
    )

    const result = expectOk(await InboxAiPendingService.list('u1', 'ws1', NOW))

    expect(result.count).toBe(3)
    expect(result.items.map((item) => item.action.id)).toEqual([
      'g1',
      'a1',
      'g2',
    ])
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        source: 'AGENT',
        path: '/ai/agents/ag1/runs/r1',
        agent: { id: 'ag1', name: 'Triagem' },
        runId: 'r1',
        conversation: null,
      }),
    )
    // Orphan run (relation gone): still listed, pointing at the agents list.
    expect(result.items[2]).toEqual(
      expect.objectContaining({
        path: '/ai/agents',
        agent: null,
        runId: null,
      }),
    )
  })

  it('should default to the current time', async () => {
    asRole('MEMBER')

    expectOk(await InboxAiPendingService.list('u1', 'ws1'))

    expect(mockedRepo.listAssistant).toHaveBeenCalledWith(
      'ws1',
      'u1',
      expect.any(Date),
    )
  })

  it('should propagate an assistant listing failure', async () => {
    asRole('MEMBER')
    mockedRepo.listAssistant.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await InboxAiPendingService.list('u1', 'ws1', NOW),
      'DATABASE_ERROR',
    )
  })

  it('should propagate an agent listing failure', async () => {
    asRole('MEMBER')
    mockedRepo.listAgent.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await InboxAiPendingService.list('u1', 'ws1', NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('InboxAiPendingService.notifyExpiring', () => {
  function expiring(id: string, minutesLeft: number, preview: unknown) {
    return {
      id,
      workspaceId: 'ws1',
      requestedById: `user-${id}`,
      preview: preview as never,
      expiresAt: new Date(NOW.getTime() + minutesLeft * 60_000),
    }
  }

  it('should look at the next five minutes only', async () => {
    expect(expectOk(await InboxAiPendingService.notifyExpiring(NOW))).toBe(0)

    expect(mockedRepo.listExpiringAssistant).toHaveBeenCalledWith(
      NOW,
      new Date(NOW.getTime() + AI_ACTION_EXPIRY_NOTICE_MS),
    )
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('should warn each requester once with a dedupe key', async () => {
    mockedRepo.listExpiringAssistant.mockResolvedValue(
      ok([
        expiring('a1', 4, { title: 'Alterar prioridade' }),
        expiring('a2', 0.5, { summary: 'sem título' }),
      ]),
    )
    mockedEmit.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    expect(expectOk(await InboxAiPendingService.notifyExpiring(NOW))).toBe(1)

    expect(mockedEmit).toHaveBeenNthCalledWith(1, {
      workspaceId: 'ws1',
      recipients: ['user-a1'],
      kind: 'AI_ACTION_EXPIRING',
      title: 'Uma ação do Steel AI expira em 4 minutos',
      body: 'Alterar prioridade. Confirme ou cancele antes que ela expire.',
      path: '/inbox?view=ai',
      dedupeKey: 'ai-action-expiring:a1',
    })
    expect(mockedEmit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: 'Uma ação do Steel AI expira em 1 minuto',
        body: 'Confirme ou cancele a ação antes que ela expire.',
        dedupeKey: 'ai-action-expiring:a2',
      }),
    )
  })

  it.each([
    ['null preview', null],
    ['blank title', { title: '   ' }],
    ['non-string title', { title: 42 }],
  ])('should use the generic body for a %s', async (_label, preview) => {
    mockedRepo.listExpiringAssistant.mockResolvedValue(
      ok([expiring('a3', 2, preview)]),
    )

    await InboxAiPendingService.notifyExpiring(NOW)

    expect(mockedEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Confirme ou cancele a ação antes que ela expire.',
      }),
    )
  })

  it('should propagate a listing failure', async () => {
    mockedRepo.listExpiringAssistant.mockResolvedValue(err(DB_ERROR))

    expectErr(await InboxAiPendingService.notifyExpiring(NOW), 'DATABASE_ERROR')
    expect(mockedEmit).not.toHaveBeenCalled()
  })

  it('should default to the current time', async () => {
    expectOk(await InboxAiPendingService.notifyExpiring())

    const [from, until] = mockedRepo.listExpiringAssistant.mock.calls[0]
    expect(until.getTime() - from.getTime()).toBe(AI_ACTION_EXPIRY_NOTICE_MS)
  })
})
