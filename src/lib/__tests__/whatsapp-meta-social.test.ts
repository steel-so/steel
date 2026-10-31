import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  attachmentText,
  createMetaSocialClient,
  exchangeLongLivedToken,
  fetchSocialProfile,
  isSocialChannel,
  isSocialWaId,
  listManagedPages,
  parseSocialWaId,
  parseSocialWebhook,
  replyToComment,
  sendPrivateReply,
  socialWaId,
  subscribePage,
} from '../whatsapp/meta-social'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('social identities', () => {
  it('prefixes and parses the contact identity', () => {
    expect(socialWaId('INSTAGRAM', '123')).toBe('ig:123')
    expect(socialWaId('MESSENGER', '9')).toBe('fb:9')
    expect(parseSocialWaId('ig:123')).toEqual({
      channel: 'INSTAGRAM',
      id: '123',
    })
    expect(parseSocialWaId('fb:9')).toEqual({ channel: 'MESSENGER', id: '9' })
    expect(parseSocialWaId('5511999999999')).toBeNull()
    expect(parseSocialWaId('ig:')).toBeNull()
    expect(isSocialWaId('fb:9')).toBe(true)
    expect(isSocialWaId('5511')).toBe(false)
  })

  it('recognises the social channels', () => {
    expect(isSocialChannel('INSTAGRAM')).toBe(true)
    expect(isSocialChannel('MESSENGER')).toBe(true)
    expect(isSocialChannel('WHATSAPP')).toBe(false)
    expect(isSocialChannel(undefined)).toBe(false)
  })
})

describe('attachmentText', () => {
  it('labels the attachment kind and keeps the caption', () => {
    expect(attachmentText('image', 'u')).toBe('[Imagem] u')
    expect(attachmentText('video', 'u')).toBe('[Vídeo] u')
    expect(attachmentText('audio', 'u')).toBe('[Áudio] u')
    expect(attachmentText('file', 'u')).toBe('[Anexo] u')
    expect(attachmentText(undefined, 'u', 'olha')).toBe('olha\n[Anexo] u')
  })
})

describe('parseSocialWebhook', () => {
  it('reads a Messenger DM and an echo', () => {
    const events = parseSocialWebhook({
      object: 'page',
      entry: [
        {
          id: 'PAGE',
          messaging: [
            {
              sender: { id: 'USER' },
              recipient: { id: 'PAGE' },
              message: { mid: 'm1', text: 'oi' },
            },
            {
              sender: { id: 'PAGE' },
              recipient: { id: 'USER' },
              message: { mid: 'm2', text: 'olá', is_echo: true },
            },
          ],
        },
      ],
    })
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'message',
        channel: 'MESSENGER',
        accountId: 'PAGE',
        contactId: 'USER',
        mid: 'm1',
        text: 'oi',
        echo: false,
      }),
      expect.objectContaining({ mid: 'm2', contactId: 'USER', echo: true }),
    ])
  })

  it('reads an Instagram attachment and drops empty, deleted and own messages', () => {
    const events = parseSocialWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'IG',
          messaging: [
            {
              sender: { id: 'U' },
              recipient: { id: 'IG' },
              message: {
                mid: 'a1',
                attachments: [{ type: 'image', payload: { url: 'http://x' } }],
              },
            },
            { sender: { id: 'U' }, message: { mid: 'a2' } },
            {
              sender: { id: 'U' },
              message: { mid: 'a3', text: 'x', is_deleted: true },
            },
            { sender: { id: 'IG' }, message: { mid: 'a4', text: 'self' } },
            { sender: { id: 'U' }, message: { text: 'no mid' } },
            { sender: {}, message: { mid: 'a5', text: 'x' } },
          ],
        },
      ],
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      channel: 'INSTAGRAM',
      attachmentUrl: 'http://x',
      attachmentType: 'image',
    })
  })

  it('reads Page feed comments and ignores everything else', () => {
    const events = parseSocialWebhook({
      object: 'page',
      entry: [
        {
          id: 'PAGE',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'c1',
                post_id: 'p1',
                parent_id: 'p1',
                permalink_url: 'https://fb/x',
                message: 'quanto custa?',
                from: { id: 'U', name: 'Ana' },
              },
            },
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'c2',
                post_id: 'p1',
                parent_id: 'c1',
                message: 'resposta',
                from: { id: 'U2', name: 'Bia' },
              },
            },
            { field: 'feed', value: { item: 'comment', verb: 'remove' } },
            { field: 'feed', value: { item: 'like', verb: 'add' } },
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'c3',
                message: 'own',
                from: { id: 'PAGE' },
              },
            },
            { field: 'ratings', value: {} },
            { field: 'feed' },
          ],
        },
      ],
    })
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'comment',
        commentId: 'c1',
        postId: 'p1',
        parentCommentId: undefined,
        permalink: 'https://fb/x',
        contactName: 'Ana',
      }),
      expect.objectContaining({ commentId: 'c2', parentCommentId: 'c1' }),
    ])
  })

  it('reads Instagram comments', () => {
    const events = parseSocialWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'IG',
          changes: [
            {
              field: 'comments',
              value: {
                id: 'ic1',
                text: 'lindo',
                from: { id: 'U', username: 'ana' },
                media: { id: 'media1' },
              },
            },
            {
              field: 'comments',
              value: { id: 'ic2', text: 'self', from: { id: 'IG' } },
            },
            { field: 'comments', value: { id: 'ic3', from: { id: 'U' } } },
            { field: 'mentions', value: {} },
          ],
        },
      ],
    })
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'comment',
        channel: 'INSTAGRAM',
        commentId: 'ic1',
        postId: 'media1',
        contactName: 'ana',
        text: 'lindo',
      }),
    ])
  })

  it('returns nothing for unknown shapes', () => {
    expect(parseSocialWebhook(null)).toEqual([])
    expect(parseSocialWebhook('x')).toEqual([])
    expect(parseSocialWebhook({ object: 'user', entry: [] })).toEqual([])
    expect(parseSocialWebhook({ object: 'page' })).toEqual([])
    expect(
      parseSocialWebhook({ object: 'page', entry: [{ messaging: [{}] }] }),
    ).toEqual([])
  })
})

describe('Graph calls', () => {
  it('exchanges the login for a long-lived token', async () => {
    const fetchMock = mockFetch(200, { access_token: 'long' })
    const result = await exchangeLongLivedToken(
      { appId: '1', appSecret: 's' },
      'short',
    )
    expect(expectOk(result)).toBe('long')
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url).toContain('grant_type=fb_exchange_token')
  })

  it('fails when Meta refuses or returns no token', async () => {
    mockFetch(400, { error: { message: 'bad', code: 190 } })
    expectErr(
      await exchangeLongLivedToken({ appId: '1', appSecret: 's' }, 'x'),
      'WHATSAPP_PROVIDER_ERROR',
    )
    mockFetch(200, {})
    expectErr(
      await exchangeLongLivedToken({ appId: '1', appSecret: 's' }, 'x'),
      'WHATSAPP_PROVIDER_ERROR',
    )
  })

  it('uses the user-facing message when Meta sends one', async () => {
    mockFetch(400, {
      error: { message: 'm', error_user_msg: 'Mensagem amigável' },
    })
    const error = expectErr(await subscribePage('t', 'p'))
    expect(error.message).toBe('Mensagem amigável')
  })

  it('reports a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      }),
    )
    const error = expectErr(await subscribePage('t', 'p'))
    expect(error.message).toContain('Não foi possível falar com a Meta')
  })

  it('lists the managed pages with their Instagram account', async () => {
    mockFetch(200, {
      data: [
        {
          id: 'P1',
          name: 'Loja',
          access_token: 'pt1',
          instagram_business_account: { id: 'IG1', username: 'loja' },
        },
        {
          id: 'P2',
          access_token: 'pt2',
          instagram_business_account: { id: 'IG2' },
        },
        { id: 'P3', name: 'Sem token' },
        { id: 'P4', name: 'Plain', access_token: 'pt4' },
      ],
    })
    const pages = expectOk(await listManagedPages('user'))
    expect(pages).toEqual([
      {
        id: 'P1',
        name: 'Loja',
        accessToken: 'pt1',
        instagram: { id: 'IG1', username: 'loja' },
      },
      {
        id: 'P2',
        name: 'P2',
        accessToken: 'pt2',
        instagram: { id: 'IG2', username: null },
      },
      { id: 'P4', name: 'Plain', accessToken: 'pt4', instagram: null },
    ])
  })

  it('handles an empty or failing page list', async () => {
    mockFetch(200, {})
    expect(expectOk(await listManagedPages('u'))).toEqual([])
    mockFetch(500, {})
    expectErr(await listManagedPages('u'), 'WHATSAPP_PROVIDER_ERROR')
  })

  it('subscribes the page webhooks', async () => {
    const fetchMock = mockFetch(200, { success: true })
    expect(expectOk(await subscribePage('t', 'P1', ['messages']))).toBe(true)
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toContain('/P1/subscribed_apps')
    expect(JSON.parse(String(call[1].body))).toEqual({
      subscribed_fields: ['messages'],
    })
    mockFetch(200, {})
    expect(expectOk(await subscribePage('t', 'P1'))).toBe(true)
  })

  it('replies publicly: Instagram replies, Facebook comments', async () => {
    const fetchMock = mockFetch(200, { id: 'r1' })
    expect(
      expectOk(
        await replyToComment({
          channel: 'INSTAGRAM',
          commentId: 'c1',
          token: 't',
          text: 'oi',
        }),
      ),
    ).toBe('r1')
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      '/c1/replies',
    )
    await replyToComment({
      channel: 'MESSENGER',
      commentId: 'c2',
      token: 't',
      text: 'oi',
    })
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toContain(
      '/c2/comments',
    )
  })

  it('fails a public reply Meta does not confirm', async () => {
    mockFetch(200, {})
    expectErr(
      await replyToComment({
        channel: 'MESSENGER',
        commentId: 'c',
        token: 't',
        text: 'x',
      }),
      'WHATSAPP_PROVIDER_ERROR',
    )
    mockFetch(400, { error: { message: 'no' } })
    expectErr(
      await replyToComment({
        channel: 'MESSENGER',
        commentId: 'c',
        token: 't',
        text: 'x',
      }),
      'WHATSAPP_PROVIDER_ERROR',
    )
  })

  it('sends a private reply to the comment author', async () => {
    const fetchMock = mockFetch(200, { message_id: 'mid1' })
    expect(
      expectOk(
        await sendPrivateReply({
          pageId: 'P',
          commentId: 'c1',
          token: 't',
          text: 'dm',
        }),
      ),
    ).toBe('mid1')
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(call[1].body))).toEqual({
      recipient: { comment_id: 'c1' },
      message: { text: 'dm' },
    })
    mockFetch(200, {})
    expectErr(
      await sendPrivateReply({
        pageId: 'P',
        commentId: 'c1',
        token: 't',
        text: 'dm',
      }),
      'WHATSAPP_PROVIDER_ERROR',
    )
    mockFetch(400, {})
    expectErr(
      await sendPrivateReply({
        pageId: 'P',
        commentId: 'c1',
        token: 't',
        text: 'dm',
      }),
      'WHATSAPP_PROVIDER_ERROR',
    )
  })

  it('fetches the customer profile, falling back to nothing', async () => {
    mockFetch(200, { name: 'Ana', profile_pic: 'http://pic' })
    expect(await fetchSocialProfile('MESSENGER', 'U', 't')).toEqual({
      name: 'Ana',
      avatarUrl: 'http://pic',
    })
    mockFetch(200, { username: 'ana' })
    expect(await fetchSocialProfile('INSTAGRAM', 'U', 't')).toEqual({
      name: 'ana',
      avatarUrl: null,
    })
    mockFetch(200, {})
    expect(await fetchSocialProfile('INSTAGRAM', 'U', 't')).toEqual({
      name: null,
      avatarUrl: null,
    })
    mockFetch(403, {})
    expect(await fetchSocialProfile('MESSENGER', 'U', 't')).toEqual({
      name: null,
      avatarUrl: null,
    })
  })
})

describe('createMetaSocialClient', () => {
  const client = () => createMetaSocialClient({ pageId: 'P', accessToken: 't' })

  it('sends text to the unprefixed recipient', async () => {
    const fetchMock = mockFetch(200, { message_id: 'm1' })
    const result = await client().sendText({ to: 'ig:555', text: 'oi' })
    expect(result).toEqual({ providerMessageId: 'm1' })
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toContain('/P/messages')
    expect(JSON.parse(String(call[1].body))).toEqual({
      recipient: { id: '555' },
      messaging_type: 'RESPONSE',
      message: { text: 'oi' },
    })
  })

  it('keeps a bare recipient id as is', async () => {
    const fetchMock = mockFetch(200, { message_id: 'm1' })
    await client().sendText({ to: '777', text: 'oi' })
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(call[1].body)).recipient).toEqual({ id: '777' })
  })

  it('sends media and the caption as a follow-up text', async () => {
    const fetchMock = mockFetch(200, { message_id: 'm1' })
    await client().sendMedia({
      to: 'fb:1',
      mediaUrl: 'http://img',
      type: 'document',
      caption: 'veja',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(first[1].body)).message.attachment.type).toBe(
      'file',
    )
    await client().sendMedia({ to: 'fb:1', mediaUrl: 'u', type: 'image' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws when Meta refuses or does not confirm', async () => {
    mockFetch(400, { error: { message: 'janela fechada' } })
    await expect(client().sendText({ to: 'fb:1', text: 'x' })).rejects.toThrow(
      'janela fechada',
    )
    mockFetch(200, {})
    await expect(client().sendText({ to: 'fb:1', text: 'x' })).rejects.toThrow(
      'não confirmou',
    )
  })

  it('refuses WhatsApp-only message kinds', async () => {
    const c = client()
    await expect(
      c.sendTemplate({ to: 'x', templateName: 't', language: 'pt_BR' }),
    ).rejects.toThrow('Instagram e Messenger')
    await expect(
      c.sendContact({ to: 'x', name: 'n', waId: '1' }),
    ).rejects.toThrow()
    await expect(
      c.sendButtons({ to: 'x', text: 't', buttons: [] }),
    ).rejects.toThrow()
    await expect(
      c.sendReaction({ to: 'x', providerMessageId: 'm', emoji: '👍' }),
    ).rejects.toThrow()
  })

  it('checks the page connection', async () => {
    mockFetch(200, { id: 'P' })
    expect(await client().getConnectionStatus()).toEqual({
      connected: true,
      error: null,
    })
    mockFetch(400, { error: { message: 'token expirado' } })
    expect(await client().getConnectionStatus()).toEqual({
      connected: false,
      failed: true,
      error: 'token expirado',
    })
  })
})
