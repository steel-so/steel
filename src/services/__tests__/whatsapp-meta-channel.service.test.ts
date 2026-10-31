import type { WhatsAppConnection } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeMetaChannelSettings,
  createFakeSocialComment,
  createFakeSocialConnection,
} from '@/src/__tests__/factories/nov-meta-channels.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  whatsappConversationNotFound,
  whatsappProviderError,
} from '@/src/errors'
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
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-meta-channel.repository')
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (plain: string) => `enc:${plain}`),
  decryptConnectionSecret: vi.fn(async (e: string) => e.replace(/^enc:/, '')),
}))
vi.mock('@/src/lib/whatsapp/meta-social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/whatsapp/meta-social')>()),
  exchangeLongLivedToken: vi.fn(),
  listManagedPages: vi.fn(),
  subscribePage: vi.fn(),
  replyToComment: vi.fn(),
  sendPrivateReply: vi.fn(),
}))
vi.mock('../whatsapp-conversation-scope.service', () => ({
  loadConversationForViewer: vi.fn(),
}))
vi.mock('../whatsapp-message.service', () => ({
  finalizeOutboundMessage: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import {
  exchangeLongLivedToken,
  listManagedPages,
  replyToComment,
  sendPrivateReply,
  subscribePage,
} from '@/src/lib/whatsapp/meta-social'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMetaChannelRepository } from '@/src/repositories/whatsapp-meta-channel.repository'
import { loadConversationForViewer } from '../whatsapp-conversation-scope.service'
import { finalizeOutboundMessage } from '../whatsapp-message.service'
import { WhatsAppMetaChannelService } from '../whatsapp-meta-channel.service'

// Low entropy on purpose: secret scanners flag random-looking literals.
const USER_TOKEN = 'x'.repeat(24)

const members = vi.mocked(MembershipRepository)
const connections = vi.mocked(WhatsAppConnectionRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const repo = vi.mocked(WhatsAppMetaChannelRepository)
const exchange = vi.mocked(exchangeLongLivedToken)
const pagesOf = vi.mocked(listManagedPages)
const subscribe = vi.mocked(subscribePage)
const publicReply = vi.mocked(replyToComment)
const privateReply = vi.mocked(sendPrivateReply)
const loadConversation = vi.mocked(loadConversationForViewer)
const finalize = vi.mocked(finalizeOutboundMessage)

const PAGE = {
  id: '100200',
  name: 'Loja',
  accessToken: 'page-token',
  instagram: { id: 'IG1', username: 'loja' },
}

function asRole(role: 'MEMBER' | 'ADMIN') {
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function settings(overrides = {}) {
  repo.findSettings.mockResolvedValue(
    ok(
      createFakeMetaChannelSettings({
        workspaceId: 'ws1',
        instagramEnabled: true,
        messengerEnabled: true,
        ...overrides,
      }),
    ),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  env.WHATSAPP_META_APP_ID = '123'
  env.WHATSAPP_META_APP_SECRET = 'secret'
  asRole('ADMIN')
  settings()
  exchange.mockResolvedValue(ok('long-user-token'))
  pagesOf.mockResolvedValue(ok([PAGE]))
})

describe('getSettings()', () => {
  it('returns everything off when nothing was saved', async () => {
    repo.findSettings.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppMetaChannelService.getSettings('u1', 'ws1')),
    ).toEqual({
      workspaceId: 'ws1',
      instagramEnabled: false,
      messengerEnabled: false,
      commentsEnabled: false,
      coexistenceEnabled: false,
    })
  })

  it('rejects a non-member', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppMetaChannelService.getSettings('u1', 'ws1'),
      'FORBIDDEN',
    )
  })

  it('propagates a database error', async () => {
    repo.findSettings.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.getSettings('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('updateSettings()', () => {
  it('saves the switches and audits the change', async () => {
    repo.upsertSettings.mockResolvedValue(
      ok(createFakeMetaChannelSettings({ commentsEnabled: true })),
    )
    const dto = expectOk(
      await WhatsAppMetaChannelService.updateSettings('u1', 'ws1', {
        commentsEnabled: true,
      }),
    )
    expect(dto.commentsEnabled).toBe(true)
    expect(repo.upsertSettings).toHaveBeenCalledWith('ws1', {
      commentsEnabled: true,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_settings',
        action: 'update',
        meta: { scope: 'meta_channels', changed: ['commentsEnabled'] },
      }),
    )
  })

  it('forbids a MEMBER', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppMetaChannelService.updateSettings('u1', 'ws1', {
        instagramEnabled: true,
      }),
      'FORBIDDEN',
    )
    expect(repo.upsertSettings).not.toHaveBeenCalled()
  })

  it('propagates a database error', async () => {
    repo.upsertSettings.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.updateSettings('u1', 'ws1', {
        instagramEnabled: true,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('listConnections()', () => {
  it('maps the connections', async () => {
    repo.listSocialConnections.mockResolvedValue(
      ok([createFakeSocialConnection({ id: 'c1' })]),
    )
    const list = expectOk(
      await WhatsAppMetaChannelService.listConnections('u1', 'ws1'),
    )
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('c1')
  })

  it('rejects a non-member and propagates database errors', async () => {
    repo.listSocialConnections.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.listConnections('u1', 'ws1'),
      'DATABASE_ERROR',
    )
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppMetaChannelService.listConnections('u1', 'ws1'),
      'FORBIDDEN',
    )
  })
})

describe('listPages()', () => {
  const dto = { accessToken: USER_TOKEN }

  it('lists the pages with the channels already connected', async () => {
    repo.listSocialConnections.mockResolvedValue(
      ok([createFakeSocialConnection({ channel: 'MESSENGER' })]),
    )
    const pages = expectOk(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
    )
    expect(pages).toEqual([
      {
        pageId: '100200',
        name: 'Loja',
        instagramAccountId: 'IG1',
        instagramUsername: 'loja',
        connectedChannels: ['MESSENGER'],
      },
    ])
  })

  it('handles a page without Instagram', async () => {
    pagesOf.mockResolvedValue(ok([{ ...PAGE, instagram: null }]))
    repo.listSocialConnections.mockResolvedValue(ok([]))
    const pages = expectOk(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
    )
    expect(pages[0]).toMatchObject({
      instagramAccountId: null,
      instagramUsername: null,
    })
  })

  it('refuses while both channels are off', async () => {
    settings({ instagramEnabled: false, messengerEnabled: false })
    expectErr(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
      'FEATURE_NOT_ENABLED',
    )
  })

  it('refuses when the Meta app is not configured', async () => {
    env.WHATSAPP_META_APP_SECRET = undefined
    expectErr(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
      'FEATURE_NOT_ENABLED',
    )
  })

  it('propagates Meta and database failures', async () => {
    exchange.mockResolvedValue(err(whatsappProviderError('x')))
    expectErr(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
      'WHATSAPP_PROVIDER_ERROR',
    )
    exchange.mockResolvedValue(ok('t'))
    pagesOf.mockResolvedValue(err(whatsappProviderError('x')))
    expectErr(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
      'WHATSAPP_PROVIDER_ERROR',
    )
    pagesOf.mockResolvedValue(ok([PAGE]))
    repo.listSocialConnections.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
    repo.findSettings.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('forbids a MEMBER', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppMetaChannelService.listPages('u1', 'ws1', dto),
      'FORBIDDEN',
    )
  })
})

describe('connect()', () => {
  const dto = {
    accessToken: USER_TOKEN,
    pageId: '100200',
    channels: ['MESSENGER', 'INSTAGRAM'] as ('MESSENGER' | 'INSTAGRAM')[],
  }

  beforeEach(() => {
    subscribe.mockResolvedValue(ok(true))
    repo.findByPage.mockResolvedValue(ok(null))
    connections.create.mockImplementation(async (data) =>
      ok(
        createFakeSocialConnection({
          id: `c-${data.channel}`,
          channel: data.channel,
          label: data.label,
          metaPageId: data.metaPageId,
          metaInstagramAccountId: data.metaInstagramAccountId ?? null,
        }),
      ),
    )
  })

  it('creates one connection per channel with the encrypted page token', async () => {
    const result = expectOk(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', dto),
    )
    expect(result.map((c) => c.channel)).toEqual(['MESSENGER', 'INSTAGRAM'])
    expect(subscribe).toHaveBeenCalledWith(
      'page-token',
      '100200',
      expect.arrayContaining(['messages', 'feed']),
    )
    expect(connections.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'META',
        channel: 'MESSENGER',
        label: 'Messenger Loja',
        phoneNumber: 'fb:100200',
        encryptedMetaAccessToken: 'enc:page-token',
        metaInstagramAccountId: null,
      }),
    )
    expect(connections.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'INSTAGRAM',
        label: 'Instagram loja',
        phoneNumber: 'ig:100200',
        metaInstagramAccountId: 'IG1',
      }),
    )
    expect(auditMutation).toHaveBeenCalledTimes(2)
  })

  it('names an Instagram connection after the account id without a username', async () => {
    pagesOf.mockResolvedValue(
      ok([{ ...PAGE, instagram: { id: 'IG9', username: null } }]),
    )
    await WhatsAppMetaChannelService.connect('u1', 'ws1', {
      ...dto,
      channels: ['INSTAGRAM'],
    })
    expect(connections.create).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Instagram IG9' }),
    )
  })

  it('refreshes the token of a page that is already connected', async () => {
    repo.findByPage.mockResolvedValue(
      ok(createFakeSocialConnection({ id: 'old' })),
    )
    connections.update.mockResolvedValue(
      ok(createFakeSocialConnection({ id: 'old' })),
    )
    const result = expectOk(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', {
        ...dto,
        channels: ['MESSENGER'],
      }),
    )
    expect(result[0].id).toBe('old')
    expect(connections.create).not.toHaveBeenCalled()
    expect(connections.update).toHaveBeenCalledWith('old', {
      encryptedMetaAccessToken: 'enc:page-token',
      status: 'CONNECTED',
      statusError: null,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update' }),
    )
  })

  it('refuses a channel the workspace has not turned on', async () => {
    settings({ instagramEnabled: false })
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', dto),
      'FEATURE_NOT_ENABLED',
    )
    settings({ messengerEnabled: false })
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', {
        ...dto,
        channels: ['MESSENGER'],
      }),
      'FEATURE_NOT_ENABLED',
    )
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('fails for an unknown page and for Instagram without a linked account', async () => {
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', {
        ...dto,
        pageId: '999999',
      }),
      'META_CHANNEL_PAGE_NOT_FOUND',
    )
    pagesOf.mockResolvedValue(ok([{ ...PAGE, instagram: null }]))
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', dto),
      'FEATURE_NOT_ENABLED',
    )
  })

  it('propagates every upstream failure', async () => {
    subscribe.mockResolvedValue(err(whatsappProviderError('x')))
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', dto),
      'WHATSAPP_PROVIDER_ERROR',
    )
    subscribe.mockResolvedValue(ok(true))
    repo.findByPage.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
    repo.findByPage.mockResolvedValue(ok(null))
    connections.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
    repo.findSettings.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('forbids a MEMBER', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppMetaChannelService.connect('u1', 'ws1', dto),
      'FORBIDDEN',
    )
  })
})

describe('listComments()', () => {
  beforeEach(() => {
    loadConversation.mockResolvedValue(
      ok({
        scope: { module: 'COMMUNICATION' },
        conversation: { id: 'cv1', connectionId: 'conn1' },
      } as never),
    )
  })

  it('maps the comment references of a visible conversation', async () => {
    repo.listCommentsByConversation.mockResolvedValue(
      ok([createFakeSocialComment({ messageId: 'm1' })]),
    )
    const list = expectOk(
      await WhatsAppMetaChannelService.listComments('u1', 'ws1', 'cv1'),
    )
    expect(list.map((c) => c.messageId)).toEqual(['m1'])
  })

  it('hides a conversation the viewer cannot see', async () => {
    loadConversation.mockResolvedValue(err(whatsappConversationNotFound()))
    expectErr(
      await WhatsAppMetaChannelService.listComments('u1', 'ws1', 'cv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('rejects a non-member and propagates database errors', async () => {
    repo.listCommentsByConversation.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppMetaChannelService.listComments('u1', 'ws1', 'cv1'),
      'DATABASE_ERROR',
    )
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppMetaChannelService.listComments('u1', 'ws1', 'cv1'),
      'FORBIDDEN',
    )
  })
})

describe('replyToComment()', () => {
  const reply = (dto: { text: string; mode: 'PUBLIC' | 'PRIVATE' }) =>
    WhatsAppMetaChannelService.replyToComment('u1', 'ws1', 'cv1', 'm1', dto)
  const PUBLIC = { text: 'x', mode: 'PUBLIC' } as const
  const comment = createFakeSocialComment({
    id: 'sc1',
    connectionId: 'conn1',
    commentId: 'cmt9',
  })
  const social = createFakeSocialConnection({
    id: 'conn1',
    channel: 'INSTAGRAM',
  })

  beforeEach(() => {
    loadConversation.mockResolvedValue(
      ok({
        scope: { module: 'COMMUNICATION' },
        conversation: { id: 'cv1', connectionId: 'conn1' },
      } as never),
    )
    repo.findCommentByMessageId.mockResolvedValue(ok(comment))
    connections.findById.mockResolvedValue(ok(social))
    publicReply.mockResolvedValue(ok('reply-1'))
    privateReply.mockResolvedValue(ok('dm-1'))
    repo.markCommentReplied.mockResolvedValue(ok(undefined))
    conversations.update.mockResolvedValue(ok({} as never))
    finalize.mockResolvedValue(ok({ id: 'out1' } as never))
  })

  it('answers in public, hands the chat to a human and records the message', async () => {
    const result = expectOk(
      await reply({ text: 'Obrigado!', mode: 'PUBLIC' }),
    )
    expect(result).toEqual({ id: 'out1' })
    expect(publicReply).toHaveBeenCalledWith({
      channel: 'INSTAGRAM',
      commentId: 'cmt9',
      token: 'page-token',
      text: 'Obrigado!',
    })
    expect(repo.markCommentReplied).toHaveBeenCalledWith('sc1')
    expect(conversations.update).toHaveBeenCalledWith('cv1', {
      aiActive: false,
      aiHandoff: true,
    })
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TEXT',
        text: '[Resposta pública] Obrigado!',
        providerMessageId: 'reply-1',
        replyToMessageId: 'm1',
        actorId: 'u1',
      }),
    )
  })

  it('answers by private message', async () => {
    await reply({ text: 'Te chamei no direct', mode: 'PRIVATE' })
    expect(privateReply).toHaveBeenCalledWith({
      pageId: '100200',
      commentId: 'cmt9',
      token: 'page-token',
      text: 'Te chamei no direct',
    })
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '[Resposta privada] Te chamei no direct',
        providerMessageId: 'dm-1',
      }),
    )
  })

  it('fails when the comment is unknown', async () => {
    repo.findCommentByMessageId.mockResolvedValue(ok(null))
    expectErr(
      await reply(PUBLIC),
      'META_CHANNEL_COMMENT_NOT_FOUND',
    )
  })

  const broken = (overrides: Partial<WhatsAppConnection>) =>
    createFakeSocialConnection({ id: 'conn1', ...overrides })

  it.each([
    ['no connection', null],
    ['a WhatsApp connection', broken({ channel: 'WHATSAPP' })],
    ['another connection', broken({ id: 'other' })],
    ['no page id', broken({ metaPageId: null })],
    ['no token', broken({ encryptedMetaAccessToken: null })],
  ])('fails with %s', async (_label, connection) => {
    connections.findById.mockResolvedValue(ok(connection))
    expectErr(
      await reply(PUBLIC),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    expect(publicReply).not.toHaveBeenCalled()
  })

  it('propagates upstream failures without recording a message', async () => {
    const dto = { text: 'x', mode: 'PUBLIC' as const }
    publicReply.mockResolvedValue(err(whatsappProviderError('fora da janela')))
    expectErr(
      await reply(dto),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(finalize).not.toHaveBeenCalled()

    repo.findCommentByMessageId.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await reply(dto),
      'DATABASE_ERROR',
    )
    repo.findCommentByMessageId.mockResolvedValue(ok(comment))
    connections.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await reply(dto),
      'DATABASE_ERROR',
    )
    loadConversation.mockResolvedValue(err(whatsappConversationNotFound()))
    expectErr(
      await reply(dto),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('rejects a non-member', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await reply(PUBLIC),
      'FORBIDDEN',
    )
  })
})
