import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { createFakeWhatsAppQuickReply } from '@/src/__tests__/factories/whatsapp-quick-reply.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, whatsappProviderError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-quick-reply.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), media: vi.fn(), buttons: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppQuickReplyRepository } from '@/src/repositories/whatsapp-quick-reply.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WhatsAppQuickReplyService } from '../whatsapp-quick-reply.service'

const membershipRepo = vi.mocked(MembershipRepository)
const quickReplyRepo = vi.mocked(WhatsAppQuickReplyRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const userRepo = vi.mocked(UserRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const send = vi.mocked(WhatsAppSend)

const zapi = createFakeWhatsAppConnection({ id: 'conn1', provider: 'ZAPI' })
const meta = createFakeWhatsAppConnection({ id: 'conn1', provider: 'META' })
const conversation = createFakeWhatsAppConversationWithPreview({
  id: 'c1',
  workspaceId: 'ws1',
  connectionId: 'conn1',
  aiActive: false,
  contact: createFakeWhatsAppContact({ waId: '5511', name: 'Ana' }),
})

const reply: WhatsAppButtonDTO = {
  id: 'b1',
  type: 'REPLY',
  label: 'Sim',
  actions: [],
}
const link: WhatsAppButtonDTO = {
  id: 'l1',
  type: 'URL',
  label: 'Site',
  url: 'https://steel.app',
}

function quickReply(overrides: object = {}) {
  return createFakeWhatsAppQuickReply({
    id: 'qr1',
    workspaceId: 'ws1',
    body: 'Olá {nome_cliente}, aqui é {nome_usuario} da {workspace}. {codigo}',
    ...overrides,
  })
}

let providerId = 0
beforeEach(() => {
  vi.clearAllMocks()
  providerId = 0
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  conversationRepo.findById.mockResolvedValue(ok(conversation))
  conversationRepo.update.mockResolvedValue(ok(conversation))
  connectionRepo.findById.mockResolvedValue(ok(zapi))
  quickReplyRepo.findById.mockResolvedValue(ok(quickReply()))
  userRepo.findById.mockResolvedValue(ok(createFakeUser({ name: 'Bia' })))
  workspaceRepo.findById.mockResolvedValue(
    ok(createFakeWorkspace({ name: 'Stratus' })),
  )
  const sent = async () => ok({ providerMessageId: `p${++providerId}` })
  send.text.mockImplementation(sent)
  send.media.mockImplementation(sent)
  send.buttons.mockImplementation(sent)
  messageRepo.create.mockImplementation(async (data) =>
    ok(
      createFakeWhatsAppMessage({
        id: `m-${data.providerMessageId}`,
        type: data.type,
        buttons: (data.buttons as never) ?? null,
      }),
    ),
  )
})

const sendQuickReply = (variables?: Record<string, string>) =>
  WhatsAppQuickReplyService.send('u1', 'ws1', 'c1', {
    quickReplyId: 'qr1',
    variables,
  })

describe('WhatsAppQuickReplyService.send()', () => {
  it('renders the variables and sends plain text without buttons', async () => {
    const dto = expectOk(await sendQuickReply({ codigo: '#42' }))

    expect(send.text).toHaveBeenCalledWith(zapi, {
      to: '5511',
      text: 'Olá Ana, aqui é Bia da Stratus. #42',
    })
    expect(dto.id).toBe('m-p1')
    expect(conversationRepo.update).toHaveBeenCalledWith('c1', {
      lastMessageAt: expect.any(Date),
      status: 'IN_PROGRESS',
    })
    expect(publishWhatsAppEvent).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'conversation.updated' }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send',
        meta: expect.objectContaining({ type: 'QUICK_REPLY', buttons: 0 }),
      }),
    )
  })

  it('falls back to default names when user/workspace cannot be read', async () => {
    userRepo.findById.mockResolvedValue(err(databaseError()))
    workspaceRepo.findById.mockResolvedValue(err(databaseError()))
    expectOk(await sendQuickReply())
    expect(send.text.mock.calls[0][1].text).toBe(
      'Olá Ana, aqui é atendente da . {codigo}',
    )
  })

  it('sends media with caption without buttons', async () => {
    quickReplyRepo.findById.mockResolvedValue(
      ok(quickReply({ body: 'Veja', mediaUrl: 'https://m/a.png' })),
    )
    expectOk(await sendQuickReply())
    expect(send.media).toHaveBeenCalledWith(zapi, {
      to: '5511',
      mediaUrl: 'https://m/a.png',
      type: 'image',
      caption: 'Veja',
    })
    expect(send.text).not.toHaveBeenCalled()
  })

  it('sends audio and then the text (audio has no caption)', async () => {
    quickReplyRepo.findById.mockResolvedValue(
      ok(quickReply({ body: 'Ouça', mediaUrl: 'https://m/a.ogg' })),
    )
    const dto = expectOk(await sendQuickReply())
    expect(send.media.mock.calls[0][1]).toMatchObject({
      type: 'audio',
      caption: undefined,
    })
    expect(send.text).toHaveBeenCalled()
    expect(messageRepo.create).toHaveBeenCalledTimes(2)
    expect(dto.id).toBe('m-p2')
  })

  it('Z-API: buttons with an image go in one message, payloads included', async () => {
    quickReplyRepo.findById.mockResolvedValue(
      ok(
        quickReply({
          body: 'Confirma?',
          mediaUrl: 'https://m/a.png',
          buttons: [reply, link],
        }),
      ),
    )

    const dto = expectOk(await sendQuickReply())

    expect(send.buttons).toHaveBeenCalledWith(zapi, {
      to: '5511',
      text: 'Confirma?',
      buttons: [
        { type: 'REPLY', id: 'stl:q:qr1:b1', label: 'Sim' },
        { type: 'URL', id: 'l1', label: 'Site', url: 'https://steel.app' },
      ],
      media: { url: 'https://m/a.png', type: 'image' },
    })
    expect(send.media).not.toHaveBeenCalled()
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'IMAGE',
        mediaUrl: 'https://m/a.png',
        buttons: [
          { id: 'b1', type: 'REPLY', label: 'Sim' },
          { id: 'l1', type: 'URL', label: 'Site', url: 'https://steel.app' },
        ],
      }),
    )
    expect(dto.buttons).toHaveLength(2)
  })

  it('Z-API: a document goes first, on its own', async () => {
    quickReplyRepo.findById.mockResolvedValue(
      ok(
        quickReply({
          body: 'Seu boleto',
          mediaUrl: 'https://m/b.pdf',
          buttons: [reply],
        }),
      ),
    )
    expectOk(await sendQuickReply())
    expect(send.media).toHaveBeenCalledWith(zapi, {
      to: '5511',
      mediaUrl: 'https://m/b.pdf',
      type: 'document',
    })
    expect(send.buttons.mock.calls[0][1].media).toBeUndefined()
    expect(messageRepo.create.mock.calls.map((c) => c[0].type)).toEqual([
      'DOCUMENT',
      'TEXT',
    ])
  })

  it('Meta: a video rides in the interactive header', async () => {
    connectionRepo.findById.mockResolvedValue(ok(meta))
    quickReplyRepo.findById.mockResolvedValue(
      ok(
        quickReply({
          body: 'Assista',
          mediaUrl: 'https://m/v.mp4',
          buttons: [reply],
        }),
      ),
    )
    expectOk(await sendQuickReply())
    expect(send.buttons.mock.calls[0][1].media).toEqual({
      url: 'https://m/v.mp4',
      type: 'video',
    })
    expect(send.media).not.toHaveBeenCalled()
  })

  it('Meta: refuses a body over the interactive limit', async () => {
    connectionRepo.findById.mockResolvedValue(ok(meta))
    quickReplyRepo.findById.mockResolvedValue(
      ok(quickReply({ body: 'x'.repeat(1100), buttons: [reply] })),
    )
    expectErr(await sendQuickReply(), 'WHATSAPP_BUTTONS_UNSUPPORTED')
    expect(send.buttons).not.toHaveBeenCalled()
  })

  it('unknown media extensions are sent as image', async () => {
    quickReplyRepo.findById.mockResolvedValue(
      ok(quickReply({ body: 'Oi', mediaUrl: 'https://m/file' })),
    )
    expectOk(await sendQuickReply())
    expect(send.media.mock.calls[0][1].type).toBe('image')
  })

  it.each([
    ['media', { mediaUrl: 'https://m/a.png' }],
    ['audio text', { mediaUrl: 'https://m/a.ogg' }],
    ['text', {}],
    ['buttons', { buttons: [reply] }],
    ['separate media', { mediaUrl: 'https://m/b.pdf', buttons: [reply] }],
  ])('stops on a provider failure (%s)', async (name, overrides) => {
    quickReplyRepo.findById.mockResolvedValue(ok(quickReply(overrides)))
    const fail = async () => err(whatsappProviderError('down'))
    if (name === 'media' || name === 'separate media') {
      send.media.mockImplementation(fail)
    } else if (name === 'buttons') {
      send.buttons.mockImplementation(fail)
    } else {
      send.text.mockImplementation(fail)
    }
    expectErr(await sendQuickReply(), 'WHATSAPP_PROVIDER_ERROR')
    expect(conversationRepo.update).not.toHaveBeenCalled()
  })

  it('guards the conversation, the AI, the quick reply and the connection', async () => {
    conversationRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(await sendQuickReply(), 'WHATSAPP_CONVERSATION_NOT_FOUND')

    conversationRepo.findById.mockResolvedValueOnce(
      ok({ ...conversation, aiActive: true }),
    )
    expectErr(await sendQuickReply(), 'WHATSAPP_CONVERSATION_AI_HANDLING')

    quickReplyRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(await sendQuickReply(), 'WHATSAPP_QUICK_REPLY_NOT_FOUND')

    connectionRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(await sendQuickReply(), 'WHATSAPP_CONNECTION_NOT_FOUND')

    membershipRepo.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await sendQuickReply(), 'FORBIDDEN')
    expect(send.text).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    conversationRepo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await sendQuickReply(), 'DATABASE_ERROR')

    quickReplyRepo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await sendQuickReply(), 'DATABASE_ERROR')

    connectionRepo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await sendQuickReply(), 'DATABASE_ERROR')

    messageRepo.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(await sendQuickReply(), 'DATABASE_ERROR')
  })

  it('skips the conversation snapshot when it cannot be reloaded', async () => {
    conversationRepo.findById
      .mockResolvedValueOnce(ok(conversation))
      .mockResolvedValueOnce(ok(null))
    expectOk(await sendQuickReply())
    expect(publishWhatsAppEvent).toHaveBeenCalledTimes(1)
  })
})

describe('WhatsAppQuickReplyService create/update buttons', () => {
  it('persists buttons on create only when there are some', async () => {
    quickReplyRepo.create.mockResolvedValue(ok(quickReply()))
    expectOk(
      await WhatsAppQuickReplyService.create('u1', 'ws1', {
        shortcut: 'a',
        title: 'A',
        body: 'a',
        buttons: [reply],
      }),
    )
    expect(quickReplyRepo.create.mock.calls[0][0].buttons).toEqual([reply])

    expectOk(
      await WhatsAppQuickReplyService.create('u1', 'ws1', {
        shortcut: 'b',
        title: 'B',
        body: 'b',
        buttons: [],
      }),
    )
    expect(quickReplyRepo.create.mock.calls[1][0].buttons).toBeUndefined()
  })

  it('replaces, clears or keeps the buttons on update', async () => {
    quickReplyRepo.update.mockResolvedValue(ok(quickReply()))

    await WhatsAppQuickReplyService.update('u1', 'ws1', 'qr1', {
      buttons: [reply],
    })
    expect(quickReplyRepo.update).toHaveBeenLastCalledWith('qr1', {
      buttons: [reply],
    })

    await WhatsAppQuickReplyService.update('u1', 'ws1', 'qr1', {
      buttons: [],
    })
    expect(quickReplyRepo.update).toHaveBeenLastCalledWith('qr1', {
      buttons: null,
    })

    await WhatsAppQuickReplyService.update('u1', 'ws1', 'qr1', {
      buttons: null,
    })
    expect(quickReplyRepo.update).toHaveBeenLastCalledWith('qr1', {
      buttons: null,
    })

    await WhatsAppQuickReplyService.update('u1', 'ws1', 'qr1', {
      title: 'Novo',
    })
    expect(quickReplyRepo.update).toHaveBeenLastCalledWith('qr1', {
      title: 'Novo',
    })
  })
})
