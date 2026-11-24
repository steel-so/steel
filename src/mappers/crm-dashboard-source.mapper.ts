import type { CrmQuotaPeriod } from '@prisma/client'
import { periodKeyOf } from '@/src/lib/crm-forecast-period'
import type {
  CrmDashboardActivity,
  CrmDashboardCampaign,
  CrmDashboardCampaignCounts,
  CrmDashboardCharge,
  CrmDashboardContract,
  CrmDashboardCustomerHealth,
  CrmDashboardOpportunityHealth,
  CrmDashboardProposal,
  CrmDashboardQuota,
  CrmDashboardWonDeal,
} from '@/src/repositories/crm-dashboard-source.repository'
import type {
  CrmActivityDashboardRow,
  CrmCampaignDashboardRow,
  CrmChargeDashboardRow,
  CrmContractDashboardRow,
  CrmHealthDashboardRow,
  CrmProposalDashboardRow,
  CrmQuotaDashboardRow,
} from '@/types/crm-dashboard-source'

const DAY_MS = 86_400_000

/* --------------------------------- labels --------------------------------- */

export const CRM_PROPOSAL_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviada',
  VIEWED: 'Visualizada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Recusada',
  EXPIRED: 'Expirada',
}

export const CRM_CONTRACT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  RENEWED: 'Renovado',
  EXPIRED: 'Expirado',
  CANCELED: 'Cancelado',
}

export const CRM_CHARGE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  PAID: 'Paga',
  EXPIRED: 'Expirada',
  CANCELED: 'Cancelada',
}

export const CRM_PAYMENT_METHOD_LABELS: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
}

export const CRM_ACTIVITY_ACTION_LABELS: Record<string, string> = {
  CREATED: 'Criou',
  UPDATED: 'Atualizou',
  DELETED: 'Removeu',
}

export const CRM_ACTIVITY_ENTITY_LABELS: Record<string, string> = {
  company: 'Empresa',
  person: 'Pessoa',
  opportunity: 'Oportunidade',
  task: 'Tarefa',
  note: 'Anotação',
  crm_proposal: 'Proposta',
}

export const CRM_QUOTA_PERIOD_LABELS: Record<CrmQuotaPeriod, string> = {
  MONTH: 'Mensal',
  QUARTER: 'Trimestral',
}

export const CRM_HEALTH_LEVEL_LABELS: Record<string, string> = {
  LOW: 'Risco baixo',
  MEDIUM: 'Risco médio',
  HIGH: 'Risco alto',
}

export const CRM_CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  SENDING: 'Enviando',
  SENT: 'Enviada',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  CANCELED: 'Cancelada',
  FAILED: 'Falhou',
}

/* --------------------------------- helpers -------------------------------- */

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null
}

function num(value: { toString(): string } | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function daysBetween(from: Date, to: Date): number {
  return round((to.getTime() - from.getTime()) / DAY_MS, 1)
}

/** `part / whole × 100`, `null` when there is nothing to divide by. */
function rate(part: number, whole: number): number | null {
  return whole > 0 ? round((part / whole) * 100, 1) : null
}

/* -------------------------------- proposals ------------------------------- */

/** Total of the PRODUCTS_PRICING section content (`{ total }`), if any. */
function pricingTotal(
  sections: CrmDashboardProposal['sections'],
): number | null {
  for (const section of sections) {
    const content = section.content
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      const total = (content as Record<string, unknown>).total
      if (typeof total === 'number' && Number.isFinite(total)) return total
    }
  }
  return null
}

export function toCrmProposalDashboardRow(
  p: CrmDashboardProposal,
  now: Date,
): CrmProposalDashboardRow {
  const isOpen = p.status === 'SENT' || p.status === 'VIEWED'
  const first = p.views[0]?.createdAt ?? null
  const last = p.views[p.views.length - 1]?.createdAt ?? null
  const daysToExpire =
    isOpen && p.validUntil ? daysBetween(now, p.validUntil) : null
  let acceptedPct: number | null = null
  if (p.status === 'ACCEPTED') acceptedPct = 100
  else if (p.status === 'REJECTED' || p.status === 'EXPIRED') acceptedPct = 0

  return {
    id: p.id,
    name: p.name,
    status: CRM_PROPOSAL_STATUS_LABELS[p.status] ?? p.status,
    responsible: p.responsible.name,
    responsibleId: p.responsibleId,
    company: p.company?.name ?? null,
    contact: p.contact?.name ?? null,
    opportunity: p.opportunity?.name ?? null,
    amount: pricingTotal(p.sections) ?? num(p.opportunity?.amount),
    isDraft: p.status === 'DRAFT',
    isOpen,
    isViewed: p.views.length > 0,
    isAccepted: p.status === 'ACCEPTED',
    isRejected: p.status === 'REJECTED',
    isExpired: p.status === 'EXPIRED',
    acceptedPct,
    viewCount: p.views.length,
    isExpiringSoon: daysToExpire !== null && daysToExpire <= 3,
    daysToExpire,
    daysToFirstView: first ? daysBetween(p.createdAt, first) : null,
    daysToAccept: p.acceptedAt ? daysBetween(p.createdAt, p.acceptedAt) : null,
    ageDays: daysBetween(p.createdAt, now),
    validUntil: iso(p.validUntil),
    createdAt: p.createdAt.toISOString(),
    firstViewedAt: iso(first),
    lastViewedAt: iso(last),
    acceptedAt: iso(p.acceptedAt),
    expiredAt: iso(p.expiredAt),
  }
}

/* -------------------------------- contracts ------------------------------- */

export function toCrmContractDashboardRow(
  c: CrmDashboardContract,
  members: Map<string, string>,
  now: Date,
): CrmContractDashboardRow {
  const isActive = c.status === 'ACTIVE'
  const daysToEnd = isActive ? daysBetween(now, c.endDate) : null
  let renewedPct: number | null = null
  if (c.status === 'RENEWED') renewedPct = 100
  else if (c.status === 'EXPIRED') renewedPct = 0

  return {
    id: c.id,
    name: c.name,
    status: CRM_CONTRACT_STATUS_LABELS[c.status] ?? c.status,
    company: c.company.name,
    owner: c.ownerId ? (members.get(c.ownerId) ?? null) : null,
    ownerId: c.ownerId,
    value: num(c.value),
    autoRenews: c.autoRenews,
    isActive,
    isRenewed: c.status === 'RENEWED',
    renewedPct,
    hasRenewalDeal: c.renewalOpportunityId !== null,
    daysToEnd,
    isExpiringSoon: daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 30,
    durationDays: Math.round(daysBetween(c.startDate, c.endDate)),
    startDate: c.startDate.toISOString(),
    endDate: c.endDate.toISOString(),
    createdAt: c.createdAt.toISOString(),
    renewalCreatedAt: iso(c.renewalCreatedAt),
  }
}

/* --------------------------------- charges -------------------------------- */

export function toCrmChargeDashboardRow(
  c: CrmDashboardCharge,
  members: Map<string, string>,
): CrmChargeDashboardRow {
  let paidPct: number | null = null
  if (c.status === 'PAID') paidPct = 100
  else if (c.status === 'EXPIRED' || c.status === 'CANCELED') paidPct = 0

  return {
    id: c.id,
    proposal: c.proposal.name,
    company: c.proposal.company?.name ?? null,
    createdBy: c.createdById ? (members.get(c.createdById) ?? null) : null,
    method: CRM_PAYMENT_METHOD_LABELS[c.method] ?? c.method,
    provider: c.provider,
    status: CRM_CHARGE_STATUS_LABELS[c.status] ?? c.status,
    amount: Number(c.amount),
    paidAmount: num(c.paidAmount),
    isPaid: c.status === 'PAID',
    isPending: c.status === 'PENDING',
    isExpired: c.status === 'EXPIRED',
    isCanceled: c.status === 'CANCELED',
    paidPct,
    daysToPay: c.paidAt ? daysBetween(c.createdAt, c.paidAt) : null,
    createdAt: c.createdAt.toISOString(),
    expiresAt: c.expiresAt.toISOString(),
    paidAt: iso(c.paidAt),
    canceledAt: iso(c.canceledAt),
  }
}

/* -------------------------------- activities ------------------------------ */

export function toCrmActivityDashboardRow(
  a: CrmDashboardActivity,
): CrmActivityDashboardRow {
  return {
    id: a.id,
    action: CRM_ACTIVITY_ACTION_LABELS[a.action] ?? a.action,
    actionCode: a.action,
    entity: CRM_ACTIVITY_ENTITY_LABELS[a.entity] ?? a.entity,
    entityCode: a.entity,
    user: a.actor?.name ?? null,
    userId: a.actorUserId,
    summary: a.summary,
    createdAt: a.createdAt.toISOString(),
  }
}

/* ---------------------------------- quotas -------------------------------- */

/** First instant (UTC) of a `2026-10` / `2026-Q4` period key. */
export function quotaPeriodStart(
  period: CrmQuotaPeriod,
  periodKey: string,
): Date | null {
  if (period === 'QUARTER') {
    const match = /^(\d{4})-Q([1-4])$/.exec(periodKey)
    if (!match) return null
    return new Date(Date.UTC(Number(match[1]), (Number(match[2]) - 1) * 3, 1))
  }
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodKey)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
}

/** Won amount and count by `owner|period|periodKey` (period of `wonAt`, UTC). */
export function wonByQuotaPeriod(
  deals: CrmDashboardWonDeal[],
): Map<string, { amount: number; count: number }> {
  const totals = new Map<string, { amount: number; count: number }>()
  for (const deal of deals) {
    if (!deal.ownerId) continue
    for (const period of ['MONTH', 'QUARTER'] as const) {
      const key = `${deal.ownerId}|${period}|${periodKeyOf(deal.wonAt, period)}`
      const entry = totals.get(key) ?? { amount: 0, count: 0 }
      entry.amount += num(deal.amount) ?? 0
      entry.count += 1
      totals.set(key, entry)
    }
  }
  return totals
}

export function toCrmQuotaDashboardRows(
  quotas: CrmDashboardQuota[],
  won: Map<string, { amount: number; count: number }>,
  now: Date,
): CrmQuotaDashboardRow[] {
  const rows: CrmQuotaDashboardRow[] = []
  for (const q of quotas) {
    const start = quotaPeriodStart(q.period, q.periodKey)
    if (!start) continue
    const target = Number(q.targetAmount)
    const hit = won.get(`${q.ownerId}|${q.period}|${q.periodKey}`)
    const achieved = round(hit?.amount ?? 0)
    rows.push({
      id: q.id,
      owner: q.owner.name,
      ownerId: q.ownerId,
      period: CRM_QUOTA_PERIOD_LABELS[q.period],
      periodKey: q.periodKey,
      target,
      achieved,
      wonCount: hit?.count ?? 0,
      remaining: round(Math.max(target - achieved, 0)),
      attainmentPct: target > 0 ? round((achieved / target) * 100, 1) : null,
      isMet: target > 0 && achieved >= target,
      isCurrent: periodKeyOf(now, q.period) === q.periodKey,
      periodStart: start.toISOString(),
    })
  }
  return rows
}

/* ---------------------------------- health -------------------------------- */

function nextActionLabel(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const label = (value as Record<string, unknown>).label
    if (typeof label === 'string') return label
  }
  return null
}

function healthShared(h: {
  riskScore: number
  level: string
  previousScore: number | null
  previousLevel: string | null
  nextAction: unknown
  computedAt: Date
}) {
  return {
    riskScore: h.riskScore,
    healthScore: 100 - h.riskScore,
    level: CRM_HEALTH_LEVEL_LABELS[h.level] ?? h.level,
    isHighRisk: h.level === 'HIGH',
    previousScore: h.previousScore,
    scoreDelta: h.previousScore === null ? null : h.riskScore - h.previousScore,
    levelChanged: h.previousLevel !== null && h.previousLevel !== h.level,
    nextAction: nextActionLabel(h.nextAction),
    computedAt: h.computedAt.toISOString(),
  }
}

export function toCrmCustomerHealthDashboardRow(
  h: CrmDashboardCustomerHealth,
  members: Map<string, string>,
): CrmHealthDashboardRow {
  const ownerId = h.company.accountOwnerId
  return {
    id: h.id,
    kind: 'Cliente',
    name: h.company.name,
    company: h.company.name,
    owner: ownerId ? (members.get(ownerId) ?? null) : null,
    ownerId,
    amount: null,
    stage: null,
    ...healthShared(h),
  }
}

export function toCrmOpportunityHealthDashboardRow(
  h: CrmDashboardOpportunityHealth,
  members: Map<string, string>,
): CrmHealthDashboardRow {
  const o = h.opportunity
  return {
    id: h.id,
    kind: 'Oportunidade',
    name: o.name,
    company: o.company?.name ?? null,
    owner: o.ownerId ? (members.get(o.ownerId) ?? null) : null,
    ownerId: o.ownerId,
    amount: num(o.amount),
    stage: o.stage.name,
    ...healthShared(h),
  }
}

/* -------------------------------- campaigns ------------------------------- */

const ZERO_COUNTS: Omit<CrmDashboardCampaignCounts, 'campaignId'> = {
  recipients: 0,
  emailSent: 0,
  emailDelivered: 0,
  emailOpened: 0,
  emailClicked: 0,
  emailBounced: 0,
  unsubscribed: 0,
  whatsappSent: 0,
  whatsappDelivered: 0,
  whatsappRead: 0,
  whatsappClicked: 0,
  whatsappReplied: 0,
  converted: 0,
}

function campaignDates(c: CrmDashboardCampaign) {
  return {
    createdAt: c.createdAt.toISOString(),
    scheduledAt: iso(c.scheduledAt),
    startedAt: iso(c.startedAt),
    completedAt: iso(c.completedAt),
  }
}

export function toCrmCampaignDashboardRow(
  c: CrmDashboardCampaign,
  counts: CrmDashboardCampaignCounts | undefined,
): CrmCampaignDashboardRow {
  const n = counts ?? { campaignId: c.id, ...ZERO_COUNTS }
  return {
    id: c.id,
    name: c.name,
    kind: 'Multicanal',
    status: CRM_CAMPAIGN_STATUS_LABELS[c.status] ?? c.status,
    hasEmail: c.hasEmail,
    hasWhatsapp: c.whatsappEnabled,
    recipients: n.recipients,
    emailSent: n.emailSent,
    emailDelivered: n.emailDelivered,
    emailOpened: n.emailOpened,
    emailClicked: n.emailClicked,
    emailBounced: n.emailBounced,
    unsubscribed: n.unsubscribed,
    whatsappSent: n.whatsappSent,
    whatsappDelivered: n.whatsappDelivered,
    whatsappRead: n.whatsappRead,
    whatsappClicked: n.whatsappClicked,
    whatsappReplied: n.whatsappReplied,
    converted: n.converted,
    emailOpenRate: rate(n.emailOpened, n.emailDelivered),
    emailClickRate: rate(n.emailClicked, n.emailDelivered),
    whatsappReadRate: rate(n.whatsappRead, n.whatsappDelivered),
    conversionRate: rate(n.converted, n.recipients),
    ...campaignDates(c),
  }
}

/** Legacy e-mail campaign: no open/click tracking, only sent counts. */
export function toCrmEmailCampaignDashboardRow(
  c: CrmDashboardCampaign,
  counts: { recipients: number; sent: number } | undefined,
): CrmCampaignDashboardRow {
  const recipients = counts?.recipients ?? 0
  const sent = counts?.sent ?? 0
  return {
    id: c.id,
    name: c.name,
    kind: 'E-mail',
    status: CRM_CAMPAIGN_STATUS_LABELS[c.status] ?? c.status,
    hasEmail: true,
    hasWhatsapp: false,
    recipients,
    emailSent: sent,
    emailDelivered: sent,
    emailOpened: null,
    emailClicked: null,
    emailBounced: null,
    unsubscribed: null,
    whatsappSent: 0,
    whatsappDelivered: 0,
    whatsappRead: 0,
    whatsappClicked: 0,
    whatsappReplied: 0,
    converted: 0,
    emailOpenRate: null,
    emailClickRate: null,
    whatsappReadRate: null,
    conversionRate: null,
    ...campaignDates(c),
  }
}
