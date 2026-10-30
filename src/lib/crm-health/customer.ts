/**
 * T4 - customer health (churn risk). The table of factors, the pure compute
 * from the signals the repository collects, and the next-action copy. The
 * scoring mechanics are shared with the opportunity score (`./core`).
 */

import {
  buildHealth,
  daysBetween,
  type HealthComputation,
  type HealthFactorOutcome,
  type HealthFactorSpec,
  type HealthNextAction,
  pluralDays,
  ramp,
} from './core'

export const CUSTOMER_FACTOR_KEYS = [
  'engagement',
  'deals_at_risk',
  'lost_deals',
  'overdue_tasks',
  'zap_sentiment',
  'sd_breaches',
  'sd_open_volume',
  'sd_csat',
  'sd_high_risk',
] as const

export type CustomerFactorKey = (typeof CUSTOMER_FACTOR_KEYS)[number]

/** Weights sum 100 (a test locks it). */
export const CUSTOMER_FACTOR_SPECS: HealthFactorSpec<CustomerFactorKey>[] = [
  { key: 'engagement', label: 'Sem interação recente', weight: 20 },
  { key: 'zap_sentiment', label: 'Sentimento no WhatsApp', weight: 20 },
  { key: 'sd_breaches', label: 'SLA estourado nos chamados', weight: 15 },
  { key: 'deals_at_risk', label: 'Negócios abertos em risco', weight: 12 },
  { key: 'lost_deals', label: 'Negócios perdidos', weight: 8 },
  { key: 'sd_open_volume', label: 'Chamados abertos', weight: 8 },
  { key: 'sd_csat', label: 'Satisfação nos chamados', weight: 7 },
  { key: 'overdue_tasks', label: 'Tarefas atrasadas', weight: 5 },
  { key: 'sd_high_risk', label: 'Chamados com risco de SLA', weight: 5 },
]

/** What the repository collects for one company. All counts are as of `now`. */
export interface CustomerHealthSignals {
  now: Date
  companyCreatedAt: Date
  crm: {
    /** Last e-mail, meeting, note or WhatsApp message with the company. */
    lastInteractionAt: Date | null
    /** Open deals and how many are in the high / medium risk band. */
    openDeals: number
    highRiskDeals: number
    mediumRiskDeals: number
    /** Deals the company ever had (open, won or lost). */
    totalDeals: number
    /** Deals lost in the last 180 days, and wins in the same window. */
    lostDeals180d: number
    wonDeals180d: number
    overdueTasks: number
  }
  /** `null` = no WhatsApp conversation matched the company's contacts. */
  zap: {
    conversations: number
    /** Mean of the conversations' average sentiment, -1 to 1; null = unscored. */
    avgSentiment: number | null
    negativeConversations: number
  } | null
  /** `null` = ServiceDesk off, or no customer there matches the company. */
  sd: {
    openTickets: number
    breachedTickets90d: number
    tickets90d: number
    csatAvg: number | null
    csatCount: number
    highRiskOpenTickets: number
  } | null
}

const CHURN_ACTIONS: Record<CustomerFactorKey, HealthNextAction> = {
  engagement: {
    key: 'reach_out',
    label: 'Retomar o contato com o cliente',
    detail:
      'Ligue ou mande uma mensagem hoje: há tempo sem nenhuma interação registrada.',
  },
  zap_sentiment: {
    key: 'recover_sentiment',
    label: 'Falar com o cliente sobre o atendimento no WhatsApp',
    detail:
      'As conversas recentes estão negativas. Um responsável deve ligar e ouvir o que aconteceu.',
  },
  sd_breaches: {
    key: 'review_sla',
    label: 'Dar retorno sobre os chamados com SLA estourado',
    detail:
      'Revise os chamados que passaram do prazo e avise o cliente sobre a solução e o novo prazo.',
  },
  deals_at_risk: {
    key: 'review_deals',
    label: 'Revisar os negócios parados desta empresa',
    detail:
      'Abra a lista de oportunidades em risco e combine o próximo passo de cada uma.',
  },
  lost_deals: {
    key: 'win_back',
    label: 'Entender a perda e propor um novo caminho',
    detail:
      'Converse com o contato sobre o motivo da perda e avalie uma nova proposta.',
  },
  sd_open_volume: {
    key: 'reduce_tickets',
    label: 'Resolver os chamados abertos do cliente',
    detail:
      'O volume de chamados abertos está alto. Priorize a fila deste cliente.',
  },
  sd_csat: {
    key: 'csat_followup',
    label: 'Ligar para quem avaliou mal o atendimento',
    detail:
      'A satisfação dos chamados está baixa. Entenda a queixa antes que vire cancelamento.',
  },
  overdue_tasks: {
    key: 'clear_tasks',
    label: 'Concluir as tarefas atrasadas desta empresa',
    detail: 'Há combinados com o cliente que passaram do prazo.',
  },
  sd_high_risk: {
    key: 'prevent_breach',
    label: 'Antecipar-se aos chamados que vão estourar o SLA',
    detail: 'Remaneje os chamados em risco alto antes de o prazo vencer.',
  },
}

const HEALTHY_ACTION: HealthNextAction = {
  key: 'keep_nurturing',
  label: 'Manter o relacionamento',
  detail:
    'Nenhum sinal de risco agora. Siga o ritmo de contato e procure uma oportunidade de expansão.',
}

export const CUSTOMER_NEXT_ACTIONS = CHURN_ACTIONS
export const CUSTOMER_HEALTHY_ACTION = HEALTHY_ACTION

const ENGAGEMENT_OK_DAYS = 14
const ENGAGEMENT_BAD_DAYS = 90

function engagement(s: CustomerHealthSignals): HealthFactorOutcome {
  const last = s.crm.lastInteractionAt
  // A company created a moment ago has no history yet: count from its birth.
  const since = last ?? s.companyCreatedAt
  const days = daysBetween(since, s.now)
  const ratio = ramp(days, ENGAGEMENT_OK_DAYS, ENGAGEMENT_BAD_DAYS)
  return {
    key: 'engagement',
    applicable: true,
    ratio,
    detail: last
      ? `Última interação há ${pluralDays(days)}`
      : `Nenhuma interação registrada em ${pluralDays(days)}`,
  }
}

function dealsAtRisk(s: CustomerHealthSignals): HealthFactorOutcome {
  const { openDeals, highRiskDeals, mediumRiskDeals } = s.crm
  if (openDeals === 0) {
    return { key: 'deals_at_risk', applicable: false, ratio: 0, detail: '' }
  }
  const ratio = (highRiskDeals + mediumRiskDeals * 0.5) / openDeals
  return {
    key: 'deals_at_risk',
    applicable: true,
    ratio,
    detail:
      highRiskDeals + mediumRiskDeals === 0
        ? 'Nenhum negócio aberto em risco'
        : `${highRiskDeals} de ${openDeals} negócios abertos em risco alto e ${mediumRiskDeals} em risco médio`,
  }
}

function lostDeals(s: CustomerHealthSignals): HealthFactorOutcome {
  const { totalDeals, lostDeals180d, wonDeals180d, openDeals } = s.crm
  if (totalDeals === 0) {
    return { key: 'lost_deals', applicable: false, ratio: 0, detail: '' }
  }
  // A loss weighs fully only when nothing else is going on with the account.
  const recovered = openDeals > 0 || wonDeals180d > 0
  const ratio = lostDeals180d === 0 ? 0 : recovered ? 0.5 : 1
  return {
    key: 'lost_deals',
    applicable: true,
    ratio,
    detail:
      lostDeals180d === 0
        ? 'Nenhum negócio perdido nos últimos 180 dias'
        : `${lostDeals180d} negócio(s) perdido(s) em 180 dias${recovered ? '' : ' e nenhum aberto'}`,
  }
}

function overdueTasks(s: CustomerHealthSignals): HealthFactorOutcome {
  const n = s.crm.overdueTasks
  return {
    key: 'overdue_tasks',
    applicable: true,
    ratio: ramp(n, 0, 3),
    detail: n === 0 ? 'Sem tarefas atrasadas' : `${n} tarefa(s) atrasada(s)`,
  }
}

function zapSentiment(s: CustomerHealthSignals): HealthFactorOutcome {
  const zap = s.zap
  if (!zap || zap.avgSentiment === null) {
    return { key: 'zap_sentiment', applicable: false, ratio: 0, detail: '' }
  }
  // 0.2 and above is fine; -1 is the worst.
  const ratio = ramp(zap.avgSentiment, 0.2, -1)
  const pct = Math.round(zap.avgSentiment * 100)
  return {
    key: 'zap_sentiment',
    applicable: true,
    ratio,
    detail: `Sentimento médio de ${pct > 0 ? '+' : ''}${pct}% em ${zap.conversations} conversa(s) do WhatsApp, ${zap.negativeConversations} negativa(s)`,
  }
}

function sdBreaches(s: CustomerHealthSignals): HealthFactorOutcome {
  if (!s.sd) {
    return { key: 'sd_breaches', applicable: false, ratio: 0, detail: '' }
  }
  const n = s.sd.breachedTickets90d
  return {
    key: 'sd_breaches',
    applicable: true,
    ratio: ramp(n, 0, 3),
    detail:
      n === 0
        ? 'Nenhum chamado com SLA estourado em 90 dias'
        : `${n} de ${s.sd.tickets90d} chamados com SLA estourado em 90 dias`,
  }
}

function sdOpenVolume(s: CustomerHealthSignals): HealthFactorOutcome {
  if (!s.sd) {
    return { key: 'sd_open_volume', applicable: false, ratio: 0, detail: '' }
  }
  const n = s.sd.openTickets
  return {
    key: 'sd_open_volume',
    applicable: true,
    ratio: ramp(n, 1, 6),
    detail: n === 0 ? 'Sem chamados abertos' : `${n} chamado(s) aberto(s)`,
  }
}

function sdCsat(s: CustomerHealthSignals): HealthFactorOutcome {
  if (!s.sd || s.sd.csatAvg === null || s.sd.csatCount === 0) {
    return { key: 'sd_csat', applicable: false, ratio: 0, detail: '' }
  }
  return {
    key: 'sd_csat',
    applicable: true,
    ratio: ramp(s.sd.csatAvg, 4, 2),
    detail: `Nota média ${s.sd.csatAvg.toFixed(1).replace('.', ',')} de 5 em ${s.sd.csatCount} avaliação(ões)`,
  }
}

function sdHighRisk(s: CustomerHealthSignals): HealthFactorOutcome {
  if (!s.sd) {
    return { key: 'sd_high_risk', applicable: false, ratio: 0, detail: '' }
  }
  const n = s.sd.highRiskOpenTickets
  return {
    key: 'sd_high_risk',
    applicable: true,
    ratio: ramp(n, 0, 2),
    detail:
      n === 0
        ? 'Nenhum chamado aberto com risco alto de SLA'
        : `${n} chamado(s) aberto(s) com risco alto de violar o SLA`,
  }
}

/** Pure: the churn-risk index of a company from its signals. */
export function computeCustomerHealth(
  signals: CustomerHealthSignals,
): HealthComputation {
  return buildHealth(
    CUSTOMER_FACTOR_SPECS,
    [
      engagement(signals),
      dealsAtRisk(signals),
      lostDeals(signals),
      overdueTasks(signals),
      zapSentiment(signals),
      sdBreaches(signals),
      sdOpenVolume(signals),
      sdCsat(signals),
      sdHighRisk(signals),
    ],
    CHURN_ACTIONS,
    HEALTHY_ACTION,
  )
}
