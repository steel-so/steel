import { describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConversation } from '@/src/__tests__/factories/whatsapp-conversation.factory'

vi.mock('@/src/services/webhook-emitter', () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}))

import { parseWebhookEventData } from '@/src/lib/webhooks/events'
import { emitWebhookEvent } from '../webhook-emitter'
import { emitWhatsAppConversationWaiting } from '../whatsapp-conversation-waiting'

describe('emitWhatsAppConversationWaiting', () => {
  it('emits communication.conversation.waiting with the catalog payload', () => {
    const conversation = createFakeWhatsAppConversation({
      id: 'c1',
      workspaceId: 'ws1',
      connectionId: 'cn1',
      status: 'NEW',
      assignedUserId: null,
      teamId: null,
      lastMessageAt: new Date('2026-10-18T12:00:00.000Z'),
      createdAt: new Date('2026-10-18T11:00:00.000Z'),
    })

    emitWhatsAppConversationWaiting({
      conversation,
      contact: { id: 'ct1', waId: '5511999990000', name: 'Maria' },
      reason: 'new',
      actorId: null,
    })

    const [workspaceId, type, build] = vi.mocked(emitWebhookEvent).mock
      .calls[0] as [string, string, () => unknown]
    expect(workspaceId).toBe('ws1')
    expect(type).toBe('communication.conversation.waiting')
    const data = build()
    expect(data).toMatchObject({
      conversation: {
        id: 'c1',
        status: 'NEW',
        connectionId: 'cn1',
        teamId: null,
        lastMessageAt: '2026-10-18T12:00:00.000Z',
        createdAt: '2026-10-18T11:00:00.000Z',
      },
      contact: { id: 'ct1', waId: '5511999990000', name: 'Maria' },
      reason: 'new',
      actorId: null,
    })
    expect(
      parseWebhookEventData('communication.conversation.waiting', data).success,
    ).toBe(true)
  })
})
