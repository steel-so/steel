/**
 * Fields of the Comunicação (WhatsApp) dashboard sources (keys = fields of
 * the flattened rows of `GET .../whatsapp/dashboards/sources/<source>`, see
 * `types/whatsapp-dashboard.d.ts`).
 */

import {
  WA_CHANNEL_SOURCE_FIELDS,
  WA_CHANNEL_SOURCE_LABELS,
  WA_CHANNEL_SOURCE_PATH,
} from './wa-channel-source-fields'

export type WaSourceField = { key: string; label: string }

export type WaDashboardSourceKey =
  | 'whatsapp-ai-campaign-recipients'
  | 'whatsapp-attendances'
  | 'whatsapp-conversation-events'
  | 'whatsapp-sla-cycles'
  | 'whatsapp-team-members'
  | 'whatsapp-messages'
  | 'whatsapp-broadcast-recipients'
  | 'whatsapp-templates'
  | 'whatsapp-costs'
  | 'whatsapp-ai-campaign-actions'
  | import('./wa-channel-source-fields').WaChannelSourceKey

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
    { key: 'openMinutes', label: 'Tempo da conversa aberta (min)' },
    { key: 'waitingMinutes', label: 'Contato aguardando resposta (min)' },
    { key: 'avgResponseMinutes', label: 'Tempo médio de resposta (min)' },
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
  'whatsapp-messages': [
    { key: 'direction', label: 'Direção' },
    { key: 'type', label: 'Tipo' },
    { key: 'status', label: 'Status' },
    { key: 'author', label: 'Autor' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'isFailed', label: 'Falhou' },
    { key: 'failureReason', label: 'Motivo da falha' },
    { key: 'deliveredPct', label: 'Taxa de entrega (%)' },
    { key: 'readPct', label: 'Taxa de leitura (%)' },
    { key: 'failedPct', label: 'Taxa de falha (%)' },
    { key: 'sentiment', label: 'Sentimento' },
    { key: 'sentimentScore', label: 'Nota de sentimento' },
    { key: 'connection', label: 'Número' },
    { key: 'provider', label: 'Provedor' },
    { key: 'team', label: 'Equipe' },
    { key: 'aiCampaign', label: 'Campanha de IA' },
    { key: 'createdAt', label: 'Criada em' },
  ],
  'whatsapp-broadcast-recipients': [
    { key: 'broadcast', label: 'Transmissão' },
    { key: 'broadcastStatus', label: 'Status da transmissão' },
    { key: 'status', label: 'Envio' },
    { key: 'isSent', label: 'Enviado' },
    { key: 'isFailed', label: 'Falhou' },
    { key: 'error', label: 'Motivo da falha' },
    { key: 'template', label: 'Modelo' },
    { key: 'connection', label: 'Número' },
    { key: 'viaMarketingLite', label: 'Via Marketing Lite' },
    { key: 'delivery', label: 'Entrega' },
    { key: 'isDelivered', label: 'Entregue' },
    { key: 'scheduledAt', label: 'Agendado para' },
    { key: 'sentAt', label: 'Enviado em' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  'whatsapp-templates': [
    { key: 'name', label: 'Modelo' },
    { key: 'language', label: 'Idioma' },
    { key: 'category', label: 'Categoria' },
    { key: 'status', label: 'Status' },
    { key: 'quality', label: 'Qualidade' },
    { key: 'connection', label: 'Número' },
    { key: 'header', label: 'Cabeçalho' },
    { key: 'hasButtons', label: 'Tem botões' },
    { key: 'buttonCount', label: 'Qtd. de botões' },
    { key: 'createdAt', label: 'Criado em' },
    { key: 'updatedAt', label: 'Atualizado em' },
  ],
  'whatsapp-costs': [
    { key: 'category', label: 'Categoria' },
    { key: 'kind', label: 'Tipo de cobrança' },
    { key: 'origin', label: 'Origem' },
    { key: 'amount', label: 'Custo' },
    { key: 'unitPrice', label: 'Preço unitário' },
    { key: 'quantity', label: 'Quantidade' },
    { key: 'currency', label: 'Moeda' },
    { key: 'connection', label: 'Número' },
    { key: 'provider', label: 'Provedor' },
    { key: 'viaMarketingLite', label: 'Via Marketing Lite' },
    { key: 'isReversed', label: 'Estornado' },
    { key: 'broadcast', label: 'Transmissão' },
    { key: 'aiCampaign', label: 'Campanha de IA' },
    { key: 'occurredAt', label: 'Data' },
  ],
  'whatsapp-ai-campaign-actions': [
    { key: 'campaign', label: 'Campanha' },
    { key: 'actionType', label: 'Tipo de ação' },
    { key: 'action', label: 'Ação' },
    { key: 'status', label: 'Status' },
    { key: 'isSuccess', label: 'Sucesso' },
    { key: 'error', label: 'Erro' },
    { key: 'createdAt', label: 'Executada em' },
  ],
  ...WA_CHANNEL_SOURCE_FIELDS,
}

export const WA_SOURCE_LABELS: Record<WaDashboardSourceKey, string> = {
  'whatsapp-ai-campaign-recipients': 'Campanhas de IA (destinatários)',
  'whatsapp-attendances': 'Atendimentos (conversas)',
  'whatsapp-conversation-events': 'Eventos de atendimento',
  'whatsapp-sla-cycles': 'SLA do atendimento',
  'whatsapp-team-members': 'Equipes e atendentes',
  'whatsapp-messages': 'Mensagens',
  'whatsapp-broadcast-recipients': 'Transmissões (destinatários)',
  'whatsapp-templates': 'Modelos de mensagem',
  'whatsapp-costs': 'Custos de mensagens',
  'whatsapp-ai-campaign-actions': 'Campanhas de IA (ações da IA)',
  ...WA_CHANNEL_SOURCE_LABELS,
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
  'whatsapp-messages': 'whatsapp/dashboards/sources/whatsapp-messages',
  'whatsapp-broadcast-recipients':
    'whatsapp/dashboards/sources/whatsapp-broadcast-recipients',
  'whatsapp-templates': 'whatsapp/dashboards/sources/whatsapp-templates',
  'whatsapp-costs': 'whatsapp/dashboards/sources/whatsapp-costs',
  'whatsapp-ai-campaign-actions':
    'whatsapp/dashboards/sources/whatsapp-ai-campaign-actions',
  ...WA_CHANNEL_SOURCE_PATH,
}
