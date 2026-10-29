import {
  CHATBOT_RESERVED_VARIABLES,
  type ChatbotFlow,
  type ChatbotNode,
} from '@/src/schemas/whatsapp-chatbot.schema'

/**
 * Structural checks a flow must pass before it can be published. Pure: the
 * service adds the checks that need the database (teams, users).
 */

export interface ChatbotFlowIssue {
  severity: 'error' | 'warning'
  nodeId?: string
  message: string
}

const WAITING_TYPES = new Set(['menu', 'question'])
const TERMINAL_TYPES = new Set(['handoff-human', 'handoff-ai', 'end'])

/** Handles a node can leave through. */
export function nodeHandles(node: ChatbotNode): string[] {
  switch (node.type) {
    case 'start':
    case 'message':
    case 'set-variable':
      return ['next']
    case 'question':
      return ['next', 'invalid']
    case 'webhook':
      return ['next', 'error']
    case 'menu':
      return [...node.data.options.map((option) => option.id), 'invalid']
    case 'condition':
      return [...node.data.branches.map((branch) => branch.id), 'else']
    default:
      return []
  }
}

/** Handles that must be drawn for the flow to make sense. */
function requiredHandles(node: ChatbotNode): string[] {
  switch (node.type) {
    case 'start':
      return ['next']
    case 'menu':
      return node.data.options.map((option) => option.id)
    case 'condition':
      return node.data.branches.map((branch) => branch.id)
    default:
      return []
  }
}

function describe(node: ChatbotNode): string {
  switch (node.type) {
    case 'start':
      return 'Início'
    case 'message':
      return 'Mensagem'
    case 'menu':
      return 'Menu'
    case 'question':
      return 'Pergunta'
    case 'condition':
      return 'Condição'
    case 'set-variable':
      return 'Definir variável'
    case 'webhook':
      return 'Integração'
    case 'handoff-human':
      return 'Passar para atendente'
    case 'handoff-ai':
      return 'Passar para a IA'
    case 'end':
      return 'Encerrar'
  }
}

export function validateChatbotFlow(flow: ChatbotFlow): ChatbotFlowIssue[] {
  const issues: ChatbotFlowIssue[] = []
  const error = (message: string, nodeId?: string) =>
    issues.push({ severity: 'error', message, nodeId })
  const warn = (message: string, nodeId?: string) =>
    issues.push({ severity: 'warning', message, nodeId })

  const ids = new Set<string>()
  for (const node of flow.nodes) {
    if (ids.has(node.id)) error(`Bloco repetido: ${node.id}`, node.id)
    ids.add(node.id)
  }

  const starts = flow.nodes.filter((node) => node.type === 'start')
  if (starts.length !== 1) {
    error('O fluxo precisa ter exatamente um bloco de início')
  }

  const byId = new Map(flow.nodes.map((node) => [node.id, node]))
  const used = new Set<string>()
  for (const edge of flow.edges) {
    const source = byId.get(edge.source)
    if (!source || !byId.has(edge.target)) {
      error('Há uma ligação para um bloco que não existe')
      continue
    }
    if (!nodeHandles(source).includes(edge.sourceHandle)) {
      error(
        `${describe(source)}: saída "${edge.sourceHandle}" não existe`,
        source.id,
      )
      continue
    }
    const key = `${edge.source}:${edge.sourceHandle}`
    if (used.has(key)) {
      error(`${describe(source)}: uma saída só pode ter uma ligação`, source.id)
    }
    used.add(key)
  }

  const reserved = new Set<string>(CHATBOT_RESERVED_VARIABLES)
  for (const node of flow.nodes) {
    for (const handle of requiredHandles(node)) {
      if (!used.has(`${node.id}:${handle}`)) {
        error(
          node.type === 'start'
            ? 'Ligue o início ao primeiro bloco'
            : `${describe(node)}: há uma saída sem destino`,
          node.id,
        )
        break
      }
    }
    if (node.type === 'menu') {
      const labels = new Set<string>()
      const optionIds = new Set<string>()
      for (const option of node.data.options) {
        if (optionIds.has(option.id)) error('Menu: opções repetidas', node.id)
        optionIds.add(option.id)
        const label = option.label.trim().toLowerCase()
        if (labels.has(label))
          error('Menu: dois textos de opção iguais', node.id)
        labels.add(label)
      }
    }
    if (node.type === 'condition') {
      const branchIds = new Set<string>()
      for (const branch of node.data.branches) {
        if (branchIds.has(branch.id))
          error('Condição: ramos repetidos', node.id)
        branchIds.add(branch.id)
      }
    }
    if (node.type === 'set-variable' && reserved.has(node.data.variable)) {
      error('Definir variável: este nome é reservado', node.id)
    }
    if (
      node.type === 'webhook' &&
      Boolean(node.data.responseVariable) !== Boolean(node.data.responsePath)
    ) {
      error(
        'Integração: informe a variável e o caminho da resposta juntos',
        node.id,
      )
    }
    if (
      node.type === 'webhook' &&
      !used.has(`${node.id}:error`) &&
      !used.has(`${node.id}:next`)
    ) {
      warn('Integração sem saída: o fluxo termina depois dela', node.id)
    }
    if (node.type === 'webhook' && !used.has(`${node.id}:error`)) {
      warn('Integração sem caminho de erro: segue pela saída normal', node.id)
    }
    if (node.type === 'handoff-human' && node.data.teamId && node.data.userId) {
      warn(
        'Informe equipe ou atendente, não os dois: vale o atendente',
        node.id,
      )
    }
  }

  // Reachability from the start node.
  const start = starts[0]
  if (start) {
    const next = new Map<string, string[]>()
    for (const edge of flow.edges) {
      next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target])
    }
    const seen = new Set<string>([start.id])
    const queue = [start.id]
    while (queue.length) {
      const current = queue.shift() as string
      for (const target of next.get(current) ?? []) {
        if (!seen.has(target)) {
          seen.add(target)
          queue.push(target)
        }
      }
    }
    for (const node of flow.nodes) {
      if (!seen.has(node.id)) {
        warn(`${describe(node)} sem ligação com o início`, node.id)
      }
    }

    // A cycle with no menu/question never waits for the contact.
    const color = new Map<string, 1 | 2>()
    const visit = (id: string): boolean => {
      const node = byId.get(id)
      if (
        !node ||
        WAITING_TYPES.has(node.type) ||
        TERMINAL_TYPES.has(node.type)
      ) {
        return false
      }
      if (color.get(id) === 1) return true
      if (color.get(id) === 2) return false
      color.set(id, 1)
      for (const target of next.get(id) ?? []) {
        if (visit(target)) return true
      }
      color.set(id, 2)
      return false
    }
    if (visit(start.id)) {
      error(
        'O fluxo tem um ciclo sem menu ou pergunta: ele nunca esperaria o cliente',
      )
    }
  }

  return issues
}

export function hasFlowErrors(issues: ChatbotFlowIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}
