import type { Job } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedAiUsage,
  seedWorkspaceAiSettings,
} from '@/src/__tests__/factories/ai-settings.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import type { AiChatRequest, AiChatResponse } from '@/src/lib/ai/types'
import { prisma } from '@/src/lib/prisma'
import { ok } from '@/src/lib/result'
import { WhatsappAiReplyJob } from '../../jobs'

vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))

// Provedores de IA fake: o resto (settings, cota, livro-razão) roda de
// verdade contra o Postgres.
const mockChat = vi.fn<(request: AiChatRequest) => Promise<AiChatResponse>>()
vi.mock('@/src/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/ai')>()
  return {
    ...actual,
    isAiProviderConfigured: () => true,
    getAiProvider: (id: 'openai' | 'anthropic') => ({ id, chat: mockChat }),
    getOpenAiClient: () => null,
  }
})

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { processWhatsappAiReply } from '../whatsapp-ai-reply'

const mockedSend = vi.mocked(WhatsAppSend)

function job(conversationId: string, messageId: string): Job {
  return {
    name: WhatsappAiReplyJob.GenerateAiReply,
    id: 'test-job',
    data: { conversationId, messageId },
  } as unknown as Job
}

function reply(overrides: Partial<AiChatResponse>): AiChatResponse {
  return {
    text: '',
    toolCalls: [],
    message: { role: 'assistant', content: overrides.text ?? '' },
    usage: { inputTokens: 300, outputTokens: 200 },
    stopReason: 'end',
    ...overrides,
  }
}

const toolTurn = () =>
  reply({
    stopReason: 'tool_use',
    toolCalls: [
      { id: 'call_1', name: 'consultar_exame_agendado', arguments: {} },
    ],
  })

async function seedFixtures(overrides?: { systemPrompt?: string }) {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Principal',
      phoneNumber: '5511999990000',
      metaPhoneNumberId: 'phone-id',
      metaWabaId: 'waba-id',
      encryptedMetaAccessToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: '5511988887777' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      contactId: contact.id,
      aiActive: true,
    },
  })
  await prisma.whatsAppAiConfig.create({
    data: {
      workspaceId: workspace.id,
      systemPrompt:
        overrides?.systemPrompt ?? 'Você é o assistente da clínica.',
      active: true,
    },
  })
  const message = await prisma.whatsAppMessage.create({
    data: {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      direction: 'IN',
      type: 'TEXT',
      text: 'Tenho algum exame agendado?',
      providerMessageId: `msg-${crypto.randomUUID()}`,
      status: 'DELIVERED',
    },
  })
  return { workspace, user, connection, contact, conversation, message }
}

function toolMessageOf(request: AiChatRequest) {
  return request.messages.find((m) => m.role === 'tool') as
    | { content: string }
    | undefined
}

describe('processWhatsappAiReply() — tool calling', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should call the appointment tool and answer using its result', async () => {
    const { workspace, user, connection, contact, conversation, message } =
      await seedFixtures()
    const broadcastList = await prisma.whatsAppBroadcastList.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        name: 'Confirmação de exames',
        messageBody: 'placeholder',
        status: 'QUEUED',
        createdById: user.id,
      },
    })
    const appointmentAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.whatsAppBroadcastRecipient.create({
      data: {
        broadcastListId: broadcastList.id,
        contactId: contact.id,
        appointmentAt,
      },
    })

    mockChat
      .mockResolvedValueOnce(toolTurn())
      .mockResolvedValueOnce(
        reply({ text: 'Sim! Você tem exame marcado para 15/08 às 09h.' }),
      )
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'sent-1' }))

    await processWhatsappAiReply(job(conversation.id, message.id))

    expect(mockChat).toHaveBeenCalledTimes(2)

    const secondCallArgs = mockChat.mock.calls[1][0]
    expect(secondCallArgs.toolChoice).toBe('none')
    const toolMessage = toolMessageOf(secondCallArgs)
    expect(toolMessage).toBeDefined()
    expect(JSON.parse(toolMessage?.content ?? '')).toEqual({
      hasAppointment: true,
      appointmentAt: appointmentAt.toISOString(),
      description: 'Confirmação de exames',
    })

    expect(mockedSend.text).toHaveBeenCalledWith(
      expect.objectContaining({ id: connection.id }),
      expect.objectContaining({
        text: 'Sim! Você tem exame marcado para 15/08 às 09h.',
      }),
      { cost: expect.objectContaining({ source: 'AI_REPLY' }) },
    )

    const sentMessage = await prisma.whatsAppMessage.findFirst({
      where: { conversationId: conversation.id, direction: 'OUT' },
    })
    expect(sentMessage?.text).toBe(
      'Sim! Você tem exame marcado para 15/08 às 09h.',
    )
  })

  it('should tell the tool there is no appointment when none exists', async () => {
    const { conversation, message } = await seedFixtures()

    mockChat
      .mockResolvedValueOnce(toolTurn())
      .mockResolvedValueOnce(
        reply({ text: 'Não encontrei nenhum exame agendado no seu nome.' }),
      )
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'sent-2' }))

    await processWhatsappAiReply(job(conversation.id, message.id))

    const toolMessage = toolMessageOf(mockChat.mock.calls[1][0])
    expect(JSON.parse(toolMessage?.content ?? '')).toEqual({
      hasAppointment: false,
    })
  })

  it('should not call the tool when the model answers directly', async () => {
    const { conversation, message } = await seedFixtures()

    mockChat.mockResolvedValueOnce(reply({ text: 'Olá! Como posso ajudar?' }))
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'sent-3' }))

    await processWhatsappAiReply(job(conversation.id, message.id))

    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(mockedSend.text).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: 'Olá! Como posso ajudar?' }),
      { cost: expect.objectContaining({ source: 'AI_REPLY' }) },
    )
  })
})

describe('processWhatsappAiReply() — provider and quota', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should use the workspace default model and charge the ledger', async () => {
    const { workspace, conversation, message } = await seedFixtures()
    await seedWorkspaceAiSettings(workspace.id, {
      enabledModels: ['openai:gpt-4o-mini', 'anthropic:claude-haiku-4-5'],
      whatsappReplyModel: 'anthropic:claude-haiku-4-5',
    })

    mockChat.mockResolvedValueOnce(reply({ text: 'Olá!' }))
    mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'sent-4' }))

    await processWhatsappAiReply(job(conversation.id, message.id))

    expect(mockChat.mock.calls[0][0].model).toBe('claude-haiku-4-5')
    const usage = await prisma.aiUsage.findMany({
      where: { workspaceId: workspace.id },
    })
    expect(usage).toHaveLength(1)
    expect(usage[0]).toEqual(
      expect.objectContaining({
        feature: 'WHATSAPP_REPLY',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        userId: null,
        inputTokens: 300,
        outputTokens: 200,
      }),
    )
    // Claude Haiku 4.5 at cost: 300 × US$ 1/1M + 200 × US$ 5/1M (ADR 0019)
    expect(usage[0].costUsd.toNumber()).toBe(0.0013)
  })

  it('should skip gracefully (no AI call, no reply) when the quota is exhausted', async () => {
    const { workspace, conversation, message } = await seedFixtures()
    await seedWorkspaceAiSettings(workspace.id, { monthlyQuotaUsd: 10 })
    await seedAiUsage(workspace.id, { costUsd: 10 })

    await processWhatsappAiReply(job(conversation.id, message.id))

    expect(mockChat).not.toHaveBeenCalled()
    expect(mockedSend.text).not.toHaveBeenCalled()
    const out = await prisma.whatsAppMessage.count({
      where: { conversationId: conversation.id, direction: 'OUT' },
    })
    expect(out).toBe(0)
  })
})
