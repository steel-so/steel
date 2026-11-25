/**
 * Campos das fontes de dashboard do ServiceDesk (chaves = campos das linhas
 * achatadas de `GET .../servicedesk/dashboards/sources/<fonte>`, ver
 * `types/sd-dashboard.d.ts`). Os campos `*Pct` valem 0 ou 100 por linha: a
 * **média** deles é a taxa (ex.: % de SLA cumprido, taxa de reabertura).
 */

export type SdSourceField = { key: string; label: string }

export type SdDashboardSourceKey =
  | 'sd-tickets'
  | 'sd-ticket-costs'
  | 'sd-ticket-events'
  | 'sd-kb-articles'

/** Prefixo dos campos customizados de chamado nas linhas (`cf_<chave>`). */
export const SD_CUSTOM_FIELD_PREFIX = 'cf_'

export const SD_SOURCE_FIELDS: Record<SdDashboardSourceKey, SdSourceField[]> = {
  'sd-tickets': [
    { key: 'code', label: 'Código' },
    { key: 'title', label: 'Título' },
    { key: 'type', label: 'Tipo' },
    { key: 'phase', label: 'Fase' },
    { key: 'phaseCategory', label: 'Situação (categoria da fase)' },
    { key: 'completionPercent', label: '% de conclusão' },
    { key: 'priority', label: 'Prioridade' },
    { key: 'priorityLevel', label: 'Peso da prioridade' },
    { key: 'severity', label: 'Severidade' },
    { key: 'impact', label: 'Impacto' },
    { key: 'urgency', label: 'Urgência' },
    { key: 'department', label: 'Departamento' },
    { key: 'assignee', label: 'Responsável' },
    { key: 'requester', label: 'Solicitante' },
    { key: 'customer', label: 'Cliente' },
    { key: 'company', label: 'Empresa' },
    { key: 'contact', label: 'Contato' },
    { key: 'category', label: 'Categoria' },
    { key: 'subcategory', label: 'Subcategoria' },
    { key: 'service', label: 'Serviço' },
    { key: 'classification', label: 'Classificação' },
    { key: 'solutionClassification', label: 'Classificação da solução' },
    { key: 'channel', label: 'Canal' },
    { key: 'tags', label: 'Tags' },
    { key: 'isOpen', label: 'Em aberto' },
    { key: 'isUnassigned', label: 'Sem responsável' },
    { key: 'isCritical', label: 'Crítico (maior prioridade)' },
    { key: 'slaFirstResponseState', label: 'SLA 1ª resposta' },
    { key: 'slaResolutionState', label: 'SLA resolução' },
    { key: 'slaAtRisk', label: 'SLA em risco' },
    { key: 'slaBreached', label: 'SLA violado' },
    { key: 'firstResponseBreached', label: '1ª resposta violada' },
    { key: 'resolutionBreached', label: 'Resolução violada' },
    { key: 'slaResolutionMetPct', label: 'SLA de resolução cumprido (%)' },
    {
      key: 'slaFirstResponseMetPct',
      label: 'SLA de 1ª resposta cumprido (%)',
    },
    { key: 'resolutionRemainingMinutes', label: 'Tempo até o prazo' },
    { key: 'resolutionDueIn', label: 'Prazo (restante)' },
    { key: 'firstResponseMinutes', label: 'Tempo de 1ª resposta' },
    { key: 'resolutionMinutes', label: 'Tempo de resolução' },
    { key: 'resolutionHours', label: 'Tempo de resolução' },
    { key: 'ageHours', label: 'Idade do chamado' },
    { key: 'escalationLevel', label: 'Nível de escalonamento' },
    { key: 'reopenCount', label: 'Reaberturas' },
    { key: 'reopenedPct', label: 'Reaberto (%)' },
    { key: 'csatScore', label: 'CSAT (1–5)' },
    { key: 'createdAt', label: 'Aberto em' },
    { key: 'firstRespondedAt', label: '1ª resposta em' },
    { key: 'resolvedAt', label: 'Resolvido em' },
    { key: 'closedAt', label: 'Fechado em' },
    { key: 'resolutionDueAt', label: 'Prazo de resolução' },
    { key: 'lastActivityAt', label: 'Última atividade' },
  ],
  'sd-ticket-costs': [
    { key: 'ticketCode', label: 'Chamado' },
    { key: 'ticketTitle', label: 'Título do chamado' },
    { key: 'ticketType', label: 'Tipo do chamado' },
    { key: 'category', label: 'Categoria do custo' },
    { key: 'ticketCategory', label: 'Categoria do chamado' },
    { key: 'description', label: 'Descrição' },
    { key: 'quantity', label: 'Quantidade' },
    { key: 'unitCost', label: 'Custo unitário' },
    { key: 'total', label: 'Total' },
    { key: 'billable', label: 'Faturável' },
    { key: 'technician', label: 'Técnico' },
    { key: 'department', label: 'Departamento' },
    { key: 'customer', label: 'Cliente' },
    { key: 'incurredAt', label: 'Data do custo' },
    { key: 'createdAt', label: 'Lançado em' },
  ],
  'sd-ticket-events': [
    { key: 'ticketCode', label: 'Chamado' },
    { key: 'ticketType', label: 'Tipo do chamado' },
    { key: 'priority', label: 'Prioridade' },
    { key: 'department', label: 'Departamento' },
    { key: 'action', label: 'Ação' },
    { key: 'flow', label: 'Fluxo (criados/resolvidos…)' },
    { key: 'throughput', label: 'Criados × resolvidos' },
    { key: 'actor', label: 'Autor' },
    { key: 'actorKind', label: 'Tipo de autor' },
    { key: 'createdAt', label: 'Data' },
  ],
  'sd-kb-articles': [
    { key: 'title', label: 'Título' },
    { key: 'status', label: 'Status' },
    { key: 'visibility', label: 'Visibilidade' },
    { key: 'category', label: 'Categoria' },
    { key: 'tags', label: 'Tags' },
    { key: 'viewCount', label: 'Visualizações' },
    { key: 'helpfulCount', label: 'Votos úteis' },
    { key: 'notHelpfulCount', label: 'Votos não úteis' },
    { key: 'helpfulPct', label: 'Utilidade (%)' },
    { key: 'author', label: 'Autor' },
    { key: 'publishedAt', label: 'Publicado em' },
    { key: 'createdAt', label: 'Criado em' },
  ],
}

export const SD_SOURCE_LABELS: Record<SdDashboardSourceKey, string> = {
  'sd-tickets': 'Chamados',
  'sd-ticket-costs': 'Custos dos chamados',
  'sd-ticket-events': 'Eventos dos chamados (fluxo)',
  'sd-kb-articles': 'Artigos da base de conhecimento',
}

export const SD_SOURCE_PATH: Record<SdDashboardSourceKey, string> = {
  'sd-tickets': 'servicedesk/dashboards/sources/sd-tickets',
  'sd-ticket-costs': 'servicedesk/dashboards/sources/sd-ticket-costs',
  'sd-ticket-events': 'servicedesk/dashboards/sources/sd-ticket-events',
  'sd-kb-articles': 'servicedesk/dashboards/sources/sd-kb-articles',
}
