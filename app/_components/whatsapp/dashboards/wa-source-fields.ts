/**
 * Fields of the Comunicação (WhatsApp) dashboard sources (keys = fields of
 * the flattened rows of `GET .../whatsapp/dashboards/sources/<source>`, see
 * `types/whatsapp-dashboard.d.ts`).
 */

export type WaSourceField = { key: string; label: string }

export type WaDashboardSourceKey =
  | 'whatsapp-ai-campaign-recipients'
  | 'whatsapp-messages'
  | 'whatsapp-broadcast-recipients'
  | 'whatsapp-templates'
  | 'whatsapp-costs'
  | 'whatsapp-ai-campaign-actions'

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
}

export const WA_SOURCE_LABELS: Record<WaDashboardSourceKey, string> = {
  'whatsapp-ai-campaign-recipients': 'Campanhas de IA (destinatários)',
  'whatsapp-messages': 'Mensagens',
  'whatsapp-broadcast-recipients': 'Transmissões (destinatários)',
  'whatsapp-templates': 'Modelos de mensagem',
  'whatsapp-costs': 'Custos de mensagens',
  'whatsapp-ai-campaign-actions': 'Campanhas de IA (ações da IA)',
}

/** API path per source (after `/api/workspaces/<id>/`). */
export const WA_SOURCE_PATH: Record<WaDashboardSourceKey, string> = {
  'whatsapp-ai-campaign-recipients':
    'whatsapp/dashboards/sources/whatsapp-ai-campaign-recipients',
  'whatsapp-messages': 'whatsapp/dashboards/sources/whatsapp-messages',
  'whatsapp-broadcast-recipients':
    'whatsapp/dashboards/sources/whatsapp-broadcast-recipients',
  'whatsapp-templates': 'whatsapp/dashboards/sources/whatsapp-templates',
  'whatsapp-costs': 'whatsapp/dashboards/sources/whatsapp-costs',
  'whatsapp-ai-campaign-actions':
    'whatsapp/dashboards/sources/whatsapp-ai-campaign-actions',
}
