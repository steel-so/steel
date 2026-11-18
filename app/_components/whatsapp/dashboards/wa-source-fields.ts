/**
 * Fields of the Comunicação (WhatsApp) dashboard sources (keys = fields of
 * the flattened rows of `GET .../whatsapp/dashboards/sources/<source>`, see
 * `types/whatsapp-dashboard.d.ts`).
 */

export type WaSourceField = { key: string; label: string }

export type WaDashboardSourceKey = 'whatsapp-ai-campaign-recipients'

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
}

export const WA_SOURCE_LABELS: Record<WaDashboardSourceKey, string> = {
  'whatsapp-ai-campaign-recipients': 'Campanhas de IA (destinatários)',
}

/** API path per source (after `/api/workspaces/<id>/`). */
export const WA_SOURCE_PATH: Record<WaDashboardSourceKey, string> = {
  'whatsapp-ai-campaign-recipients':
    'whatsapp/dashboards/sources/whatsapp-ai-campaign-recipients',
}
