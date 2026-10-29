import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeChatbot,
  createFakeChatbotSession,
  createFakePublishedChatbot,
} from '@/src/__tests__/factories/nov-z2-chatbot-builder.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversation } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden, whatsappProviderError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { initialChatbotState } from '@/src/lib/whatsapp/chatbot/engine'
import { menuFlow } from '@/src/lib/whatsapp/chatbot/templates'
import type { ChatbotFlow } from '@/src/schemas/whatsapp-chatbot.schema'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/whatsapp-chatbot.repository')
vi.mock('@/src/repositories/whatsapp-chatbot-session.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-ai-config.repository')
vi.mock('@/src/repositories/whatsapp-button-action.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), buttons: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/whatsapp/chatbot/webhook-call', () => ({
  callChatbotWebhook: vi.fn(async () => ({ ok: true, json: {} })),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappChatbotQueue: vi.fn(),
  getWhatsappAiReplyQueue: vi.fn(),
}))
vi.mock('@/src/services/authz', () => ({ assertMember: vi.fn() }))
vi.mock('@/src/services/whatsapp-sla.service', () => ({
  WhatsAppSlaService: { onClosed: vi.fn(async () => undefined) },
}))
vi.mock('@/src/services/whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: { check: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-distribution.service', () => ({
  WhatsAppDistributionService: { distributeConversation: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => undefined),
  WHATSAPP_NOTIFY_ADMIN_CAP: 20,
  whatsAppConversationPath: (id: string) => `/zap/${id}`,
}))

import { logger } from '@/lib/axiom/logger'
import {
  getWhatsappAiReplyQueue,
  getWhatsappChatbotQueue,
} from '@/src/lib/queue/queues'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppButtonActionRepository } from '@/src/repositories/whatsapp-button-action.repository'
import { WhatsAppChatbotRepository } from '@/src/repositories/whatsapp-chatbot.repository'
import { WhatsAppChatbotSessionRepository } from '@/src/repositories/whatsapp-chatbot-session.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { assertMember } from '@/src/services/authz'
import { WhatsAppBusinessHoursService } from '@/src/services/whatsapp-business-hours.service'
import { WhatsAppDistributionService } from '@/src/services/whatsapp-distribution.service'
import { notifyWhatsAppUsers } from '@/src/services/whatsapp-notify'
import { WhatsAppSlaService } from '@/src/services/whatsapp-sla.service'
import { WhatsAppChatbotRuntimeService } from '../whatsapp-chatbot-runtime.service'

const botRepo = vi.mocked(WhatsAppChatbotRepository)
const sessionRepo = vi.mocked(WhatsAppChatbotSessionRepository)
const convRepo = vi.mocked(WhatsAppConversationRepository)
const eventRepo = vi.mocked(WhatsAppConversationEventRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const aiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const teamRepo = vi.mocked(WhatsAppButtonActionRepository)
const send = vi.mocked(WhatsAppSend)
const hours = vi.mocked(WhatsAppBusinessHoursService)
const distribution = vi.mocked(WhatsAppDistributionService)
const member = vi.mocked(assertMember)
const chatbotQueueAdd = vi.fn()
const aiQueueAdd = vi.fn()

const dbErr = () => err(databaseError('x'))
const connection = createFakeWhatsAppConnection({ id: 'c1', workspaceId: 'ws' })
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: 'ws',
  waId: '5511',
  name: 'Ana',
})

function conversation(overrides = {}) {
  return {
    ...createFakeWhatsAppConversation({
      id: 'cv1',
      workspaceId: 'ws',
      connectionId: 'c1',
      contactId: 'ct1',
      ...overrides,
    }),
    connection,
  }
}

const claimInput = (overrides = {}) => ({
  workspaceId: 'ws',
  connection: { id: 'c1', module: 'COMMUNICATION' },
  conversation: { id: 'cv1', assignedUserId: null, aiHandoff: false },
  messageId: 'm1',
  text: 'oi',
  opening: true,
  ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getWhatsappChatbotQueue).mockReturnValue({
    add: chatbotQueueAdd,
  } as never)
  vi.mocked(getWhatsappAiReplyQueue).mockReturnValue({
    add: aiQueueAdd,
  } as never)
  chatbotQueueAdd.mockResolvedValue(undefined)
  aiQueueAdd.mockResolvedValue(undefined)
  sessionRepo.update.mockResolvedValue(ok(createFakeChatbotSession()))
  sessionRepo.finish.mockResolvedValue(ok(true))
  convRepo.update.mockResolvedValue(ok(createFakeWhatsAppConversation()))
  convRepo.findById.mockResolvedValue(ok(null))
  eventRepo.create.mockResolvedValue(ok({} as never))
})

describe('claimInbound()', () => {
  it('ignores ServiceDesk connections', async () => {
    const result = await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput({ connection: { id: 'c1', module: 'SERVICE_DESK' } }),
    )
    expect(expectOk(result)).toEqual({ engaged: false })
    expect(sessionRepo.findRunningByConversation).not.toHaveBeenCalled()
  })

  it('stops the flow when a person owns the conversation', async () => {
    sessionRepo.findRunningByConversation.mockResolvedValue(
      ok(createFakeChatbotSession({ id: 's1' })),
    )
    const result = await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput({
        conversation: { id: 'cv1', assignedUserId: 'u1', aiHandoff: true },
      }),
    )
    expect(expectOk(result).engaged).toBe(false)
    expect(sessionRepo.finish).toHaveBeenCalledWith(
      's1',
      'CANCELLED',
      'human_took_over',
    )

    sessionRepo.finish.mockClear()
    sessionRepo.findRunningByConversation.mockResolvedValue(ok(null))
    await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput({
        conversation: { id: 'cv1', assignedUserId: 'u1', aiHandoff: true },
      }),
    )
    expect(sessionRepo.finish).not.toHaveBeenCalled()
  })

  it('queues a step for a live session', async () => {
    sessionRepo.findRunningByConversation.mockResolvedValue(
      ok(createFakeChatbotSession({ id: 's1', chatbotId: 'b1' })),
    )
    botRepo.findById.mockResolvedValue(ok(createFakeChatbot({ id: 'b1' })))
    const result = await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput({ opening: false }),
    )
    expect(expectOk(result).engaged).toBe(true)
    expect(chatbotQueueAdd).toHaveBeenCalledWith(
      'run-chatbot-step',
      { sessionId: 's1', messageId: 'm1' },
      { jobId: 'chatbot-step-m1' },
    )
  })

  it('expires a stale session and starts again', async () => {
    const now = new Date('2026-11-11T12:00:00Z')
    sessionRepo.findRunningByConversation.mockResolvedValueOnce(
      ok(
        createFakeChatbotSession({
          id: 's1',
          chatbotId: 'b1',
          lastActivityAt: new Date('2026-11-10T00:00:00Z'),
        }),
      ),
    )
    botRepo.findById.mockResolvedValue(
      ok(createFakeChatbot({ id: 'b1', sessionTtlMinutes: 60 })),
    )
    botRepo.listRunnable.mockResolvedValue(
      ok([createFakePublishedChatbot(menuFlow(), { id: 'b1' })]),
    )
    sessionRepo.createRunning.mockResolvedValue(
      ok(createFakeChatbotSession({ id: 's2' })),
    )
    const result = await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput({ now }),
    )
    expect(expectOk(result).engaged).toBe(true)
    expect(sessionRepo.finish).toHaveBeenCalledWith('s1', 'EXPIRED', 'timeout')
    expect(chatbotQueueAdd).toHaveBeenCalledWith(
      'run-chatbot-step',
      { sessionId: 's2', messageId: 'm1' },
      expect.any(Object),
    )
  })

  it('expires a session whose bot was deleted', async () => {
    sessionRepo.findRunningByConversation.mockResolvedValue(
      ok(createFakeChatbotSession({ id: 's1' })),
    )
    botRepo.findById.mockResolvedValue(ok(null))
    botRepo.listRunnable.mockResolvedValue(ok([]))
    const result = await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput(),
    )
    expect(expectOk(result).engaged).toBe(false)
    expect(sessionRepo.finish).toHaveBeenCalledWith('s1', 'EXPIRED', 'timeout')
  })

  it('does not restart after a handoff', async () => {
    sessionRepo.findRunningByConversation.mockResolvedValue(ok(null))
    const result = await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput({
        conversation: { id: 'cv1', assignedUserId: null, aiHandoff: true },
      }),
    )
    expect(expectOk(result).engaged).toBe(false)
    expect(botRepo.listRunnable).not.toHaveBeenCalled()
  })

  it('does nothing without a matching bot', async () => {
    sessionRepo.findRunningByConversation.mockResolvedValue(ok(null))
    botRepo.listRunnable.mockResolvedValue(ok([]))
    expect(
      expectOk(await WhatsAppChatbotRuntimeService.claimInbound(claimInput()))
        .engaged,
    ).toBe(false)

    botRepo.listRunnable.mockResolvedValue(
      ok([
        createFakePublishedChatbot(menuFlow(), {
          triggerKind: 'KEYWORD',
          keywords: ['orcamento'],
        }),
      ]),
    )
    expect(
      expectOk(await WhatsAppChatbotRuntimeService.claimInbound(claimInput()))
        .engaged,
    ).toBe(false)
  })

  it('starts a keyword bot in an existing conversation', async () => {
    sessionRepo.findRunningByConversation.mockResolvedValue(ok(null))
    botRepo.listRunnable.mockResolvedValue(
      ok([
        createFakePublishedChatbot(menuFlow(), {
          triggerKind: 'KEYWORD',
          keywords: ['orcamento'],
        }),
      ]),
    )
    sessionRepo.createRunning.mockResolvedValue(
      ok(createFakeChatbotSession({ id: 's9' })),
    )
    const result = await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput({ opening: false, text: 'quero um orçamento' }),
    )
    expect(expectOk(result).engaged).toBe(true)
    expect(convRepo.update).toHaveBeenCalledWith('cv1', { aiActive: false })
  })

  describe('outside business hours trigger', () => {
    beforeEach(() => {
      sessionRepo.findRunningByConversation.mockResolvedValue(ok(null))
      botRepo.listRunnable.mockResolvedValue(
        ok([
          createFakePublishedChatbot(menuFlow(), {
            triggerKind: 'OUTSIDE_BUSINESS_HOURS',
          }),
        ]),
      )
      sessionRepo.createRunning.mockResolvedValue(
        ok(createFakeChatbotSession({ id: 's3' })),
      )
    })

    it('starts only when the hours are on and closed', async () => {
      hours.check.mockResolvedValue(
        ok({
          open: false,
          nextOpeningAt: null,
          hours: { enabled: true },
        } as never),
      )
      expect(
        expectOk(await WhatsAppChatbotRuntimeService.claimInbound(claimInput()))
          .engaged,
      ).toBe(true)
    })

    it.each([
      ['open', { open: true, hours: { enabled: true } }],
      ['disabled', { open: false, hours: { enabled: false } }],
    ])('does not start when the hours are %s', async (_label, value) => {
      hours.check.mockResolvedValue(ok(value as never))
      expect(
        expectOk(await WhatsAppChatbotRuntimeService.claimInbound(claimInput()))
          .engaged,
      ).toBe(false)
    })

    it('does not start when the hours cannot be read', async () => {
      hours.check.mockResolvedValue(dbErr())
      expect(
        expectOk(await WhatsAppChatbotRuntimeService.claimInbound(claimInput()))
          .engaged,
      ).toBe(false)
    })
  })

  it('reuses the winner when another message created the session first', async () => {
    sessionRepo.findRunningByConversation
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(createFakeChatbotSession({ id: 'winner' })))
    botRepo.listRunnable.mockResolvedValue(ok([createFakePublishedChatbot()]))
    sessionRepo.createRunning.mockResolvedValue(ok(null))
    const result = await WhatsAppChatbotRuntimeService.claimInbound(
      claimInput(),
    )
    expect(expectOk(result).engaged).toBe(true)
    expect(chatbotQueueAdd).toHaveBeenCalledWith(
      'run-chatbot-step',
      { sessionId: 'winner', messageId: 'm1' },
      expect.any(Object),
    )
  })

  it('backs off when nobody owns the session after a lost race', async () => {
    sessionRepo.findRunningByConversation
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(null))
    botRepo.listRunnable.mockResolvedValue(ok([createFakePublishedChatbot()]))
    sessionRepo.createRunning.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppChatbotRuntimeService.claimInbound(claimInput()))
        .engaged,
    ).toBe(false)

    sessionRepo.findRunningByConversation
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.claimInbound(claimInput()),
      'DATABASE_ERROR',
    )
  })

  it('propagates repository failures', async () => {
    sessionRepo.findRunningByConversation.mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.claimInbound(claimInput()),
      'DATABASE_ERROR',
    )

    sessionRepo.findRunningByConversation.mockResolvedValue(
      ok(createFakeChatbotSession()),
    )
    botRepo.findById.mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.claimInbound(claimInput()),
      'DATABASE_ERROR',
    )

    sessionRepo.findRunningByConversation.mockResolvedValue(ok(null))
    botRepo.listRunnable.mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.claimInbound(claimInput()),
      'DATABASE_ERROR',
    )

    botRepo.listRunnable.mockResolvedValue(ok([createFakePublishedChatbot()]))
    sessionRepo.createRunning.mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.claimInbound(claimInput()),
      'DATABASE_ERROR',
    )
  })

  it('reports a queue failure', async () => {
    sessionRepo.findRunningByConversation.mockResolvedValue(ok(null))
    botRepo.listRunnable.mockResolvedValue(ok([createFakePublishedChatbot()]))
    sessionRepo.createRunning.mockResolvedValue(ok(createFakeChatbotSession()))
    chatbotQueueAdd.mockRejectedValueOnce(new Error('redis down'))
    expectErr(
      await WhatsAppChatbotRuntimeService.claimInbound(claimInput()),
      'DATABASE_ERROR',
    )
    chatbotQueueAdd.mockRejectedValueOnce('weird')
    expectErr(
      await WhatsAppChatbotRuntimeService.claimInbound(claimInput()),
      'DATABASE_ERROR',
    )
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('runStep()', () => {
  const step = { sessionId: 's1', messageId: 'm1' }

  function prepare(
    options: {
      flow?: ChatbotFlow
      state?: unknown
      conversationOverrides?: object
      text?: string
      buttonPayload?: string | null
    } = {},
  ) {
    sessionRepo.findById.mockResolvedValue(
      ok(
        createFakeChatbotSession({
          id: 's1',
          definition: (options.flow ?? menuFlow()) as never,
          state: (options.state ?? initialChatbotState()) as never,
        }),
      ),
    )
    convRepo.findByIdWithConnection.mockResolvedValue(
      ok(conversation(options.conversationOverrides)),
    )
    contactRepo.findById.mockResolvedValue(ok(contact))
    messageRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppMessage({
          id: 'm1',
          text: options.text ?? 'oi',
          buttonPayload: options.buttonPayload ?? null,
        }),
      ),
    )
    messageRepo.create.mockImplementation(async (data) =>
      ok(createFakeWhatsAppMessage({ ...(data as object) } as never)),
    )
    send.buttons.mockResolvedValue(ok({ providerMessageId: 'p1' }))
    send.text.mockResolvedValue(ok({ providerMessageId: 'p2' }))
  }

  const waitingMenuState = {
    started: true,
    awaiting: { kind: 'menu', nodeId: 'menu', attempts: 0 },
    variables: {},
  }

  it('skips sessions that are gone or finished', async () => {
    sessionRepo.findById.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppChatbotRuntimeService.runStep(step)).status,
    ).toBe('skipped')
    sessionRepo.findById.mockResolvedValue(
      ok(createFakeChatbotSession({ status: 'COMPLETED' })),
    )
    expect(
      expectOk(await WhatsAppChatbotRuntimeService.runStep(step)).status,
    ).toBe('skipped')
  })

  it('starts the flow, sends the menu with buttons and keeps waiting', async () => {
    prepare()
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toEqual({
      status: 'ran',
      sessionStatus: 'RUNNING',
      sent: 1,
    })
    expect(send.buttons).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        to: '5511',
        buttons: expect.arrayContaining([
          expect.objectContaining({ id: 'bot:menu:sales', type: 'REPLY' }),
        ]),
      }),
      expect.any(Object),
    )
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'OUT', buttons: expect.any(Array) }),
    )
    expect(sessionRepo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ state: expect.any(Object) }),
    )
  })

  it('falls back to numbered text when the provider refuses buttons', async () => {
    prepare()
    send.buttons.mockResolvedValue(err(whatsappProviderError('no buttons')))
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toMatchObject({ sessionStatus: 'RUNNING', sent: 1 })
    expect(send.text).toHaveBeenCalledWith(
      connection,
      { to: '5511', text: expect.stringContaining('1. Comercial') },
      expect.any(Object),
    )
  })

  it('sends a long menu as numbered text directly', async () => {
    const options = Array.from({ length: 5 }, (_, index) => ({
      id: `o${index}`,
      label: `Opção ${index}`,
    }))
    const flow: ChatbotFlow = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'menu',
          type: 'menu',
          position: { x: 0, y: 0 },
          data: { text: 'Escolha', options, maxAttempts: 2 },
        },
      ],
      edges: [
        { id: 'e', source: 'start', sourceHandle: 'next', target: 'menu' },
      ],
    }
    prepare({ flow })
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(send.buttons).not.toHaveBeenCalled()
    expect(send.text).toHaveBeenCalled()
  })

  it('hands the conversation to a team queue on a menu choice', async () => {
    const flow = menuFlow()
    const handoff = flow.nodes.find((node) => node.id === 'to-sales')
    if (handoff?.type !== 'handoff-human') throw new Error('fixture')
    handoff.data.teamId = 't1'
    prepare({
      flow,
      state: waitingMenuState,
      buttonPayload: 'bot:menu:sales',
      text: 'Comercial',
    })
    teamRepo.findTeam.mockResolvedValue(
      ok({ id: 't1', name: 'Vendas', memberIds: ['u1', 'u2'] }),
    )
    distribution.distributeConversation.mockResolvedValue(
      ok({ assigned: false } as never),
    )
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toMatchObject({ sessionStatus: 'HANDED_OFF_HUMAN' })
    expect(convRepo.update).toHaveBeenCalledWith(
      'cv1',
      expect.objectContaining({
        teamId: 't1',
        assignedUserId: null,
        aiActive: false,
        aiHandoff: true,
      }),
    )
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CHATBOT_HANDOFF',
        source: 'CHATBOT',
        reason: 'Equipe Vendas',
      }),
    )
    expect(notifyWhatsAppUsers).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['u1', 'u2'] }),
    )
    expect(sessionRepo.finish).toHaveBeenCalledWith(
      's1',
      'HANDED_OFF_HUMAN',
      'handoff_human',
      expect.any(Object),
    )
  })

  it('does not notify the team when the distribution assigned an agent', async () => {
    const flow = menuFlow()
    const handoff = flow.nodes.find((node) => node.id === 'to-sales')
    if (handoff?.type !== 'handoff-human') throw new Error('fixture')
    handoff.data.teamId = 't1'
    prepare({ flow, state: waitingMenuState, text: '1' })
    teamRepo.findTeam.mockResolvedValue(
      ok({ id: 't1', name: 'Vendas', memberIds: ['u1'] }),
    )
    distribution.distributeConversation.mockResolvedValue(
      ok({ assigned: true } as never),
    )
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(notifyWhatsAppUsers).not.toHaveBeenCalled()
  })

  it('falls back to the general queue when the team is gone', async () => {
    const flow = menuFlow()
    const handoff = flow.nodes.find((node) => node.id === 'to-sales')
    if (handoff?.type !== 'handoff-human') throw new Error('fixture')
    handoff.data.teamId = 't1'
    prepare({ flow, state: waitingMenuState, text: '1' })
    teamRepo.findTeam.mockResolvedValue(ok(null))
    distribution.distributeConversation.mockResolvedValue(dbErr())
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Fila de atendimento' }),
    )
    expect(convRepo.update).toHaveBeenCalledWith(
      'cv1',
      expect.not.objectContaining({ teamId: expect.anything() }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.chatbot.handoff_team_missing',
      expect.any(Object),
    )
  })

  it('assigns straight to an agent when the handoff names one', async () => {
    const flow = menuFlow()
    const handoff = flow.nodes.find((node) => node.id === 'to-sales')
    if (handoff?.type !== 'handoff-human') throw new Error('fixture')
    handoff.data.userId = 'agent1'
    prepare({ flow, state: waitingMenuState, text: '1' })
    member.mockResolvedValue(ok({} as never))
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(convRepo.update).toHaveBeenCalledWith(
      'cv1',
      expect.objectContaining({
        assignedUserId: 'agent1',
        status: 'IN_PROGRESS',
      }),
    )
    expect(notifyWhatsAppUsers).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['agent1'] }),
    )
  })

  it('queues the conversation when the named agent left the workspace', async () => {
    const flow = menuFlow()
    const handoff = flow.nodes.find((node) => node.id === 'to-sales')
    if (handoff?.type !== 'handoff-human') throw new Error('fixture')
    handoff.data.userId = 'gone'
    prepare({ flow, state: waitingMenuState, text: '1' })
    member.mockResolvedValue(err(forbidden()))
    distribution.distributeConversation.mockResolvedValue(
      ok({ assigned: false } as never),
    )
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Fila de atendimento' }),
    )
  })

  it('hands over to the AI when it is on', async () => {
    prepare({ state: waitingMenuState, text: '3' })
    aiConfigRepo.findByWorkspace.mockResolvedValue(
      ok({ active: true } as never),
    )
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toMatchObject({ sessionStatus: 'HANDED_OFF_AI' })
    expect(convRepo.update).toHaveBeenCalledWith('cv1', {
      aiActive: true,
      aiHandoff: false,
    })
    expect(aiQueueAdd).toHaveBeenCalledWith('generate-ai-reply', {
      conversationId: 'cv1',
      messageId: 'm1',
    })
  })

  it.each([
    ['off', ok({ active: false } as never)],
    ['missing', ok(null)],
    ['unreadable', dbErr()],
  ])('hands over to a person when the AI is %s', async (_label, config) => {
    prepare({ state: waitingMenuState, text: '3' })
    aiConfigRepo.findByWorkspace.mockResolvedValue(config as never)
    distribution.distributeConversation.mockResolvedValue(
      ok({ assigned: false } as never),
    )
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toMatchObject({ sessionStatus: 'HANDED_OFF_HUMAN' })
    expect(sessionRepo.finish).toHaveBeenCalledWith(
      's1',
      'HANDED_OFF_HUMAN',
      'ai_inactive',
      expect.any(Object),
    )
    expect(aiQueueAdd).not.toHaveBeenCalled()
  })

  it('passes the AI instruction of the node', async () => {
    const flow = menuFlow()
    const node = flow.nodes.find((item) => item.id === 'to-ai')
    if (node?.type !== 'handoff-ai') throw new Error('fixture')
    node.data.instruction = 'Seja breve'
    prepare({ flow, state: waitingMenuState, text: '3' })
    aiConfigRepo.findByWorkspace.mockResolvedValue(
      ok({ active: true } as never),
    )
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(aiQueueAdd).toHaveBeenCalledWith(
      'generate-ai-reply',
      expect.objectContaining({ instruction: 'Seja breve' }),
    )
  })

  it('closes the conversation when the end node asks to', async () => {
    const flow: ChatbotFlow = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'end',
          type: 'end',
          position: { x: 0, y: 0 },
          data: { text: 'Tchau', closeConversation: true },
        },
      ],
      edges: [
        { id: 'e', source: 'start', sourceHandle: 'next', target: 'end' },
      ],
    }
    prepare({ flow })
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toMatchObject({ sessionStatus: 'COMPLETED', sent: 1 })
    expect(convRepo.update).toHaveBeenCalledWith(
      'cv1',
      expect.objectContaining({ status: 'CLOSED' }),
    )
    expect(WhatsAppSlaService.onClosed).toHaveBeenCalled()
  })

  it('completes without closing when the flow just ends', async () => {
    const flow: ChatbotFlow = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'm',
          type: 'message',
          position: { x: 0, y: 0 },
          data: { text: 'Oi' },
        },
      ],
      edges: [{ id: 'e', source: 'start', sourceHandle: 'next', target: 'm' }],
    }
    prepare({ flow })
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(convRepo.update).not.toHaveBeenCalledWith(
      'cv1',
      expect.objectContaining({ status: 'CLOSED' }),
    )
  })

  it('sends a person to a broken flow (loop guard)', async () => {
    const flow: ChatbotFlow = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'a',
          type: 'set-variable',
          position: { x: 0, y: 0 },
          data: { variable: 'x', value: '1' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', sourceHandle: 'next', target: 'a' },
        { id: 'e2', source: 'a', sourceHandle: 'next', target: 'a' },
      ],
    }
    prepare({ flow })
    distribution.distributeConversation.mockResolvedValue(
      ok({ assigned: false } as never),
    )
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toMatchObject({ sessionStatus: 'FAILED' })
  })

  it('fails the session and queues the conversation when sending fails', async () => {
    prepare()
    send.buttons.mockResolvedValue(err(whatsappProviderError('down')))
    send.text.mockResolvedValue(err(whatsappProviderError('down')))
    distribution.distributeConversation.mockResolvedValue(
      ok({ assigned: false } as never),
    )
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toEqual({ status: 'ran', sessionStatus: 'FAILED', sent: 0 })
    expect(sessionRepo.finish).toHaveBeenCalledWith(
      's1',
      'FAILED',
      'send_failed',
      expect.any(Object),
    )
    expect(logger.error).toHaveBeenCalled()
  })

  it('fails when the message cannot be saved after sending', async () => {
    prepare()
    messageRepo.create.mockResolvedValue(dbErr())
    distribution.distributeConversation.mockResolvedValue(
      ok({ assigned: false } as never),
    )
    const outcome = expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(outcome).toMatchObject({ sessionStatus: 'FAILED' })
  })

  it('cancels when a person owns the conversation or it closed', async () => {
    prepare({ conversationOverrides: { assignedUserId: 'u1' } })
    expect(expectOk(await WhatsAppChatbotRuntimeService.runStep(step))).toEqual(
      {
        status: 'skipped',
        reason: 'conversation_taken',
      },
    )
    expect(sessionRepo.finish).toHaveBeenCalledWith(
      's1',
      'CANCELLED',
      'human_took_over',
    )

    prepare({ conversationOverrides: { status: 'CLOSED' } })
    await WhatsAppChatbotRuntimeService.runStep(step)
    expect(sessionRepo.finish).toHaveBeenCalledWith(
      's1',
      'CANCELLED',
      'conversation_closed',
    )
  })

  it('cancels when the conversation is gone', async () => {
    prepare()
    convRepo.findByIdWithConnection.mockResolvedValue(ok(null))
    expect(expectOk(await WhatsAppChatbotRuntimeService.runStep(step))).toEqual(
      {
        status: 'skipped',
        reason: 'conversation_gone',
      },
    )
    convRepo.findByIdWithConnection.mockResolvedValue(
      ok(conversation({ deletedAt: new Date() })),
    )
    expect(
      expectOk(await WhatsAppChatbotRuntimeService.runStep(step)).status,
    ).toBe('skipped')
  })

  it('fails the session when the contact or message vanished', async () => {
    prepare()
    contactRepo.findById.mockResolvedValue(ok(null))
    expect(expectOk(await WhatsAppChatbotRuntimeService.runStep(step))).toEqual(
      {
        status: 'skipped',
        reason: 'missing_data',
      },
    )
    expect(sessionRepo.finish).toHaveBeenCalledWith(
      's1',
      'FAILED',
      'missing_data',
    )
    prepare()
    messageRepo.findById.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppChatbotRuntimeService.runStep(step)).status,
    ).toBe('skipped')
  })

  it('propagates database failures so the job retries', async () => {
    sessionRepo.findById.mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.runStep(step),
      'DATABASE_ERROR',
    )

    prepare()
    convRepo.findByIdWithConnection.mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.runStep(step),
      'DATABASE_ERROR',
    )

    prepare()
    contactRepo.findById.mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.runStep(step),
      'DATABASE_ERROR',
    )

    prepare()
    messageRepo.findById.mockResolvedValueOnce(dbErr())
    expectErr(
      await WhatsAppChatbotRuntimeService.runStep(step),
      'DATABASE_ERROR',
    )
  })

  it('publishes the updated conversation after a handoff', async () => {
    prepare({ state: waitingMenuState, text: '3' })
    aiConfigRepo.findByWorkspace.mockResolvedValue(
      ok({ active: true } as never),
    )
    convRepo.findById.mockResolvedValue(ok(null))
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(convRepo.findById).toHaveBeenCalledWith('cv1', 'ws')
  })

  it('keeps going when the timeline event cannot be written', async () => {
    prepare({ state: waitingMenuState, text: '3' })
    aiConfigRepo.findByWorkspace.mockResolvedValue(
      ok({ active: true } as never),
    )
    eventRepo.create.mockResolvedValue(dbErr())
    expectOk(await WhatsAppChatbotRuntimeService.runStep(step))
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.chatbot.event_failed',
      expect.any(Object),
    )
  })
})
