import { describe, expect, it, vi } from 'vitest'
import {
  CHATBOT_MAX_STEPS,
  type ChatbotContext,
  initialChatbotState,
  matchMenuOption,
  menuButtonPayload,
  parseChatbotState,
  resumeFlow,
  startFlow,
} from '@/src/lib/whatsapp/chatbot/engine'
import {
  type ChatbotFlow,
  ChatbotFlowSchema,
} from '@/src/schemas/whatsapp-chatbot.schema'

const pos = { x: 0, y: 0 }
const edge = (source: string, sourceHandle: string, target: string) => ({
  id: `${source}-${sourceHandle}`,
  source,
  sourceHandle,
  target,
})

function ctx(overrides: Partial<ChatbotContext> = {}): ChatbotContext {
  return {
    contact: { name: 'Ana', phone: '5511999990000' },
    callWebhook: vi.fn(async () => ({ ok: true as const, json: {} })),
    ...overrides,
  }
}

const parse = (flow: unknown): ChatbotFlow => ChatbotFlowSchema.parse(flow)

const menuFlow = parse({
  nodes: [
    { id: 'start', type: 'start', position: pos, data: {} },
    {
      id: 'menu',
      type: 'menu',
      position: pos,
      data: {
        text: 'Oi {{contact_name}}',
        variable: 'area',
        options: [
          { id: 'a', label: 'Comercial' },
          { id: 'b', label: 'Suporte' },
        ],
        maxAttempts: 2,
      },
    },
    {
      id: 'sales',
      type: 'handoff-human',
      position: pos,
      data: { text: 'Vou chamar, {{area}}', teamId: 't1' },
    },
    {
      id: 'support',
      type: 'handoff-ai',
      position: pos,
      data: { instruction: 'Ajude com suporte' },
    },
  ],
  edges: [
    edge('start', 'next', 'menu'),
    edge('menu', 'a', 'sales'),
    edge('menu', 'b', 'support'),
  ],
})

describe('chatbot engine', () => {
  it('starts, renders the menu with buttons and waits', async () => {
    const run = await startFlow(menuFlow, ctx())
    expect(run.status).toBe('WAITING')
    expect(run.state.awaiting).toEqual({
      kind: 'menu',
      nodeId: 'menu',
      attempts: 0,
    })
    const menu = run.outputs[0]
    expect(menu.kind).toBe('menu')
    if (menu.kind !== 'menu') throw new Error('expected a menu')
    expect(menu.text).toBe('Oi Ana')
    expect(menu.buttons).toEqual([
      { id: 'bot:menu:a', label: 'Comercial' },
      { id: 'bot:menu:b', label: 'Suporte' },
    ])
    expect(menu.numbered).toContain('1. Comercial')
  })

  it('falls back to numbered text when the menu does not fit buttons', async () => {
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
              { id: 'a', label: 'Uma opção com rótulo muito comprido' },
              { id: 'b', label: 'B' },
            ],
          },
        },
      ],
      edges: [edge('start', 'next', 'menu')],
    })
    const run = await startFlow(flow, ctx())
    const menu = run.outputs[0]
    if (menu.kind !== 'menu') throw new Error('expected a menu')
    expect(menu.buttons).toBeNull()
  })

  it('routes a button click to the option and hands off to a person', async () => {
    const started = await startFlow(menuFlow, ctx())
    const run = await resumeFlow(
      menuFlow,
      started.state,
      { text: '', buttonPayload: menuButtonPayload('menu', 'a') },
      ctx(),
    )
    expect(run.status).toBe('HANDED_OFF_HUMAN')
    expect(run.handoff).toEqual({ teamId: 't1', userId: undefined })
    expect(run.outputs).toEqual([
      { kind: 'text', text: 'Vou chamar, Comercial' },
    ])
    expect(run.state.variables.area).toBe('Comercial')
  })

  it('accepts a typed number or label and hands off to the AI', async () => {
    const started = await startFlow(menuFlow, ctx())
    const byNumber = await resumeFlow(
      menuFlow,
      started.state,
      { text: '2' },
      ctx(),
    )
    expect(byNumber.status).toBe('HANDED_OFF_AI')
    expect(byNumber.handoff?.instruction).toBe('Ajude com suporte')
    const byLabel = await resumeFlow(
      menuFlow,
      started.state,
      { text: ' COMERCIAL! ' },
      ctx(),
    )
    expect(byLabel.status).toBe('HANDED_OFF_HUMAN')
  })

  it('ignores a button of another menu and retries, then hands off', async () => {
    const started = await startFlow(menuFlow, ctx())
    const first = await resumeFlow(
      menuFlow,
      started.state,
      { text: '', buttonPayload: 'bot:other:a' },
      ctx(),
    )
    expect(first.status).toBe('WAITING')
    expect(first.state.awaiting).toMatchObject({ attempts: 1 })
    expect(first.outputs[0]).toMatchObject({ kind: 'text' })
    expect(first.outputs[1]).toMatchObject({ kind: 'menu' })

    const second = await resumeFlow(
      menuFlow,
      first.state,
      { text: 'xyz' },
      ctx(),
    )
    expect(second.status).toBe('HANDED_OFF_HUMAN')
    expect(second.handoff?.reason).toBe('invalid_answer')
    expect(second.endReason).toBe('invalid_answer')
  })

  it('takes the "invalid" exit when it is drawn', async () => {
    const flow = parse({
      ...menuFlow,
      nodes: [
        ...menuFlow.nodes,
        {
          id: 'bye',
          type: 'end',
          position: pos,
          data: { text: 'Até logo', closeConversation: true },
        },
      ],
      edges: [...menuFlow.edges, edge('menu', 'invalid', 'bye')],
    })
    const one = parse({
      ...flow,
      nodes: flow.nodes.map((node) =>
        node.type === 'menu'
          ? { ...node, data: { ...node.data, maxAttempts: 1 } }
          : node,
      ),
    })
    const started = await startFlow(one, ctx())
    const run = await resumeFlow(one, started.state, { text: 'nada' }, ctx())
    expect(run.status).toBe('COMPLETED')
    expect(run.closeConversation).toBe(true)
    expect(run.outputs).toEqual([{ kind: 'text', text: 'Até logo' }])
  })

  it('collects validated answers into variables', async () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'q1',
          type: 'question',
          position: pos,
          data: {
            text: 'E-mail?',
            variable: 'email',
            validation: 'EMAIL',
            errorText: 'Inválido',
            maxAttempts: 2,
          },
        },
        {
          id: 'done',
          type: 'end',
          position: pos,
          data: { text: 'Anotei {{email}}' },
        },
      ],
      edges: [edge('start', 'next', 'q1'), edge('q1', 'next', 'done')],
    })
    const started = await startFlow(flow, ctx())
    expect(started.outputs).toEqual([{ kind: 'text', text: 'E-mail?' }])
    const bad = await resumeFlow(flow, started.state, { text: 'nope' }, ctx())
    expect(bad.status).toBe('WAITING')
    expect(bad.outputs).toEqual([{ kind: 'text', text: 'Inválido' }])
    const good = await resumeFlow(
      flow,
      bad.state,
      { text: 'ANA@Exemplo.com' },
      ctx(),
    )
    expect(good.status).toBe('COMPLETED')
    expect(good.outputs).toEqual([
      { kind: 'text', text: 'Anotei ana@exemplo.com' },
    ])
    expect(good.closeConversation).toBe(false)
  })

  it('uses the default retry text and the question "invalid" exit', async () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'q1',
          type: 'question',
          position: pos,
          data: {
            text: 'CPF?',
            variable: 'cpf',
            validation: 'CPF',
            maxAttempts: 2,
          },
        },
        {
          id: 'fail',
          type: 'message',
          position: pos,
          data: { text: 'Sem CPF' },
        },
      ],
      edges: [edge('start', 'next', 'q1'), edge('q1', 'invalid', 'fail')],
    })
    const started = await startFlow(flow, ctx())
    const first = await resumeFlow(flow, started.state, { text: '123' }, ctx())
    expect(first.outputs[0]).toMatchObject({
      text: expect.stringContaining('Pode enviar de novo'),
    })
    const second = await resumeFlow(flow, first.state, { text: '123' }, ctx())
    expect(second.status).toBe('COMPLETED')
    expect(second.outputs).toEqual([{ kind: 'text', text: 'Sem CPF' }])
  })

  it('branches on conditions and sets variables', async () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'set',
          type: 'set-variable',
          position: pos,
          data: { variable: 'plano', value: 'premium {{contact_name}}' },
        },
        {
          id: 'cond',
          type: 'condition',
          position: pos,
          data: {
            branches: [
              {
                id: 'vip',
                variable: 'plano',
                operator: 'contains',
                value: 'premium',
              },
            ],
          },
        },
        { id: 'yes', type: 'message', position: pos, data: { text: 'VIP' } },
        { id: 'no', type: 'message', position: pos, data: { text: 'Comum' } },
      ],
      edges: [
        edge('start', 'next', 'set'),
        edge('set', 'next', 'cond'),
        edge('cond', 'vip', 'yes'),
        edge('cond', 'else', 'no'),
      ],
    })
    const run = await startFlow(flow, ctx())
    expect(run.outputs).toEqual([{ kind: 'text', text: 'VIP' }])
    expect(run.status).toBe('COMPLETED')
    expect(run.endReason).toBe('flow_ended')

    const other = await startFlow(
      flow,
      ctx({ contact: { name: null, phone: '1' } }),
    )
    expect(other.outputs).toEqual([{ kind: 'text', text: 'VIP' }])
  })

  it('goes through the else exit when no branch matches', async () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'cond',
          type: 'condition',
          position: pos,
          data: {
            branches: [
              {
                id: 'b1',
                variable: 'missing',
                operator: 'is_not_empty',
                value: '',
              },
            ],
          },
        },
        { id: 'no', type: 'message', position: pos, data: { text: 'Comum' } },
      ],
      edges: [edge('start', 'next', 'cond'), edge('cond', 'else', 'no')],
    })
    const run = await startFlow(flow, ctx())
    expect(run.outputs).toEqual([{ kind: 'text', text: 'Comum' }])
  })

  describe('webhook node', () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          id: 'hook',
          type: 'webhook',
          position: pos,
          data: {
            url: 'https://example.com/{{contact_phone}}',
            method: 'POST',
            body: '{"name":"{{contact_name}}"}',
            responseVariable: 'protocolo',
            responsePath: 'data.protocol',
          },
        },
        {
          id: 'ok',
          type: 'message',
          position: pos,
          data: { text: 'Protocolo {{protocolo}}' },
        },
        { id: 'bad', type: 'message', position: pos, data: { text: 'Falhou' } },
      ],
      edges: [
        edge('start', 'next', 'hook'),
        edge('hook', 'next', 'ok'),
        edge('hook', 'error', 'bad'),
      ],
    })

    it('stores the answer and follows next', async () => {
      const callWebhook = vi.fn(async () => ({
        ok: true as const,
        json: { data: { protocol: 'A-1' } },
      }))
      const run = await startFlow(flow, ctx({ callWebhook }))
      expect(callWebhook).toHaveBeenCalledWith({
        url: 'https://example.com/5511999990000',
        method: 'POST',
        body: { name: 'Ana' },
      })
      expect(run.outputs).toEqual([{ kind: 'text', text: 'Protocolo A-1' }])
    })

    it('follows the error exit on failure', async () => {
      const callWebhook = vi.fn(async () => ({
        ok: false as const,
        reason: 'status_500',
      }))
      const run = await startFlow(flow, ctx({ callWebhook }))
      expect(run.outputs).toEqual([{ kind: 'text', text: 'Falhou' }])
    })

    it('falls through next when no error exit is drawn', async () => {
      const noError = parse({
        ...flow,
        edges: flow.edges.filter((item) => item.sourceHandle !== 'error'),
      })
      const callWebhook = vi.fn(async () => ({
        ok: false as const,
        reason: 'timeout',
      }))
      const run = await startFlow(noError, ctx({ callWebhook }))
      expect(run.outputs).toEqual([{ kind: 'text', text: 'Protocolo' }])
    })

    it('does not send a body on GET', async () => {
      const get = parse({
        nodes: [
          { id: 'start', type: 'start', position: pos, data: {} },
          {
            id: 'hook',
            type: 'webhook',
            position: pos,
            data: {
              url: 'https://example.com/x',
              method: 'GET',
              body: '{"a":1}',
            },
          },
        ],
        edges: [edge('start', 'next', 'hook')],
      })
      const callWebhook = vi.fn(async () => ({ ok: true as const, json: null }))
      await startFlow(get, ctx({ callWebhook }))
      expect(callWebhook).toHaveBeenCalledWith({
        url: 'https://example.com/x',
        method: 'GET',
        body: undefined,
      })
    })
  })

  it('fails safe on a loop without waiting', async () => {
    const flow = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        { id: 'a', type: 'message', position: pos, data: { text: 'a' } },
      ],
      edges: [edge('start', 'next', 'a'), edge('a', 'next', 'a')],
    })
    const run = await startFlow(flow, ctx())
    expect(run.status).toBe('FAILED')
    expect(run.endReason).toBe('loop_guard')
    expect(run.outputs.length).toBe(CHATBOT_MAX_STEPS - 1)
  })

  it('fails when the start node or a target is missing', async () => {
    const noStart = parse({ nodes: [], edges: [] })
    expect((await startFlow(noStart, ctx())).endReason).toBe('missing_start')

    const dangling = parse({
      nodes: [{ id: 'start', type: 'start', position: pos, data: {} }],
      edges: [edge('start', 'next', 'ghost')],
    })
    expect((await startFlow(dangling, ctx())).endReason).toBe('missing_node')
  })

  it('fails to resume without a valid waiting node', async () => {
    const nothing = await resumeFlow(
      menuFlow,
      initialChatbotState(),
      { text: 'oi' },
      ctx(),
    )
    expect(nothing.status).toBe('FAILED')

    const wrongNode = await resumeFlow(
      menuFlow,
      {
        started: true,
        awaiting: { kind: 'question', nodeId: 'sales', attempts: 0 },
        variables: {},
      },
      { text: 'oi' },
      ctx(),
    )
    expect(wrongNode.endReason).toBe('invalid_state')
  })

  it('completes when a flow ends on an unconnected node', async () => {
    const flow = parse({
      nodes: [{ id: 'start', type: 'start', position: pos, data: {} }],
      edges: [],
    })
    const run = await startFlow(flow, ctx(), { text: 'oi' })
    expect(run.status).toBe('COMPLETED')
    expect(run.state.variables.last_message).toBe('oi')
  })
})

describe('matchMenuOption', () => {
  const menu = menuFlow.nodes.find((node) => node.type === 'menu')
  if (menu?.type !== 'menu') throw new Error('menu missing')

  it('returns null for empty or out-of-range answers', () => {
    expect(matchMenuOption(menu, { text: '' })).toBeNull()
    expect(matchMenuOption(menu, { text: '9' })).toBeNull()
    expect(matchMenuOption(menu, { text: '1' })?.id).toBe('a')
  })
})

describe('parseChatbotState', () => {
  it('reads valid state and drops garbage', () => {
    expect(parseChatbotState(null)).toEqual(initialChatbotState())
    expect(parseChatbotState('x')).toEqual(initialChatbotState())
    expect(
      parseChatbotState({
        started: true,
        awaiting: { kind: 'menu', nodeId: 'm', attempts: 1 },
        variables: { a: 'b', c: 3 },
      }),
    ).toEqual({
      started: true,
      awaiting: { kind: 'menu', nodeId: 'm', attempts: 1 },
      variables: { a: 'b' },
    })
    expect(
      parseChatbotState({
        started: true,
        awaiting: { kind: 'x' },
        variables: 5,
      }),
    ).toEqual({ started: true, awaiting: null, variables: {} })
  })
})
