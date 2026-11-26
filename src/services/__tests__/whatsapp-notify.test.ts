import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../notification-emitter', () => ({
  emitNotification: vi.fn(),
  workspaceAdminIds: vi.fn(),
}))

import { emitNotification, workspaceAdminIds } from '../notification-emitter'
import {
  notifyNewWhatsAppConversation,
  notifyWhatsAppUsers,
  WHATSAPP_NOTIFY_ADMIN_CAP,
  whatsAppAdminIds,
  whatsAppConversationPath,
} from '../whatsapp-notify'

const emit = vi.mocked(emitNotification)
const admins = vi.mocked(workspaceAdminIds)

beforeEach(() => {
  vi.clearAllMocks()
  emit.mockResolvedValue(2)
})

describe('notifyWhatsAppUsers', () => {
  it('hands the notice to the shared emitter (actor, members and mute are handled there)', async () => {
    expect(
      await notifyWhatsAppUsers({
        workspaceId: 'ws1',
        kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
        userIds: ['u1', null],
        actorId: 'actor',
        title: 'Conversa atribuída a você',
        body: 'Conversa com Ana.',
        path: whatsAppConversationPath('c1'),
        meta: { conversationId: 'c1' },
      }),
    ).toBe(2)
    expect(emit).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      recipients: ['u1', null],
      actorId: 'actor',
      kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
      title: 'Conversa atribuída a você',
      body: 'Conversa com Ana.',
      path: '/zap?conversa=c1',
    })
  })
})

describe('whatsAppAdminIds', () => {
  it('caps the workspace admins', async () => {
    admins.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => `admin-${index}`),
    )
    const ids = await whatsAppAdminIds('ws1')
    expect(ids).toHaveLength(WHATSAPP_NOTIFY_ADMIN_CAP)
    expect(admins).toHaveBeenCalledWith('ws1')
  })
})

describe('notifyNewWhatsAppConversation', () => {
  const base = {
    workspaceId: 'ws1',
    conversationId: 'c1',
    contactLabel: 'Ana',
  }

  it('goes to the routed team, once per conversation', async () => {
    await notifyNewWhatsAppConversation({
      ...base,
      teamMemberIds: ['u1', 'u2'],
      preview: 'Olá, preciso de ajuda',
    })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_NEW_CONVERSATION',
        recipients: ['u1', 'u2'],
        title: 'Nova conversa',
        body: 'Ana: Olá, preciso de ajuda',
        dedupeKey: 'wa-new-conversation:c1',
        path: '/zap?conversa=c1',
      }),
    )
    expect(admins).not.toHaveBeenCalled()
  })

  it('falls back to the workspace admins without a team', async () => {
    admins.mockResolvedValue(['a1'])
    await notifyNewWhatsAppConversation({ ...base, teamMemberIds: [] })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['a1'],
        body: 'Ana iniciou uma conversa.',
      }),
    )
  })

  it('trims a long preview and never throws', async () => {
    await notifyNewWhatsAppConversation({
      ...base,
      teamMemberIds: ['u1'],
      preview: 'x'.repeat(500),
    })
    const [call] = emit.mock.calls
    const body = String((call?.[0] as { body: string } | undefined)?.body)
    expect(body.length).toBeLessThanOrEqual(125)
    emit.mockRejectedValueOnce(new Error('boom'))
    expect(
      await notifyNewWhatsAppConversation({ ...base, teamMemberIds: ['u1'] }),
    ).toBe(0)
  })
})
