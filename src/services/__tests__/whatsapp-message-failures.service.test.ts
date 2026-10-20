import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'

// Business hours: open unless a test says otherwise.
vi.mock('@/src/services/whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: {
    assertOpen: vi.fn(async () => ({ ok: true, value: undefined })),
    check: vi.fn(async () => ({
      ok: true,
      value: { open: true, nextOpeningAt: null, hours: {} },
    })),
  },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: {
    text: vi.fn(),
    media: vi.fn(),
    template: vi.fn(),
    contact: vi.fn(),
    reaction: vi.fn(),
  },
}))

import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppMessageService } from '../whatsapp-message.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedMessageRepo = vi.mocked(WhatsAppMessageRepository)
const mockedSend = vi.mocked(WhatsAppSend)

const DB_ERROR: AppError = { code: 'DATABASE_ERROR', message: 'db down' }
const PROVIDER_ERROR: AppError = {
  code: 'WHATSAPP_PROVIDER_ERROR',
  message: 'offline',
}

type Call = () => Promise<Result<unknown>>

function asAdmin() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
}

function conversation() {
  return createFakeWhatsAppConversationWithPreview({
    id: 'conv1',
    workspaceId: 'ws1',
    connectionId: 'conn1',
    aiActive: false,
    contact: createFakeWhatsAppContact({ waId: '5511999990000' }),
  })
}

function arrangeSendable() {
  asAdmin()
  mockedConversationRepo.findById.mockResolvedValue(ok(conversation()))
  mockedConnectionRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConnection({ id: 'conn1', workspaceId: 'ws1' })),
  )
  mockedContactRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppContact({ id: 'ct2', name: 'Bia', waId: '551188' })),
  )
  mockedMessageRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppMessage({
        id: 'm1',
        conversationId: 'conv1',
        providerMessageId: 'wamid-1',
      }),
    ),
  )
  mockedMessageRepo.create.mockResolvedValue(
    ok(createFakeWhatsAppMessage({ id: 'out1', conversationId: 'conv1' })),
  )
  mockedMessageRepo.update.mockResolvedValue(
    ok(createFakeWhatsAppMessage({ id: 'm1', conversationId: 'conv1' })),
  )
  mockedConversationRepo.update.mockResolvedValue(ok(conversation()))
  for (const fn of [
    mockedSend.text,
    mockedSend.media,
    mockedSend.template,
    mockedSend.contact,
  ]) {
    fn.mockResolvedValue(ok({ providerMessageId: 'pm1' }) as never)
  }
  mockedSend.reaction.mockResolvedValue(ok(undefined) as never)
}

const sends: [string, Call, () => { mockResolvedValue: (v: never) => void }][] =
  [
    [
      'sendText',
      () =>
        WhatsAppMessageService.sendText('u1', 'ws1', 'conv1', { text: 'Oi' }),
      () => mockedSend.text as never,
    ],
    [
      'sendMedia',
      () =>
        WhatsAppMessageService.sendMedia('u1', 'ws1', 'conv1', {
          type: 'IMAGE',
          mediaUrl: 'https://cdn.example.com/a.jpg',
        }),
      () => mockedSend.media as never,
    ],
    [
      'sendTemplate',
      () =>
        WhatsAppMessageService.sendTemplate('u1', 'ws1', 'conv1', {
          templateName: 'boas_vindas',
          language: 'pt_BR',
        }),
      () => mockedSend.template as never,
    ],
    [
      'sendContact',
      () =>
        WhatsAppMessageService.sendContact('u1', 'ws1', 'conv1', {
          contactId: 'ct2',
        }),
      () => mockedSend.contact as never,
    ],
    [
      'react',
      () =>
        WhatsAppMessageService.react('u1', 'ws1', 'conv1', 'm1', {
          emoji: '👍',
        }),
      () => mockedSend.reaction as never,
    ],
  ]

describe.each(sends)(
  'WhatsAppMessageService.%s() failures',
  (_name, call, sender) => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

      expectErr(await call(), 'FORBIDDEN')
    })

    it('should propagate a conversation lookup failure', async () => {
      arrangeSendable()
      mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

      expectErr(await call(), 'DATABASE_ERROR')
    })

    it('should return WHATSAPP_CONVERSATION_NOT_FOUND when missing', async () => {
      arrangeSendable()
      mockedConversationRepo.findById.mockResolvedValue(ok(null))

      expectErr(await call(), 'WHATSAPP_CONVERSATION_NOT_FOUND')
    })

    it('should propagate a connection lookup failure', async () => {
      arrangeSendable()
      mockedConnectionRepo.findById.mockResolvedValue(err(DB_ERROR))

      expectErr(await call(), 'DATABASE_ERROR')
    })

    it('should return WHATSAPP_CONNECTION_NOT_FOUND when the connection is gone', async () => {
      arrangeSendable()
      mockedConnectionRepo.findById.mockResolvedValue(ok(null))

      expectErr(await call(), 'WHATSAPP_CONNECTION_NOT_FOUND')
    })

    it('should propagate a provider send failure without persisting', async () => {
      arrangeSendable()
      sender().mockResolvedValue(err(PROVIDER_ERROR) as never)

      expectErr(await call(), 'WHATSAPP_PROVIDER_ERROR')
      expect(mockedMessageRepo.create).not.toHaveBeenCalled()
    })
  },
)

describe.each(sends.filter(([name]) => name !== 'react'))(
  'WhatsAppMessageService.%s() persistence',
  (_name, call) => {
    it('should propagate a failure persisting the outbound message', async () => {
      arrangeSendable()
      mockedMessageRepo.create.mockResolvedValue(err(DB_ERROR))

      expectErr(await call(), 'DATABASE_ERROR')
      expect(mockedConversationRepo.update).not.toHaveBeenCalled()
    })

    it('should skip the conversation event when the refresh finds nothing', async () => {
      arrangeSendable()
      mockedConversationRepo.findById
        .mockResolvedValueOnce(ok(conversation()))
        .mockResolvedValueOnce(ok(null))

      expectOk(await call())

      expect(publishWhatsAppEvent).toHaveBeenCalledTimes(1)
      expect(publishWhatsAppEvent).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ type: 'message.created' }),
      )
    })
  },
)

describe('WhatsAppMessageService specifics', () => {
  it('sendTemplate() should send the template and store its name as text', async () => {
    arrangeSendable()

    expectOk(
      await WhatsAppMessageService.sendTemplate('u1', 'ws1', 'conv1', {
        templateName: 'boas_vindas',
        language: 'pt_BR',
      }),
    )

    expect(mockedSend.template).toHaveBeenCalledWith(expect.anything(), {
      to: '5511999990000',
      templateName: 'boas_vindas',
      language: 'pt_BR',
      components: undefined,
    })
    expect(mockedMessageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TEMPLATE',
        text: 'boas_vindas',
        providerMessageId: 'pm1',
      }),
    )
  })

  it('sendText() should drop the quote when the quoted lookup fails', async () => {
    arrangeSendable()
    mockedMessageRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectOk(
      await WhatsAppMessageService.sendText('u1', 'ws1', 'conv1', {
        text: 'Oi',
        replyToMessageId: 'm1',
      }),
    )

    expect(mockedSend.text).toHaveBeenCalledWith(expect.anything(), {
      to: '5511999990000',
      text: 'Oi',
      quotedProviderMessageId: undefined,
    })
  })

  it('sendText() should drop the quote when the quoted message was never delivered', async () => {
    arrangeSendable()
    mockedMessageRepo.findById.mockResolvedValue(ok(null))

    expectOk(
      await WhatsAppMessageService.sendText('u1', 'ws1', 'conv1', {
        text: 'Oi',
        replyToMessageId: 'gone',
      }),
    )

    expect(mockedSend.text).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quotedProviderMessageId: undefined }),
    )
    expect(mockedMessageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ replyToMessageId: 'gone' }),
    )
  })

  it('sendContact() should propagate a shared contact lookup failure', async () => {
    arrangeSendable()
    mockedContactRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppMessageService.sendContact('u1', 'ws1', 'conv1', {
        contactId: 'ct2',
      }),
      'DATABASE_ERROR',
    )
  })

  it('sendContact() should fall back to the waId for an unnamed contact', async () => {
    arrangeSendable()
    mockedContactRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppContact({ id: 'ct2', name: null, waId: '551188' })),
    )

    expectOk(
      await WhatsAppMessageService.sendContact('u1', 'ws1', 'conv1', {
        contactId: 'ct2',
      }),
    )

    expect(mockedSend.contact).toHaveBeenCalledWith(expect.anything(), {
      to: '5511999990000',
      name: '551188',
      waId: '551188',
    })
  })

  it('list() should return FORBIDDEN for a non-member', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppMessageService.list('u1', 'ws1', 'conv1', { limit: 20 }),
      'FORBIDDEN',
    )
  })

  it('list() should propagate a conversation lookup failure', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppMessageService.list('u1', 'ws1', 'conv1', { limit: 20 }),
      'DATABASE_ERROR',
    )
  })

  it('list() should propagate a message lookup failure', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(ok(conversation()))
    mockedMessageRepo.listByConversation.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppMessageService.list('u1', 'ws1', 'conv1', { limit: 20 }),
      'DATABASE_ERROR',
    )
  })

  const remove = () => WhatsAppMessageService.remove('u1', 'ws1', 'conv1', 'm1')

  it('remove() should return FORBIDDEN for a non-member', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(await remove(), 'FORBIDDEN')
  })

  it('remove() should propagate a conversation lookup failure', async () => {
    arrangeSendable()
    mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await remove(), 'DATABASE_ERROR')
  })

  it('remove() should return WHATSAPP_CONVERSATION_NOT_FOUND when missing', async () => {
    arrangeSendable()
    mockedConversationRepo.findById.mockResolvedValue(ok(null))

    expectErr(await remove(), 'WHATSAPP_CONVERSATION_NOT_FOUND')
  })

  it('remove() should propagate a message lookup failure', async () => {
    arrangeSendable()
    mockedMessageRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await remove(), 'DATABASE_ERROR')
  })

  it('remove() should propagate the soft-delete failure', async () => {
    arrangeSendable()
    mockedMessageRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(await remove(), 'DATABASE_ERROR')
  })

  const react = (emoji: string) =>
    WhatsAppMessageService.react('u1', 'ws1', 'conv1', 'm1', { emoji })

  it('react() should propagate a message lookup failure', async () => {
    arrangeSendable()
    mockedMessageRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await react('👍'), 'DATABASE_ERROR')
  })

  it('react() should refuse a message never delivered to the provider', async () => {
    arrangeSendable()
    mockedMessageRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppMessage({
          id: 'm1',
          conversationId: 'conv1',
          providerMessageId: null,
        }),
      ),
    )

    expectErr(await react('👍'), 'WHATSAPP_MESSAGE_NOT_FOUND')
    expect(mockedSend.reaction).not.toHaveBeenCalled()
  })

  it('react() should clear the reaction for an empty emoji', async () => {
    arrangeSendable()

    expectOk(await react(''))

    expect(mockedMessageRepo.update).toHaveBeenCalledWith('m1', {
      reactionEmoji: null,
      reactedByContact: null,
    })
  })

  it('react() should propagate the update failure', async () => {
    arrangeSendable()
    mockedMessageRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(await react('👍'), 'DATABASE_ERROR')
  })
})
