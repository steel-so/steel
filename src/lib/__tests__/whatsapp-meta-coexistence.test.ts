import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  coexistenceContent,
  parseContactSync,
  parseHistoryWebhook,
  parseMessageEchoes,
  requestCoexistenceSync,
} from '../whatsapp/meta-coexistence'

afterEach(() => vi.unstubAllGlobals())

describe('coexistenceContent', () => {
  it('keeps text and turns media into labelled placeholders', () => {
    expect(coexistenceContent({ type: 'text', text: { body: 'oi' } })).toEqual({
      type: 'TEXT',
      text: 'oi',
    })
    expect(coexistenceContent({ type: 'text' })).toEqual({
      type: 'TEXT',
      text: null,
    })
    expect(
      coexistenceContent({ type: 'image', image: { caption: 'foto' } }),
    ).toEqual({ type: 'IMAGE', text: '[Imagem] foto' })
    expect(coexistenceContent({ type: 'video' })).toEqual({
      type: 'VIDEO',
      text: '[Vídeo]',
    })
    expect(
      coexistenceContent({
        type: 'document',
        document: { filename: 'a.pdf' },
      }),
    ).toEqual({ type: 'DOCUMENT', text: '[Documento] a.pdf' })
    expect(coexistenceContent({ type: 'voice' }).type).toBe('AUDIO')
    expect(coexistenceContent({ type: 'sticker' }).type).toBe('STICKER')
    expect(coexistenceContent({ type: 'location' }).type).toBe('LOCATION')
    expect(coexistenceContent({ type: 'contacts' }).type).toBe('CONTACT')
  })

  it('marks an unknown type as unsupported text', () => {
    expect(coexistenceContent({ type: 'order' })).toEqual({
      type: 'TEXT',
      text: '[Mensagem não suportada: order]',
    })
  })
})

describe('parseHistoryWebhook', () => {
  it('reads threads, direction, status and progress', () => {
    const parsed = parseHistoryWebhook({
      history: [
        {
          metadata: { phase: 1, chunk_order: 2, progress: 40 },
          threads: [
            {
              id: '5511999990001',
              messages: [
                {
                  id: 'wamid.1',
                  from: '5511999990001',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'oi' },
                  history_context: { status: 'READ' },
                },
                {
                  id: 'wamid.2',
                  from: '5511900000000',
                  timestamp: 1700000100,
                  type: 'text',
                  text: { body: 'olá' },
                  history_context: { status: 'ERROR' },
                },
                {
                  id: 'wamid.3',
                  from: '5511900000000',
                  timestamp: 'x',
                  type: 'text',
                  text: { body: 'sem status' },
                },
                { from: '5511900000000', type: 'text' },
              ],
            },
            { id: '', messages: [{ id: 'skip', type: 'text' }] },
          ],
        },
      ],
    })
    expect(parsed.declined).toBe(false)
    expect(parsed.chunks).toHaveLength(1)
    const [chunk] = parsed.chunks
    expect(chunk.phase).toBe(1)
    expect(chunk.progress).toBe(40)
    expect(chunk.messages).toHaveLength(3)
    expect(chunk.messages[0]).toMatchObject({
      waId: '5511999990001',
      providerMessageId: 'wamid.1',
      direction: 'IN',
      status: 'READ',
    })
    expect(chunk.messages[0].at).toEqual(new Date(1700000000 * 1000))
    expect(chunk.messages[1]).toMatchObject({
      direction: 'OUT',
      status: 'FAILED',
    })
    expect(chunk.messages[2].status).toBe('SENT')
    expect(chunk.messages[2].at.getTime()).toBeGreaterThan(1700000000000)
  })

  it('flags a refusal to share the history', () => {
    const parsed = parseHistoryWebhook({
      history: [{ errors: [{ code: 2593109, title: 'declined' }] }],
    })
    expect(parsed).toEqual({ declined: true, chunks: [] })
  })

  it('tolerates a missing history and metadata', () => {
    expect(parseHistoryWebhook({})).toEqual({ declined: false, chunks: [] })
    expect(parseHistoryWebhook({ history: [{}] }).chunks).toEqual([
      { phase: null, progress: null, messages: [] },
    ])
  })
})

describe('parseContactSync', () => {
  it('keeps added and edited contacts with a phone', () => {
    expect(
      parseContactSync({
        state_sync: [
          {
            type: 'contact',
            action: 'add',
            contact: {
              full_name: 'Ana Souza',
              phone_number: '+55 11 99999-0001',
            },
          },
          {
            type: 'contact',
            action: 'edit',
            contact: { first_name: 'Bia', phone_number: '5511999990002' },
          },
          {
            type: 'contact',
            action: 'edit',
            contact: { phone_number: '5511999990003' },
          },
          {
            type: 'contact',
            action: 'remove',
            contact: { phone_number: '5511' },
          },
          {
            type: 'contact',
            action: 'add',
            contact: { full_name: 'Sem fone' },
          },
          { type: 'other', contact: { phone_number: '5511' } },
        ],
      }),
    ).toEqual([
      { waId: '5511999990001', name: 'Ana Souza' },
      { waId: '5511999990002', name: 'Bia' },
      { waId: '5511999990003', name: null },
    ])
    expect(parseContactSync({})).toEqual([])
  })
})

describe('parseMessageEchoes', () => {
  it('maps the messages typed in the app', () => {
    expect(
      parseMessageEchoes({
        message_echoes: [
          {
            id: 'e1',
            to: '55 11 99999-0001',
            type: 'text',
            text: { body: 'ok' },
          },
          { id: 'e2', to: '5511999990002', type: 'image' },
          { to: '5511999990003', type: 'text' },
          { id: 'e4', type: 'text' },
        ],
      }),
    ).toEqual([
      {
        waId: '5511999990001',
        providerMessageId: 'e1',
        type: 'TEXT',
        text: 'ok',
      },
      {
        waId: '5511999990002',
        providerMessageId: 'e2',
        type: 'IMAGE',
        text: '[Imagem]',
      },
    ])
    expect(parseMessageEchoes({})).toEqual([])
  })
})

describe('requestCoexistenceSync', () => {
  it('posts the sync type', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(
      expectOk(await requestCoexistenceSync('tok', '555', 'history')),
    ).toBe(true)
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toContain('/555/smb_app_data')
    expect(JSON.parse(String(call[1].body))).toEqual({
      messaging_product: 'whatsapp',
      sync_type: 'history',
    })
  })

  it('maps a refusal and a network failure to a provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 1, message: 'x' } }), {
            status: 400,
          }),
      ),
    )
    expectErr(
      await requestCoexistenceSync('tok', '555', 'smb_app_state_sync'),
      'WHATSAPP_PROVIDER_ERROR',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    )
    expectErr(
      await requestCoexistenceSync('tok', '555', 'history'),
      'WHATSAPP_PROVIDER_ERROR',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      }),
    )
    expectErr(
      await requestCoexistenceSync('tok', '555', 'history'),
      'WHATSAPP_PROVIDER_ERROR',
    )
  })
})
