import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeMetaChannelSettings,
  createFakeSocialComment,
  createFakeSocialConnection,
} from '@/src/__tests__/factories/nov-meta-channels.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, rateLimited } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { SocialEvent } from '@/src/lib/whatsapp/meta-social'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-meta-channel.repository')
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (e: string) => e.replace(/^enc:/, '')),
}))
vi.mock('@/src/lib/rate-limit', () => ({
  whatsappWebhookLimiter: {},
  consume: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/meta-social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/whatsapp/meta-social')>()),
  fetchSocialProfile: vi.fn(),
}))
vi.mock('../whatsapp-webhook.service', () => ({
  WhatsAppWebhookService: {
    ingestInboundMessage: vi.fn(),
    ingestOutboundDeviceMessage: vi.fn(),
  },
}))

import { consume } from '@/src/lib/rate-limit'
import { fetchSocialProfile } from '@/src/lib/whatsapp/meta-social'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppMetaChannelRepository } from '@/src/repositories/whatsapp-meta-channel.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WhatsAppMetaSocialWebhookService } from '../whatsapp-meta-social-webhook.service'
import { WhatsAppWebhookService } from '../whatsapp-webhook.service'

const repo = vi.mocked(WhatsAppMetaChannelRepository)
const contacts = vi.mocked(WhatsAppContactRepository)
const messages = vi.mocked(WhatsAppMessageRepository)
const webhook = vi.mocked(WhatsAppWebhookService)
const profile = vi.mocked(fetchSocialProfile)
const limiter = vi.mocked(consume)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const ingest = (events: SocialEvent[]) =>
  WhatsAppMetaSocialWebhookService.ingest(events)

const dm = (overrides: Partial<SocialEvent> = {}): SocialEvent =>
  ({
    kind: 'message',
    channel: 'MESSENGER',
    accountId: '100200',
    contactId: 'USER',
    mid: 'm1',
    text: 'oi',
    echo: false,
    ...overrides,
  }) as SocialEvent

const comment = (overrides: Partial<SocialEvent> = {}): SocialEvent =>
  ({
    kind: 'comment',
    channel: 'INSTAGRAM',
    accountId: 'IG1',
    contactId: 'USER',
    commentId: 'c1',
    postId: 'p1',
    permalink: 'https://x',
    text: 'quanto custa?',
    ...overrides,
  }) as SocialEvent

beforeEach(() => {
  vi.clearAllMocks()
  repo.findByAccountId.mockResolvedValue(
    ok(createFakeSocialConnection({ id: 'conn1', workspaceId: 'ws1' })),
  )
  repo.findSettings.mockResolvedValue(
    ok(
      createFakeMetaChannelSettings({
        instagramEnabled: true,
        messengerEnabled: true,
        commentsEnabled: true,
      }),
    ),
  )
  repo.createComment.mockResolvedValue(ok(createFakeSocialComment()))
  contacts.findByWaId.mockResolvedValue(ok(null))
  limiter.mockResolvedValue(ok(undefined))
  profile.mockResolvedValue({ name: 'Ana', avatarUrl: 'http://pic' })
  webhook.ingestInboundMessage.mockResolvedValue(ok(undefined))
  webhook.ingestOutboundDeviceMessage.mockResolvedValue(ok(undefined))
  messages.findByProviderMessageId.mockResolvedValue(
    ok({ id: 'msg1' } as never),
  )
})

describe('WhatsAppMetaSocialWebhookService.ingest()', () => {
  it('feeds a DM into the zap pipeline with a prefixed identity and profile', async () => {
    const summary = expectOk(
      await ingest([dm()]),
    )
    expect(summary).toEqual({ processed: 1, skipped: 0 })
    expect(profile).toHaveBeenCalledWith('MESSENGER', 'USER', 'page-token')
    expect(webhook.ingestInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        waId: 'fb:USER',
        contactName: 'Ana',
        contactAvatarUrl: 'http://pic',
        providerMessageId: 'm1',
        type: 'TEXT',
        text: 'oi',
      }),
    )
    expect(repo.createComment).not.toHaveBeenCalled()
  })

  it('does not look the profile up again for a known contact', async () => {
    contacts.findByWaId.mockResolvedValue(ok({ name: 'Ana' } as never))
    await ingest([dm()])
    expect(profile).not.toHaveBeenCalled()
    expect(webhook.ingestInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contactName: undefined,
        contactAvatarUrl: undefined,
      }),
    )
  })

  it('skips the profile when the connection has no token', async () => {
    repo.findByAccountId.mockResolvedValue(
      ok(createFakeSocialConnection({ encryptedMetaAccessToken: null })),
    )
    await ingest([dm()])
    expect(profile).not.toHaveBeenCalled()
  })

  it('falls back to no name when Meta hides the profile', async () => {
    profile.mockResolvedValue({ name: null, avatarUrl: null })
    await ingest([dm()])
    expect(webhook.ingestInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contactName: undefined,
        contactAvatarUrl: undefined,
      }),
    )
  })

  it('turns an attachment-only message into text with the link', async () => {
    await ingest([
      dm({
        text: undefined,
        attachmentUrl: 'http://img',
        attachmentType: 'image',
      }),
    ])
    expect(webhook.ingestInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '[Imagem] http://img' }),
    )
  })

  it('ignores an event with nothing to show', async () => {
    const summary = expectOk(
      await ingest([dm({ text: undefined })]),
    )
    expect(summary.processed).toBe(1)
    expect(webhook.ingestInboundMessage).not.toHaveBeenCalled()
  })

  it('records an answer typed in the Page app as an outbound device message', async () => {
    await ingest([
      dm({ echo: true, text: 'já te respondo' }),
    ])
    expect(webhook.ingestOutboundDeviceMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        waId: 'fb:USER',
        providerMessageId: 'm1',
        text: 'já te respondo',
      }),
    )
    expect(webhook.ingestInboundMessage).not.toHaveBeenCalled()
  })

  it('stores a comment with its post reference', async () => {
    const summary = expectOk(
      await ingest([comment()]),
    )
    expect(summary.processed).toBe(1)
    expect(webhook.ingestInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        waId: 'ig:USER',
        providerMessageId: 'comment:c1',
        text: 'quanto custa?',
      }),
    )
    expect(repo.createComment).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      connectionId: 'conn1',
      messageId: 'msg1',
      commentId: 'c1',
      postId: 'p1',
      parentCommentId: undefined,
      permalink: 'https://x',
    })
  })

  it('uses the commenter name from the webhook instead of a lookup', async () => {
    await ingest([
      comment({ contactName: 'ana.souza' } as Partial<SocialEvent>),
    ])
    expect(profile).not.toHaveBeenCalled()
    expect(webhook.ingestInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactName: 'ana.souza' }),
    )
  })

  it('does not save a comment reference when the message never arrived', async () => {
    messages.findByProviderMessageId.mockResolvedValue(ok(null))
    await ingest([comment()])
    expect(repo.createComment).not.toHaveBeenCalled()
  })

  it('skips events of unknown accounts, disabled modules and disabled channels', async () => {
    repo.findByAccountId.mockResolvedValueOnce(ok(null))
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    const first = expectOk(await ingest([dm(), dm()]))
    expect(first).toEqual({ processed: 0, skipped: 2 })

    repo.findSettings.mockResolvedValue(
      ok(createFakeMetaChannelSettings({ messengerEnabled: false })),
    )
    expect(
      expectOk(await ingest([dm()])).skipped,
    ).toBe(1)

    repo.findSettings.mockResolvedValue(
      ok(createFakeMetaChannelSettings({ instagramEnabled: false })),
    )
    expect(
      expectOk(await ingest([comment()])).skipped,
    ).toBe(1)

    repo.findSettings.mockResolvedValue(
      ok(
        createFakeMetaChannelSettings({
          instagramEnabled: true,
          commentsEnabled: false,
        }),
      ),
    )
    expect(
      expectOk(await ingest([comment()])).skipped,
    ).toBe(1)
    expect(webhook.ingestInboundMessage).not.toHaveBeenCalled()
  })

  it('answers 429-style when the connection is over its limit', async () => {
    limiter.mockResolvedValue(err(rateLimited(1)))
    expectErr(
      await ingest([dm()]),
      'RATE_LIMITED',
    )
  })

  it('propagates repository and pipeline failures', async () => {
    repo.findByAccountId.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await ingest([dm()]),
      'DATABASE_ERROR',
    )
    repo.findSettings.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await ingest([dm()]),
      'DATABASE_ERROR',
    )
    webhook.ingestInboundMessage.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await ingest([dm()]),
      'DATABASE_ERROR',
    )
    messages.findByProviderMessageId.mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expectErr(
      await ingest([comment()]),
      'DATABASE_ERROR',
    )
    repo.createComment.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await ingest([comment()]),
      'DATABASE_ERROR',
    )
  })

  it('returns an empty summary for no events', async () => {
    const summary = expectOk(await ingest([]))
    expect(summary).toEqual({ processed: 0, skipped: 0 })
  })
})
