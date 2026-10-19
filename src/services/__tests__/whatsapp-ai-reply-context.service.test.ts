import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppAiConfig } from '@/src/__tests__/factories/whatsapp-ai-config.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/whatsapp-ai-config.repository')
vi.mock('@/src/repositories/whatsapp-ai-knowledge-document.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-notify')>()),
  notifyWhatsAppUsers: vi.fn(async () => 1),
  whatsAppAdminIds: vi.fn(async () => ['owner', 'admin']),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/ai')>()),
  getOpenAiClient: vi.fn(() => null),
}))

import { logger } from '@/lib/axiom/logger'
import { databaseError } from '@/src/errors'
import { getOpenAiClient } from '@/src/lib/ai'
import {
  type UntrustedSource,
  wrapUntrusted,
} from '@/src/lib/ai/guardrails/injection'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai/types'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppAiKnowledgeDocumentRepository } from '@/src/repositories/whatsapp-ai-knowledge-document.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  AiUsageService,
  type PreparedAiCall,
} from '@/src/services/ai-usage.service'
import { WhatsAppAiReplyService } from '../whatsapp-ai-reply.service'

/** Customer text and documents reach the model fenced (ADR 0041). */
const fenced = (text: string, source: UntrustedSource = 'whatsapp_message') =>
  wrapUntrusted(text, source)

const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedAiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const mockedKnowledgeRepo = vi.mocked(WhatsAppAiKnowledgeDocumentRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedMessageRepo = vi.mocked(WhatsAppMessageRepository)
const mockedAiUsage = vi.mocked(AiUsageService)
const mockedSend = vi.mocked(WhatsAppSend)
const mockedBroadcastRepo = vi.mocked(WhatsAppBroadcastRepository)

const WS = 'ws1'
const CONV = 'conv1'

function response(text: string): AiChatResponse {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'end',
  }
}

function preparedCall(chat: AiProvider['chat']): PreparedAiCall {
  return {
    feature: 'WHATSAPP_REPLY',
    provider: { id: 'openai', chat, chatStream: vi.fn() },
    model: {
      key: 'openai:gpt-4o-mini',
      provider: 'openai',
      model: 'gpt-4o-mini',
      label: 'GPT-4o mini',
    },
    usdPer1kTokens: 4,
  }
}

function arrange(options?: {
  conversation?: Parameters<typeof createFakeWhatsAppConversation>[0]
  aiConfigActive?: boolean
}) {
  const connection = createFakeWhatsAppConnection({ workspaceId: WS })
  const conversation = {
    ...createFakeWhatsAppConversation({
      id: CONV,
      workspaceId: WS,
      contactId: 'contact1',
      aiActive: true,
      ...options?.conversation,
    }),
    connection,
  }
  mockedConversationRepo.findByIdWithConnection.mockResolvedValue(
    ok(conversation),
  )
  mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppAiConfig({
        workspaceId: WS,
        active: options?.aiConfigActive ?? true,
        systemPrompt: 'Prompt base.',
      }),
    ),
  )
  mockedMessageRepo.listLatestByConversation.mockResolvedValue(
    ok([
      createFakeWhatsAppMessage({
        id: 'm1',
        conversationId: CONV,
        text: 'Oi',
      }),
    ]),
  )
  mockedKnowledgeRepo.listReadyTextsByWorkspace.mockResolvedValue(ok([]))
  mockedContactRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppContact({ id: 'contact1', waId: '5511988887777' })),
  )
  mockedMessageRepo.create.mockImplementation(async (data) =>
    ok(
      createFakeWhatsAppMessage({
        id: 'out1',
        conversationId: CONV,
        direction: 'OUT',
        text: data.text ?? null,
      }),
    ),
  )
  mockedConversationRepo.update.mockResolvedValue(
    ok(createFakeWhatsAppConversation({ id: CONV })),
  )
  mockedConversationRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConversationWithPreview({ id: CONV })),
  )
  mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
  return { connection, conversation }
}

const generate = (messageId = 'm1') =>
  WhatsAppAiReplyService.generateReply({ conversationId: CONV, messageId })

function withChat<T extends AiProvider['chat']>(chat: T): T {
  mockedAiUsage.prepare.mockResolvedValue(ok(preparedCall(chat)))
  return chat
}

function withReadMedia() {
  mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppAiConfig({
        workspaceId: WS,
        active: true,
        readMedia: true,
        systemPrompt: 'Prompt base.',
      }),
    ),
  )
}

function withHistory(
  ...messages: ReturnType<typeof createFakeWhatsAppMessage>[]
) {
  // O repositório devolve do mais novo para o mais antigo.
  mockedMessageRepo.listLatestByConversation.mockResolvedValue(
    ok(messages.slice().reverse()),
  )
}

type ChatMock = { mock: { calls: unknown[][] } }

function sentMessages(chat: ChatMock, call = 0) {
  return (chat.mock.calls[call][0] as { messages: unknown[] }).messages
}

function systemPrompt(chat: ChatMock) {
  return (chat.mock.calls[0][0] as { system: string }).system
}

describe('WhatsAppAiReplyService.generateReply() — context building', () => {
  it('should inject the knowledge base within the character budget', async () => {
    arrange()
    const chat = withChat(vi.fn(async () => response('Ok')))
    mockedKnowledgeRepo.listReadyTextsByWorkspace.mockResolvedValue(
      ok([
        { filename: 'faq.md', extractedText: 'a'.repeat(15_000) },
        { filename: 'precos.md', extractedText: 'b'.repeat(10_000) },
        { filename: 'ignorado.md', extractedText: 'c'.repeat(100) },
      ]),
    )

    expectOk(await generate())

    const system = systemPrompt(chat)
    expect(system).toContain('Base de conhecimento')
    expect(system).toContain(
      `### faq.md\n${fenced('a'.repeat(15_000), 'knowledge_document')}`,
    )
    expect(system).toContain(
      `### precos.md\n${fenced('b'.repeat(5_000), 'knowledge_document')}`,
    )
    expect(system).not.toContain('b'.repeat(5_001))
    expect(system).not.toContain('ignorado.md')
  })

  it('should omit the knowledge base when its lookup fails', async () => {
    arrange()
    const chat = withChat(vi.fn(async () => response('Ok')))
    mockedKnowledgeRepo.listReadyTextsByWorkspace.mockResolvedValue(
      err(databaseError('db down')),
    )

    expectOk(await generate())

    const system = systemPrompt(chat)
    expect(system).not.toContain('Base de conhecimento')
    expect(system.startsWith('Prompt base.')).toBe(true)
  })

  it('should map history to user/assistant turns with media placeholders', async () => {
    arrange()
    const chat = withChat(vi.fn(async () => response('Ok')))
    withHistory(
      createFakeWhatsAppMessage({
        id: 'h1',
        direction: 'IN',
        type: 'IMAGE',
        text: null,
      }),
      createFakeWhatsAppMessage({
        id: 'h2',
        direction: 'OUT',
        type: 'TEXT',
        text: 'Resposta',
      }),
      createFakeWhatsAppMessage({
        id: 'h3',
        direction: 'IN',
        type: 'AUDIO',
        text: null,
      }),
      createFakeWhatsAppMessage({
        id: 'h4',
        direction: 'IN',
        type: 'VIDEO',
        text: null,
      }),
      createFakeWhatsAppMessage({
        id: 'h5',
        direction: 'IN',
        type: 'DOCUMENT',
        text: null,
      }),
      createFakeWhatsAppMessage({
        id: 'h6',
        direction: 'IN',
        type: 'STICKER' as never,
        text: null,
      }),
    )

    expectOk(await generate('h6'))

    expect(sentMessages(chat)).toEqual([
      { role: 'user', content: fenced('[imagem]') },
      { role: 'assistant', content: 'Resposta' },
      { role: 'user', content: fenced('[áudio]') },
      { role: 'user', content: fenced('[vídeo]') },
      { role: 'user', content: fenced('[documento]') },
      { role: 'user', content: fenced('[mensagem]') },
    ])
  })

  it('should send the triggering image to the model when readMedia is on', async () => {
    arrange()
    withReadMedia()
    const chat = withChat(vi.fn(async () => response('Bonita foto')))
    withHistory(
      createFakeWhatsAppMessage({
        id: 'old',
        direction: 'IN',
        type: 'IMAGE',
        text: null,
        mediaUrl: 'https://cdn.example.com/old.jpg',
      }),
      createFakeWhatsAppMessage({
        id: 'img',
        direction: 'IN',
        type: 'IMAGE',
        text: null,
        mediaUrl: 'https://cdn.example.com/a.jpg',
      }),
      createFakeWhatsAppMessage({
        id: 'cap',
        direction: 'IN',
        type: 'IMAGE',
        text: 'Olha isso',
        mediaUrl: 'https://cdn.example.com/b.jpg',
      }),
    )

    expectOk(await generate('img'))
    expectOk(await generate('cap'))

    expect(sentMessages(chat, 0)).toEqual([
      { role: 'user', content: fenced('[imagem]') },
      {
        role: 'user',
        content: [
          { type: 'text', text: fenced('Imagem enviada pelo cliente') },
          { type: 'image', url: 'https://cdn.example.com/a.jpg' },
        ],
      },
      { role: 'user', content: fenced('Olha isso') },
    ])
    expect(sentMessages(chat, 1)[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: fenced('Olha isso') },
        { type: 'image', url: 'https://cdn.example.com/b.jpg' },
      ],
    })
  })

  it('should keep the text of a triggering video or document', async () => {
    arrange()
    withReadMedia()
    const chat = withChat(vi.fn(async () => response('Ok')))
    withHistory(
      createFakeWhatsAppMessage({
        id: 'vid',
        direction: 'IN',
        type: 'VIDEO',
        text: null,
        mediaUrl: 'https://cdn.example.com/v.mp4',
      }),
    )
    expectOk(await generate('vid'))

    withHistory(
      createFakeWhatsAppMessage({
        id: 'doc',
        direction: 'IN',
        type: 'DOCUMENT',
        text: 'contrato.pdf',
        mediaUrl: 'https://cdn.example.com/c.pdf',
      }),
    )
    expectOk(await generate('doc'))

    expect(sentMessages(chat, 0)).toEqual([
      { role: 'user', content: fenced('[vídeo]') },
    ])
    expect(sentMessages(chat, 1)).toEqual([
      { role: 'user', content: fenced('contrato.pdf') },
    ])
  })

  it('should not re-read outbound media even when it is the trigger', async () => {
    arrange()
    withReadMedia()
    const chat = withChat(vi.fn(async () => response('Ok')))
    withHistory(
      createFakeWhatsAppMessage({
        id: 'out-img',
        direction: 'OUT',
        type: 'IMAGE',
        text: null,
        mediaUrl: 'https://cdn.example.com/out.jpg',
      }),
    )

    expectOk(await generate('out-img'))

    expect(sentMessages(chat)).toEqual([
      { role: 'assistant', content: '[imagem]' },
    ])
  })

  it('should propagate a failure loading the AI config', async () => {
    arrange()
    mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
      err(databaseError('db down')),
    )

    expectErr(await generate(), 'DATABASE_ERROR')
  })

  it('should skip with ai_prepare_failed for other preparation errors', async () => {
    arrange()
    mockedAiUsage.prepare.mockResolvedValue(err(databaseError('db down')))

    expect(expectOk(await generate())).toEqual({
      status: 'skipped',
      reason: 'ai_prepare_failed',
    })
  })

  it('should propagate a failure loading the history', async () => {
    arrange()
    withChat(vi.fn(async () => response('Ok')))
    mockedMessageRepo.listLatestByConversation.mockResolvedValue(
      err(databaseError('db down')),
    )

    expectErr(await generate(), 'DATABASE_ERROR')
  })
})

describe('WhatsAppAiReplyService.generateReply() — audio transcription', () => {
  const transcriptionsCreate = vi.fn()

  function arrangeAudio() {
    arrange()
    withReadMedia()
    withHistory(
      createFakeWhatsAppMessage({
        id: 'aud',
        direction: 'IN',
        type: 'AUDIO',
        text: null,
        mediaUrl: 'https://cdn.example.com/a.ogg',
      }),
    )
    vi.mocked(getOpenAiClient).mockReturnValue({
      audio: { transcriptions: { create: transcriptionsCreate } },
    } as never)
    return withChat(vi.fn(async () => response('Entendi')))
  }

  function stubFetch(okResponse: boolean) {
    const fetchMock = vi.fn(async () => ({
      ok: okResponse,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(getOpenAiClient).mockReturnValue(null)
  })

  it('should send the Whisper transcription of the triggering audio', async () => {
    const chat = arrangeAudio()
    const fetchMock = stubFetch(true)
    transcriptionsCreate.mockResolvedValue({ text: '  quero remarcar  ' })

    expectOk(await generate('aud'))

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/a.ogg')
    expect(transcriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1' }),
    )
    expect(sentMessages(chat)).toEqual([
      { role: 'user', content: fenced('[áudio transcrito] quero remarcar') },
    ])
  })

  it('should fall back to the placeholder for an empty transcription', async () => {
    const chat = arrangeAudio()
    stubFetch(true)
    transcriptionsCreate.mockResolvedValue({ text: '   ' })

    expectOk(await generate('aud'))

    expect(sentMessages(chat)).toEqual([
      { role: 'user', content: fenced('[áudio]') },
    ])
  })

  it('should fall back to the placeholder when the media download fails', async () => {
    const chat = arrangeAudio()
    stubFetch(false)

    expectOk(await generate('aud'))

    expect(transcriptionsCreate).not.toHaveBeenCalled()
    expect(sentMessages(chat)).toEqual([
      { role: 'user', content: fenced('[áudio]') },
    ])
  })

  it.each([
    [new Error('whisper down'), 'whisper down'],
    ['raw failure', 'raw failure'],
  ])(
    'should log and fall back when transcription throws %s',
    async (thrown, logged) => {
      const chat = arrangeAudio()
      stubFetch(true)
      transcriptionsCreate.mockRejectedValue(thrown)

      expectOk(await generate('aud'))

      expect(logger.error).toHaveBeenCalledWith(
        'queue.whatsapp_ai_reply.transcription_failed',
        expect.objectContaining({ message: logged }),
      )
      expect(sentMessages(chat)).toEqual([
        { role: 'user', content: fenced('[áudio]') },
      ])
    },
  )

  it('should use the placeholder without an OpenAI key', async () => {
    const chat = arrangeAudio()
    vi.mocked(getOpenAiClient).mockReturnValue(null)
    const fetchMock = stubFetch(true)

    expectOk(await generate('aud'))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sentMessages(chat)).toEqual([
      { role: 'user', content: fenced('[áudio]') },
    ])
  })
})

describe('WhatsAppAiReplyService.generateReply() — appointment tool', () => {
  function toolUse(...names: string[]): AiChatResponse {
    const toolCalls = names.map((name, i) => ({
      id: `call${i}`,
      name,
      arguments: {},
    }))
    return {
      text: '',
      toolCalls,
      message: { role: 'assistant', content: '', toolCalls },
      usage: { inputTokens: 7, outputTokens: 3 },
      stopReason: 'tool_use',
    }
  }

  function toolMessages(chat: ChatMock) {
    return (sentMessages(chat, 1) as { role: string }[]).filter(
      (m) => m.role === 'tool',
    )
  }

  it('should answer the tool call with the upcoming appointment and sum usage', async () => {
    arrange()
    const chat = withChat(
      vi
        .fn<AiProvider['chat']>()
        .mockResolvedValueOnce(toolUse('consultar_exame_agendado'))
        .mockResolvedValueOnce(response('Seu exame é amanhã.')),
    )
    mockedBroadcastRepo.findUpcomingAppointmentByContact.mockResolvedValue(
      ok({
        appointmentAt: new Date('2026-09-20T13:00:00Z'),
        broadcastList: { name: 'Ultrassom' },
      } as never),
    )

    expect(expectOk(await generate())).toEqual(
      expect.objectContaining({ status: 'sent' }),
    )

    expect(
      mockedBroadcastRepo.findUpcomingAppointmentByContact,
    ).toHaveBeenCalledWith('contact1')
    expect(toolMessages(chat)).toEqual([
      {
        role: 'tool',
        toolCallId: 'call0',
        name: 'consultar_exame_agendado',
        content: JSON.stringify({
          hasAppointment: true,
          appointmentAt: '2026-09-20T13:00:00.000Z',
          description: 'Ultrassom',
        }),
      },
    ])
    expect(chat.mock.calls[1][0]).toEqual(
      expect.objectContaining({ toolChoice: 'none' }),
    )
    expect(mockedAiUsage.record).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: WS,
      userId: null,
      usage: { inputTokens: 17, outputTokens: 8 },
    })
  })

  it('should report no appointment and reject unknown tools', async () => {
    arrange()
    const chat = withChat(
      vi
        .fn<AiProvider['chat']>()
        .mockResolvedValueOnce(
          toolUse('consultar_exame_agendado', 'apagar_tudo'),
        )
        .mockResolvedValueOnce(response('Não encontrei nada marcado.')),
    )
    mockedBroadcastRepo.findUpcomingAppointmentByContact.mockResolvedValue(
      ok(null),
    )

    expectOk(await generate())

    expect(toolMessages(chat)).toEqual([
      expect.objectContaining({
        content: JSON.stringify({ hasAppointment: false }),
      }),
      expect.objectContaining({
        name: 'apagar_tudo',
        content: JSON.stringify({
          error: 'Ferramenta desconhecida: apagar_tudo',
        }),
      }),
    ])
  })

  it('should treat a failed appointment lookup as no appointment', async () => {
    arrange()
    const chat = withChat(
      vi
        .fn<AiProvider['chat']>()
        .mockResolvedValueOnce(toolUse('consultar_exame_agendado'))
        .mockResolvedValueOnce(response('Não achei.')),
    )
    mockedBroadcastRepo.findUpcomingAppointmentByContact.mockResolvedValue(
      err(databaseError('db down')),
    )

    expectOk(await generate())

    expect(toolMessages(chat)[0]).toEqual(
      expect.objectContaining({
        content: JSON.stringify({ hasAppointment: false }),
      }),
    )
  })
})

describe('WhatsAppAiReplyService.generateReply() — delivery edge cases', () => {
  it('should stringify a non-Error provider failure', async () => {
    arrange()
    withChat(
      vi.fn(async () => {
        throw 'rate limited'
      }),
    )

    expect(expectOk(await generate())).toEqual(
      expect.objectContaining({
        status: 'failed',
        reason: 'provider_failed',
        detail: 'rate limited',
        provider: 'openai',
        model: 'gpt-4o-mini',
      }),
    )
  })

  it('should send the fallback message when the reply is only the handoff marker', async () => {
    arrange()
    withChat(vi.fn(async () => response('[[TRANSFERIR_ATENDENTE]]')))

    expect(expectOk(await generate())).toEqual(
      expect.objectContaining({ status: 'sent', handoff: true }),
    )
    expect(mockedSend.text).toHaveBeenCalledWith(expect.anything(), {
      to: '5511988887777',
      text: 'Vou te transferir para um de nossos atendentes, só um momento.',
    })
  })

  it('should propagate a contact lookup failure', async () => {
    arrange()
    withChat(vi.fn(async () => response('Oi')))
    mockedContactRepo.findById.mockResolvedValue(err(databaseError('db down')))

    expectErr(await generate(), 'DATABASE_ERROR')
  })

  it('should skip when the contact no longer exists', async () => {
    arrange()
    withChat(vi.fn(async () => response('Oi')))
    mockedContactRepo.findById.mockResolvedValue(ok(null))

    expect(expectOk(await generate())).toEqual({
      status: 'skipped',
      reason: 'contact_not_found',
    })
    expect(mockedSend.text).not.toHaveBeenCalled()
  })

  it('should propagate a failure persisting the sent message', async () => {
    arrange()
    withChat(vi.fn(async () => response('Oi')))
    mockedMessageRepo.create.mockResolvedValue(err(databaseError('db down')))

    expectErr(await generate(), 'DATABASE_ERROR')
    expect(mockedConversationRepo.update).not.toHaveBeenCalled()
  })

  it('should propagate a failure updating the conversation', async () => {
    arrange()
    withChat(vi.fn(async () => response('Oi')))
    mockedConversationRepo.update.mockResolvedValue(
      err(databaseError('db down')),
    )

    expectErr(await generate(), 'DATABASE_ERROR')
  })

  it('should still report sent when the refreshed conversation is gone', async () => {
    arrange()
    withChat(vi.fn(async () => response('Oi')))
    mockedConversationRepo.findById.mockResolvedValue(ok(null))

    expect(expectOk(await generate())).toEqual({
      status: 'sent',
      messageId: 'out1',
      handoff: false,
    })
  })
})
