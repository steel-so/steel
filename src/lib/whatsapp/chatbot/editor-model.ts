import {
  CHATBOT_RESERVED_VARIABLES,
  type ChatbotEdge,
  type ChatbotFlow,
  ChatbotFlowSchema,
  type ChatbotNode,
  type ChatbotNodeType,
} from '@/src/schemas/whatsapp-chatbot.schema'
import { nodeHandles } from './validate'

/**
 * Pure helpers of the visual editor: labels, node factories and the
 * conversion between the persisted `ChatbotFlow` and the React Flow
 * shapes (kept structural so this file has no UI dependency).
 */

export const NODE_TYPE_LABEL: Record<ChatbotNodeType, string> = {
  start: 'Início',
  message: 'Mensagem',
  menu: 'Menu de opções',
  question: 'Pergunta',
  condition: 'Condição',
  'set-variable': 'Definir variável',
  webhook: 'Integração (HTTP)',
  'handoff-human': 'Passar para atendente',
  'handoff-ai': 'Passar para a IA',
  end: 'Encerrar',
}

export const NODE_TYPE_DESCRIPTION: Record<ChatbotNodeType, string> = {
  start: 'Onde o fluxo começa',
  message: 'Envia um texto ao contato',
  menu: 'O contato escolhe uma opção',
  question: 'Pergunta e guarda a resposta',
  condition: 'Segue um caminho conforme uma variável',
  'set-variable': 'Guarda um valor para usar depois',
  webhook: 'Chama um endereço HTTPS e lê a resposta',
  'handoff-human': 'Entrega a conversa a uma equipe ou pessoa',
  'handoff-ai': 'Entrega a conversa à IA do Comunicação',
  end: 'Termina o fluxo, com opção de fechar a conversa',
}

export const PALETTE_GROUPS: Array<{
  title: string
  types: ChatbotNodeType[]
}> = [
  { title: 'Mensagens', types: ['message', 'menu'] },
  {
    title: 'Perguntas e lógica',
    types: ['question', 'condition', 'set-variable'],
  },
  { title: 'Integração', types: ['webhook'] },
  { title: 'Encerrar', types: ['handoff-human', 'handoff-ai', 'end'] },
]

export const TRIGGER_LABEL = {
  NEW_CONVERSATION: 'Nova conversa',
  KEYWORD: 'Palavra-chave',
  OUTSIDE_BUSINESS_HOURS: 'Fora do horário de atendimento',
} as const

export const TRIGGER_DESCRIPTION = {
  NEW_CONVERSATION:
    'Começa quando o contato abre uma conversa (nova ou reaberta).',
  KEYWORD: 'Começa quando a mensagem contém uma das palavras-chave.',
  OUTSIDE_BUSINESS_HOURS:
    'Começa quando a conversa abre fora do horário de atendimento.',
} as const

export const STATUS_LABEL = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
} as const

export const SESSION_STATUS_LABEL = {
  RUNNING: 'Em andamento',
  HANDED_OFF_HUMAN: 'Passou para atendente',
  HANDED_OFF_AI: 'Passou para a IA',
  COMPLETED: 'Concluído',
  EXPIRED: 'Expirou',
  CANCELLED: 'Cancelado',
  FAILED: 'Falhou',
} as const

export const END_REASON_LABEL: Record<string, string> = {
  handoff_human: 'Passou para atendente',
  handoff_ai: 'Passou para a IA',
  end_node: 'Chegou ao fim do fluxo',
  flow_ended: 'Chegou ao fim do fluxo',
  invalid_answer: 'Respostas inválidas repetidas',
  loop_guard: 'Fluxo em ciclo',
  missing_node: 'Bloco ausente no fluxo',
  missing_start: 'Fluxo sem início',
  timeout: 'Contato parou de responder',
  human_took_over: 'Um atendente assumiu',
  conversation_closed: 'Conversa fechada',
  conversation_gone: 'Conversa removida',
  send_failed: 'Falha no envio',
  ai_inactive: 'IA desligada: foi para a fila',
}

export const VALIDATION_LABEL = {
  TEXT: 'Texto livre',
  NUMBER: 'Número',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  DATE: 'Data (dd/mm/aaaa)',
} as const

export const OPERATOR_LABEL = {
  equals: 'é igual a',
  not_equals: 'é diferente de',
  contains: 'contém',
  not_contains: 'não contém',
  greater_than: 'é maior que',
  less_than: 'é menor que',
  is_empty: 'está vazio',
  is_not_empty: 'não está vazio',
} as const

export const OPERATORS_WITHOUT_VALUE = new Set(['is_empty', 'is_not_empty'])

export function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

export function defaultNodeData(type: ChatbotNodeType): ChatbotNode['data'] {
  switch (type) {
    case 'start':
      return {}
    case 'message':
      return { text: 'Olá, {{contact_name}}!' }
    case 'menu':
      return {
        text: 'Como podemos ajudar?',
        options: [
          { id: randomId('o'), label: 'Opção 1' },
          { id: randomId('o'), label: 'Opção 2' },
        ],
        maxAttempts: 2,
      }
    case 'question':
      return {
        text: 'Qual é o seu nome?',
        variable: 'resposta',
        validation: 'TEXT',
        maxAttempts: 2,
      }
    case 'condition':
      return {
        branches: [
          {
            id: randomId('c'),
            variable: 'resposta',
            operator: 'equals',
            value: '',
          },
        ],
      }
    case 'set-variable':
      return { variable: 'variavel', value: '' }
    case 'webhook':
      return { url: 'https://exemplo.com.br/api', method: 'POST' }
    case 'handoff-human':
      return { text: 'Já vou chamar um atendente para ajudar você.' }
    case 'handoff-ai':
      return {}
    case 'end':
      return { text: 'Obrigado pelo contato!', closeConversation: false }
  }
}

export function newFlowNode(
  type: ChatbotNodeType,
  position: { x: number; y: number },
): ChatbotNode {
  return {
    id: randomId('n'),
    type,
    position,
    data: defaultNodeData(type),
  } as ChatbotNode
}

/** Structural twins of the React Flow node / edge. */
export interface XyNode {
  id: string
  type: ChatbotNodeType
  position: { x: number; y: number }
  data: ChatbotNode['data']
}
export interface XyEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

export function edgeId(source: string, handle: string): string {
  return `e-${source}-${handle}`
}

export function flowToXy(flow: ChatbotFlow): {
  nodes: XyNode[]
  edges: XyEdge[]
} {
  return {
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
    })),
    edges: flow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
    })),
  }
}

/**
 * Back to the persisted shape. Edges that point to a missing node or to a
 * handle the node no longer has (a removed menu option) are dropped, and a
 * handle keeps a single edge.
 */
export function xyToFlow(nodes: XyNode[], edges: XyEdge[]): ChatbotFlow {
  const flowNodes = nodes.map(
    (node) =>
      ({
        id: node.id,
        type: node.type,
        position: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
        data: node.data,
      }) as ChatbotNode,
  )
  const byId = new Map(flowNodes.map((node) => [node.id, node]))
  const seen = new Set<string>()
  const flowEdges: ChatbotEdge[] = []
  for (const edge of edges) {
    const source = byId.get(edge.source)
    if (!source || !byId.has(edge.target)) continue
    const handle = edge.sourceHandle ?? 'next'
    if (!nodeHandles(source).includes(handle)) continue
    const key = `${edge.source}:${handle}`
    if (seen.has(key)) continue
    seen.add(key)
    flowEdges.push({
      id: edgeId(edge.source, handle),
      source: edge.source,
      sourceHandle: handle,
      target: edge.target,
    })
  }
  return { nodes: flowNodes, edges: flowEdges }
}

/** Variables the flow defines (questions, menus, set-variable, webhooks). */
export function collectVariables(flow: ChatbotFlow): string[] {
  const names = new Set<string>(CHATBOT_RESERVED_VARIABLES)
  for (const node of flow.nodes) {
    if (node.type === 'question' || node.type === 'set-variable') {
      if (node.data.variable) names.add(node.data.variable)
    }
    if (node.type === 'menu' && node.data.variable)
      names.add(node.data.variable)
    if (node.type === 'webhook' && node.data.responseVariable) {
      names.add(node.data.responseVariable)
    }
  }
  return [...names]
}

export interface SchemaProblem {
  nodeId?: string
  message: string
}

/** First problem the API's Zod schema would reject, with the node to focus. */
export function firstSchemaProblem(flow: ChatbotFlow): SchemaProblem | null {
  const parsed = ChatbotFlowSchema.safeParse(flow)
  if (parsed.success) return null
  const issue = parsed.error.issues[0]
  const [group, index] = issue.path
  const nodeId =
    group === 'nodes' && typeof index === 'number'
      ? flow.nodes[index]?.id
      : undefined
  return {
    nodeId,
    message: 'Há campos obrigatórios vazios ou inválidos neste bloco.',
  }
}
