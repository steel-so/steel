import { describe, expect, it, vi } from 'vitest'
import {
  seedAiConversation,
  seedAiPendingAction,
} from '@/src/__tests__/factories/steel-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiActionLogRepository } from '../ai-action-log.repository'
import { AiPendingActionRepository } from '../ai-pending-action.repository'

async function context() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const conversation = await seedAiConversation(workspace.id, user.id)
  return { workspace, user, conversation }
}

describe('AiPendingActionRepository', () => {
  it('should create and find within the workspace only', async () => {
    const { workspace, user, conversation } = await context()
    const other = await seedWorkspace()

    const created = expectOk(
      await AiPendingActionRepository.create({
        workspaceId: workspace.id,
        requestedById: user.id,
        conversationId: conversation.id,
        toolName: 'crm_create_task',
        toolCallId: 'call_1',
        kind: 'CREATE',
        module: 'CRM',
        args: { title: 'Ligar' },
        preview: { title: 'Criar tarefa', summary: 'Ligar' },
        requiresDoubleConfirm: false,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )
    expect(created.status).toBe('PENDING')

    expect(
      expectOk(
        await AiPendingActionRepository.findById(created.id, workspace.id),
      ).toolName,
    ).toBe('crm_create_task')
    expectErr(
      await AiPendingActionRepository.findById(created.id, other.id),
      'AI_PENDING_ACTION_NOT_FOUND',
    )
  })

  it('should list by requester with filters and by conversation', async () => {
    const { workspace, user, conversation } = await context()
    const other = await seedUser()
    const a = await seedAiPendingAction(workspace.id, {
      requestedById: user.id,
      conversationId: conversation.id,
    })
    const b = await seedAiPendingAction(workspace.id, {
      requestedById: user.id,
      status: 'EXECUTED',
    })
    await seedAiPendingAction(workspace.id, { requestedById: other.id })

    const mine = expectOk(
      await AiPendingActionRepository.listByRequester({
        workspaceId: workspace.id,
        requestedById: user.id,
      }),
    )
    expect(mine.map((x) => x.id).sort()).toEqual([a.id, b.id].sort())

    const pending = expectOk(
      await AiPendingActionRepository.listByRequester({
        workspaceId: workspace.id,
        requestedById: user.id,
        status: 'PENDING',
        conversationId: conversation.id,
      }),
    )
    expect(pending.map((x) => x.id)).toEqual([a.id])

    expect(
      expectOk(
        await AiPendingActionRepository.listByConversation(conversation.id),
      ).map((x) => x.id),
    ).toEqual([a.id])
  })

  it('should let only one caller win the PENDING transition', async () => {
    const { workspace, user } = await context()
    const action = await seedAiPendingAction(workspace.id, {
      requestedById: user.id,
    })
    const decidedAt = new Date()

    const [first, second] = await Promise.all([
      AiPendingActionRepository.transitionFromPending(action.id, {
        status: 'EXECUTED',
        decidedById: user.id,
        decidedAt,
      }),
      AiPendingActionRepository.transitionFromPending(action.id, {
        status: 'EXECUTED',
        decidedById: user.id,
        decidedAt,
      }),
    ])
    const winners = [expectOk(first), expectOk(second)].filter(Boolean)
    expect(winners).toHaveLength(1)
    expect(winners[0]?.status).toBe('EXECUTED')
    expect(winners[0]?.decidedById).toBe(user.id)

    const completed = expectOk(
      await AiPendingActionRepository.complete(action.id, {
        status: 'FAILED',
        error: 'boom',
      }),
    )
    expect(completed.error).toBe('boom')
  })

  it('should refresh the preview of a PENDING action only', async () => {
    const { workspace } = await context()
    const action = await seedAiPendingAction(workspace.id)
    const decided = await seedAiPendingAction(workspace.id, {
      status: 'CANCELED',
    })
    const fresh = { title: 'Atualizar chamado', summary: 'Novo título' }

    const refreshed = expectOk(
      await AiPendingActionRepository.refreshPreview(action.id, fresh),
    )
    expect(refreshed?.preview).toEqual(fresh)
    expect(refreshed?.status).toBe('PENDING')

    expect(
      expectOk(
        await AiPendingActionRepository.refreshPreview(decided.id, fresh),
      ),
    ).toBeNull()
    const untouched = expectOk(
      await AiPendingActionRepository.findById(decided.id, workspace.id),
    )
    expect(untouched.preview).toEqual(decided.preview)
  })

  it('should expire only overdue PENDING actions of the workspace', async () => {
    const { workspace } = await context()
    const other = await seedWorkspace()
    const overdue = await seedAiPendingAction(workspace.id, {
      expiresAt: new Date(Date.now() - 1_000),
    })
    const fresh = await seedAiPendingAction(workspace.id)
    await seedAiPendingAction(workspace.id, {
      status: 'EXECUTED',
      expiresAt: new Date(Date.now() - 1_000),
    })
    await seedAiPendingAction(other.id, {
      expiresAt: new Date(Date.now() - 1_000),
    })

    expect(
      expectOk(await AiPendingActionRepository.expireOverdue(workspace.id)),
    ).toBe(1)
    const rows = await prisma.aiPendingAction.findMany({
      where: { id: { in: [overdue.id, fresh.id] } },
    })
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [overdue.id]: 'EXPIRED',
      [fresh.id]: 'PENDING',
    })
  })

  it('should return DATABASE_ERROR on failures', async () => {
    expectErr(
      await AiPendingActionRepository.create({
        workspaceId: 'missing',
        requestedById: null,
        conversationId: null,
        toolName: 'x',
        toolCallId: null,
        kind: 'CREATE',
        module: null,
        args: {},
        preview: {},
        requiresDoubleConfirm: false,
        expiresAt: new Date(),
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiPendingActionRepository.complete('missing', { status: 'FAILED' }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.aiPendingAction, 'findFirst').mockRejectedValueOnce(
      new Error('down'),
    )
    vi.spyOn(prisma.aiPendingAction, 'findMany')
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
    vi.spyOn(prisma.aiPendingAction, 'updateMany')
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
    expectErr(
      await AiPendingActionRepository.findById('a', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiPendingActionRepository.listByRequester({
        workspaceId: 'w',
        requestedById: 'u',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiPendingActionRepository.listByConversation('c'),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiPendingActionRepository.transitionFromPending('a', {
        status: 'CANCELED',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiPendingActionRepository.expireOverdue('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiPendingActionRepository.refreshPreview('a', { title: 'x' }),
      'DATABASE_ERROR',
    )
  })
})

describe('AiActionLogRepository', () => {
  it('should create and list newest first, filtered by target', async () => {
    const { workspace, user } = await context()
    const base = {
      workspaceId: workspace.id,
      source: 'ASSISTANT' as const,
      actorId: user.id,
      toolName: 'crm_create_task',
      kind: 'CREATE' as const,
      module: 'CRM' as const,
      args: {},
      outcome: 'success' as const,
      summary: 'Tarefa criada',
    }
    const first = expectOk(
      await AiActionLogRepository.create({
        ...base,
        targetType: 'crm_task',
        targetId: 't1',
      }),
    )
    const second = expectOk(
      await AiActionLogRepository.create({ ...base, targetType: 'crm_lead' }),
    )

    const all = expectOk(
      await AiActionLogRepository.listByWorkspace(workspace.id, { limit: 10 }),
    )
    expect(all.map((l) => l.id)).toEqual([second.id, first.id])
    expect(first).toMatchObject({
      outcome: 'success',
      summary: 'Tarefa criada',
    })

    const filtered = expectOk(
      await AiActionLogRepository.listByWorkspace(workspace.id, {
        targetType: 'crm_task',
        targetId: 't1',
        limit: 10,
      }),
    )
    expect(filtered.map((l) => l.id)).toEqual([first.id])
  })

  it('should return DATABASE_ERROR on failures', async () => {
    expectErr(
      await AiActionLogRepository.create({
        workspaceId: 'missing',
        source: 'AGENT',
        actorId: null,
        toolName: 'x',
        kind: 'ACTION',
        module: null,
        args: {},
        outcome: 'failure',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.aiActionLog, 'findMany').mockRejectedValueOnce(
      new Error('down'),
    )
    expectErr(
      await AiActionLogRepository.listByWorkspace('w', { limit: 1 }),
      'DATABASE_ERROR',
    )
  })
})
