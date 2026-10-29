import { describe, expect, it } from 'vitest'
import {
  createFakeChatbot,
  createFakeChatbotSession,
  createFakePublishedChatbot,
} from '@/src/__tests__/factories/nov-z2-chatbot-builder.factory'
import { menuFlow } from '@/src/lib/whatsapp/chatbot/templates'
import {
  emptyChatbotStats,
  parseStoredFlow,
  toWhatsAppChatbotDTO,
  toWhatsAppChatbotListItemDTO,
  toWhatsAppChatbotSessionDTO,
} from '../whatsapp-chatbot.mapper'

describe('whatsapp chatbot mapper', () => {
  it('reads a stored flow and falls back to an empty one', () => {
    expect(parseStoredFlow(menuFlow()).nodes.length).toBeGreaterThan(1)
    expect(parseStoredFlow({ nodes: 'nope' })).toEqual({ nodes: [], edges: [] })
    expect(parseStoredFlow(null)).toEqual({ nodes: [], edges: [] })
  })

  it('maps a draft that was never published', () => {
    const dto = toWhatsAppChatbotDTO(createFakeChatbot({ name: 'Bot' }))
    expect(dto).toMatchObject({
      name: 'Bot',
      status: 'DRAFT',
      publishedVersion: 0,
      publishedAt: null,
      hasUnpublishedChanges: true,
    })
    expect(typeof dto.createdAt).toBe('string')
  })

  it('detects whether the draft differs from the published flow', () => {
    const published = createFakePublishedChatbot()
    expect(toWhatsAppChatbotDTO(published).hasUnpublishedChanges).toBe(false)
    expect(toWhatsAppChatbotDTO(published).publishedAt).not.toBeNull()

    const edited = { ...menuFlow(), nodes: menuFlow().nodes.slice(0, 2) }
    const changed = createFakePublishedChatbot(menuFlow(), {
      draft: edited as never,
    })
    expect(toWhatsAppChatbotDTO(changed).hasUnpublishedChanges).toBe(true)
  })

  it('maps the list item with node count and stats', () => {
    const stats = { ...emptyChatbotStats(), sessions: 3, completed: 2 }
    const item = toWhatsAppChatbotListItemDTO(
      createFakePublishedChatbot(),
      stats,
    )
    expect(item.nodeCount).toBe(menuFlow().nodes.length)
    expect(item.stats).toEqual(stats)
    expect('flow' in item).toBe(false)
  })

  it('maps a session with and without its contact', () => {
    const base = createFakeChatbotSession({
      state: { started: true, awaiting: null, variables: { nome: 'Ana' } },
      endReason: 'end_node',
      endedAt: new Date('2026-11-11T12:00:00Z'),
    })
    const withContact = toWhatsAppChatbotSessionDTO({
      ...base,
      conversation: { contact: { name: 'Ana', waId: '5511' } },
    })
    expect(withContact).toMatchObject({
      contactName: 'Ana',
      contactPhone: '5511',
      variables: { nome: 'Ana' },
      endedAt: '2026-11-11T12:00:00.000Z',
    })
    const bare = toWhatsAppChatbotSessionDTO(createFakeChatbotSession())
    expect(bare).toMatchObject({
      contactName: null,
      contactPhone: null,
      endedAt: null,
      variables: {},
    })
  })
})
