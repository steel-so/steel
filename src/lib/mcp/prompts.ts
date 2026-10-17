import type {
  GetPromptResult,
  ListPromptsResult,
} from '@modelcontextprotocol/sdk/types.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ModuleKind } from '@prisma/client'
import type { AiToolAccess } from '@/src/lib/ai/tools/registry'
import type { McpGrant } from './grant'

/**
 * Ready-made prompts of the MCP server (ADR 0032), at most three per module,
 * in pt-BR. Each one tells the client's model which Steel tools to use; the
 * tools themselves still apply the user's permissions.
 */

export interface McpPromptDefinition {
  name: string
  title: string
  description: string
  module: ModuleKind
  text: string
}

export const MCP_PROMPTS: readonly McpPromptDefinition[] = [
  {
    name: 'servicedesk_daily_summary',
    title: 'Resumo do dia do ServiceDesk',
    description:
      'Panorama do ServiceDesk hoje: volume de chamados, SLAs em risco e a minha fila.',
    module: 'SERVICE_DESK',
    text: [
      'Monte um resumo do dia do ServiceDesk deste workspace, em português.',
      'Use `sd_ticket_counts` para o volume por status e prioridade, `sd_sla_at_risk` para os chamados com SLA estourado ou perto de estourar e `sd_my_queue` para a minha fila.',
      'Organize em: 1) números do dia; 2) chamados que pedem ação agora (com número, título e prazo); 3) sugestão de prioridade para as próximas horas.',
      'Seja objetivo e não invente dados que as ferramentas não retornaram.',
    ].join('\n'),
  },
  {
    name: 'crm_weekly_pipeline',
    title: 'Pipeline da semana',
    description:
      'Como está o funil de vendas: oportunidades abertas, etapas e previsão.',
    module: 'CRM',
    text: [
      'Analise o pipeline de vendas desta semana no CRM, em português.',
      'Use `crm_list_pipelines` para conhecer as etapas, `crm_list_opportunities` para as oportunidades abertas e `crm_get_forecast` para a previsão.',
      'Traga: valor total por etapa, as oportunidades que mais pesam no resultado, as paradas há mais tempo e os próximos passos recomendados.',
      'Não invente valores que as ferramentas não retornaram.',
    ].join('\n'),
  },
  {
    name: 'whatsapp_unanswered_conversations',
    title: 'Conversas sem resposta',
    description:
      'Conversas do WhatsApp esperando resposta, com as mais urgentes primeiro.',
    module: 'COMMUNICATION',
    text: [
      'Liste as conversas do WhatsApp que estão esperando resposta, em português.',
      'Use `zap_conversations_list` com `status: "OPEN"` e `unreadOnly: true`; repita com `negativeSentiment: true` para achar clientes insatisfeitos. Para entender uma conversa, use `zap_conversation_get`.',
      'Ordene pelas mais urgentes (sentimento negativo e espera mais longa primeiro) e diga, para cada uma, o contato, há quanto tempo espera e um resumo do pedido.',
      'Só sugira respostas; não envie mensagens.',
    ].join('\n'),
  },
]

function promptsFor(
  grant: McpGrant,
  access: AiToolAccess,
): McpPromptDefinition[] {
  return MCP_PROMPTS.filter(
    (prompt) =>
      grant.modules.includes(prompt.module) &&
      access.modules.includes(prompt.module),
  )
}

export function listMcpPrompts(
  grant: McpGrant,
  access: AiToolAccess,
): ListPromptsResult {
  return {
    prompts: promptsFor(grant, access).map(({ name, title, description }) => ({
      name,
      title,
      description,
    })),
  }
}

export function getMcpPrompt(
  grant: McpGrant,
  access: AiToolAccess,
  name: string,
): GetPromptResult {
  const prompt = promptsFor(grant, access).find((p) => p.name === name)
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidParams, `Prompt desconhecido: ${name}`)
  }
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: prompt.text } }],
  }
}
