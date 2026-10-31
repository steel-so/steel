import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeCoexistenceConnection,
  createFakeCoexistenceSync,
  createFakeMetaChannelSettings,
} from '@/src/__tests__/factories/nov-meta-channels.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, whatsappProviderError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const env = vi.hoisted(() => ({
  WHATSAPP_META_APP_ID: '123' as string | undefined,
  WHATSAPP_META_APP_SECRET: 'secret' as string | undefined,
}))
vi.mock('@/lib/env/server', () => env)
vi.mock('@/lib/env/env', () => ({ NEXT_PUBLIC_META_APP_ID: undefined }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-coexistence.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-meta-channel.repository')
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (plain: string) => `enc:${plain}`),
}))
vi.mock('@/src/lib/whatsapp/meta-signup', () => ({
  exchangeSignupCode: vi.fn(),
  subscribeAppToWaba: vi.fn(),
  fetchPhoneInfo: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/meta-coexistence', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/src/lib/whatsapp/meta-coexistence')
  >()),
  requestCoexistenceSync: vi.fn(),
}))
vi.mock('../whatsapp-webhook.service', () => ({
  WhatsAppWebhookService: { ingestOutboundDeviceMessage: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { requestCoexistenceSync } from '@/src/lib/whatsapp/meta-coexistence'
import {
  exchangeSignupCode,
  fetchPhoneInfo,
  subscribeAppToWaba,
} from '@/src/lib/whatsapp/meta-signup'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppCoexistenceRepository } from '@/src/repositories/whatsapp-coexistence.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMetaChannelRepository } from '@/src/repositories/whatsapp-meta-channel.repository'
import { WhatsAppCoexistenceService } from '../whatsapp-coexistence.service'
import { WhatsAppWebhookService } from '../whatsapp-webhook.service'

const members = vi.mocked(MembershipRepository)
const sync = vi.mocked(WhatsAppCoexistenceRepository)
const connections = vi.mocked(WhatsAppConnectionRepository)
const contacts = vi.mocked(WhatsAppContactRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const channels = vi.mocked(WhatsAppMetaChannelRepository)
const exchange = vi.mocked(exchangeSignupCode)
const subscribe = vi.mocked(subscribeAppToWaba)
const phone = vi.mocked(fetchPhoneInfo)
const requestSync = vi.mocked(requestCoexistenceSync)
const webhook = vi.mocked(WhatsAppWebhookService)

const SIGNUP = { code: 'c', phoneNumberId: '555000111', wabaId: '777000222' }

function asRole(role: 'MEMBER' | 'ADMIN') {
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  env.WHATSAPP_META_APP_ID = '123'
  env.WHATSAPP_META_APP_SECRET = 'secret'
  asRole('ADMIN')
  channels.findSettings.mockResolvedValue(
    ok(createFakeMetaChannelSettings({ coexistenceEnabled: true })),
  )
  exchange.mockResolvedValue(ok('biz-token'))
  subscribe.mockResolvedValue(ok(true))
  phone.mockResolvedValue(
    ok({ displayPhoneNumber: '5511999990000', verifiedName: 'Loja' }),
  )
  connections.create.mockResolvedValue(
    ok(createFakeCoexistenceConnection({ id: 'conn1', workspaceId: 'ws1' })),
  )
  sync.create.mockResolvedValue(
    ok(createFakeCoexistenceSync({ connectionId: 'conn1' })),
  )
  requestSync.mockResolvedValue(ok(true))
})

describe('connect()', () => {
  it('connects without registering the number and requests contacts then history', async () => {
    const result = expectOk(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
    )
    expect(result.connection.id).toBe('conn1')
    expect(result.sync.status).toBe('PENDING')
    expect(connections.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'META',
        coexistence: true,
        status: 'CONNECTED',
        label: 'Loja',
        phoneNumber: '5511999990000',
        encryptedMetaAccessToken: 'enc:biz-token',
      }),
    )
    expect(requestSync.mock.calls.map((call) => call[2])).toEqual([
      'smb_app_state_sync',
      'history',
    ])
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { provider: 'META', via: 'coexistence' },
      }),
    )
  })

  it('uses the given label', async () => {
    await WhatsAppCoexistenceService.connect('u1', 'ws1', {
      ...SIGNUP,
      label: 'Comercial',
    })
    expect(connections.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Comercial' }),
    )
  })

  it('labels the connection with the number when Meta has no verified name', async () => {
    phone.mockResolvedValue(
      ok({ displayPhoneNumber: '5511999990000', verifiedName: null }),
    )
    await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP)
    expect(connections.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: '5511999990000' }),
    )
  })

  it('keeps the connection but marks the import as failed when Meta refuses it', async () => {
    requestSync.mockResolvedValueOnce(err(whatsappProviderError('recusado')))
    sync.update.mockResolvedValue(
      ok(createFakeCoexistenceSync({ status: 'FAILED', error: 'recusado' })),
    )
    const result = expectOk(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
    )
    expect(result.sync.status).toBe('FAILED')
    expect(requestSync).toHaveBeenCalledTimes(1)
    expect(sync.update).toHaveBeenCalledWith('conn1', {
      status: 'FAILED',
      error: 'recusado',
    })
  })

  it('still answers when the failure cannot be stored', async () => {
    requestSync.mockResolvedValue(err(whatsappProviderError('recusado')))
    sync.update.mockResolvedValue(err(databaseError('x')))
    const result = expectOk(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
    )
    expect(result.sync.status).toBe('PENDING')
    sync.update.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP))
        .sync.status,
    ).toBe('PENDING')
  })

  it('refuses while Coexistence is off', async () => {
    channels.findSettings.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'FEATURE_NOT_ENABLED',
    )
    expect(exchange).not.toHaveBeenCalled()
  })

  it('refuses when the Meta app is not configured', async () => {
    env.WHATSAPP_META_APP_ID = undefined
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'FEATURE_NOT_ENABLED',
    )
  })

  it('forbids a MEMBER', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'FORBIDDEN',
    )
  })

  it('propagates every upstream failure', async () => {
    exchange.mockResolvedValueOnce(err(whatsappProviderError('x')))
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'WHATSAPP_PROVIDER_ERROR',
    )
    subscribe.mockResolvedValueOnce(err(whatsappProviderError('x')))
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'WHATSAPP_PROVIDER_ERROR',
    )
    phone.mockResolvedValueOnce(err(whatsappProviderError('x')))
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'WHATSAPP_PROVIDER_ERROR',
    )
    connections.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'DATABASE_ERROR',
    )
    sync.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'DATABASE_ERROR',
    )
    channels.findSettings.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppCoexistenceService.connect('u1', 'ws1', SIGNUP),
      'DATABASE_ERROR',
    )
  })
})

describe('getSync()', () => {
  it('returns the import progress', async () => {
    sync.findByConnection.mockResolvedValue(
      ok(createFakeCoexistenceSync({ progress: 40, status: 'SYNCING' })),
    )
    expect(
      expectOk(await WhatsAppCoexistenceService.getSync('u1', 'ws1', 'conn1')),
    ).toMatchObject({ progress: 40, status: 'SYNCING' })
  })

  it('fails for a connection without an import and for non-members', async () => {
    sync.findByConnection.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCoexistenceService.getSync('u1', 'ws1', 'conn1'),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    sync.findByConnection.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCoexistenceService.getSync('u1', 'ws1', 'conn1'),
      'DATABASE_ERROR',
    )
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppCoexistenceService.getSync('u1', 'ws1', 'conn1'),
      'FORBIDDEN',
    )
  })
})

describe('applyWebhook()', () => {
  const coexisting = createFakeCoexistenceConnection({
    id: 'conn1',
    workspaceId: 'ws1',
  })
  const metadata = { phone_number_id: '555000111' }

  beforeEach(() => {
    connections.findByMetaPhoneNumberId.mockResolvedValue(ok(coexisting))
    sync.update.mockResolvedValue(ok(createFakeCoexistenceSync()))
    contacts.upsertByWaId.mockResolvedValue(ok({ id: 'ct1' } as never))
  })

  it('ignores an event without a phone number id or for another kind of number', async () => {
    expectOk(
      await WhatsAppCoexistenceService.applyWebhook({
        field: 'history',
        value: {},
      }),
    )
    connections.findByMetaPhoneNumberId.mockResolvedValueOnce(ok(null))
    expectOk(
      await WhatsAppCoexistenceService.applyWebhook({
        field: 'history',
        value: { metadata },
      }),
    )
    connections.findByMetaPhoneNumberId.mockResolvedValueOnce(
      ok(createFakeCoexistenceConnection({ coexistence: false })),
    )
    expectOk(
      await WhatsAppCoexistenceService.applyWebhook({
        field: 'smb_app_state_sync',
        value: { metadata },
      }),
    )
    expect(sync.update).not.toHaveBeenCalled()
  })

  it('propagates a lookup failure', async () => {
    connections.findByMetaPhoneNumberId.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppCoexistenceService.applyWebhook({
        field: 'history',
        value: { metadata },
      }),
      'DATABASE_ERROR',
    )
  })

  describe('smb_app_state_sync', () => {
    const value = {
      metadata,
      state_sync: [
        {
          type: 'contact',
          action: 'add',
          contact: { full_name: 'Ana', phone_number: '5511999990001' },
        },
        {
          type: 'contact',
          action: 'add',
          contact: { phone_number: '5511999990002' },
        },
      ],
    }

    it('imports the contacts of the app', async () => {
      expectOk(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'smb_app_state_sync',
          value,
        }),
      )
      expect(contacts.upsertByWaId).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        waId: '5511999990001',
        name: 'Ana',
      })
      expect(contacts.upsertByWaId).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        waId: '5511999990002',
        name: undefined,
      })
      expect(sync.update).toHaveBeenCalledWith('conn1', {
        status: 'SYNCING',
        contactsImported: { increment: 2 },
      })
    })

    it('propagates database failures', async () => {
      contacts.upsertByWaId.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'smb_app_state_sync',
          value,
        }),
        'DATABASE_ERROR',
      )
      sync.update.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'smb_app_state_sync',
          value,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('smb_message_echoes', () => {
    const value = {
      metadata,
      message_echoes: [
        { id: 'e1', to: '5511999990001', type: 'text', text: { body: 'ok' } },
        { id: 'e2', to: '5511999990002', type: 'image' },
      ],
    }

    it('records what the team typed in the app as outbound messages', async () => {
      webhook.ingestOutboundDeviceMessage.mockResolvedValue(ok(undefined))
      expectOk(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'smb_message_echoes',
          value,
        }),
      )
      expect(webhook.ingestOutboundDeviceMessage).toHaveBeenCalledTimes(2)
      expect(webhook.ingestOutboundDeviceMessage).toHaveBeenCalledWith({
        connection: coexisting,
        waId: '5511999990001',
        providerMessageId: 'e1',
        type: 'TEXT',
        text: 'ok',
      })
    })

    it('propagates a pipeline failure', async () => {
      webhook.ingestOutboundDeviceMessage.mockResolvedValue(
        err(databaseError('x')),
      )
      expectErr(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'smb_message_echoes',
          value,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('history', () => {
    const history = (progress: number | undefined) => ({
      metadata,
      history: [
        {
          metadata: { phase: 0, progress },
          threads: [
            {
              id: '5511999990001',
              messages: [
                {
                  id: 'h1',
                  from: '5511999990001',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'oi' },
                },
                {
                  id: 'h2',
                  from: '5511900000000',
                  timestamp: '1700000100',
                  type: 'text',
                  text: { body: 'olá' },
                  history_context: { status: 'READ' },
                },
              ],
            },
          ],
        },
      ],
    })

    beforeEach(() => {
      conversations.findActiveByContact.mockResolvedValue(ok(null))
      conversations.findLatestClosedByContact.mockResolvedValue(ok(null))
      conversations.create.mockResolvedValue(ok({ id: 'cv1' } as never))
      conversations.update.mockResolvedValue(ok({} as never))
      sync.createHistoryMessages.mockResolvedValue(ok(2))
    })

    it('imports a thread into a new closed conversation, without side effects', async () => {
      expectOk(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'history',
          value: history(40),
        }),
      )
      expect(conversations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn1',
          contactId: 'ct1',
          status: 'CLOSED',
          unreadCount: 0,
          lastMessageAt: new Date(1700000100 * 1000),
          closedAt: new Date(1700000100 * 1000),
        }),
      )
      const rows = sync.createHistoryMessages.mock.calls[0][0]
      expect(rows).toEqual([
        expect.objectContaining({
          conversationId: 'cv1',
          direction: 'IN',
          providerMessageId: 'h1',
          status: 'DELIVERED',
          createdAt: new Date(1700000000 * 1000),
        }),
        expect.objectContaining({
          direction: 'OUT',
          providerMessageId: 'h2',
          status: 'READ',
        }),
      ])
      expect(sync.update).toHaveBeenCalledWith('conn1', {
        status: 'SYNCING',
        progress: 40,
        messagesImported: { increment: 2 },
        conversationsTouched: { increment: 1 },
      })
    })

    it('completes the import at 100%', async () => {
      expectOk(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'history',
          value: history(100),
        }),
      )
      expect(sync.update).toHaveBeenCalledWith(
        'conn1',
        expect.objectContaining({
          status: 'COMPLETED',
          progress: 100,
          finishedAt: expect.any(Date),
        }),
      )
    })

    it('does not touch the progress when Meta sends none', async () => {
      await WhatsAppCoexistenceService.applyWebhook({
        field: 'history',
        value: history(undefined),
      })
      const patch = sync.update.mock.calls[0][1] as Record<string, unknown>
      expect(patch).not.toHaveProperty('progress')
      expect(patch.status).toBe('SYNCING')
    })

    it('adds to an existing open conversation and only moves lastMessageAt forward', async () => {
      conversations.findActiveByContact.mockResolvedValue(
        ok({
          id: 'cv9',
          lastMessageAt: new Date(1600000000 * 1000),
        } as never),
      )
      await WhatsAppCoexistenceService.applyWebhook({
        field: 'history',
        value: history(10),
      })
      expect(conversations.create).not.toHaveBeenCalled()
      expect(conversations.update).toHaveBeenCalledWith('cv9', {
        lastMessageAt: new Date(1700000100 * 1000),
      })

      conversations.update.mockClear()
      conversations.findActiveByContact.mockResolvedValue(
        ok({
          id: 'cv9',
          lastMessageAt: new Date(1800000000 * 1000),
        } as never),
      )
      await WhatsAppCoexistenceService.applyWebhook({
        field: 'history',
        value: history(10),
      })
      expect(conversations.update).not.toHaveBeenCalled()
    })

    it('reuses the latest closed conversation and fills an empty lastMessageAt', async () => {
      conversations.findLatestClosedByContact.mockResolvedValue(
        ok({ id: 'cv7', lastMessageAt: null } as never),
      )
      await WhatsAppCoexistenceService.applyWebhook({
        field: 'history',
        value: history(10),
      })
      expect(conversations.create).not.toHaveBeenCalled()
      expect(conversations.update).toHaveBeenCalledWith('cv7', {
        lastMessageAt: new Date(1700000100 * 1000),
      })
    })

    it('records a refusal to share the history', async () => {
      expectOk(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'history',
          value: {
            metadata,
            history: [{ errors: [{ code: 2593109, title: 'declined' }] }],
          },
        }),
      )
      expect(sync.update).toHaveBeenCalledWith('conn1', {
        status: 'DECLINED',
        finishedAt: expect.any(Date),
      })
      sync.update.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await WhatsAppCoexistenceService.applyWebhook({
          field: 'history',
          value: {
            metadata,
            history: [{ errors: [{ code: 2593107 }] }],
          },
        }),
        'DATABASE_ERROR',
      )
    })

    it('propagates database failures at every step', async () => {
      const apply = () =>
        WhatsAppCoexistenceService.applyWebhook({
          field: 'history',
          value: history(10),
        })
      contacts.upsertByWaId.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(await apply(), 'DATABASE_ERROR')
      conversations.findActiveByContact.mockResolvedValueOnce(
        err(databaseError('x')),
      )
      expectErr(await apply(), 'DATABASE_ERROR')
      conversations.findLatestClosedByContact.mockResolvedValueOnce(
        err(databaseError('x')),
      )
      expectErr(await apply(), 'DATABASE_ERROR')
      conversations.create.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(await apply(), 'DATABASE_ERROR')
      conversations.findActiveByContact.mockResolvedValueOnce(
        ok({ id: 'cv9', lastMessageAt: null } as never),
      )
      conversations.update.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(await apply(), 'DATABASE_ERROR')
      sync.createHistoryMessages.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(await apply(), 'DATABASE_ERROR')
      sync.update.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(await apply(), 'DATABASE_ERROR')
    })
  })
})
