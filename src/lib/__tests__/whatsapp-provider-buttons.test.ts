import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  buildMetaInteractive,
  buildMetaListMessage,
  createMetaClient,
  META_INTERACTIVE_BODY_MAX,
  META_LIST_ROWS_MAX,
} from '@/src/lib/whatsapp/meta-client'
import type { WhatsAppOutboundButton } from '@/src/lib/whatsapp/types'
import {
  buildZapiButtons,
  createZapiClient,
} from '@/src/lib/whatsapp/zapi-client'

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

const reply: WhatsAppOutboundButton = {
  type: 'REPLY',
  id: 'stl:q:qr1:b1',
  label: 'Sim',
}
const reply2: WhatsAppOutboundButton = {
  type: 'REPLY',
  id: 'stl:q:qr1:b2',
  label: 'Não',
}
const link: WhatsAppOutboundButton = {
  type: 'URL',
  id: 'l1',
  label: 'Site',
  url: 'https://steel.app',
}
const link2: WhatsAppOutboundButton = {
  type: 'URL',
  id: 'l2',
  label: 'Ajuda',
  url: 'https://steel.app/ajuda',
}

describe('buildMetaInteractive', () => {
  it('sends reply buttons as interactive.type=button', () => {
    const { interactive, body } = buildMetaInteractive({
      to: '55',
      text: 'Confirma?',
      buttons: [reply, reply2],
    })
    expect(body).toBe('Confirma?')
    expect(interactive).toEqual({
      type: 'button',
      body: { text: 'Confirma?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'stl:q:qr1:b1', title: 'Sim' } },
          { type: 'reply', reply: { id: 'stl:q:qr1:b2', title: 'Não' } },
        ],
      },
    })
  })

  it('appends the link to the body when mixed with a reply', () => {
    const { interactive, body } = buildMetaInteractive({
      to: '55',
      text: 'Confirma?',
      buttons: [reply, link],
      media: { url: 'https://m/x.png', type: 'image' },
    })
    expect(body).toBe('Confirma?\n\nSite: https://steel.app')
    expect(interactive.type).toBe('button')
    expect(interactive.header).toEqual({
      type: 'image',
      image: { link: 'https://m/x.png' },
    })
  })

  it('sends a lone link as cta_url (a second link goes in the body)', () => {
    const { interactive, body } = buildMetaInteractive({
      to: '55',
      text: 'Veja',
      buttons: [link, link2],
      media: { url: 'https://m/x.pdf', type: 'document', fileName: 'x.pdf' },
    })
    expect(body).toBe('Veja\n\nAjuda: https://steel.app/ajuda')
    expect(interactive).toEqual({
      type: 'cta_url',
      body: { text: body },
      action: {
        name: 'cta_url',
        parameters: { display_text: 'Site', url: 'https://steel.app' },
      },
      header: {
        type: 'document',
        document: { link: 'https://m/x.pdf', filename: 'x.pdf' },
      },
    })
  })

  it('omits the filename on non-document headers', () => {
    const { interactive } = buildMetaInteractive({
      to: '55',
      text: 'Veja',
      buttons: [reply],
      media: { url: 'https://m/x.mp4', type: 'video', fileName: 'x.mp4' },
    })
    expect(interactive.header).toEqual({
      type: 'video',
      video: { link: 'https://m/x.mp4' },
    })
  })
})

describe('Meta sendButtons()', () => {
  const client = createMetaClient({
    phoneNumberId: 'phone',
    wabaId: 'waba',
    accessToken: 'token',
  })

  it('posts an interactive message', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.9' }] })

    const result = await client.sendButtons({
      to: '5511',
      text: 'Confirma?',
      buttons: [reply],
    })

    expect(result).toEqual({ providerMessageId: 'wamid.9' })
    const call = lastCall(spy)
    expect(call.url).toContain('/phone/messages')
    expect(call.body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5511',
      type: 'interactive',
      interactive: { type: 'button' },
    })
  })

  it('refuses a body over the interactive limit', async () => {
    const spy = stubFetch({})
    await expect(
      client.sendButtons({
        to: '5511',
        text: 'x'.repeat(META_INTERACTIVE_BODY_MAX + 1),
        buttons: [reply],
      }),
    ).rejects.toThrow('1024')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('buildZapiButtons', () => {
  it('uses the button list for reply-only without media', () => {
    expect(
      buildZapiButtons({ to: '55', text: 'Oi', buttons: [reply, reply2] }),
    ).toEqual({
      path: '/send-button-list',
      body: {
        phone: '55',
        message: 'Oi',
        buttonList: {
          buttons: [
            { id: 'stl:q:qr1:b1', label: 'Sim' },
            { id: 'stl:q:qr1:b2', label: 'Não' },
          ],
        },
      },
    })
  })

  it('uses button actions for links and images', () => {
    expect(
      buildZapiButtons({
        to: '55',
        text: 'Oi',
        buttons: [reply, link],
        media: { url: 'https://m/x.png', type: 'image' },
      }),
    ).toEqual({
      path: '/send-button-actions',
      body: {
        phone: '55',
        message: 'Oi',
        image: 'https://m/x.png',
        buttonActions: [
          { id: 'stl:q:qr1:b1', type: 'REPLY', label: 'Sim' },
          { id: 'l1', type: 'URL', label: 'Site', url: 'https://steel.app' },
        ],
      },
    })
  })

  it('does not inline a non-image media', () => {
    const built = buildZapiButtons({
      to: '55',
      text: 'Oi',
      buttons: [reply],
      media: { url: 'https://m/x.pdf', type: 'document' },
    })
    expect(built.path).toBe('/send-button-list')
    expect(built.body.image).toBeUndefined()
  })
})

describe('Z-API sendButtons()', () => {
  it('posts to the chosen endpoint', async () => {
    const spy = stubFetch({ messageId: 'Z1' })
    const client = createZapiClient({ instanceId: 'i', token: 't' })

    const result = await client.sendButtons({
      to: '5511',
      text: 'Oi',
      buttons: [link],
    })

    expect(result).toEqual({ providerMessageId: 'Z1' })
    const call = lastCall(spy)
    expect(call.url).toBe(
      'https://api.z-api.io/instances/i/token/t/send-button-actions',
    )
    expect(call.body.buttonActions).toHaveLength(1)
  })
})

describe('buildMetaListMessage()', () => {
  it('builds one section with the rows and the opening button', () => {
    const message = buildMetaListMessage({
      to: '5511',
      text: 'Como podemos ajudar?',
      buttonLabel: 'Ver opções',
      rows: [
        { id: 'bot:m1:a', title: 'Comercial' },
        { id: 'bot:m1:b', title: 'Suporte' },
      ],
    })
    expect(message).toEqual({
      type: 'list',
      body: { text: 'Como podemos ajudar?' },
      action: {
        button: 'Ver opções',
        sections: [
          {
            title: 'Opções',
            rows: [
              { id: 'bot:m1:a', title: 'Comercial' },
              { id: 'bot:m1:b', title: 'Suporte' },
            ],
          },
        ],
      },
    })
  })

  it('cuts a long title and keeps the full text as the description', () => {
    const long = 'Falar com o financeiro sobre boletos vencidos'
    const message = buildMetaListMessage({
      to: '5511',
      text: 'x',
      buttonLabel: 'Ver opções',
      rows: [{ id: 'r', title: long }],
    }) as { action: { sections: { rows: Record<string, string>[] }[] } }
    const [row] = message.action.sections[0].rows
    expect(row.title.length).toBeLessThanOrEqual(24)
    expect(row.title.endsWith('…')).toBe(true)
    expect(row.description).toBe(long)
  })

  it('keeps an explicit description and caps rows and the button label', () => {
    const rows = Array.from({ length: META_LIST_ROWS_MAX + 3 }, (_, index) => ({
      id: `r${index}`,
      title: `Opção ${index}`,
      description: 'd'.repeat(100),
    }))
    const message = buildMetaListMessage({
      to: '5511',
      text: 'x',
      buttonLabel: 'Um rótulo de botão bem comprido',
      rows,
    }) as {
      action: { button: string; sections: { rows: Record<string, string>[] }[] }
    }
    expect(message.action.button).toHaveLength(20)
    expect(message.action.sections[0].rows).toHaveLength(META_LIST_ROWS_MAX)
    expect(message.action.sections[0].rows[0].description).toHaveLength(72)
  })
})

describe('Meta sendList()', () => {
  const client = createMetaClient({
    phoneNumberId: 'phone',
    wabaId: 'waba',
    accessToken: 'token',
  })
  const input = {
    to: '5511',
    text: 'Escolha',
    buttonLabel: 'Ver opções',
    rows: [{ id: 'a', title: 'A' }],
  }

  it('posts an interactive list', async () => {
    const spy = stubFetch({ messages: [{ id: 'wamid.7' }] })
    const result = await client.sendList?.(input)
    expect(result).toEqual({ providerMessageId: 'wamid.7' })
    expect(lastCall(spy).body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5511',
      type: 'interactive',
      interactive: { type: 'list' },
    })
  })

  it('refuses a body over the interactive limit', async () => {
    const spy = stubFetch({})
    await expect(
      client.sendList?.({
        ...input,
        text: 'x'.repeat(META_INTERACTIVE_BODY_MAX + 1),
      }),
    ).rejects.toThrow('1024')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('Z-API has no interactive list', () => {
  it('does not implement sendList', () => {
    const client = createZapiClient({ instanceId: 'i', token: 't' })
    expect(client.sendList).toBeUndefined()
  })
})
