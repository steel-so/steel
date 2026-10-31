import type { AiTemplateToolSpec, SteelAgentTemplate } from './types'

/**
 * C3 — ready-made Steel Agents for the sales team (CRM). They use the A1
 * triggers (lead created, proposal viewed) and the same rules as the other
 * templates: reads run alone, every write starts as APPROVAL, and the agent
 * is created paused. Kept apart from `agent-templates.ts` (admin catalog).
 */

const TZ = 'America/Sao_Paulo'

const read = (toolName: string): AiTemplateToolSpec => ({
  toolName,
  mode: 'AUTO',
})
const approval = (toolName: string): AiTemplateToolSpec => ({
  toolName,
  mode: 'APPROVAL',
})
const lines = (...text: string[]) => text.join('\n')

export const CRM_SALES_AGENT_TEMPLATES: readonly SteelAgentTemplate[] = [
  {
    id: 'crm-qualificar-lead',
    name: 'Qualificar lead novo',
    description:
      'Quando um lead entra no CRM, avalia o perfil, registra uma nota de qualificação e propõe responsável e primeira tarefa.',
    category: 'CRM',
    modules: ['CRM'],
    instructions: lines(
      'Você é o assistente de pré-vendas do time comercial.',
      '1. Pelos dados do gatilho, abra o lead recém-criado e leia nome, empresa, cargo, origem e contatos.',
      '2. Procure leads em aberto com o mesmo e-mail, telefone ou empresa. Se houver duplicidade, diga isso na nota e não crie tarefa.',
      '3. Avalie o encaixe em quatro pontos: quem é (cargo e empresa), de onde veio (origem), como contatar (e-mail e telefone) e urgência aparente. Dê uma nota de 1 a 5 para o encaixe, sempre explicando o motivo em uma frase.',
      '4. Proponha uma nota no lead com essa avaliação, em tópicos curtos.',
      '5. Se o lead não tiver responsável, proponha atribuí-lo a quem tem menos leads em aberto.',
      '6. Proponha uma tarefa de primeiro contato para o responsável, com prazo de 1 dia útil.',
      'Nunca envie mensagem ao lead, não mude a etapa e não exclua nada. No resumo final, mostre o lead, a nota de encaixe e o que foi proposto.',
    ),
    triggerType: 'EVENT',
    eventKey: 'crm.lead.created',
    cron: null,
    scheduleLabel: 'Quando um lead é criado',
    timezone: TZ,
    maxToolRounds: 10,
    tools: [
      read('crm_get_record'),
      read('crm_list_leads'),
      read('ws_members'),
      approval('crm_create_note'),
      approval('crm_assign_owner'),
      approval('crm_create_task'),
    ],
  },
  {
    id: 'crm-follow-up-vendas',
    name: 'Follow-up de vendas',
    description:
      'Todo dia útil de manhã, encontra negócios e propostas sem retorno e propõe a tarefa de follow-up de cada responsável.',
    category: 'CRM',
    modules: ['CRM'],
    instructions: lines(
      'Você cuida do follow-up do time comercial.',
      '1. Liste as oportunidades abertas e as propostas enviadas ou visualizadas (SENT, VIEWED).',
      '2. Para cada uma, veja a linha do tempo e ache as que estão há mais de 3 dias úteis sem contato.',
      '3. Para as 10 de maior valor, proponha uma tarefa de follow-up ao responsável, com prazo de hoje ou amanhã e um título objetivo que diga o que perguntar (ex.: "Perguntar se a proposta foi analisada").',
      '4. Quando uma proposta já foi visualizada e o prazo vence em até 7 dias, proponha também uma nota lembrando disso.',
      'Não entre em contato com o cliente e não mude etapa nem valor. No resumo final, agrupe por responsável: negócio, valor, dias sem contato e a tarefa proposta.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 9 * * 1-5',
    scheduleLabel: 'Dias úteis às 9h',
    timezone: TZ,
    maxToolRounds: 12,
    tools: [
      read('crm_list_opportunities'),
      read('crm_list_proposals'),
      read('crm_get_record_timeline'),
      approval('crm_create_task'),
      approval('crm_create_note'),
    ],
  },
  {
    id: 'crm-atualizar-oportunidade',
    name: 'Atualizar oportunidade após proposta vista',
    description:
      'Quando o cliente abre uma proposta, atualiza a oportunidade: propõe a etapa, registra o interesse e cria o retorno.',
    category: 'CRM',
    modules: ['CRM'],
    instructions: lines(
      'Você mantém o funil de vendas em dia.',
      '1. Pelos dados do gatilho, abra a proposta visualizada e a oportunidade ou lead ligado a ela.',
      '2. Veja a linha do tempo: se for a primeira visualização, é um sinal de interesse; se for a segunda ou mais, o cliente está analisando com atenção.',
      '3. Se a oportunidade ainda estiver numa etapa anterior à de proposta, proponha movê-la para a etapa de proposta. Nunca mova para etapa de fechamento e nunca marque como ganha ou perdida.',
      '4. Proponha atualizar a oportunidade com uma observação curta do que aconteceu (proposta visualizada, quantas vezes e quando).',
      '5. Proponha uma tarefa de retorno ao responsável para até 1 dia útil depois.',
      'No resumo final, diga qual proposta foi vista, a etapa atual e o que foi proposto.',
    ),
    triggerType: 'EVENT',
    eventKey: 'crm.proposal.viewed',
    cron: null,
    scheduleLabel: 'Quando uma proposta é visualizada',
    timezone: TZ,
    maxToolRounds: 8,
    tools: [
      read('crm_get_record'),
      read('crm_get_record_timeline'),
      read('crm_list_proposals'),
      read('crm_list_pipelines'),
      approval('crm_move_opportunity_stage'),
      approval('crm_update_opportunity'),
      approval('crm_create_task'),
    ],
  },
]

export function findCrmSalesAgentTemplate(
  id: string,
): SteelAgentTemplate | undefined {
  return CRM_SALES_AGENT_TEMPLATES.find((template) => template.id === id)
}
