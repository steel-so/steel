/**
 * Fields of the channel sources of the Comunicação dashboards (calls,
 * charges, appointments, chatbot, flows, ads, contact base). Keys = fields
 * of the rows of `types/whatsapp-dashboard-channels.d.ts`. Merged into
 * `wa-source-fields.ts`.
 */

export type WaChannelSourceKey =
  | 'whatsapp-calls'
  | 'whatsapp-charges'
  | 'whatsapp-appointments'
  | 'whatsapp-chatbot-sessions'
  | 'whatsapp-flow-responses'
  | 'whatsapp-ad-referrals'
  | 'whatsapp-ad-spends'
  | 'whatsapp-contacts'

export const WA_CHANNEL_SOURCE_FIELDS: Record<
  WaChannelSourceKey,
  { key: string; label: string }[]
> = {
  'whatsapp-calls': [
    { key: 'direction', label: 'Direção' },
    { key: 'origin', label: 'Origem' },
    { key: 'status', label: 'Status' },
    { key: 'isAnswered', label: 'Atendida' },
    { key: 'answeredPct', label: 'Taxa de atendimento (%)' },
    { key: 'durationSeconds', label: 'Duração (s)' },
    { key: 'durationMinutes', label: 'Duração (min)' },
    { key: 'ringSeconds', label: 'Tempo até atender (s)' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'team', label: 'Equipe' },
    { key: 'connection', label: 'Número' },
    { key: 'hasRecording', label: 'Tem gravação' },
    { key: 'isVoiceAgent', label: 'Atendente de voz (IA)' },
    { key: 'sentiment', label: 'Sentimento' },
    { key: 'createdAt', label: 'Iniciada em' },
    { key: 'answeredAt', label: 'Atendida em' },
    { key: 'endedAt', label: 'Encerrada em' },
  ],
  'whatsapp-charges': [
    { key: 'method', label: 'Forma de pagamento' },
    { key: 'status', label: 'Status' },
    { key: 'isPaid', label: 'Paga' },
    { key: 'paidPct', label: 'Taxa de pagamento (%)' },
    { key: 'amount', label: 'Valor (R$)' },
    { key: 'paidAmount', label: 'Valor pago (R$)' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'createdByAi', label: 'Criada pela IA' },
    { key: 'minutesToPay', label: 'Tempo até o pagamento (min)' },
    { key: 'createdAt', label: 'Criada em' },
    { key: 'paidAt', label: 'Paga em' },
    { key: 'expiresAt', label: 'Vencimento' },
  ],
  'whatsapp-appointments': [
    { key: 'service', label: 'Serviço' },
    { key: 'professional', label: 'Profissional' },
    { key: 'status', label: 'Status' },
    { key: 'origin', label: 'Origem' },
    { key: 'durationMinutes', label: 'Duração (min)' },
    { key: 'isUpcoming', label: 'Futuro' },
    { key: 'isCanceled', label: 'Cancelado' },
    { key: 'noShowPct', label: 'Taxa de faltas (%)' },
    { key: 'leadHours', label: 'Antecedência (h)' },
    { key: 'startsAt', label: 'Data do agendamento' },
    { key: 'createdAt', label: 'Criado em' },
    { key: 'canceledAt', label: 'Cancelado em' },
  ],
  'whatsapp-chatbot-sessions': [
    { key: 'chatbot', label: 'Chatbot' },
    { key: 'status', label: 'Status' },
    { key: 'isRunning', label: 'Em andamento' },
    { key: 'isFinished', label: 'Concluiu o fluxo' },
    { key: 'isHandoff', label: 'Transferida' },
    { key: 'finishedPct', label: 'Taxa de conclusão (%)' },
    { key: 'endReason', label: 'Motivo do encerramento' },
    { key: 'durationMinutes', label: 'Duração (min)' },
    { key: 'team', label: 'Equipe' },
    { key: 'connection', label: 'Número' },
    { key: 'startedAt', label: 'Iniciada em' },
    { key: 'endedAt', label: 'Encerrada em' },
  ],
  'whatsapp-flow-responses': [
    { key: 'flow', label: 'Flow' },
    { key: 'category', label: 'Categoria' },
    { key: 'status', label: 'Status' },
    { key: 'isCompleted', label: 'Respondido' },
    { key: 'completedPct', label: 'Taxa de resposta (%)' },
    { key: 'crmRecord', label: 'Registro criado no CRM' },
    { key: 'attendant', label: 'Atendente' },
    { key: 'minutesToRespond', label: 'Tempo até a resposta (min)' },
    { key: 'createdAt', label: 'Enviado em' },
    { key: 'respondedAt', label: 'Respondido em' },
  ],
  'whatsapp-ad-referrals': [
    { key: 'sourceType', label: 'Tipo de origem' },
    { key: 'ad', label: 'Anúncio' },
    { key: 'adId', label: 'ID do anúncio' },
    { key: 'headline', label: 'Título do anúncio' },
    { key: 'mediaType', label: 'Tipo de mídia' },
    { key: 'connection', label: 'Número' },
    { key: 'team', label: 'Equipe' },
    { key: 'generatedLead', label: 'Gerou lead' },
    { key: 'createdAt', label: 'Recebido em' },
  ],
  'whatsapp-ad-spends': [
    { key: 'ad', label: 'Anúncio' },
    { key: 'adId', label: 'ID do anúncio' },
    { key: 'amount', label: 'Investimento (R$)' },
    { key: 'periodDays', label: 'Dias do período' },
    { key: 'dailyAmount', label: 'Investimento por dia (R$)' },
    { key: 'periodStart', label: 'Início do período' },
    { key: 'periodEnd', label: 'Fim do período' },
    { key: 'createdAt', label: 'Lançado em' },
  ],
  'whatsapp-contacts': [
    { key: 'hasWhatsapp', label: 'Tem WhatsApp' },
    { key: 'isOptedOut', label: 'Descadastrado' },
    { key: 'optOutSource', label: 'Origem do descadastro' },
    { key: 'isBlocked', label: 'Bloqueado' },
    { key: 'hasCrmPerson', label: 'Vinculado ao CRM' },
    { key: 'createdAt', label: 'Criado em' },
    { key: 'optedOutAt', label: 'Descadastrado em' },
  ],
}

export const WA_CHANNEL_SOURCE_LABELS: Record<WaChannelSourceKey, string> = {
  'whatsapp-calls': 'Ligações',
  'whatsapp-charges': 'Cobranças (Pix e boleto)',
  'whatsapp-appointments': 'Agendamentos',
  'whatsapp-chatbot-sessions': 'Chatbot (sessões)',
  'whatsapp-flow-responses': 'Flows (respostas)',
  'whatsapp-ad-referrals': 'Anúncios (origem das conversas)',
  'whatsapp-ad-spends': 'Anúncios (investimento)',
  'whatsapp-contacts': 'Contatos (base)',
}

/** API path per source (after `/api/workspaces/<id>/`). */
export const WA_CHANNEL_SOURCE_PATH: Record<WaChannelSourceKey, string> = {
  'whatsapp-calls': 'whatsapp/dashboards/sources/whatsapp-calls',
  'whatsapp-charges': 'whatsapp/dashboards/sources/whatsapp-charges',
  'whatsapp-appointments': 'whatsapp/dashboards/sources/whatsapp-appointments',
  'whatsapp-chatbot-sessions':
    'whatsapp/dashboards/sources/whatsapp-chatbot-sessions',
  'whatsapp-flow-responses':
    'whatsapp/dashboards/sources/whatsapp-flow-responses',
  'whatsapp-ad-referrals': 'whatsapp/dashboards/sources/whatsapp-ad-referrals',
  'whatsapp-ad-spends': 'whatsapp/dashboards/sources/whatsapp-ad-spends',
  'whatsapp-contacts': 'whatsapp/dashboards/sources/whatsapp-contacts',
}
