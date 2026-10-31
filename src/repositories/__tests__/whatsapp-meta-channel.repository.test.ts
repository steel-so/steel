import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppMetaChannelRepository } from '../whatsapp-meta-channel.repository'

let counter = 0

async function seedSocial(
  channel: 'MESSENGER' | 'INSTAGRAM',
  extra: { coexistence?: boolean } = {},
) {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      channel,
      label: `Social ${counter}`,
      phoneNumber: `${channel === 'MESSENGER' ? 'fb' : 'ig'}:${counter}`,
      metaPageId: `page-${counter}`,
      metaInstagramAccountId: channel === 'INSTAGRAM' ? `ig-${counter}` : null,
      encryptedMetaAccessToken: 'enc:token',
      createdById: user.id,
      ...extra,
    },
  })
  return { workspace, user, connection }
}

describe('WhatsAppMetaChannelRepository settings', () => {
  it('returns null until saved, then upserts the same row', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await WhatsAppMetaChannelRepository.findSettings(workspace.id)),
    ).toBeNull()

    const created = expectOk(
      await WhatsAppMetaChannelRepository.upsertSettings(workspace.id, {
        instagramEnabled: true,
      }),
    )
    expect(created.instagramEnabled).toBe(true)
    expect(created.messengerEnabled).toBe(false)
    expect(created.coexistenceEnabled).toBe(false)

    const updated = expectOk(
      await WhatsAppMetaChannelRepository.upsertSettings(workspace.id, {
        commentsEnabled: true,
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.instagramEnabled).toBe(true)
    expect(updated.commentsEnabled).toBe(true)
  })

  it('returns DATABASE_ERROR when a query throws', async () => {
    vi.spyOn(
      prisma.whatsAppMetaChannelSettings,
      'findUnique',
    ).mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await WhatsAppMetaChannelRepository.findSettings('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppMetaChannelRepository.upsertSettings('missing', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppMetaChannelRepository connections', () => {
  it('lists social and coexistence connections, not plain WhatsApp ones', async () => {
    const social = await seedSocial('MESSENGER')
    const plain = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: social.workspace.id,
        provider: 'ZAPI',
        label: 'Zap',
        phoneNumber: '5511999990000',
        zapiInstanceId: 'inst-meta-channel',
        encryptedZapiToken: 'enc:token',
        createdById: social.user.id,
      },
    })
    const coexisting = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: social.workspace.id,
        provider: 'META',
        label: 'Coex',
        phoneNumber: '5511999990001',
        metaPhoneNumberId: 'pn-coex',
        coexistence: true,
        createdById: social.user.id,
      },
    })

    const list = expectOk(
      await WhatsAppMetaChannelRepository.listSocialConnections(
        social.workspace.id,
      ),
    )
    const ids = list.map((c) => c.id)
    expect(ids).toContain(social.connection.id)
    expect(ids).toContain(coexisting.id)
    expect(ids).not.toContain(plain.id)
  })

  it('finds a connection by Page id (Messenger) and by account id (Instagram)', async () => {
    const messenger = await seedSocial('MESSENGER')
    const instagram = await seedSocial('INSTAGRAM')

    const byPage = expectOk(
      await WhatsAppMetaChannelRepository.findByAccountId(
        'MESSENGER',
        messenger.connection.metaPageId as string,
      ),
    )
    expect(byPage?.id).toBe(messenger.connection.id)

    const byAccount = expectOk(
      await WhatsAppMetaChannelRepository.findByAccountId(
        'INSTAGRAM',
        instagram.connection.metaInstagramAccountId as string,
      ),
    )
    expect(byAccount?.id).toBe(instagram.connection.id)

    expect(
      expectOk(
        await WhatsAppMetaChannelRepository.findByAccountId('MESSENGER', 'nope'),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await WhatsAppMetaChannelRepository.findByAccountId(
          'INSTAGRAM',
          messenger.connection.metaPageId as string,
        ),
      ),
    ).toBeNull()
  })

  it('finds a connection by workspace, channel and Page', async () => {
    const { workspace, connection } = await seedSocial('MESSENGER')
    const found = expectOk(
      await WhatsAppMetaChannelRepository.findByPage(
        workspace.id,
        'MESSENGER',
        connection.metaPageId as string,
      ),
    )
    expect(found?.id).toBe(connection.id)
    expect(
      expectOk(
        await WhatsAppMetaChannelRepository.findByPage(
          workspace.id,
          'INSTAGRAM',
          connection.metaPageId as string,
        ),
      ),
    ).toBeNull()
  })

  it('returns DATABASE_ERROR when a lookup throws', async () => {
    vi.spyOn(prisma.whatsAppConnection, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppMetaChannelRepository.listSocialConnections('w'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppConnection, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppMetaChannelRepository.findByAccountId('MESSENGER', 'x'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppConnection, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppMetaChannelRepository.findByPage('w', 'MESSENGER', 'x'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppMetaChannelRepository comments', () => {
  async function seedComment() {
    const { workspace, connection } = await seedSocial('INSTAGRAM')
    const contact = await prisma.whatsAppContact.create({
      data: { workspaceId: workspace.id, waId: `ig:${counter}`, name: 'Ana' },
    })
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
      },
    })
    const message = await prisma.whatsAppMessage.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'IN',
        type: 'TEXT',
        text: 'quanto custa?',
        providerMessageId: `comment:${counter}`,
      },
    })
    return { workspace, connection, conversation, message }
  }

  it('stores a comment once per message, finds it and lists by conversation', async () => {
    const { workspace, connection, conversation, message } = await seedComment()
    const data = {
      workspaceId: workspace.id,
      connectionId: connection.id,
      messageId: message.id,
      commentId: 'c1',
      postId: 'p1',
      permalink: 'https://www.instagram.com/p/abc/',
    }
    const first = expectOk(await WhatsAppMetaChannelRepository.createComment(data))
    const again = expectOk(
      await WhatsAppMetaChannelRepository.createComment({
        ...data,
        commentId: 'other',
      }),
    )
    expect(again.id).toBe(first.id)
    expect(again.commentId).toBe('c1')

    const found = expectOk(
      await WhatsAppMetaChannelRepository.findCommentByMessageId(
        workspace.id,
        message.id,
      ),
    )
    expect(found?.id).toBe(first.id)
    expect(
      expectOk(
        await WhatsAppMetaChannelRepository.findCommentByMessageId(
          'other-ws',
          message.id,
        ),
      ),
    ).toBeNull()

    const list = expectOk(
      await WhatsAppMetaChannelRepository.listCommentsByConversation(
        workspace.id,
        conversation.id,
      ),
    )
    expect(list.map((c) => c.id)).toEqual([first.id])
    expect(
      expectOk(
        await WhatsAppMetaChannelRepository.listCommentsByConversation(
          workspace.id,
          'other-conversation',
        ),
      ),
    ).toEqual([])
  })

  it('marks a comment as replied', async () => {
    const { workspace, connection, message } = await seedComment()
    const comment = expectOk(
      await WhatsAppMetaChannelRepository.createComment({
        workspaceId: workspace.id,
        connectionId: connection.id,
        messageId: message.id,
        commentId: 'c2',
      }),
    )
    expect(comment.repliedAt).toBeNull()
    expectOk(await WhatsAppMetaChannelRepository.markCommentReplied(comment.id))
    const found = expectOk(
      await WhatsAppMetaChannelRepository.findCommentByMessageId(
        workspace.id,
        message.id,
      ),
    )
    expect(found?.repliedAt).toBeInstanceOf(Date)
  })

  it('returns DATABASE_ERROR on failures', async () => {
    expectErr(
      await WhatsAppMetaChannelRepository.createComment({
        workspaceId: 'missing',
        connectionId: 'missing',
        messageId: 'missing',
        commentId: 'c',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppMetaChannelRepository.markCommentReplied('missing'),
      'DATABASE_ERROR',
    )
    vi.spyOn(
      prisma.whatsAppSocialComment,
      'findFirst',
    ).mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await WhatsAppMetaChannelRepository.findCommentByMessageId('w', 'm'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppMessage, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppMetaChannelRepository.listCommentsByConversation('w', 'c'),
      'DATABASE_ERROR',
    )
  })
})
