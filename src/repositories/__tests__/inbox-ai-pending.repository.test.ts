import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedIntegrationGrant,
  seedOauthClient,
} from '@/src/__tests__/factories/integration-grant.factory'
import {
  seedSteelAgent,
  seedSteelAgentRun,
} from '@/src/__tests__/factories/steel-agent.factory'
import {
  seedAiConversation,
  seedAiPendingAction,
} from '@/src/__tests__/factories/steel-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { InboxAiPendingRepository } from '../inbox-ai-pending.repository'

const NOW = new Date('2026-10-07T12:00:00Z')
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

async function context() {
  const [workspace, otherWorkspace, me, colleague] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
    seedUser(),
  ])
  const conversation = await seedAiConversation(workspace.id, me.id, {
    title: 'Priorizar VPN',
  })
  return { workspace, otherWorkspace, me, colleague, conversation }
}

async function seedAgentRun(
  workspaceId: string,
  ownerId: string,
  name: string,
) {
  const agent = await seedSteelAgent({ workspaceId, ownerId, name })
  const run = await seedSteelAgentRun({
    workspaceId,
    agentId: agent.id,
    status: 'WAITING_APPROVAL',
  })
  return { agent, run }
}

describe('InboxAiPendingRepository.listAssistant', () => {
  it('should list the user own pending, unexpired assistant actions soonest first', async () => {
    const { workspace, otherWorkspace, me, colleague, conversation } =
      await context()
    const { run } = await seedAgentRun(workspace.id, me.id, 'Agente')

    const later = await seedAiPendingAction(workspace.id, {
      requestedById: me.id,
      conversationId: conversation.id,
      expiresAt: at(20),
    })
    const sooner = await seedAiPendingAction(workspace.id, {
      requestedById: me.id,
      expiresAt: at(5),
    })
    await Promise.all([
      // Someone else's.
      seedAiPendingAction(workspace.id, {
        requestedById: colleague.id,
        expiresAt: at(10),
      }),
      // Already decided.
      seedAiPendingAction(workspace.id, {
        requestedById: me.id,
        status: 'EXECUTED',
        expiresAt: at(10),
      }),
      // Overdue (lazy expiry has not run yet).
      seedAiPendingAction(workspace.id, {
        requestedById: me.id,
        expiresAt: at(-1),
      }),
      // Agent proposal.
      seedAiPendingAction(workspace.id, {
        requestedById: me.id,
        agentRunId: run.id,
        expiresAt: at(10),
      }),
      // Another workspace.
      seedAiPendingAction(otherWorkspace.id, {
        requestedById: me.id,
        expiresAt: at(10),
      }),
    ])

    const rows = expectOk(
      await InboxAiPendingRepository.listAssistant(workspace.id, me.id, NOW),
    )

    expect(rows.map((row) => row.id)).toEqual([sooner.id, later.id])
    expect(rows[0].conversation).toBeNull()
    expect(rows[1].conversation).toEqual({
      id: conversation.id,
      title: 'Priorizar VPN',
    })
  })
})

describe('InboxAiPendingRepository.listAssistant — MCP', () => {
  it('should include the connected app of actions an MCP client proposed', async () => {
    const { workspace, me } = await context()
    const client = await seedOauthClient({ name: 'Claude' })
    const grant = await seedIntegrationGrant({
      userId: me.id,
      workspaceId: workspace.id,
      clientId: client.clientId,
      scopes: ['mcp:read', 'mcp:write'],
    })
    const mcp = await seedAiPendingAction(workspace.id, {
      requestedById: me.id,
      integrationGrantId: grant.id,
      expiresAt: at(10),
    })
    const chat = await seedAiPendingAction(workspace.id, {
      requestedById: me.id,
      expiresAt: at(20),
    })

    const rows = expectOk(
      await InboxAiPendingRepository.listAssistant(workspace.id, me.id, NOW),
    )

    expect(rows.map((row) => row.id)).toEqual([mcp.id, chat.id])
    expect(rows[0].integrationGrant).toEqual({
      client: { clientId: client.clientId, name: 'Claude' },
    })
    expect(rows[1].integrationGrant).toBeNull()
  })
})

describe('InboxAiPendingRepository.listAgent', () => {
  it('should list pending agent approvals with the agent, optionally by owner', async () => {
    const { workspace, me, colleague } = await context()
    const mine = await seedAgentRun(workspace.id, me.id, 'Meu agente')
    const theirs = await seedAgentRun(workspace.id, colleague.id, 'Outro')

    const a = await seedAiPendingAction(workspace.id, {
      agentRunId: mine.run.id,
      expiresAt: at(60),
    })
    const b = await seedAiPendingAction(workspace.id, {
      agentRunId: theirs.run.id,
      expiresAt: at(30),
    })
    await Promise.all([
      seedAiPendingAction(workspace.id, {
        agentRunId: mine.run.id,
        status: 'CANCELED',
        expiresAt: at(30),
      }),
      seedAiPendingAction(workspace.id, {
        agentRunId: mine.run.id,
        expiresAt: at(-5),
      }),
      seedAiPendingAction(workspace.id, {
        requestedById: me.id,
        expiresAt: at(30),
      }),
    ])

    const all = expectOk(
      await InboxAiPendingRepository.listAgent(workspace.id, NOW),
    )
    expect(all.map((row) => row.id)).toEqual([b.id, a.id])
    expect(all[1].agentRun).toEqual({
      id: mine.run.id,
      agentId: mine.agent.id,
      agent: { id: mine.agent.id, name: 'Meu agente', ownerId: me.id },
    })

    const own = expectOk(
      await InboxAiPendingRepository.listAgent(workspace.id, NOW, me.id),
    )
    expect(own.map((row) => row.id)).toEqual([a.id])
  })
})

describe('InboxAiPendingRepository.listExpiringAssistant', () => {
  it('should return assistant actions expiring inside the window, across workspaces', async () => {
    const { workspace, otherWorkspace, me } = await context()
    const { run } = await seedAgentRun(workspace.id, me.id, 'Agente')

    const inWindow = await seedAiPendingAction(workspace.id, {
      requestedById: me.id,
      expiresAt: at(3),
    })
    const edge = await seedAiPendingAction(otherWorkspace.id, {
      requestedById: me.id,
      expiresAt: at(5),
    })
    await Promise.all([
      seedAiPendingAction(workspace.id, {
        requestedById: me.id,
        expiresAt: at(6),
      }),
      seedAiPendingAction(workspace.id, {
        requestedById: me.id,
        expiresAt: NOW,
      }),
      seedAiPendingAction(workspace.id, {
        requestedById: me.id,
        status: 'CANCELED',
        expiresAt: at(2),
      }),
      seedAiPendingAction(workspace.id, {
        agentRunId: run.id,
        expiresAt: at(2),
      }),
      seedAiPendingAction(workspace.id, { expiresAt: at(2) }),
    ])

    const rows = expectOk(
      await InboxAiPendingRepository.listExpiringAssistant(NOW, at(5)),
    )

    expect(rows.map((row) => row.id)).toEqual([inWindow.id, edge.id])
    expect(rows[0]).toEqual({
      id: inWindow.id,
      workspaceId: workspace.id,
      requestedById: me.id,
      preview: { title: 'Criar tarefa', summary: 'Ligar' },
      expiresAt: at(3),
    })
  })
})

describe('InboxAiPendingRepository failures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return DATABASE_ERROR when the query throws', async () => {
    vi.spyOn(prisma.aiPendingAction, 'findMany').mockRejectedValue(
      new Error('boom'),
    )

    expectErr(
      await InboxAiPendingRepository.listAssistant('w', 'u', NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await InboxAiPendingRepository.listAgent('w', NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await InboxAiPendingRepository.listExpiringAssistant(NOW, at(5)),
      'DATABASE_ERROR',
    )
  })
})
