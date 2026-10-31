import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flowFromTemplate,
  leadCaptureFlow,
  menuFlow,
} from '@/src/lib/whatsapp/chatbot/templates'
import {
  hasFlowErrors,
  nodeHandles,
  validateChatbotFlow,
} from '@/src/lib/whatsapp/chatbot/validate'
import {
  CHATBOT_WEBHOOK_MAX_BYTES,
  callChatbotWebhook,
} from '@/src/lib/whatsapp/chatbot/webhook-call'
import {
  type ChatbotFlow,
  ChatbotFlowSchema,
  CreateWhatsAppChatbotSchema,
  SimulateWhatsAppChatbotSchema,
  UpdateWhatsAppChatbotSchema,
} from '@/src/schemas/whatsapp-chatbot.schema'

const pos = { x: 0, y: 0 }
const edge = (source: string, sourceHandle: string, target: string) => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
})
const parse = (flow: unknown): ChatbotFlow => ChatbotFlowSchema.parse(flow)
const messages = (flow: ChatbotFlow) =>
  validateChatbotFlow(flow).map((issue) => issue.message)

describe('templates', () => {
  it.each(['blank', 'menu', 'lead-capture'] as const)(
    'the %s template is a valid flow',
    (template) => {
      const flow = flowFromTemplate(template)
      expect(ChatbotFlowSchema.safeParse(flow).success).toBe(true)
      expect(hasFlowErrors(validateChatbotFlow(flow))).toBe(false)
    },
  )

  it('builds distinct flows', () => {
    expect(menuFlow().nodes.some((node) => node.type === 'menu')).toBe(true)
    expect(
      leadCaptureFlow().nodes.some((node) => node.type === 'question'),
    ).toBe(true)
  })
})

describe('validateChatbotFlow', () => {
  it('requires exactly one start and a connected start', () => {
    expect(messages(parse({ nodes: [], edges: [] }))).toContain(
      'O fluxo precisa ter exatamente um bloco de início',
    )
    const unconnected = parse({
      nodes: [{ id: 'start', type: 'start', position: pos, data: {} }],
      edges: [],
    })
    expect(messages(unconnected)).toContain('Ligue o início ao primeiro bloco')
  })

  it('flags dangling edges, unknown handles and shared exits', () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        { id: 'a', type: 'message', position: pos, data: { text: 'a' } },
        { id: 'b', type: 'message', position: pos, data: { text: 'b' } },
      ],
      edges: [
        edge('start', 'next', 'a'),
        edge('start', 'next', 'b'),
        edge('a', 'bogus', 'b'),
        edge('a', 'next', 'ghost'),
      ],
    })
    const found = messages(flow)
    expect(found).toContain('Início: uma saída só pode ter uma ligação')
    expect(found).toContain('Mensagem: saída "bogus" não existe')
    expect(found).toContain('Há uma ligação para um bloco que não existe')
    expect(hasFlowErrors(validateChatbotFlow(flow))).toBe(true)
  })

  it('flags duplicate node ids', () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        { id: 'a', type: 'message', position: pos, data: { text: 'a' } },
        { id: 'a', type: 'message', position: pos, data: { text: 'b' } },
      ],
      edges: [edge('start', 'next', 'a')],
    })
    expect(messages(flow)).toContain('Bloco repetido: a')
  })

  it('checks menus and conditions', () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'menu',
          type: 'menu',
          position: pos,
          data: {
            text: 'Escolha',
            options: [
              { id: 'a', label: 'Sim' },
              { id: 'a', label: ' sim ' },
            ],
          },
        },
        {
          id: 'cond',
          type: 'condition',
          position: pos,
          data: {
            branches: [
              { id: 'x', variable: 'v', operator: 'equals', value: '1' },
              { id: 'x', variable: 'v', operator: 'equals', value: '2' },
            ],
          },
        },
      ],
      edges: [edge('start', 'next', 'menu')],
    })
    const found = messages(flow)
    expect(found).toContain('Menu: opções repetidas')
    expect(found).toContain('Menu: dois textos de opção iguais')
    expect(found).toContain('Condição: ramos repetidos')
    expect(found).toContain('Menu: há uma saída sem destino')
    expect(found).toContain('Condição: há uma saída sem destino')
    expect(found).toContain('Condição sem ligação com o início')
  })

  it('warns about webhooks and handoff targets', () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'hook',
          type: 'webhook',
          position: pos,
          data: {
            url: 'https://example.com/x',
            method: 'POST',
            responseVariable: 'v',
          },
        },
        {
          id: 'human',
          type: 'handoff-human',
          position: pos,
          data: { teamId: 't', userId: 'u' },
        },
      ],
      edges: [edge('start', 'next', 'hook'), edge('hook', 'next', 'human')],
    })
    const found = validateChatbotFlow(flow)
    expect(found.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'Integração: informe a variável e o caminho da resposta juntos',
        'Integração sem caminho de erro: segue pela saída normal',
        'Informe equipe ou atendente, não os dois: vale o atendente',
      ]),
    )
    const lonely = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'hook',
          type: 'webhook',
          position: pos,
          data: { url: 'https://example.com/x', method: 'GET' },
        },
      ],
      edges: [edge('start', 'next', 'hook')],
    })
    expect(messages(lonely)).toContain(
      'Integração sem saída: o fluxo termina depois dela',
    )
  })

  it('refuses a cycle that never waits but allows one through a menu', () => {
    const loop = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        { id: 'a', type: 'message', position: pos, data: { text: 'a' } },
        { id: 'b', type: 'message', position: pos, data: { text: 'b' } },
        { id: 'end', type: 'end', position: pos, data: {} },
      ],
      edges: [
        edge('start', 'next', 'a'),
        edge('a', 'next', 'b'),
        edge('b', 'next', 'a'),
      ],
    })
    expect(messages(loop)).toContain(
      'O fluxo tem um ciclo sem menu ou pergunta: ele nunca esperaria o cliente',
    )

    const withMenu = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'menu',
          type: 'menu',
          position: pos,
          data: {
            text: 'x',
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        },
        { id: 'msg', type: 'message', position: pos, data: { text: 'm' } },
        { id: 'end', type: 'end', position: pos, data: {} },
      ],
      edges: [
        edge('start', 'next', 'menu'),
        edge('menu', 'a', 'msg'),
        edge('menu', 'b', 'end'),
        edge('msg', 'next', 'menu'),
      ],
    })
    expect(hasFlowErrors(validateChatbotFlow(withMenu))).toBe(false)
  })

  it('treats the send form block as a single-exit block', () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'form',
          type: 'send-form',
          position: pos,
          data: { flowId: 'f1' },
        },
        { id: 'end', type: 'end', position: pos, data: {} },
      ],
      edges: [edge('start', 'next', 'form'), edge('form', 'next', 'end')],
    })
    expect(nodeHandles(flow.nodes[1])).toEqual(['next'])
    expect(hasFlowErrors(validateChatbotFlow(flow))).toBe(false)

    const badHandle = parse({
      nodes: flow.nodes,
      edges: [edge('start', 'next', 'form'), edge('form', 'invalid', 'end')],
    })
    expect(messages(badHandle)).toContain(
      'Enviar formulário: saída "invalid" não existe',
    )

    const unchosen = parse({
      nodes: [
        flow.nodes[0],
        { ...flow.nodes[1], data: { flowId: '' } },
        flow.nodes[2],
      ],
      edges: flow.edges,
    })
    expect(messages(unchosen)).toContain(
      'Enviar formulário: escolha o formulário',
    )
  })

  it('exposes the handles of each node type', () => {
    const flow = parse({
      nodes: [
        {
          id: 'q',
          type: 'question',
          position: pos,
          data: { text: 'q', variable: 'v' },
        },
        { id: 'h', type: 'handoff-ai', position: pos, data: {} },
        {
          id: 'w',
          type: 'webhook',
          position: pos,
          data: { url: 'https://a.com/x' },
        },
      ],
      edges: [],
    })
    expect(nodeHandles(flow.nodes[0])).toEqual(['next', 'invalid'])
    expect(nodeHandles(flow.nodes[1])).toEqual([])
    expect(nodeHandles(flow.nodes[2])).toEqual(['next', 'error'])
  })

  it('refuses reserved variable names when setting variables', () => {
    expect(
      ChatbotFlowSchema.safeParse({
        nodes: [
          {
            id: 'x',
            type: 'set-variable',
            position: pos,
            data: { variable: 'contact_name', value: 'x' },
          },
        ],
        edges: [],
      }).success,
    ).toBe(false)
  })
})

describe('schemas', () => {
  it('applies create defaults', () => {
    const parsed = CreateWhatsAppChatbotSchema.parse({ name: ' Bot ' })
    expect(parsed).toMatchObject({
      name: 'Bot',
      triggerKind: 'NEW_CONVERSATION',
      keywords: [],
      sessionTtlMinutes: 720,
      template: 'blank',
    })
    expect(CreateWhatsAppChatbotSchema.safeParse({ name: '' }).success).toBe(
      false,
    )
  })

  it('parses update and simulate payloads', () => {
    expect(
      UpdateWhatsAppChatbotSchema.safeParse({ keywords: ['oi'] }).success,
    ).toBe(true)
    expect(
      UpdateWhatsAppChatbotSchema.safeParse({ sessionTtlMinutes: 1 }).success,
    ).toBe(false)
    expect(
      SimulateWhatsAppChatbotSchema.safeParse({ input: 'oi' }).success,
    ).toBe(true)
    expect(
      ChatbotFlowSchema.safeParse({
        nodes: [
          {
            id: 'w',
            type: 'webhook',
            position: pos,
            data: { url: 'http://insecure.example.com' },
          },
        ],
        edges: [],
      }).success,
    ).toBe(false)
  })
})

describe('callChatbotWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const request = {
    url: 'https://1.1.1.1/hook',
    method: 'POST' as const,
    body: { a: 1 },
  }

  it('refuses private hosts without calling out', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await callChatbotWebhook({
      ...request,
      url: 'https://127.0.0.1/x',
    })
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts JSON and parses the answer', async () => {
    const fetchMock = vi.fn(
      async (..._args: unknown[]) =>
        new Response('{"ok":true}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await callChatbotWebhook(request)
    expect(result).toEqual({ ok: true, json: { ok: true } })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.body).toBe('{"a":1}')
  })

  it('sends GET without a body and accepts empty or text answers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('plain text', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const get = { ...request, method: 'GET' as const, body: undefined }
    expect(await callChatbotWebhook(get)).toEqual({ ok: true, json: null })
    expect(await callChatbotWebhook(get)).toEqual({
      ok: true,
      json: 'plain text',
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBeUndefined()
  })

  it('posts without a body when none is configured', async () => {
    const fetchMock = vi.fn(
      async (..._args: unknown[]) => new Response('{}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await callChatbotWebhook({ ...request, body: undefined })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBeUndefined()
  })

  it('reports non-2xx, oversized and failing calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
      .mockResolvedValueOnce(
        new Response('x'.repeat(CHATBOT_WEBHOOK_MAX_BYTES + 1), {
          status: 200,
        }),
      )
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce('weird')
    vi.stubGlobal('fetch', fetchMock)
    expect(await callChatbotWebhook(request)).toEqual({
      ok: false,
      reason: 'status_500',
    })
    expect(await callChatbotWebhook(request)).toEqual({
      ok: false,
      reason: 'response_too_large',
    })
    expect(await callChatbotWebhook(request)).toEqual({
      ok: false,
      reason: 'boom',
    })
    expect(await callChatbotWebhook(request)).toEqual({
      ok: false,
      reason: 'request_failed',
    })
  })
})
