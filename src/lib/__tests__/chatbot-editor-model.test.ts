import { describe, expect, it } from 'vitest'
import {
  collectVariables,
  edgeId,
  firstSchemaProblem,
  flowToXy,
  newFlowNode,
  xyToFlow,
} from '@/src/lib/whatsapp/chatbot/editor-model'
import { menuFlow } from '@/src/lib/whatsapp/chatbot/templates'
import {
  CHATBOT_NODE_TYPES,
  ChatbotFlowSchema,
} from '@/src/schemas/whatsapp-chatbot.schema'

describe('chatbot editor model', () => {
  it('round-trips a flow through the editor shapes', () => {
    const flow = menuFlow()
    const xy = flowToXy(flow)
    expect(xyToFlow(xy.nodes, xy.edges)).toEqual({
      nodes: flow.nodes,
      edges: flow.edges.map((e) => ({
        ...e,
        id: edgeId(e.source, e.sourceHandle),
      })),
    })
  })

  it('drops edges to removed nodes, unknown handles and duplicates', () => {
    const flow = menuFlow()
    const xy = flowToXy(flow)
    const menu = xy.nodes.find((n) => n.id === 'menu')
    if (menu?.type === 'menu') {
      const data = menu.data as { options: { id: string }[] }
      menu.data = {
        ...menu.data,
        options: data.options.filter((o) => o.id !== 'sales'),
      } as typeof menu.data
    }
    const edges = [
      ...xy.edges,
      { id: 'dup', source: 'menu', sourceHandle: 'support', target: 'to-ai' },
      { id: 'ghost', source: 'menu', sourceHandle: 'other', target: 'gone' },
    ]
    const result = xyToFlow(xy.nodes, edges)
    const handles = result.edges.map((e) => `${e.source}:${e.sourceHandle}`)
    expect(handles).not.toContain('menu:sales')
    expect(handles.filter((h) => h === 'menu:support')).toHaveLength(1)
    expect(handles.filter((h) => h === 'menu:other')).toHaveLength(1)
    expect(result.edges.some((e) => e.target === 'gone')).toBe(false)
  })

  it('defaults a missing handle to next and rounds positions', () => {
    const xy = flowToXy(menuFlow())
    xy.nodes[0].position = { x: 10.4, y: 20.6 }
    const result = xyToFlow(xy.nodes, [
      { id: 'x', source: 'start', target: 'menu', sourceHandle: null },
    ])
    expect(result.nodes[0].position).toEqual({ x: 10, y: 21 })
    expect(result.edges[0].sourceHandle).toBe('next')
  })

  it('builds valid default data for every node type', () => {
    for (const type of CHATBOT_NODE_TYPES) {
      const node = newFlowNode(type, { x: 0, y: 0 })
      const parsed = ChatbotFlowSchema.safeParse({ nodes: [node], edges: [] })
      expect(parsed.success).toBe(true)
    }
  })

  it('collects reserved and defined variables', () => {
    const names = collectVariables({
      nodes: [
        ...menuFlow().nodes,
        newFlowNode('question', { x: 0, y: 0 }),
        {
          id: 'w',
          type: 'webhook',
          position: { x: 0, y: 0 },
          data: {
            url: 'https://a.b',
            method: 'GET',
            responseVariable: 'protocolo',
            responsePath: 'id',
          },
        },
      ],
      edges: [],
    })
    expect(names).toEqual(
      expect.arrayContaining(['contact_name', 'resposta', 'protocolo']),
    )
  })

  it('points to the node with an invalid field', () => {
    const flow = menuFlow()
    expect(firstSchemaProblem(flow)).toBeNull()
    const msg = flow.nodes.find((n) => n.type === 'menu')
    if (msg?.type === 'menu') msg.data.text = ''
    expect(firstSchemaProblem(flow)?.nodeId).toBe('menu')
  })
})
