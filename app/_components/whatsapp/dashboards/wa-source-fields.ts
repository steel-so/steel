/**
 * Fields of the Comunicação (WhatsApp) dashboard sources (keys = fields of
 * the flattened rows of `GET .../whatsapp/dashboards/sources/<source>`, see
 * `types/whatsapp-dashboard.d.ts`).
 */

export type WaSourceField = { key: string; label: string }

export type WaDashboardSourceKey =
  | 'whatsapp-ai-campaign-recipients'
  | 'whatsapp-attendances'
  | 'whatsapp-conversation-events'
  | 'whatsapp-sla-cycles'
  | 'whatsapp-team-members'

export const WA_SOURCE_FIELDS: Record<WaDashboardSourceKey, WaSourceField[]> = {
  'whatsapp-ai-campaign-recipients': [
    { key: 'campaign', label: 'Campanha' },
    { key: 'campaignStatus', label: 'Status da campanha' },
    { key: 'sendStatus', label: 'Envio' },
    { key: 'isSent', label: 'Enviado' },
    { key: 'delivery', label: 'Entrega' },
    { key: 'isDelivered', label: 'Entregue' },
    { key: 'response', label: 'Resposta' },
    { key: 'replied', label: 'Respondeu' },
    { key: 'transferred', label: 'Transferido p/ atendente' },
    { key: 'stage', label: 'Etapa do atendimento' },
    { key: 'isWaiting', label: 'Aguardando atendimento' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'team', label: 'Equipe' },
    { key: 'outcome', label: 'Resultado' },
    { key: 'closeStatus', label: 'Tabulação' },
    { key: 'sentAt', label: 'Enviado em' },
    { key: 'repliedAt', label: 'Respondido em' },
    { key: 'closedAt', label: 'Encerrado em' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  'whatsapp-attendances': [
    { key: 'status', label: 'Status' },
    { key: 'isOpen', label: 'Em aberto' },
    { key: 'connection', label: 'Número' },
    { key: 'provider', label: 'Provedor' },
    { key: 'team', label: 'Equipe' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'isUnassigned', label: 'Sem atendente' },
    { key: 'aiCampaign', label: 'Campanha de IA' },
    { key: 'aiActive', label: 'IA respondendo' },
    { key: 'aiHandoff', label: 'Transferido pela IA p/ atendente' },
    { key: 'unreadCount', label: 'Mensagens não lidas' },
    { key: 'isWaiting', label: 'Aguardando atendimento' },
    { key: 'firstResponseMinutes', label: 'Tempo até a 1ª resposta (min)' },
    { key: 'durationMinutes', label: 'Duração do atendimento (min)' },
    { key: 'outcome', label: 'Resultado' },
    { key: 'closeStatus', label: 'Tabulação' },
    { key: 'closeReason', label: 'Motivo do encerramento' },
    { key: 'sentimentScore', label: 'Sentimento (média)' },
    { key: 'sentimentLabel', label: 'Sentimento' },
    { key: 'archived', label: 'Arquivada' },
    { key: 'createdAt', label: 'Criado em' },
    { key: 'lastMessageAt', label: 'Última mensagem em' },
    { key: 'lastInboundAt', label: 'Última mensagem do contato em' },
    { key: 'closedAt', label: 'Encerrado em' },
  ],
  'whatsapp-conversation-events': [
    { key: 'kind', label: 'Evento' },
    { key: 'source', label: 'Origem' },
    { key: 'actor', label: 'Quem fez' },
    { key: 'reason', label: 'Detalhe' },
    { key: 'outcome', label: 'Resultado' },
    { key: 'closeStatus', label: 'Tabulação' },
    { key: 'team', label: 'Equipe' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'aiCampaign', label: 'Campanha de IA' },
    { key: 'connection', label: 'Número' },
    { key: 'createdAt', label: 'Ocorrido em' },
  ],
  'whatsapp-sla-cycles': [
    { key: 'policy', label: 'Política de SLA' },
    { key: 'team', label: 'Equipe' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'connection', label: 'Número' },
    { key: 'aiCampaign', label: 'Campanha de IA' },
    { key: 'isOpen', label: 'Em aberto' },
    { key: 'businessHoursOnly', label: 'Só horário de atendimento' },
    { key: 'firstResponseState', label: 'SLA 1ª resposta' },
    { key: 'resolutionState', label: 'SLA resolução' },
    { key: 'firstResponseBreached', label: '1ª resposta estourada' },
    { key: 'resolutionBreached', label: 'Resolução estourada' },
    { key: 'slaBreached', label: 'SLA estourado' },
    { key: 'slaAtRisk', label: 'SLA em risco' },
    {
      key: 'firstResponseMetPct',
      label: 'SLA de 1ª resposta cumprido (%)',
    },
    { key: 'resolutionMetPct', label: 'SLA de resolução cumprido (%)' },
    { key: 'firstResponseTargetMinutes', label: 'Meta de 1ª resposta (min)' },
    { key: 'resolutionTargetMinutes', label: 'Meta de resolução (min)' },
    { key: 'firstResponseMinutes', label: 'Tempo até a 1ª resposta (min)' },
    { key: 'resolutionMinutes', label: 'Tempo até a resolução (min)' },
    { key: 'startedAt', label: 'Iniciado em' },
    { key: 'firstResponseDueAt', label: 'Prazo da 1ª resposta' },
    { key: 'firstResponseAt', label: '1ª resposta em' },
    { key: 'resolutionDueAt', label: 'Prazo da resolução' },
    { key: 'resolvedAt', label: 'Resolvido em' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  'whatsapp-team-members': [
    { key: 'team', label: 'Equipe' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'role', label: 'Papel' },
    { key: 'presence', label: 'Presença' },
    { key: 'isOnline', label: 'Disponível' },
    { key: 'openConversations', label: 'Conversas em aberto' },
    { key: 'lastAssignedAt', label: 'Última conversa recebida em' },
    { key: 'presenceChangedAt', label: 'Presença alterada em' },
    { key: 'createdAt', label: 'Entrou na equipe em' },
  ],
}

export const WA_SOURCE_LABELS: Record<WaDashboardSourceKey, string> = {
  'whatsapp-ai-campaign-recipients': 'Campanhas de IA (destinatários)',
  'whatsapp-attendances': 'Atendimentos (conversas)',
  'whatsapp-conversation-events': 'Eventos de atendimento',
  'whatsapp-sla-cycles': 'SLA do atendimento',
  'whatsapp-team-members': 'Equipes e atendentes',
}

/** API path per source (after `/api/workspaces/<id>/`). */
export const WA_SOURCE_PATH: Record<WaDashboardSourceKey, string> = {
  'whatsapp-ai-campaign-recipients':
    'whatsapp/dashboards/sources/whatsapp-ai-campaign-recipients',
  'whatsapp-attendances': 'whatsapp/dashboards/sources/whatsapp-attendances',
  'whatsapp-conversation-events':
    'whatsapp/dashboards/sources/whatsapp-conversation-events',
  'whatsapp-sla-cycles': 'whatsapp/dashboards/sources/whatsapp-sla-cycles',
  'whatsapp-team-members': 'whatsapp/dashboards/sources/whatsapp-team-members',
}
