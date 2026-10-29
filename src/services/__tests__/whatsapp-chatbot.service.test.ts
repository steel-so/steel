import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeChatbot,
  createFakeChatbotSession,
  createFakePublishedChatbot,
} from '@/src/__tests__/factories/nov-z2-chatbot-builder.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'
import { blankFlow, menuFlow } from '@/src/lib/whatsapp/chatbot/templates'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-chatbot.repository')
vi.mock('@/src/repositories/whatsapp-chatbot-session.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-button-action.repository')

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppButtonActionRepository } from '@/src/repositories/whatsapp-button-action.repository'
import { WhatsAppChatbotRepository } from '@/src/repositories/whatsapp-chatbot.repository'
import { WhatsAppChatbotSessionRepository } from '@/src/repositories/whatsapp-chatbot-session.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import {
  WHATSAPP_CHATBOT_MAX_PER_WORKSPACE,
  WhatsAppChatbotService,
} from '../whatsapp-chatbot.service'

const membershipRepo = vi.mocked(MembershipRepository)
const botRepo = vi.mocked(WhatsAppChatbotRepository)
const sessionRepo = vi.mocked(WhatsAppChatbotSessionRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const teamRepo = vi.mocked(WhatsAppButtonActionRepository)

const asRole = (role: 'OWNER' | 'ADMIN' | 'MEMBER') =>
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const createInput = {
  name: 'Bot',
  triggerKind: 'NEW_CONVERSATION' as const,
  keywords: [],
  sessionTtlMinutes: 720,
  template: 'menu' as const,
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('WhatsAppChatbotService', () => {
  describe('authorization', () => {
    it('lets any member read but only admins change', async () => {
      asRole('MEMBER')
      botRepo.listByWorkspace.mockResolvedValue(ok([]))
      botRepo.sessionCounts.mockResolvedValue(ok([]))
      expectOk(await WhatsAppChatbotService.list('u', 'ws'))

      expectErr(
        await WhatsAppChatbotService.create('u', 'ws', createInput),
        'FORBIDDEN',
      )
      expectErr(
        await WhatsAppChatbotService.update('u', 'ws', 'b', { name: 'x' }),
        'FORBIDDEN',
      )
      expectErr(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
        'FORBIDDEN',
      )
      expectErr(
        await WhatsAppChatbotService.validate('u', 'ws', 'b'),
        'FORBIDDEN',
      )
      expectErr(
        await WhatsAppChatbotService.setStatus('u', 'ws', 'b', {
          status: 'PAUSED',
        }),
        'FORBIDDEN',
      )
      expectErr(
        await WhatsAppChatbotService.remove('u', 'ws', 'b'),
        'FORBIDDEN',
      )
      expectErr(
        await WhatsAppChatbotService.simulate('u', 'ws', 'b', {}),
        'FORBIDDEN',
      )
    })

    it('refuses non-members everywhere', async () => {
      membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await WhatsAppChatbotService.list('u', 'ws'), 'FORBIDDEN')
      expectErr(await WhatsAppChatbotService.get('u', 'ws', 'b'), 'FORBIDDEN')
      expectErr(
        await WhatsAppChatbotService.sessions('u', 'ws', 'b', { limit: 10 }),
        'FORBIDDEN',
      )
    })
  })

  describe('list()', () => {
    it('adds the 30-day stats of each bot', async () => {
      asRole('MEMBER')
      const bot = createFakePublishedChatbot()
      botRepo.listByWorkspace.mockResolvedValue(ok([bot]))
      botRepo.sessionCounts.mockResolvedValue(
        ok([
          { chatbotId: bot.id, status: 'RUNNING', count: 1 },
          { chatbotId: bot.id, status: 'COMPLETED', count: 2 },
          { chatbotId: bot.id, status: 'HANDED_OFF_HUMAN', count: 3 },
          { chatbotId: bot.id, status: 'HANDED_OFF_AI', count: 4 },
          { chatbotId: bot.id, status: 'EXPIRED', count: 5 },
          { chatbotId: bot.id, status: 'CANCELLED', count: 6 },
          { chatbotId: bot.id, status: 'FAILED', count: 7 },
          { chatbotId: 'other', status: 'COMPLETED', count: 99 },
        ]),
      )
      const [item] = expectOk(await WhatsAppChatbotService.list('u', 'ws'))
      expect(item.stats).toEqual({
        sessions: 28,
        running: 1,
        completed: 2,
        handedOffHuman: 3,
        handedOffAi: 4,
        expired: 5,
        cancelled: 6,
        failed: 7,
      })
    })

    it('propagates database errors', async () => {
      asRole('MEMBER')
      botRepo.listByWorkspace.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(await WhatsAppChatbotService.list('u', 'ws'), 'DATABASE_ERROR')

      botRepo.listByWorkspace.mockResolvedValue(ok([]))
      botRepo.sessionCounts.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(await WhatsAppChatbotService.list('u', 'ws'), 'DATABASE_ERROR')
    })
  })

  describe('get()', () => {
    it('returns the bot with its draft flow', async () => {
      asRole('MEMBER')
      botRepo.findById.mockResolvedValue(ok(createFakePublishedChatbot()))
      const dto = expectOk(await WhatsAppChatbotService.get('u', 'ws', 'b'))
      expect(dto.flow.nodes.length).toBeGreaterThan(0)
    })

    it('is not found for another workspace', async () => {
      asRole('MEMBER')
      botRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.get('u', 'ws', 'b'),
        'WHATSAPP_CHATBOT_NOT_FOUND',
      )
    })

    it('propagates database errors', async () => {
      asRole('MEMBER')
      botRepo.findById.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.get('u', 'ws', 'b'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('create()', () => {
    beforeEach(() => {
      asRole('ADMIN')
      botRepo.count.mockResolvedValue(ok(0))
      botRepo.create.mockImplementation(async (data) =>
        ok(createFakeChatbot({ ...data, draft: data.draft as never })),
      )
    })

    it('creates a draft from the chosen template', async () => {
      const dto = expectOk(
        await WhatsAppChatbotService.create('u', 'ws', createInput),
      )
      expect(dto.status).toBe('DRAFT')
      expect(dto.flow.nodes.some((node) => node.type === 'menu')).toBe(true)
      expect(botRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws', createdByUserId: 'u' }),
      )
    })

    it('requires keywords for the keyword trigger', async () => {
      expectErr(
        await WhatsAppChatbotService.create('u', 'ws', {
          ...createInput,
          triggerKind: 'KEYWORD',
        }),
        'VALIDATION_ERROR',
      )
    })

    it('checks that the connection belongs to the workspace', async () => {
      connectionRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.create('u', 'ws', {
          ...createInput,
          connectionId: 'c1',
        }),
        'WHATSAPP_CONNECTION_NOT_FOUND',
      )
      connectionRepo.findById.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.create('u', 'ws', {
          ...createInput,
          connectionId: 'c1',
        }),
        'DATABASE_ERROR',
      )
    })

    it('accepts a valid connection', async () => {
      connectionRepo.findById.mockResolvedValue(ok({ id: 'c1' } as never))
      expectOk(
        await WhatsAppChatbotService.create('u', 'ws', {
          ...createInput,
          connectionId: 'c1',
        }),
      )
    })

    it('enforces the per-workspace limit', async () => {
      botRepo.count.mockResolvedValue(ok(WHATSAPP_CHATBOT_MAX_PER_WORKSPACE))
      expectErr(
        await WhatsAppChatbotService.create('u', 'ws', createInput),
        'WHATSAPP_CHATBOT_LIMIT_REACHED',
      )
      botRepo.count.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.create('u', 'ws', createInput),
        'DATABASE_ERROR',
      )
    })

    it('propagates a failed insert', async () => {
      botRepo.create.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.create('u', 'ws', createInput),
        'DATABASE_ERROR',
      )
    })
  })

  describe('update()', () => {
    beforeEach(() => {
      asRole('OWNER')
      botRepo.findById.mockResolvedValue(ok(createFakeChatbot({ id: 'b' })))
      botRepo.update.mockImplementation(async (id, data) =>
        ok(createFakeChatbot({ id, name: String(data.name ?? 'Bot') })),
      )
    })

    it('saves the draft flow and fields', async () => {
      const dto = expectOk(
        await WhatsAppChatbotService.update('u', 'ws', 'b', {
          name: 'Novo',
          flow: blankFlow(),
        }),
      )
      expect(dto.name).toBe('Novo')
      expect(botRepo.update).toHaveBeenCalledWith(
        'b',
        expect.objectContaining({ name: 'Novo', draft: expect.any(Object) }),
      )
    })

    it('saves without touching the draft when no flow is sent', async () => {
      expectOk(
        await WhatsAppChatbotService.update('u', 'ws', 'b', { name: 'x' }),
      )
      expect(botRepo.update.mock.calls[0]?.[1]).not.toHaveProperty('draft')
    })

    it('is not found for an unknown bot', async () => {
      botRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.update('u', 'ws', 'b', { name: 'x' }),
        'WHATSAPP_CHATBOT_NOT_FOUND',
      )
    })

    it('keeps the keyword trigger valid', async () => {
      expectErr(
        await WhatsAppChatbotService.update('u', 'ws', 'b', {
          triggerKind: 'KEYWORD',
        }),
        'VALIDATION_ERROR',
      )
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ triggerKind: 'KEYWORD', keywords: ['oi'] })),
      )
      expectErr(
        await WhatsAppChatbotService.update('u', 'ws', 'b', { keywords: [] }),
        'VALIDATION_ERROR',
      )
    })

    it('checks the connection and propagates update errors', async () => {
      connectionRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.update('u', 'ws', 'b', {
          connectionId: 'c',
        }),
        'WHATSAPP_CONNECTION_NOT_FOUND',
      )
      connectionRepo.findById.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.update('u', 'ws', 'b', {
          connectionId: 'c',
        }),
        'DATABASE_ERROR',
      )
      connectionRepo.findById.mockResolvedValue(ok({ id: 'c' } as never))
      botRepo.update.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.update('u', 'ws', 'b', {
          connectionId: 'c',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('publish() and validate()', () => {
    beforeEach(() => {
      asRole('ADMIN')
      botRepo.update.mockImplementation(async (id, data) =>
        ok(
          createFakePublishedChatbot(menuFlow(), {
            id,
            publishedVersion: 2,
            status: data.status as never,
          }),
        ),
      )
    })

    it('publishes a valid draft and activates a draft bot', async () => {
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ id: 'b', draft: menuFlow() as never })),
      )
      const result = expectOk(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
      )
      expect(result.chatbot.publishedVersion).toBe(2)
      expect(botRepo.update).toHaveBeenCalledWith(
        'b',
        expect.objectContaining({
          status: 'ACTIVE',
          published: expect.any(Object),
        }),
      )
    })

    it('keeps a paused bot paused', async () => {
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ status: 'PAUSED', draft: menuFlow() as never })),
      )
      expectOk(await WhatsAppChatbotService.publish('u', 'ws', 'b'))
      expect(botRepo.update).toHaveBeenCalledWith(
        'b',
        expect.objectContaining({ status: 'PAUSED' }),
      )
    })

    it('refuses a flow with structural errors', async () => {
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ draft: { nodes: [], edges: [] } as never })),
      )
      expectErr(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
        'WHATSAPP_CHATBOT_INVALID_FLOW',
      )
      expect(botRepo.update).not.toHaveBeenCalled()
    })

    const handoffDraft = (data: { teamId?: string; userId?: string }) =>
      ({
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'h', type: 'handoff-human', position: { x: 0, y: 0 }, data },
        ],
        edges: [
          { id: 'e', source: 'start', sourceHandle: 'next', target: 'h' },
        ],
      }) as never

    it('refuses a handoff to a team that no longer exists', async () => {
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ draft: handoffDraft({ teamId: 't1' }) })),
      )
      teamRepo.findTeam.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
        'WHATSAPP_CHATBOT_INVALID_FLOW',
      )
      teamRepo.findTeam.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
        'DATABASE_ERROR',
      )
    })

    it('refuses a handoff to an agent outside the workspace', async () => {
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ draft: handoffDraft({ userId: 'gone' }) })),
      )
      membershipRepo.findByUserAndWorkspace
        .mockResolvedValueOnce(ok(createFakeMembership({ role: 'ADMIN' })))
        .mockResolvedValueOnce(ok(null))
      expectErr(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
        'WHATSAPP_CHATBOT_INVALID_FLOW',
      )
    })

    it('accepts a handoff to an existing team and agent', async () => {
      botRepo.findById.mockResolvedValue(
        ok(
          createFakeChatbot({
            draft: handoffDraft({ teamId: 't1', userId: 'a1' }),
          }),
        ),
      )
      teamRepo.findTeam.mockResolvedValue(
        ok({ id: 't1', name: 'Suporte', memberIds: [] }),
      )
      const result = expectOk(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
      )
      // Team and agent together is only a warning.
      expect(result.issues.some((issue) => issue.severity === 'warning')).toBe(
        true,
      )
    })

    it('propagates load and update failures', async () => {
      botRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
        'WHATSAPP_CHATBOT_NOT_FOUND',
      )
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ draft: menuFlow() as never })),
      )
      botRepo.update.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.publish('u', 'ws', 'b'),
        'DATABASE_ERROR',
      )
    })

    it('validate() reports issues without saving', async () => {
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ draft: { nodes: [], edges: [] } as never })),
      )
      const issues = expectOk(
        await WhatsAppChatbotService.validate('u', 'ws', 'b'),
      )
      expect(issues.length).toBeGreaterThan(0)

      botRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.validate('u', 'ws', 'b'),
        'WHATSAPP_CHATBOT_NOT_FOUND',
      )
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ draft: handoffDraft({ teamId: 't' }) })),
      )
      teamRepo.findTeam.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.validate('u', 'ws', 'b'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('setStatus()', () => {
    beforeEach(() => {
      asRole('ADMIN')
      botRepo.setStatus.mockImplementation(async (id, status) =>
        ok(createFakeChatbot({ id, status })),
      )
    })

    it('activates a published bot and pauses it', async () => {
      botRepo.findById.mockResolvedValue(ok(createFakePublishedChatbot()))
      expect(
        expectOk(
          await WhatsAppChatbotService.setStatus('u', 'ws', 'b', {
            status: 'ACTIVE',
          }),
        ).status,
      ).toBe('ACTIVE')
      expect(
        expectOk(
          await WhatsAppChatbotService.setStatus('u', 'ws', 'b', {
            status: 'PAUSED',
          }),
        ).status,
      ).toBe('PAUSED')
    })

    it('refuses to activate a bot that was never published', async () => {
      botRepo.findById.mockResolvedValue(ok(createFakeChatbot()))
      expectErr(
        await WhatsAppChatbotService.setStatus('u', 'ws', 'b', {
          status: 'ACTIVE',
        }),
        'WHATSAPP_CHATBOT_NOT_PUBLISHED',
      )
    })

    it('propagates not found and database errors', async () => {
      botRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.setStatus('u', 'ws', 'b', {
          status: 'PAUSED',
        }),
        'WHATSAPP_CHATBOT_NOT_FOUND',
      )
      botRepo.findById.mockResolvedValue(ok(createFakePublishedChatbot()))
      botRepo.setStatus.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.setStatus('u', 'ws', 'b', {
          status: 'PAUSED',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('remove()', () => {
    it('deletes an existing bot', async () => {
      asRole('ADMIN')
      botRepo.findById.mockResolvedValue(ok(createFakeChatbot()))
      botRepo.delete.mockResolvedValue(ok(undefined))
      expectOk(await WhatsAppChatbotService.remove('u', 'ws', 'b'))
    })

    it('propagates not found and database errors', async () => {
      asRole('ADMIN')
      botRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.remove('u', 'ws', 'b'),
        'WHATSAPP_CHATBOT_NOT_FOUND',
      )
      botRepo.findById.mockResolvedValue(ok(createFakeChatbot()))
      botRepo.delete.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.remove('u', 'ws', 'b'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('simulate()', () => {
    beforeEach(() => {
      asRole('ADMIN')
      botRepo.findById.mockResolvedValue(
        ok(createFakeChatbot({ draft: menuFlow() as never })),
      )
    })

    it('runs the draft step by step without sending anything', async () => {
      const first = expectOk(
        await WhatsAppChatbotService.simulate('u', 'ws', 'b', {}),
      )
      expect(first.status).toBe('WAITING')
      expect(first.outputs[0]).toMatchObject({ kind: 'menu' })
      expect(first.outputs[0]).toMatchObject({
        text: expect.stringContaining('Cliente'),
      })

      const second = expectOk(
        await WhatsAppChatbotService.simulate('u', 'ws', 'b', {
          state: first.state,
          input: 'bot:menu:sales',
        }),
      )
      expect(second.status).toBe('HANDED_OFF_HUMAN')
      expect(second.handoff).not.toBeNull()

      const typed = expectOk(
        await WhatsAppChatbotService.simulate('u', 'ws', 'b', {
          state: first.state,
          input: '3',
          contactName: 'Ana',
        }),
      )
      expect(typed.status).toBe('HANDED_OFF_AI')
      expect(typed.closeConversation).toBe(false)
    })

    it('is not found for an unknown bot', async () => {
      botRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.simulate('u', 'ws', 'b', {}),
        'WHATSAPP_CHATBOT_NOT_FOUND',
      )
    })

    it('answers integration nodes with an empty success', async () => {
      botRepo.findById.mockResolvedValue(
        ok(
          createFakeChatbot({
            draft: {
              nodes: [
                {
                  id: 'start',
                  type: 'start',
                  position: { x: 0, y: 0 },
                  data: {},
                },
                {
                  id: 'hook',
                  type: 'webhook',
                  position: { x: 0, y: 0 },
                  data: { url: 'https://example.com/x', method: 'GET' },
                },
                {
                  id: 'end',
                  type: 'end',
                  position: { x: 0, y: 0 },
                  data: { text: 'ok', closeConversation: true },
                },
              ],
              edges: [
                {
                  id: 'a',
                  source: 'start',
                  sourceHandle: 'next',
                  target: 'hook',
                },
                {
                  id: 'b',
                  source: 'hook',
                  sourceHandle: 'next',
                  target: 'end',
                },
              ],
            } as never,
          }),
        ),
      )
      const result = expectOk(
        await WhatsAppChatbotService.simulate('u', 'ws', 'b', {}),
      )
      expect(result.status).toBe('COMPLETED')
      expect(result.closeConversation).toBe(true)
    })
  })

  describe('sessions()', () => {
    it('lists sessions with their contact', async () => {
      asRole('MEMBER')
      botRepo.findById.mockResolvedValue(ok(createFakeChatbot({ id: 'b' })))
      sessionRepo.listByChatbot.mockResolvedValue(
        ok([
          {
            ...createFakeChatbotSession({ chatbotId: 'b' }),
            conversation: { contact: { name: 'Ana', waId: '5511' } },
          },
        ]),
      )
      const [session] = expectOk(
        await WhatsAppChatbotService.sessions('u', 'ws', 'b', {
          limit: 10,
          status: 'RUNNING',
        }),
      )
      expect(session.contactName).toBe('Ana')
      expect(sessionRepo.listByChatbot).toHaveBeenCalledWith({
        workspaceId: 'ws',
        chatbotId: 'b',
        status: 'RUNNING',
        limit: 10,
      })
    })

    it('propagates not found and database errors', async () => {
      asRole('MEMBER')
      botRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppChatbotService.sessions('u', 'ws', 'b', { limit: 10 }),
        'WHATSAPP_CHATBOT_NOT_FOUND',
      )
      botRepo.findById.mockResolvedValue(ok(createFakeChatbot()))
      sessionRepo.listByChatbot.mockResolvedValue(
        err({ code: 'DATABASE_ERROR', message: 'x' }),
      )
      expectErr(
        await WhatsAppChatbotService.sessions('u', 'ws', 'b', { limit: 10 }),
        'DATABASE_ERROR',
      )
    })
  })
})
