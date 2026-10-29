import type { AiToolCall, AiToolSpec } from '@/src/lib/ai/types'
import type {
  AiCampaignAction,
  AiCampaignActionKind,
} from '@/src/schemas/whatsapp-ai-campaign.schema'

/**
 * As ações de uma campanha viram ferramentas (tool calling) da IA de
 * resposta. Cada ferramenta só deixa a IA escolher *se* a ação acontece e
 * *por quê* (mais uma nota ou os campos do webhook): o destino — atendente,
 * equipe, status, workflow, URL — foi fixado pelo admin (ADR 0045).
 */

/** Actions the AI may run in one reply — a loop guard. */
export const AI_CAMPAIGN_MAX_ACTIONS_PER_REPLY = 3

const TOOL_PREFIX = 'acao_campanha_'

export const AI_CAMPAIGN_ACTION_KIND_LABEL: Record<
  AiCampaignActionKind,
  string
> = {
  TRANSFER_USER: 'Transferir para um atendente',
  TRANSFER_TEAM: 'Transferir para uma equipe',
  CLOSE: 'Fechar a conversa',
  OPT_OUT: 'Descadastrar o contato',
  ADD_NOTE: 'Anotar no contato',
  FOLLOW_UP: 'Agendar retorno',
  CRM_WORKFLOW: 'Disparar workflow do CRM',
  WEBHOOK: 'Chamar webhook',
  SEND_PIX: 'Enviar cobrança Pix',
}

/** Kinds that end the AI's part of the conversation. */
export const AI_CAMPAIGN_TERMINAL_KINDS = new Set<AiCampaignActionKind>([
  'TRANSFER_USER',
  'TRANSFER_TEAM',
  'CLOSE',
])

function toolName(index: number): string {
  return `${TOOL_PREFIX}${index + 1}`
}

function actionParameters(action: AiCampaignAction): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    motivo: {
      type: 'string',
      description:
        'Em uma frase, por que você está executando esta ação (fica no histórico para a equipe).',
    },
  }
  const required = ['motivo']
  if (action.kind === 'ADD_NOTE') {
    properties.nota = {
      type: 'string',
      description: 'O que anotar no cadastro do contato.',
    }
    required.push('nota')
  }
  if (action.kind === 'WEBHOOK') {
    for (const field of action.fields) {
      properties[field.key] = { type: 'string', description: field.description }
      required.push(field.key)
    }
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

/** One tool per action, named by position (stable within a reply). */
export function buildAiCampaignActionTools(
  actions: AiCampaignAction[],
): AiToolSpec[] {
  return actions.map((action, index) => ({
    name: toolName(index),
    description: `${action.label} (${AI_CAMPAIGN_ACTION_KIND_LABEL[action.kind]}). Use quando: ${action.when}`,
    parameters: actionParameters(action),
  }))
}

export function isAiCampaignActionTool(name: string): boolean {
  return name.startsWith(TOOL_PREFIX)
}

/** An action the AI asked for in this reply, with what it filled in. */
export interface AiCampaignActionRequest {
  action: AiCampaignAction
  reason: string
  note?: string
  fields: Record<string, string>
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** The configured action behind a tool call, or `null` (unknown tool). */
export function parseAiCampaignActionCall(
  actions: AiCampaignAction[],
  call: AiToolCall,
): AiCampaignActionRequest | null {
  if (!isAiCampaignActionTool(call.name)) return null
  const index = Number(call.name.slice(TOOL_PREFIX.length)) - 1
  const action = actions[index]
  if (!action) return null

  const fields: Record<string, string> = {}
  if (action.kind === 'WEBHOOK') {
    for (const field of action.fields) {
      fields[field.key] = text(call.arguments[field.key], 1000)
    }
  }
  return {
    action,
    reason: text(call.arguments.motivo, 500) || 'Sem motivo informado',
    ...(action.kind === 'ADD_NOTE'
      ? { note: text(call.arguments.nota, 1000) }
      : {}),
    fields,
  }
}

/**
 * Keeps the first request per action, at most
 * `AI_CAMPAIGN_MAX_ACTIONS_PER_REPLY`, and only one terminal action
 * (transfer/close) — the AI cannot transfer and close in the same breath.
 */
export function selectAiCampaignActionRequests(
  requests: AiCampaignActionRequest[],
): AiCampaignActionRequest[] {
  const selected: AiCampaignActionRequest[] = []
  const seen = new Set<string>()
  let terminal = false
  for (const request of requests) {
    if (selected.length >= AI_CAMPAIGN_MAX_ACTIONS_PER_REPLY) break
    if (seen.has(request.action.id)) continue
    const isTerminal = AI_CAMPAIGN_TERMINAL_KINDS.has(request.action.kind)
    if (isTerminal && terminal) continue
    seen.add(request.action.id)
    terminal ||= isTerminal
    selected.push(request)
  }
  return selected
}

/** Campaign part of the system prompt (admin-written: trusted). */
export function buildAiCampaignSystemSection(campaign: {
  name: string
  objective: string | null
  instructions: string
  actions: AiCampaignAction[]
}): string {
  const lines = [
    `\n\n## Campanha: ${campaign.name}`,
    'Este contato recebeu uma mensagem desta campanha (ela aparece no histórico como sua). Continue a conversa a partir dela.',
  ]
  if (campaign.objective)
    lines.push(`Objetivo da campanha: ${campaign.objective}`)
  if (campaign.instructions.trim()) {
    lines.push(`Instruções da campanha:\n${campaign.instructions.trim()}`)
  }
  if (campaign.actions.length > 0) {
    lines.push(
      'Você pode executar as ações da campanha pelas ferramentas `acao_campanha_*`, sempre seguindo a regra de cada uma. Ao usar uma ação, responda ao cliente em texto também (ex.: avise que vai transferir ou que encerrou). Nunca prometa uma ação que não existe nas ferramentas.',
    )
  }
  return lines.join('\n')
}
