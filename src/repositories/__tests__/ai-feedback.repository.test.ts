import { describe, expect, it, vi } from 'vitest'
import {
  seedAiFeedback,
  seedWhatsAppMessage,
  seedWhatsAppThread,
} from '@/src/__tests__/factories/ai-quality.factory'
import {
  seedSdKbArticle,
  seedSdTicket,
} from '@/src/__tests__/factories/sd-kb.factory'
import {
  seedSteelAgent,
  seedSteelAgentRun,
} from '@/src/__tests__/factories/steel-agent.factory'
import {
  seedAiConversation,
  seedAiMessage,
} from '@/src/__tests__/factories/steel-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiFeedbackRepository } from '../ai-feedback.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

function base(workspaceId: string, userId: string, targetId: string) {
  return {
    workspaceId,
    userId,
    surface: 'STEEL_AI_MESSAGE' as const,
    targetId,
    variant: '',
    rating: 'UP' as const,
    reason: null,
    comment: null,
    modelKey: 'openai:gpt-4o-mini',
    module: null,
  }
}

describe('AiFeedbackRepository', () => {
  it('upserts one row per user, surface, target and variant', async () => {
    const { workspace, user } = await setup()
    const first = expectOk(
      await AiFeedbackRepository.upsert(base(workspace.id, user.id, 't1')),
    )
    const second = expectOk(
      await AiFeedbackRepository.upsert({
        ...base(workspace.id, user.id, 't1'),
        rating: 'DOWN',
        reason: 'incorrect',
        comment: 'Errou o prazo',
      }),
    )
    expect(second.id).toBe(first.id)
    expect(second.rating).toBe('DOWN')
    expect(second.comment).toBe('Errou o prazo')

    const other = expectOk(
      await AiFeedbackRepository.upsert({
        ...base(workspace.id, user.id, 't1'),
        surface: 'SD_COPILOT',
        variant: 'summary',
      }),
    )
    expect(other.id).not.toBe(first.id)
    expect(await prisma.aiFeedback.count()).toBe(2)
  })

  it('finds by id inside the workspace and deletes', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const row = await seedAiFeedback({
      workspaceId: workspace.id,
      userId: user.id,
      targetId: 't1',
    })
    expect(
      expectOk(await AiFeedbackRepository.findById(row.id, workspace.id))?.id,
    ).toBe(row.id)
    expect(
      expectOk(await AiFeedbackRepository.findById(row.id, other.id)),
    ).toBeNull()
    expectOk(await AiFeedbackRepository.delete(row.id))
    expect(await prisma.aiFeedback.count()).toBe(0)
  })

  it('lists only the caller ratings of the asked targets', async () => {
    const { workspace, user } = await setup()
    const someone = await seedUser()
    await Promise.all([
      seedAiFeedback({
        workspaceId: workspace.id,
        userId: user.id,
        targetId: 'a',
      }),
      seedAiFeedback({
        workspaceId: workspace.id,
        userId: user.id,
        targetId: 'b',
      }),
      seedAiFeedback({
        workspaceId: workspace.id,
        userId: someone.id,
        targetId: 'a',
      }),
      seedAiFeedback({
        workspaceId: workspace.id,
        userId: user.id,
        targetId: 'a',
        surface: 'STEEL_AGENT_RUN',
      }),
    ])
    const rows = expectOk(
      await AiFeedbackRepository.listMine(
        user.id,
        workspace.id,
        'STEEL_AI_MESSAGE',
        ['a', 'c'],
      ),
    )
    expect(rows.map((r) => r.targetId)).toEqual(['a'])
  })

  it('goes away with the user (LGPD)', async () => {
    const { workspace, user } = await setup()
    await seedAiFeedback({
      workspaceId: workspace.id,
      userId: user.id,
      targetId: 'x',
      comment: 'dado pessoal',
    })
    await prisma.user.delete({ where: { id: user.id } })
    expect(await prisma.aiFeedback.count()).toBe(0)
  })

  it('looks up an assistant message with its conversation owner', async () => {
    const { workspace, user } = await setup()
    const conversation = await seedAiConversation(workspace.id, user.id)
    const message = await seedAiMessage(conversation.id, {
      role: 'ASSISTANT',
      content: 'Resposta',
      modelKey: 'openai:gpt-4o-mini',
    })
    const found = expectOk(
      await AiFeedbackRepository.findAssistantMessage(message.id),
    )
    expect(found).toMatchObject({
      id: message.id,
      role: 'ASSISTANT',
      modelKey: 'openai:gpt-4o-mini',
      conversationWorkspaceId: workspace.id,
      conversationUserId: user.id,
    })
    expect(
      expectOk(await AiFeedbackRepository.findAssistantMessage('nope')),
    ).toBeNull()

    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { deletedAt: new Date() },
    })
    expect(
      expectOk(await AiFeedbackRepository.findAssistantMessage(message.id)),
    ).toBeNull()
  })

  it('looks up agent runs, tickets, KB drafts and WhatsApp messages per workspace', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const agent = await seedSteelAgent({ workspaceId: workspace.id })
    const run = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    const ticket = await seedSdTicket(workspace.id)
    const gone = await seedSdTicket(workspace.id, { deletedAt: new Date() })
    const article = await seedSdKbArticle(workspace.id, {
      sourceTicketId: ticket.id,
    })
    const conversation = await seedWhatsAppThread(workspace.id, user.id)
    const message = await seedWhatsAppMessage(workspace.id, conversation.id, {
      sentByAi: true,
    })

    expect(
      expectOk(await AiFeedbackRepository.findAgentRun(run.id, workspace.id)),
    ).toMatchObject({ id: run.id, agentId: agent.id })
    expect(
      expectOk(await AiFeedbackRepository.findAgentRun(run.id, other.id)),
    ).toBeNull()
    expect(
      expectOk(await AiFeedbackRepository.findTicket(ticket.id, workspace.id)),
    ).toMatchObject({ id: ticket.id, number: ticket.number })
    expect(
      expectOk(await AiFeedbackRepository.findTicket(gone.id, workspace.id)),
    ).toBeNull()
    expect(
      expectOk(
        await AiFeedbackRepository.findKbDraft(article.id, workspace.id),
      ),
    ).toEqual({ id: article.id, sourceTicketId: ticket.id })
    expect(
      expectOk(
        await AiFeedbackRepository.findWhatsAppMessage(
          message.id,
          workspace.id,
        ),
      ),
    ).toMatchObject({ id: message.id, sentByAi: true, direction: 'OUT' })
    expect(
      expectOk(
        await AiFeedbackRepository.findWhatsAppMessage(message.id, other.id),
      ),
    ).toBeNull()
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    const spies = [
      vi
        .spyOn(prisma.aiFeedback, 'upsert')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.aiFeedback, 'findFirst')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.aiFeedback, 'deleteMany')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.aiFeedback, 'findMany')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.aiMessage, 'findUnique')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.steelAgentRun, 'findFirst')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.sdTicket, 'findFirst')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.sdKbArticle, 'findFirst')
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.whatsAppMessage, 'findFirst')
        .mockRejectedValueOnce(new Error('x')),
    ]
    const results = [
      await AiFeedbackRepository.upsert(base('w', 'u', 't')),
      await AiFeedbackRepository.findById('f', 'w'),
      await AiFeedbackRepository.delete('f'),
      await AiFeedbackRepository.listMine('u', 'w', 'STEEL_AI_MESSAGE', ['t']),
      await AiFeedbackRepository.findAssistantMessage('m'),
      await AiFeedbackRepository.findAgentRun('r', 'w'),
      await AiFeedbackRepository.findTicket('t', 'w'),
      await AiFeedbackRepository.findKbDraft('a', 'w'),
      await AiFeedbackRepository.findWhatsAppMessage('m', 'w'),
    ]
    for (const result of results) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    for (const spy of spies) spy.mockRestore()
  })
})
