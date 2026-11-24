/**
 * Rows of the CRM dashboard sources
 * (`GET /api/workspaces/[id]/crm/dashboards/sources/[source]`). Labels are
 * already pt-BR (the widget engine groups and filters by text). `*Pct`
 * fields are 0 or 100 per row (or `null` when they do not apply): their
 * **average** is the rate. Dates are ISO strings; day counts are calendar days.
 */

export interface CrmProposalDashboardRow {
  id: string
  name: string
  /** Rascunho, Enviada, Visualizada, Aceita, Recusada, Expirada. */
  status: string
  responsible: string
  responsibleId: string
  company: string | null
  contact: string | null
  opportunity: string | null
  /** Total of the pricing section, else the deal amount; `null` if none. */
  amount: number | null
  isDraft: boolean
  /** Sent or viewed, not decided yet. */
  isOpen: boolean
  isViewed: boolean
  isAccepted: boolean
  isRejected: boolean
  isExpired: boolean
  /** 100 accepted, 0 rejected/expired, `null` while undecided. */
  acceptedPct: number | null
  viewCount: number
  /** Open and expiring within 3 days. */
  isExpiringSoon: boolean
  /** Days until `validUntil` for open proposals (negative = overdue). */
  daysToExpire: number | null
  daysToSend: number | null
  daysToFirstView: number | null
  daysToAccept: number | null
  ageDays: number
  validUntil: string | null
  createdAt: string
  sentAt: string | null
  firstViewedAt: string | null
  lastViewedAt: string | null
  acceptedAt: string | null
  expiredAt: string | null
}

export interface CrmContractDashboardRow {
  id: string
  name: string
  /** Ativo, Renovado, Expirado, Cancelado. */
  status: string
  company: string
  owner: string | null
  ownerId: string | null
  value: number | null
  autoRenews: boolean
  isActive: boolean
  isRenewed: boolean
  /** 100 renewed, 0 expired, `null` otherwise. */
  renewedPct: number | null
  hasRenewalDeal: boolean
  /** Days to the end date for active contracts (negative = past due). */
  daysToEnd: number | null
  /** Active and ending within 30 days. */
  isExpiringSoon: boolean
  durationDays: number
  startDate: string
  endDate: string
  createdAt: string
  renewalCreatedAt: string | null
}

export interface CrmChargeDashboardRow {
  id: string
  proposal: string
  company: string | null
  createdBy: string | null
  /** Pix, Boleto. */
  method: string
  provider: string
  /** Pendente, Paga, Expirada, Cancelada. */
  status: string
  amount: number
  paidAmount: number | null
  isPaid: boolean
  isPending: boolean
  isExpired: boolean
  isCanceled: boolean
  /** 100 paid, 0 expired/canceled, `null` while pending. */
  paidPct: number | null
  daysToPay: number | null
  createdAt: string
  expiresAt: string
  paidAt: string | null
  canceledAt: string | null
}

export interface CrmActivityDashboardRow {
  id: string
  /** Criou, Atualizou, Removeu… */
  action: string
  actionCode: string
  /** Empresa, Pessoa, Oportunidade… */
  entity: string
  entityCode: string
  user: string | null
  userId: string | null
  summary: string | null
  createdAt: string
}

export interface CrmQuotaDashboardRow {
  id: string
  owner: string
  ownerId: string
  /** Mensal, Trimestral. */
  period: string
  /** `2026-10` or `2026-Q4`. */
  periodKey: string
  target: number
  /** Sum of the deals won by the owner in the period (by `wonAt`). */
  achieved: number
  wonCount: number
  remaining: number
  /** `achieved / target × 100`; `null` when the target is 0. */
  attainmentPct: number | null
  isMet: boolean
  isCurrent: boolean
  periodStart: string
}

export interface CrmHealthDashboardRow {
  id: string
  /** Cliente, Oportunidade. */
  kind: string
  /** Company or deal name. */
  name: string
  company: string | null
  owner: string | null
  ownerId: string | null
  /** Open-deal amount (opportunities only). */
  amount: number | null
  stage: string | null
  /** 0–100, higher is riskier. */
  riskScore: number
  /** `100 - riskScore`. */
  healthScore: number
  /** Risco baixo, Risco médio, Risco alto. */
  level: string
  isHighRisk: boolean
  previousScore: number | null
  scoreDelta: number | null
  levelChanged: boolean
  nextAction: string | null
  computedAt: string
}

export interface CrmCampaignDashboardRow {
  id: string
  name: string
  /** Multicanal, E-mail. */
  kind: string
  status: string
  hasEmail: boolean
  hasWhatsapp: boolean
  recipients: number
  emailSent: number
  emailDelivered: number
  emailOpened: number | null
  emailClicked: number | null
  emailBounced: number | null
  unsubscribed: number | null
  whatsappSent: number
  whatsappDelivered: number
  whatsappRead: number
  whatsappClicked: number
  whatsappReplied: number
  converted: number
  /** Percentages 0–100; `null` when the denominator is 0. */
  emailOpenRate: number | null
  emailClickRate: number | null
  whatsappReadRate: number | null
  conversionRate: number | null
  createdAt: string
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
}

export type CrmDashboardRow =
  | CrmProposalDashboardRow
  | CrmContractDashboardRow
  | CrmChargeDashboardRow
  | CrmActivityDashboardRow
  | CrmQuotaDashboardRow
  | CrmHealthDashboardRow
  | CrmCampaignDashboardRow
