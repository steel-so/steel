/**
 * Campos das fontes de dashboard do CRM com linhas achatadas (chaves =
 * campos de `GET .../crm/dashboards/sources/<fonte>`, ver
 * `types/crm-dashboard-source.d.ts`). Os campos `*Pct` e `*Rate` valem
 * 0–100: a **média** dos `*Pct` (0 ou 100 por linha) é a taxa.
 */

export type CrmSourceField = { key: string; label: string }

export type CrmDashboardSourceKey =
  | 'crm-proposals'
  | 'crm-contracts'
  | 'crm-charges'
  | 'crm-activities'
  | 'crm-quotas'
  | 'crm-health'
  | 'crm-campaigns'

export const CRM_SOURCE_FIELDS: Record<
  CrmDashboardSourceKey,
  CrmSourceField[]
> = {
  'crm-proposals': [
    { key: 'name', label: 'Proposta' },
    { key: 'status', label: 'Status' },
    { key: 'responsible', label: 'Responsável' },
    { key: 'company', label: 'Empresa' },
    { key: 'contact', label: 'Contato' },
    { key: 'opportunity', label: 'Oportunidade' },
    { key: 'amount', label: 'Valor' },
    { key: 'isOpen', label: 'Em aberto' },
    { key: 'isViewed', label: 'Visualizada' },
    { key: 'isAccepted', label: 'Aceita' },
    { key: 'isRejected', label: 'Recusada' },
    { key: 'isExpired', label: 'Expirada' },
    { key: 'acceptedPct', label: 'Aceite (%)' },
    { key: 'viewCount', label: 'Visualizações' },
    { key: 'isExpiringSoon', label: 'Vence em até 3 dias' },
    { key: 'daysToExpire', label: 'Dias até vencer' },
    { key: 'daysToSend', label: 'Dias até o envio' },
    { key: 'daysToFirstView', label: 'Dias do envio até a 1ª visualização' },
    { key: 'daysToAccept', label: 'Dias até o aceite' },
    { key: 'ageDays', label: 'Idade' },
    { key: 'validUntil', label: 'Validade' },
    { key: 'createdAt', label: 'Criada em' },
    { key: 'sentAt', label: 'Enviada em' },
    { key: 'firstViewedAt', label: '1ª visualização em' },
    { key: 'lastViewedAt', label: 'Última visualização em' },
    { key: 'acceptedAt', label: 'Aceita em' },
    { key: 'expiredAt', label: 'Expirada em' },
  ],
  'crm-contracts': [
    { key: 'name', label: 'Contrato' },
    { key: 'status', label: 'Status' },
    { key: 'company', label: 'Empresa' },
    { key: 'owner', label: 'Responsável' },
    { key: 'value', label: 'Valor' },
    { key: 'autoRenews', label: 'Renovação automática' },
    { key: 'isActive', label: 'Ativo' },
    { key: 'isRenewed', label: 'Renovado' },
    { key: 'renewedPct', label: 'Renovação (%)' },
    { key: 'hasRenewalDeal', label: 'Com oportunidade de renovação' },
    { key: 'daysToEnd', label: 'Dias até o fim' },
    { key: 'isExpiringSoon', label: 'Vence em até 30 dias' },
    { key: 'durationDays', label: 'Duração' },
    { key: 'startDate', label: 'Início' },
    { key: 'endDate', label: 'Fim' },
    { key: 'createdAt', label: 'Criado em' },
    { key: 'renewalCreatedAt', label: 'Renovação criada em' },
  ],
  'crm-charges': [
    { key: 'proposal', label: 'Proposta' },
    { key: 'company', label: 'Empresa' },
    { key: 'createdBy', label: 'Criada por' },
    { key: 'method', label: 'Forma (Pix/Boleto)' },
    { key: 'provider', label: 'Provedor' },
    { key: 'status', label: 'Status' },
    { key: 'amount', label: 'Valor' },
    { key: 'paidAmount', label: 'Valor pago' },
    { key: 'isPaid', label: 'Paga' },
    { key: 'isPending', label: 'Pendente' },
    { key: 'isExpired', label: 'Expirada' },
    { key: 'isCanceled', label: 'Cancelada' },
    { key: 'paidPct', label: 'Pagamento (%)' },
    { key: 'daysToPay', label: 'Dias até o pagamento' },
    { key: 'createdAt', label: 'Criada em' },
    { key: 'expiresAt', label: 'Vence em' },
    { key: 'paidAt', label: 'Paga em' },
    { key: 'canceledAt', label: 'Cancelada em' },
  ],
  'crm-activities': [
    { key: 'action', label: 'Ação' },
    { key: 'entity', label: 'Entidade' },
    { key: 'user', label: 'Usuário' },
    { key: 'summary', label: 'Resumo' },
    { key: 'createdAt', label: 'Criada em' },
  ],
  'crm-quotas': [
    { key: 'owner', label: 'Responsável' },
    { key: 'period', label: 'Período' },
    { key: 'periodKey', label: 'Mês / trimestre' },
    { key: 'target', label: 'Meta' },
    { key: 'achieved', label: 'Atingido' },
    { key: 'wonCount', label: 'Negócios ganhos' },
    { key: 'remaining', label: 'Falta para a meta' },
    { key: 'attainmentPct', label: 'Atingimento (%)' },
    { key: 'isMet', label: 'Meta batida' },
    { key: 'isCurrent', label: 'Período atual' },
    { key: 'periodStart', label: 'Início do período' },
  ],
  'crm-health': [
    { key: 'kind', label: 'Tipo (cliente/oportunidade)' },
    { key: 'name', label: 'Nome' },
    { key: 'company', label: 'Empresa' },
    { key: 'owner', label: 'Responsável' },
    { key: 'amount', label: 'Valor' },
    { key: 'stage', label: 'Etapa' },
    { key: 'riskScore', label: 'Risco (0–100)' },
    { key: 'healthScore', label: 'Saúde (0–100)' },
    { key: 'level', label: 'Nível de risco' },
    { key: 'isHighRisk', label: 'Risco alto' },
    { key: 'previousScore', label: 'Risco anterior' },
    { key: 'scoreDelta', label: 'Variação do risco' },
    { key: 'levelChanged', label: 'Mudou de nível' },
    { key: 'nextAction', label: 'Próxima ação' },
    { key: 'computedAt', label: 'Calculado em' },
  ],
  'crm-campaigns': [
    { key: 'name', label: 'Campanha' },
    { key: 'kind', label: 'Tipo' },
    { key: 'status', label: 'Status' },
    { key: 'hasEmail', label: 'Com e-mail' },
    { key: 'hasWhatsapp', label: 'Com WhatsApp' },
    { key: 'recipients', label: 'Destinatários' },
    { key: 'emailSent', label: 'E-mails enviados' },
    { key: 'emailDelivered', label: 'E-mails entregues' },
    { key: 'emailOpened', label: 'E-mails abertos' },
    { key: 'emailClicked', label: 'E-mails com clique' },
    { key: 'emailBounced', label: 'E-mails devolvidos' },
    { key: 'unsubscribed', label: 'Descadastros' },
    { key: 'whatsappSent', label: 'WhatsApp enviados' },
    { key: 'whatsappDelivered', label: 'WhatsApp entregues' },
    { key: 'whatsappRead', label: 'WhatsApp lidos' },
    { key: 'whatsappClicked', label: 'WhatsApp com clique' },
    { key: 'whatsappReplied', label: 'WhatsApp respondidos' },
    { key: 'converted', label: 'Conversões' },
    { key: 'emailOpenRate', label: 'Abertura de e-mail (%)' },
    { key: 'emailClickRate', label: 'Clique de e-mail (%)' },
    { key: 'whatsappReadRate', label: 'Leitura de WhatsApp (%)' },
    { key: 'conversionRate', label: 'Conversão (%)' },
    { key: 'createdAt', label: 'Criada em' },
    { key: 'scheduledAt', label: 'Agendada para' },
    { key: 'startedAt', label: 'Início do envio' },
    { key: 'completedAt', label: 'Concluída em' },
  ],
}

export const CRM_SOURCE_LABELS: Record<CrmDashboardSourceKey, string> = {
  'crm-proposals': 'Propostas (detalhado)',
  'crm-contracts': 'Contratos',
  'crm-charges': 'Cobranças (Pix e boleto)',
  'crm-activities': 'Atividades do CRM',
  'crm-quotas': 'Metas de vendas',
  'crm-health': 'Saúde de clientes e oportunidades',
  'crm-campaigns': 'Campanhas (desempenho)',
}

export const CRM_SOURCE_PATH: Record<CrmDashboardSourceKey, string> = {
  'crm-proposals': 'crm/dashboards/sources/crm-proposals',
  'crm-contracts': 'crm/dashboards/sources/crm-contracts',
  'crm-charges': 'crm/dashboards/sources/crm-charges',
  'crm-activities': 'crm/dashboards/sources/crm-activities',
  'crm-quotas': 'crm/dashboards/sources/crm-quotas',
  'crm-health': 'crm/dashboards/sources/crm-health',
  'crm-campaigns': 'crm/dashboards/sources/crm-campaigns',
}
