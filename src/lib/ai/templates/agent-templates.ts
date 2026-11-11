import type { AiTemplateToolSpec, SteelAgentTemplate } from './types'

/**
 * Steel Agents templates aimed at workspace OWNER/ADMIN. Reads run on
 * their own (AUTO); every write — and anything that reaches a customer —
 * starts as APPROVAL, so the first runs only propose changes. Results are
 * the run summary on the agent's history screen.
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

export const STEEL_AGENT_TEMPLATES: readonly SteelAgentTemplate[] = [
  {
    id: 'sd-chamados-sem-responsavel',
    name: 'Chamados sem responsável',
    description:
      'De hora em hora, encontra chamados abertos sem responsável e propõe a quem atribuir.',
    category: 'SERVICE_DESK',
    modules: ['SERVICE_DESK'],
    instructions: lines(
      'Você cuida da fila do ServiceDesk para o administrador.',
      '1. Busque os chamados abertos sem responsável (use o resumo de SLA e a busca de chamados).',
      '2. Para cada um, veja o departamento, a prioridade e o prazo de SLA.',
      '3. Proponha a atribuição a um técnico do mesmo departamento, preferindo quem tem a fila mais curta. Nunca atribua a quem não é do departamento do chamado.',
      '4. Se não houver técnico adequado, não atribua: apenas liste o chamado no resumo.',
      'No resumo final, mostre quantos chamados estavam sem responsável, as atribuições propostas (código, título, técnico sugerido e o motivo) e o que ficou pendente.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 8-18 * * 1-5',
    scheduleLabel: 'Dias úteis, de hora em hora (8h às 18h)',
    timezone: TZ,
    maxToolRounds: 10,
    tools: [
      read('sd_sla_at_risk'),
      read('sd_search_tickets'),
      read('sd_get_ticket'),
      read('sd_my_queue'),
      read('ws_members'),
      approval('sd_assign_ticket'),
    ],
  },
  {
    id: 'sd-sla-em-risco',
    name: 'SLA em risco',
    description:
      'A cada 30 minutos no horário comercial, aponta chamados com SLA em risco ou estourado.',
    category: 'SERVICE_DESK',
    modules: ['SERVICE_DESK'],
    instructions: lines(
      'Você monitora o SLA do ServiceDesk.',
      '1. Consulte os chamados com SLA em risco e os já estourados.',
      '2. Para os estourados e para os que vencem na próxima hora, abra o chamado e veja a última movimentação.',
      '3. Proponha uma nota interna curta em cada um desses chamados, dizendo quanto falta (ou quanto passou) do prazo e qual é o próximo passo esperado. Não responda ao solicitante.',
      'Se nada estiver em risco, termine sem propor alterações.',
      'No resumo final, liste em tabela: código, prioridade, responsável, fase e prazo, estourados primeiro.',
    ),
    triggerType: 'SCHEDULE',
    cron: '*/30 8-18 * * 1-5',
    scheduleLabel: 'Dias úteis, a cada 30 min (8h às 18h)',
    timezone: TZ,
    maxToolRounds: 8,
    tools: [
      read('sd_sla_at_risk'),
      read('sd_get_ticket'),
      approval('sd_add_internal_note'),
    ],
  },
  {
    id: 'sd-fila-parada-por-tecnico',
    name: 'Fila parada por técnico',
    description:
      'Todo dia útil de manhã, mostra por técnico os chamados sem movimentação há dias.',
    category: 'SERVICE_DESK',
    modules: ['SERVICE_DESK'],
    instructions: lines(
      'Monte um relatório da fila do ServiceDesk por técnico, só com leituras.',
      '1. Busque os chamados abertos com responsável e veja quando cada um foi atualizado pela última vez.',
      '2. Agrupe por técnico: total na fila, quantos estão sem movimentação há mais de 3 dias úteis e o mais antigo deles.',
      '3. Use os indicadores do ServiceDesk para comparar criados × resolvidos nos últimos 7 dias.',
      'No resumo final, ordene os técnicos do mais parado ao menos parado e termine com no máximo 3 recomendações ao administrador (redistribuir, cobrar, fechar). Não altere nenhum chamado.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 9 * * 1-5',
    scheduleLabel: 'Dias úteis às 9h',
    timezone: TZ,
    maxToolRounds: 8,
    tools: [
      read('sd_search_tickets'),
      read('sd_ticket_counts'),
      read('ws_members'),
    ],
  },
  {
    id: 'crm-funil-parado',
    name: 'Oportunidades paradas no funil',
    description:
      'Toda segunda, lista leads e oportunidades sem avanço há mais de 14 dias e propõe tarefas de retomada.',
    category: 'CRM',
    modules: ['CRM'],
    instructions: lines(
      'Você revisa o funil de vendas do CRM para o administrador.',
      '1. Para cada funil, liste as oportunidades abertas e os leads em aberto.',
      '2. Use o histórico do registro para achar os que estão há mais de 14 dias sem atividade ou sem mudar de etapa.',
      '3. Para os 10 de maior valor, proponha uma tarefa de retomada para o responsável, com prazo de 2 dias úteis e um título objetivo.',
      'Nunca mova etapa, feche ou exclua registros.',
      'No resumo final, mostre por responsável: quantidade parada, valor total parado e as tarefas propostas.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 8 * * 1',
    scheduleLabel: 'Segundas às 8h',
    timezone: TZ,
    maxToolRounds: 12,
    tools: [
      read('crm_list_pipelines'),
      read('crm_list_opportunities'),
      read('crm_list_leads'),
      read('crm_get_record_timeline'),
      approval('crm_create_task'),
    ],
  },
  {
    id: 'crm-propostas-vencendo',
    name: 'Propostas vencendo',
    description:
      'Todo dia útil, encontra propostas enviadas que vencem nos próximos 7 dias e propõe follow-up.',
    category: 'CRM',
    modules: ['CRM'],
    instructions: lines(
      'Acompanhe as propostas comerciais do CRM (CRM > Documentos).',
      '1. Liste as propostas enviadas ou visualizadas (SENT, VIEWED) com validade nos próximos 7 dias.',
      '2. Para cada uma, veja a oportunidade ou o lead vinculado e quem é o responsável.',
      '3. Proponha uma tarefa de follow-up para o responsável, com prazo antes do vencimento.',
      'Não entre em contato com o cliente e não altere a proposta.',
      'No resumo final, liste: proposta, cliente, valor (se houver), vencimento, visualizações e a tarefa proposta.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 8 * * 1-5',
    scheduleLabel: 'Dias úteis às 8h',
    timezone: TZ,
    maxToolRounds: 8,
    tools: [
      read('crm_list_proposal_documents'),
      read('crm_get_record'),
      approval('crm_create_task'),
    ],
  },
  {
    id: 'zap-conversas-sem-resposta',
    name: 'Conversas sem resposta',
    description:
      'De hora em hora, encontra conversas do WhatsApp esperando resposta e propõe um atendente.',
    category: 'COMMUNICATION',
    modules: ['COMMUNICATION'],
    instructions: lines(
      'Você cuida da fila de atendimento do WhatsApp.',
      '1. Liste as conversas abertas sem responsável e as não lidas há mais de 30 minutos.',
      '2. Veja os indicadores do atendimento para saber quantas conversas cada atendente tem abertas.',
      '3. Para cada conversa sem responsável, proponha a atribuição ao atendente com menos conversas abertas.',
      'Nunca envie mensagem ao cliente e nunca encerre conversas.',
      'No resumo final, mostre o total esperando, as atribuições propostas e as conversas com sentimento negativo, que merecem atenção primeiro.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 8-18 * * 1-5',
    scheduleLabel: 'Dias úteis, de hora em hora (8h às 18h)',
    timezone: TZ,
    maxToolRounds: 10,
    tools: [
      read('zap_conversations_list'),
      read('zap_dashboard'),
      read('ws_members'),
      approval('zap_conversation_assign'),
    ],
  },
  {
    id: 'zap-conexoes-desconectadas',
    name: 'Conexões do WhatsApp desconectadas',
    description:
      'De hora em hora, verifica se algum número do WhatsApp caiu e explica o último erro.',
    category: 'COMMUNICATION',
    modules: ['COMMUNICATION'],
    instructions: lines(
      'Verifique o status de todas as conexões (números) de WhatsApp do workspace.',
      'Se todas estiverem conectadas, termine com o resumo "Todas as conexões estão conectadas".',
      'Se alguma estiver desconectada ou com erro, o resumo deve começar com "ATENÇÃO", listar número, provedor, status e o último erro, e explicar em uma frase o que o administrador precisa fazer (por exemplo, ler o QR Code de novo ou renovar o token da API oficial).',
      'Não altere nada.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 * * * *',
    scheduleLabel: 'A cada hora',
    timezone: TZ,
    maxToolRounds: 3,
    tools: [read('zap_connections_status')],
  },
  {
    id: 'ia-consumo-acima-do-ritmo',
    name: 'Consumo de IA acima do ritmo',
    description:
      'Todo dia, compara o gasto de IA com a cota mensal e avisa quando a projeção passa do limite.',
    category: 'GOVERNANCE',
    modules: [],
    instructions: lines(
      'Acompanhe o consumo de IA do workspace contra a cota mensal.',
      '1. Consulte o consumo do mês: gasto até agora, projeção para o fim do mês, cota e a parcela semanal.',
      '2. Se a projeção do mês passar de 90% da cota, ou a semana já tiver passado da parcela semanal, o resumo deve começar com "ATENÇÃO" e mostrar quais modelos, recursos e pessoas mais gastaram.',
      '3. Caso contrário, resuma em uma linha: gasto, projeção e % da cota.',
      'Valores em US$. Não altere nada.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 9 * * *',
    scheduleLabel: 'Todo dia às 9h',
    timezone: TZ,
    maxToolRounds: 3,
    tools: [read('ws_ai_usage')],
  },
  {
    id: 'governanca-auditoria-acessos',
    name: 'Auditoria semanal de acessos',
    description:
      'Toda segunda, revisa membros, papéis e convites pendentes e aponta o que merece atenção.',
    category: 'GOVERNANCE',
    modules: [],
    instructions: lines(
      'Faça a auditoria semanal de acessos do workspace, só com leituras.',
      '1. Liste os membros com o papel de cada um e conte quantos são proprietários e administradores.',
      '2. Liste os convites pendentes e destaque os que vencem em menos de 2 dias ou que foram enviados há mais de 7 dias.',
      '3. Confira os módulos habilitados.',
      'Aponte riscos: muitos administradores (mais de 20% dos membros), convites esquecidos, convites para domínios de e-mail diferentes do da maioria dos membros.',
      'No resumo final, use seções curtas (Membros, Convites, Pontos de atenção) e termine com as ações recomendadas. Não altere nada.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 9 * * 1',
    scheduleLabel: 'Segundas às 9h',
    timezone: TZ,
    maxToolRounds: 5,
    tools: [read('ws_overview'), read('ws_members'), read('ws_invitations')],
  },
  {
    id: 'gestao-resumo-executivo',
    name: 'Resumo executivo semanal',
    description:
      'Toda segunda cedo, um resumo da semana anterior em todos os módulos, pensado para o proprietário.',
    category: 'MANAGEMENT',
    modules: [],
    instructions: lines(
      'Escreva o resumo executivo da semana anterior (segunda a domingo) para o proprietário do workspace, usando só os módulos disponíveis:',
      '- ServiceDesk: chamados abertos × resolvidos e SLA estourado;',
      '- CRM: oportunidades ganhas, perdidas e criadas, com valores, e a previsão do mês;',
      '- Comunicação: volume de conversas, conversas sem responsável e com sentimento negativo;',
      '- IA: gasto da semana e a projeção do mês contra a cota.',
      'Comece com 3 números-chave, depois uma seção curta por módulo, e termine com 3 destaques e 1 ponto de atenção. Seja objetivo: no máximo 25 linhas. Não altere nada.',
    ),
    triggerType: 'SCHEDULE',
    cron: '0 7 * * 1',
    scheduleLabel: 'Segundas às 7h',
    timezone: TZ,
    maxToolRounds: 10,
    tools: [
      read('ws_overview'),
      read('sd_ticket_counts'),
      read('sd_sla_at_risk'),
      read('crm_list_opportunities'),
      read('crm_get_forecast'),
      read('zap_dashboard'),
      read('ws_ai_usage'),
    ],
  },
]

export function findSteelAgentTemplate(
  id: string,
): SteelAgentTemplate | undefined {
  return STEEL_AGENT_TEMPLATES.find((template) => template.id === id)
}
