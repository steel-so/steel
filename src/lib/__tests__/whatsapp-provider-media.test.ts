import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { createMetaClient } from '@/src/lib/whatsapp/meta-client'
import { createZapiClient } from '@/src/lib/whatsapp/zapi-client'

function stubFetch(body: unknown) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

function lastCall(spy: ReturnType<typeof stubFetch>) {
  const [url, init] = spy.mock.calls.at(-1) as unknown as [string, RequestInit]
  return { url, body: JSON.parse(String(init.body)) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Meta Cloud API sendMedia()', () => {
  const client = createMetaClient({
    phoneNumberId: 'phone',
    wabaId: 'waba',
    accessToken: 'token',
  })

  it('should send a document with its filename and caption', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.1' }] })

    await client.sendMedia({
      to: '5511',
      mediaUrl: 'https://cdn/x.pdf',
      type: 'document',
      caption: 'Seu boleto',
      fileName: 'boleto.pdf',
    })

    expect(lastCall(spy).body).toEqual(
      expect.objectContaining({
        type: 'document',
        document: {
          link: 'https://cdn/x.pdf',
          caption: 'Seu boleto',
          filename: 'boleto.pdf',
        },
      }),
    )
  })

  it('should send video as video and drop the caption for audio', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.2' }] })

    await client.sendMedia({
      to: '5511',
      mediaUrl: 'https://cdn/x.mp4',
      type: 'video',
      caption: 'Veja',
    })
    expect(lastCall(spy).body.video).toEqual({
      link: 'https://cdn/x.mp4',
      caption: 'Veja',
    })

    await client.sendMedia({
      to: '5511',
      mediaUrl: 'https://cdn/x.ogg',
      type: 'audio',
      caption: 'ignorada',
    })
    expect(lastCall(spy).body).toEqual(
      expect.objectContaining({
        type: 'audio',
        audio: { link: 'https://cdn/x.ogg' },
      }),
    )
  })
})

describe('Z-API sendMedia()', () => {
  const client = createZapiClient({ instanceId: 'inst', token: 'tok' })

  it('should call send-document with the file extension', async () => {
    const spy = stubFetch({ messageId: 'z1' })

    await client.sendMedia({
      to: '5511',
      mediaUrl: 'https://cdn/abc.bin',
      type: 'document',
      caption: 'Contrato',
      fileName: 'contrato.docx',
    })

    const { url, body } = lastCall(spy)
    expect(url).toMatch(/\/send-document\/docx$/)
    expect(body).toEqual(
      expect.objectContaining({
        document: 'https://cdn/abc.bin',
        fileName: 'contrato.docx',
        caption: 'Contrato',
      }),
    )
  })

  it('should call send-video / send-audio and drop the audio caption', async () => {
    const spy = stubFetch({ messageId: 'z2' })

    await client.sendMedia({
      to: '5511',
      mediaUrl: 'https://cdn/a.mp4',
      type: 'video',
      caption: 'Oi',
    })
    expect(lastCall(spy).url).toMatch(/\/send-video$/)

    await client.sendMedia({
      to: '5511',
      mediaUrl: 'https://cdn/a.mp3',
      type: 'audio',
      caption: 'Oi',
    })
    const audio = lastCall(spy)
    expect(audio.url).toMatch(/\/send-audio$/)
    expect(audio.body.caption).toBeUndefined()
  })
})

describe('Meta Cloud API recipient (BSUID)', () => {
  const client = createMetaClient({
    phoneNumberId: 'phone',
    wabaId: 'waba',
    accessToken: 'token',
  })

  it('should address a phone number in `to`', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.1' }] })

    await client.sendText({ to: '5513991374570', text: 'oi' })

    const { body } = lastCall(spy)
    expect(body.to).toBe('5513991374570')
    expect(body).not.toHaveProperty('recipient')
  })

  it('should address a BSUID in `recipient`, never in `to`', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.2' }] })

    await client.sendText({ to: 'BR.13491208655302741918', text: 'oi' })

    const { body } = lastCall(spy)
    expect(body.recipient).toBe('BR.13491208655302741918')
    expect(body).not.toHaveProperty('to')
  })
})

describe('Meta Cloud API BSUID errors', () => {
  const client = createMetaClient({
    phoneNumberId: 'phone',
    wabaId: 'waba',
    accessToken: 'token',
  })

  it('should explain error 131062 in plain Portuguese', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 131062,
                message: 'BSUID recipients are not supported',
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )

    await expect(
      client.sendText({ to: 'BR.13491208655302741918', text: 'oi' }),
    ).rejects.toThrow('sem telefone')
  })
})
