import { describe, expect, it, vi } from 'vitest'
import {
  collectVariables,
  defaultNodeData,
  NODE_TYPE_LABEL,
} from '@/src/lib/whatsapp/chatbot/editor-model'
import {
  type ChatbotActionRequest,
  type ChatbotContext,
  startFlow,
} from '@/src/lib/whatsapp/chatbot/engine'
import {
  hasFlowErrors,
  nodeHandles,
  validateChatbotFlow,
} from '@/src/lib/whatsapp/chatbot/validate'
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
const parse = (flow: unknown): ChatbotFlow => ChatbotFlowSchema.parse(flow)

function ctx(overrides: Partial<ChatbotContext> = {}): ChatbotContext {
  return {
    contact: { name: 'Ana', phone: '5511999990000' },
    callWebhook: vi.fn(async () => ({ ok: true as const, json: {} })),
    ...overrides,
  }
}

const leadNode = {
  id: 'lead',
  type: 'create-lead',
  position: pos,
  data: {
    name: '{{contact_name}}',
    phone: '{{contact_phone}}',
    email: '{{mail}}',
    company: 'Acme',
    origin: 'WhatsApp (chatbot)',
    resultVariable: 'lead_id',
  },
}
const ticketNode = {
  id: 'ticket',
  type: 'open-ticket',
  position: pos,
  data: {
    ticketType: 'SERVICE_REQUEST',
    title: 'Pedido de {{contact_name}}',
    description: '{{last_message}}',
    resultVariable: 'chamado',
  },
}

function flowWith(node: object, withError = true): ChatbotFlow {
  const id = (node as { id: string }).id
  return parse({
    nodes: [
      { id: 'start', type: 'start', position: pos, data: {} },
      node,
      {
        id: 'ok',
        type: 'message',
        position: pos,
        data: { text: 'Feito: {{lead_id}}{{chamado}}' },
      },
      {
        id: 'bad',
        type: 'message',
        position: pos,
        data: { text: 'Não deu' },
      },
    ],
    edges: [
      edge('start', 'next', id),
      edge(id, 'next', 'ok'),
      ...(withError ? [edge(id, 'error', 'bad')] : []),
    ],
  })
}

describe('create-lead and open-ticket blocks', () => {
  it('interpolates the variables, runs the action and stores the result', async () => {
    const runAction = vi.fn(async (request: ChatbotActionRequest) =>
      request.kind === 'create-lead'
        ? { ok: true as const, value: 'lead-1' }
        : { ok: true as const, value: 'REQ-000005' },
    )
    const lead = await startFlow(flowWith(leadNode), ctx({ runAction }), {
      text: 'oi',
    })
    expect(runAction).toHaveBeenCalledWith({
      kind: 'create-lead',
      name: 'Ana',
      phone: '5511999990000',
      email: '',
      company: 'Acme',
      origin: 'WhatsApp (chatbot)',
    })
    expect(lead.outputs).toEqual([{ kind: 'text', text: 'Feito: lead-1' }])
    expect(lead.state.variables.lead_id).toBe('lead-1')

    const ticket = await startFlow(flowWith(ticketNode), ctx({ runAction }), {
      text: 'preciso de ajuda',
    })
    expect(runAction).toHaveBeenLastCalledWith({
      kind: 'open-ticket',
      ticketType: 'SERVICE_REQUEST',
      title: 'Pedido de Ana',
      description: 'preciso de ajuda',
    })
    expect(ticket.outputs).toEqual([
      { kind: 'text', text: 'Feito: REQ-000005' },
    ])
  })

  it('goes out by the error handle, or the normal one without it', async () => {
    const runAction = vi.fn(async () => ({
      ok: false as const,
      reason: 'MODULE_DISABLED',
    }))
    const withError = await startFlow(flowWith(ticketNode), ctx({ runAction }))
    expect(withError.outputs).toEqual([{ kind: 'text', text: 'Não deu' }])
    const without = await startFlow(
      flowWith(ticketNode, false),
      ctx({ runAction }),
    )
    expect(without.outputs).toEqual([{ kind: 'text', text: 'Feito:' }])
  })

  it('succeeds with a placeholder when the context has no runner (simulator)', async () => {
    const run = await startFlow(flowWith(ticketNode), ctx())
    expect(run.state.variables.chamado).toBe('simulado')
    const noResult = parse({
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          ...leadNode,
          data: { ...leadNode.data, resultVariable: undefined },
        },
      ],
      edges: [edge('start', 'next', 'lead')],
    })
    const done = await startFlow(noResult, ctx())
    expect(done.status).toBe('COMPLETED')
    expect(done.state.variables.lead_id).toBeUndefined()
  })
})

describe('validation and editor model', () => {
  it('exposes next and error handles', () => {
    const [lead] = flowWith(leadNode).nodes.slice(1)
    expect(nodeHandles(lead)).toEqual(['next', 'error'])
  })

  it('warns about a missing error path and accepts a complete block', () => {
    const issues = validateChatbotFlow(flowWith(ticketNode, false))
    expect(issues.map((i) => i.message)).toContain(
      'Abrir chamado sem caminho de erro: segue pela saída normal',
    )
    expect(hasFlowErrors(validateChatbotFlow(flowWith(leadNode)))).toBe(false)
  })

  it('rejects a lead without phone and e-mail and a reserved result variable', () => {
    const noContact = flowWith({
      ...leadNode,
      data: { ...leadNode.data, phone: '', email: undefined },
    })
    expect(validateChatbotFlow(noContact).map((i) => i.message)).toContain(
      'Criar lead: informe o telefone ou o e-mail do contato',
    )
    // The schema blocks reserved names; the validator still guards old drafts.
    const reserved = {
      nodes: [
        { id: 'start', type: 'start', position: pos, data: {} },
        {
          ...ticketNode,
          data: { ...ticketNode.data, resultVariable: 'contact_name' },
        },
      ],
      edges: [edge('start', 'next', 'ticket')],
    } as unknown as ChatbotFlow
    expect(validateChatbotFlow(reserved).map((i) => i.message)).toContain(
      'Abrir chamado: este nome de variável é reservado',
    )
  })

  it('has labels, defaults and variable names for the new blocks', () => {
    expect(NODE_TYPE_LABEL['create-lead']).toBe('Criar lead no CRM')
    expect(NODE_TYPE_LABEL['open-ticket']).toBe('Abrir chamado')
    for (const type of ['create-lead', 'open-ticket'] as const) {
      const node = { id: 'n', type, position: pos, data: defaultNodeData(type) }
      const parsed = ChatbotFlowSchema.safeParse({ nodes: [node], edges: [] })
      expect(parsed.success).toBe(true)
    }
    expect(collectVariables(flowWith(leadNode))).toContain('lead_id')
    expect(collectVariables(flowWith(ticketNode))).toContain('chamado')
  })
})
