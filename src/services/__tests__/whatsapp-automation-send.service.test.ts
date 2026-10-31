import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { template: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('../whatsapp-usage.service', () => ({
  WhatsAppUsageService: { assertCanSend: vi.fn(), record: vi.fn() },
}))
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')

import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import {
  ensureConversation,
  recordOutboundMessage,
  sendAutomationTemplate,
  templatePreview,
} from '../whatsapp-automation-send.service'
import { WhatsAppUsageService } from '../whatsapp-usage.service'

const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const usage = vi.mocked(WhatsAppUsageService)
const sendTemplate = vi.mocked(WhatsAppSend.template)
const publish = vi.mocked(publishWhatsAppEvent)

const dbErr = () => err(databaseError('x'))
const connection = createFakeWhatsAppConnection({
  id: 'conn1',
  provider: 'META',
  status: 'CONNECTED',
})
const template = createFakeWhatsAppTemplate({
  id: 'tpl1',
  connectionId: 'conn1',
  status: 'APPROVED',
  name: 'carrinho',
  language: 'pt_BR',
  category: 'MARKETING',
  components: [{ type: 'BODY', text: 'Oi {{1}}, volte em {{2}}' }],
})
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: 'ws1',
  waId: '5511988887777',
  broadcastOptedOutAt: null,
})
const conversation = createFakeWhatsAppConversationWithPreview({ id: 'cv1' })

const input = (over = {}) => ({
  workspaceId: 'ws1',
  connectionId: 'conn1',
  templateId: 'tpl1',
  waId: '5511988887777',
  contactName: 'Maria',
  variables: ['Maria', 'https://exemplo.com/x'],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  connectionRepo.findById.mockResolvedValue(ok(connection))
  templateRepo.findById.mockResolvedValue(ok(template))
  contactRepo.upsertByWaId.mockResolvedValue(ok(contact))
  conversationRepo.findActiveByContact.mockResolvedValue(ok(conversation))
  conversationRepo.findById.mockResolvedValue(ok(conversation))
  conversationRepo.update.mockResolvedValue(ok(conversation))
  messageRepo.create.mockResolvedValue(ok(createFakeWhatsAppMessage()))
  usage.assertCanSend.mockResolvedValue(ok(undefined))
  sendTemplate.mockResolvedValue(ok({ providerMessageId: 'wamid.1' }))
})

describe('sendAutomationTemplate', () => {
  it('sends the template, files it in the open conversation and tells the screens', async () => {
    const outcome = expectOk(await sendAutomationTemplate(input()))
    expect(outcome).toEqual({
      kind: 'sent',
      conversationId: conversation.id,
      providerMessageId: 'wamid.1',
    })
    const [, payload, options] = sendTemplate.mock.calls[0]
    expect(payload).toMatchObject({
      to: '5511988887777',
      templateName: 'carrinho',
      language: 'pt_BR',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: 'https://exemplo.com/x' },
          ],
        },
      ],
    })
    expect(options?.cost).toMatchObject({
      source: 'OTHER',
      templateCategory: 'MARKETING',
    })
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TEMPLATE',
        text: 'Oi Maria, volte em https://exemplo.com/x',
        direction: 'OUT',
      }),
    )
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('sends no body component without variables and cleans blank values', async () => {
    expectOk(await sendAutomationTemplate(input({ variables: [] })))
    expect(sendTemplate.mock.calls[0][1].components).toEqual([])
    sendTemplate.mockClear()
    expectOk(
      await sendAutomationTemplate(input({ variables: ['  ', 'a\n  b\tc'] })),
    )
    expect(sendTemplate.mock.calls[0][1].components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: '-' },
          { type: 'text', text: 'a b c' },
        ],
      },
    ])
  })

  it('does not message opted-out contacts unless the notice is transactional', async () => {
    contactRepo.upsertByWaId.mockResolvedValue(
      ok({ ...contact, broadcastOptedOutAt: new Date() }),
    )
    expect(expectOk(await sendAutomationTemplate(input()))).toEqual({
      kind: 'opted_out',
    })
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(
      expectOk(await sendAutomationTemplate(input({ ignoreOptOut: true })))
        .kind,
    ).toBe('sent')
  })

  it('reports not_ready for offline, non-Meta and unapproved setups', async () => {
    connectionRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppConnection({ ...connection, status: 'DISCONNECTED' }),
      ),
    )
    expect(expectOk(await sendAutomationTemplate(input())).kind).toBe(
      'not_ready',
    )
    connectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ ...connection, provider: 'ZAPI' })),
    )
    expect(expectOk(await sendAutomationTemplate(input()))).toMatchObject({
      kind: 'not_ready',
      reason: expect.stringContaining('API oficial'),
    })
    connectionRepo.findById.mockResolvedValue(ok(connection))
    templateRepo.findById.mockResolvedValue(
      ok({ ...template, status: 'PENDING' }),
    )
    expect(expectOk(await sendAutomationTemplate(input())).kind).toBe(
      'not_ready',
    )
    templateRepo.findById.mockResolvedValue(
      ok({ ...template, connectionId: 'other' }),
    )
    expect(expectOk(await sendAutomationTemplate(input())).kind).toBe(
      'not_ready',
    )
  })

  it('propagates lookup and send failures', async () => {
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await sendAutomationTemplate(input()),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValue(dbErr())
    expectErr(await sendAutomationTemplate(input()), 'DATABASE_ERROR')
    connectionRepo.findById.mockResolvedValue(ok(connection))
    templateRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await sendAutomationTemplate(input()),
      'WHATSAPP_TEMPLATE_NOT_FOUND',
    )
    templateRepo.findById.mockResolvedValue(dbErr())
    expectErr(await sendAutomationTemplate(input()), 'DATABASE_ERROR')
    templateRepo.findById.mockResolvedValue(ok(template))
    contactRepo.upsertByWaId.mockResolvedValue(dbErr())
    expectErr(await sendAutomationTemplate(input()), 'DATABASE_ERROR')
    contactRepo.upsertByWaId.mockResolvedValue(ok(contact))
    conversationRepo.findActiveByContact.mockResolvedValue(dbErr())
    expectErr(await sendAutomationTemplate(input()), 'DATABASE_ERROR')
    conversationRepo.findActiveByContact.mockResolvedValue(ok(conversation))
    sendTemplate.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'recusado' } as never),
    )
    expectErr(await sendAutomationTemplate(input()), 'WHATSAPP_PROVIDER_ERROR')
  })

  it('does not fail a delivered send when filing the message fails', async () => {
    messageRepo.create.mockResolvedValue(dbErr())
    expect(expectOk(await sendAutomationTemplate(input())).kind).toBe('sent')
  })
})

describe('ensureConversation', () => {
  it('opens a new conversation when none is open, counting it', async () => {
    conversationRepo.findActiveByContact.mockResolvedValue(ok(null))
    conversationRepo.create.mockResolvedValue(
      ok({ ...conversation, id: 'new1' }),
    )
    expect(expectOk(await ensureConversation('ws1', connection, contact))).toBe(
      'new1',
    )
    expect(conversationRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      connectionId: 'conn1',
      contactId: 'ct1',
      status: 'NEW',
    })
    expect(usage.record).toHaveBeenCalledWith('ws1', 'conversations')
  })

  it('respects the plan limit and creation failures', async () => {
    conversationRepo.findActiveByContact.mockResolvedValue(ok(null))
    usage.assertCanSend.mockResolvedValue(
      err({ code: 'WHATSAPP_LIMIT_REACHED', message: 'x' } as never),
    )
    expectErr(await ensureConversation('ws1', connection, contact))
    usage.assertCanSend.mockResolvedValue(ok(undefined))
    conversationRepo.create.mockResolvedValue(dbErr())
    expectErr(await ensureConversation('ws1', connection, contact))
  })
})

describe('recordOutboundMessage', () => {
  const record = (over = {}) =>
    recordOutboundMessage({
      workspaceId: 'ws1',
      conversationId: 'cv1',
      type: 'TEXT',
      text: 'oi',
      providerMessageId: 'w1',
      ...over,
    })

  it('files the message and skips the snapshot when the conversation vanished', async () => {
    expectOk(await record({ senderUserId: 'u1' }))
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ senderUserId: 'u1', status: 'SENT' }),
    )
    publish.mockClear()
    conversationRepo.findById.mockResolvedValue(ok(null))
    expectOk(await record())
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('propagates a storage failure', async () => {
    messageRepo.create.mockResolvedValue(dbErr())
    expectErr(await record())
  })
})

describe('templatePreview', () => {
  it('fills the numbered variables', () => {
    expect(templatePreview(template, ['A'])).toBe('Oi A, volte em -')
  })

  it('falls back to the name when the body is missing', () => {
    expect(templatePreview({ name: 'x', components: [] }, [])).toBe('x')
    expect(templatePreview({ name: 'y', components: null as never }, [])).toBe(
      'y',
    )
  })
})
