import type {
  AiInsightKind,
  AiInsightSeverity,
  ModuleKind,
} from '@prisma/client'
import {
  canSeeConversation,
  type WhatsAppConversationScope,
} from '@/src/lib/whatsapp/conversation-scope'
import {
  atClock,
  clockIn,
  duration,
  minutesBetween,
  money,
  percent,
  plural,
  score,
} from './format'

/**
 * Rules of the proactive AI (ADR 0040): pure functions that turn the
 * signals read from each module into insight drafts, one per recipient.
 * No LLM, no I/O — every number in a title or body comes from the signals,
 * and the thresholds below are the whole policy (change them here, no
 * migration). The service decides who the viewers are (module access,
 * ServiceDesk agent, Equipes scope) before calling these.
 */
export const PROACTIVE_RULES = {
  /** ServiceDesk: breach forecasts inside this window become insights. */
  sdForecastWindowHours: 4,
  /** ServiceDesk: the first breach this close is CRITICAL. */
  sdCriticalWithinMinutes: 60,
  /** CRM: an open deal without activity for this long is "stale". */
  crmStaleDays: 10,
  /** CRM: from this many stale deals the insight is a WARNING. */
  crmStaleWarningCount: 5,
  /** CRM: a stage with at least this many stale deals is "stalled". */
  crmStalledStageMinDeals: 3,
  /** CRM: weighted forecast below this share of the quota is a gap. */
  crmForecastGapRatio: 0.9,
  /** CRM: below this share the gap is a WARNING. */
  crmForecastWarningRatio: 0.7,
  /** Comunicação: an unassigned conversation waiting longer than this. */
  zapWaitingMinutes: 30,
  /** Comunicação: the oldest waiting this long is CRITICAL. */
  zapWaitingCriticalMinutes: 120,
  /** Comunicação: only conversations with a message this recent. */
  zapSentimentWindowHours: 24,
  /** Comunicação: an average at or below this is CRITICAL. */
  zapSentimentCritical: -0.7,
  /** Comunicação: at most this many sentiment insights per person. */
  zapSentimentMaxPerUser: 5,
} as const

export interface AiInsightFact {
  label: string
  value: string
}

/** What the worker writes for one user (see `AiInsight`). */
export interface AiInsightDraft {
  userId: string
  kind: AiInsightKind
  module: ModuleKind
  severity: AiInsightSeverity
  dedupeKey: string
  title: string
  body: string
  facts: AiInsightFact[]
  href: string | null
  prompt: string | null
}

const TITLE_MAX = 80

function clip(text: string, max = TITLE_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/* ------------------------------- ServiceDesk ------------------------------ */

export interface SdBreachSignal {
  ticketId: string
  number: number
  /** Readable code (`INC-000123`). */
  code: string
  title: string
  departmentId: string | null
  departmentName: string | null
  assigneeId: string | null
  breachEtaAt: Date
  score: number
}

/** An agent of the ServiceDesk (requesters never get these insights). */
export interface SdInsightViewer {
  userId: string
  isAdmin: boolean
  leadDepartmentIds: string[]
}

function byEta(a: SdBreachSignal, b: SdBreachSignal): number {
  return a.breachEtaAt.getTime() - b.breachEtaAt.getTime() || b.score - a.score
}

function sdSeverity(first: SdBreachSignal, now: Date): AiInsightSeverity {
  return minutesBetween(now, first.breachEtaAt) <=
    PROACTIVE_RULES.sdCriticalWithinMinutes
    ? 'CRITICAL'
    : 'WARNING'
}

function sdHref(slug: string, signals: SdBreachSignal[]): string {
  return signals.length === 1
    ? `/${slug}/servicedesk/tickets/${signals[0].number}`
    : `/${slug}/servicedesk/risk`
}

const NO_DEPARTMENT = 'none'

/**
 * SLA breach forecast (ADR 0016 `breachEtaAt`): the assignee gets their own
 * tickets; department leads and ServiceDesk admins get the department queue
 * (tickets without a department go to the admins only).
 */
export function buildSdInsights(input: {
  slug: string
  timeZone: string
  now: Date
  signals: SdBreachSignal[]
  viewers: SdInsightViewer[]
}): AiInsightDraft[] {
  const { slug, timeZone, now } = input
  const window = PROACTIVE_RULES.sdForecastWindowHours
  const signals = [...input.signals].sort(byEta)
  if (signals.length === 0) return []

  const byDepartment = new Map<string, SdBreachSignal[]>()
  for (const signal of signals) {
    const key = signal.departmentId ?? NO_DEPARTMENT
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), signal])
  }

  const drafts: AiInsightDraft[] = []
  for (const viewer of input.viewers) {
    const own = signals.filter((s) => s.assigneeId === viewer.userId)
    if (own.length > 0) {
      const first = own[0]
      const last = own[own.length - 1]
      drafts.push({
        userId: viewer.userId,
        kind: 'SD_SLA_BREACH_FORECAST',
        module: 'SERVICE_DESK',
        severity: sdSeverity(first, now),
        dedupeKey: `sd-breach:assignee:${viewer.userId}`,
        title:
          own.length === 1
            ? `O chamado ${first.code} deve estourar o SLA ${atClock(first.breachEtaAt, now, timeZone)}`
            : `${own.length} chamados seus devem estourar o SLA nas próximas ${window} h`,
        body:
          own.length === 1
            ? `${clip(first.title)}. Previsão do risco preditivo se nada mudar (nota ${first.score} de 100).`
            : `O primeiro, ${first.code}, vence ${atClock(first.breachEtaAt, now, timeZone)}; o último, ${atClock(last.breachEtaAt, now, timeZone)}. Previsão do risco preditivo se nada mudar.`,
        facts: [
          { label: 'Chamados', value: String(own.length) },
          {
            label: 'Primeiro estouro',
            value: clockIn(first.breachEtaAt, now, timeZone),
          },
          { label: 'Maior risco', value: `${first.score}/100` },
        ],
        href: sdHref(slug, own),
        prompt:
          own.length === 1
            ? `O chamado ${first.code} deve estourar o SLA ${atClock(first.breachEtaAt, now, timeZone)}. Resuma o chamado, explique o risco e diga o que eu faço primeiro.`
            : `Quais dos meus chamados devem estourar o SLA nas próximas ${window} horas? Para cada um, explique o risco e sugira por onde começar.`,
      })
    }

    for (const [departmentId, group] of byDepartment) {
      const visible =
        viewer.isAdmin ||
        (departmentId !== NO_DEPARTMENT &&
          viewer.leadDepartmentIds.includes(departmentId))
      if (!visible) continue
      const first = group[0]
      const last = group[group.length - 1]
      const unassigned = group.filter((s) => !s.assigneeId).length
      const name =
        departmentId === NO_DEPARTMENT
          ? null
          : (first.departmentName ?? 'departamento')
      drafts.push({
        userId: viewer.userId,
        kind: 'SD_SLA_BREACH_FORECAST',
        module: 'SERVICE_DESK',
        severity: sdSeverity(first, now),
        dedupeKey: `sd-breach:dept:${departmentId}`,
        title: name
          ? `A fila de ${clip(name, 40)} deve estourar o SLA ${atClock(first.breachEtaAt, now, timeZone)}`
          : `Chamados sem departamento devem estourar o SLA ${atClock(first.breachEtaAt, now, timeZone)}`,
        body: `${plural(group.length, 'chamado', 'chamados')} com previsão de estouro até ${clockIn(last.breachEtaAt, now, timeZone)}${unassigned > 0 ? `, ${unassigned} sem responsável` : ''}. O primeiro é ${first.code}: ${clip(first.title, 60)}.`,
        facts: [
          { label: 'Chamados', value: String(group.length) },
          {
            label: 'Primeiro estouro',
            value: clockIn(first.breachEtaAt, now, timeZone),
          },
          { label: 'Sem responsável', value: String(unassigned) },
        ],
        href: sdHref(slug, group),
        prompt: name
          ? `Quais chamados da fila de ${clip(name, 40)} devem estourar o SLA nas próximas ${window} horas? Para cada um, explique o risco e sugira quem pode assumir.`
          : `Quais chamados sem departamento devem estourar o SLA nas próximas ${window} horas? Sugira o departamento e quem pode assumir cada um.`,
      })
    }
  }
  return drafts
}

/* ----------------------------------- CRM ---------------------------------- */

export interface CrmStaleDeal {
  id: string
  name: string
  amount: number | null
  stageId: string
  stageName: string
  ownerId: string | null
  idleDays: number
}

export interface CrmForecastSignal {
  /** `2026-10` — the quota period key. */
  periodKey: string
  /** "outubro de 2026". */
  periodLabel: string
  targetAmount: number | null
  weightedAmount: number
  wonAmount: number
}

export interface CrmInsightViewer {
  userId: string
  /** OWNER/ADMIN: workspace-wide CRM insights. */
  isPrivileged: boolean
}

/**
 * "Stale" deal: open, with no timeline activity (or edit) for `days` — the
 * same rule as the sales kit's "parados" card (ADR 0031). Pure: the caller
 * passes the open deals and their last activity.
 */
export function staleDealsOf(
  deals: {
    id: string
    name: string
    amount: number | null
    stageId: string
    stageName: string
    ownerId: string | null
    updatedAt: Date
  }[],
  lastActivity: Map<string, Date>,
  now: Date,
  days: number = PROACTIVE_RULES.crmStaleDays,
): CrmStaleDeal[] {
  return deals
    .map((deal) => {
      const logged = lastActivity.get(deal.id)
      const last =
        logged && logged.getTime() > deal.updatedAt.getTime()
          ? logged
          : deal.updatedAt
      return {
        id: deal.id,
        name: deal.name,
        amount: deal.amount,
        stageId: deal.stageId,
        stageName: deal.stageName,
        ownerId: deal.ownerId,
        idleDays: Math.floor((now.getTime() - last.getTime()) / 86_400_000),
      }
    })
    .filter((deal) => deal.idleDays >= days)
    .sort(
      (a, b) => b.idleDays - a.idleDays || (b.amount ?? 0) - (a.amount ?? 0),
    )
}

function sumAmount(deals: CrmStaleDeal[]): number {
  return (
    Math.round(deals.reduce((sum, d) => sum + (d.amount ?? 0), 0) * 100) / 100
  )
}

function staleDraft(
  viewer: CrmInsightViewer,
  slug: string,
  deals: CrmStaleDeal[],
  scope: 'owner' | 'all',
): AiInsightDraft {
  const days = PROACTIVE_RULES.crmStaleDays
  const oldest = deals[0]
  const total = sumAmount(deals)
  const unassigned = deals.filter((d) => !d.ownerId).length
  const subject =
    scope === 'owner'
      ? deals.length === 1
        ? '1 oportunidade sua'
        : `${deals.length} oportunidades suas`
      : plural(deals.length, 'oportunidade', 'oportunidades')
  return {
    userId: viewer.userId,
    kind: 'CRM_STALE_OPPORTUNITIES',
    module: 'CRM',
    severity:
      deals.length >= PROACTIVE_RULES.crmStaleWarningCount ? 'WARNING' : 'INFO',
    dedupeKey:
      scope === 'owner' ? `crm-stale:owner:${viewer.userId}` : 'crm-stale:all',
    title: `${subject} sem contato há ${days} dias ou mais`,
    body: `${deals.length === 1 ? 'Vale' : 'Somam'} ${money(total)}. A mais parada, ${clip(oldest.name, 60)}, está sem atividade há ${oldest.idleDays} dias${scope === 'all' && unassigned > 0 ? `; ${plural(unassigned, 'está sem responsável', 'estão sem responsável')}` : ''}.`,
    facts: [
      { label: 'Oportunidades', value: String(deals.length) },
      { label: 'Valor', value: money(total) },
      { label: 'Mais parada', value: `${oldest.idleDays} dias` },
    ],
    href:
      deals.length === 1
        ? `/${slug}/crm/opportunities?record=${oldest.id}`
        : `/${slug}/crm/opportunities`,
    prompt:
      scope === 'owner'
        ? `Liste minhas oportunidades abertas sem contato há ${days} dias ou mais e sugira o próximo passo para cada uma.`
        : `Liste as oportunidades abertas sem contato há ${days} dias ou mais, agrupadas por responsável, e sugira o próximo passo para as de maior valor.`,
  }
}

/**
 * CRM: the owner's stale deals; for OWNER/ADMIN also the workspace total,
 * the stage that concentrates them and the month's forecast gap.
 */
export function buildCrmInsights(input: {
  slug: string
  deals: CrmStaleDeal[]
  forecast: CrmForecastSignal | null
  viewers: CrmInsightViewer[]
}): AiInsightDraft[] {
  const { slug, deals, forecast } = input
  const drafts: AiInsightDraft[] = []

  const byStage = new Map<string, CrmStaleDeal[]>()
  for (const deal of deals) {
    byStage.set(deal.stageId, [...(byStage.get(deal.stageId) ?? []), deal])
  }
  const [stalledStage] = [...byStage.values()]
    .filter((group) => group.length >= PROACTIVE_RULES.crmStalledStageMinDeals)
    .sort((a, b) => b.length - a.length || sumAmount(b) - sumAmount(a))

  const gap =
    forecast?.targetAmount &&
    forecast.weightedAmount <
      forecast.targetAmount * PROACTIVE_RULES.crmForecastGapRatio
      ? {
          ...forecast,
          targetAmount: forecast.targetAmount,
          missing:
            Math.round(
              (forecast.targetAmount - forecast.weightedAmount) * 100,
            ) / 100,
          below: 100 - percent(forecast.weightedAmount, forecast.targetAmount),
        }
      : null

  for (const viewer of input.viewers) {
    const own = deals.filter((d) => d.ownerId === viewer.userId)
    if (own.length > 0) drafts.push(staleDraft(viewer, slug, own, 'owner'))
    if (!viewer.isPrivileged) continue

    if (deals.length > 0) drafts.push(staleDraft(viewer, slug, deals, 'all'))

    if (stalledStage) {
      const stage = stalledStage[0]
      const total = sumAmount(stalledStage)
      drafts.push({
        userId: viewer.userId,
        kind: 'CRM_STALLED_STAGE',
        module: 'CRM',
        severity: 'INFO',
        dedupeKey: `crm-stage:${stage.stageId}`,
        title: `A etapa ${clip(stage.stageName, 40)} concentra ${stalledStage.length} oportunidades paradas`,
        body: `${stalledStage.length} de ${deals.length} oportunidades sem contato há ${PROACTIVE_RULES.crmStaleDays} dias ou mais estão nessa etapa, somando ${money(total)}.`,
        facts: [
          { label: 'Na etapa', value: String(stalledStage.length) },
          { label: 'Paradas no total', value: String(deals.length) },
          { label: 'Valor', value: money(total) },
        ],
        href: `/${slug}/crm/opportunities`,
        prompt: `Por que as oportunidades da etapa ${clip(stage.stageName, 40)} estão paradas? Liste-as com o último contato e sugira como destravar cada uma.`,
      })
    }

    if (gap) {
      drafts.push({
        userId: viewer.userId,
        kind: 'CRM_FORECAST_GAP',
        module: 'CRM',
        severity:
          gap.weightedAmount <
          gap.targetAmount * PROACTIVE_RULES.crmForecastWarningRatio
            ? 'WARNING'
            : 'INFO',
        dedupeKey: `crm-forecast:${gap.periodKey}`,
        title: `A previsão de ${gap.periodLabel} está ${gap.below}% abaixo da meta`,
        body: `Previsão ponderada de ${money(gap.weightedAmount)} para uma meta de ${money(gap.targetAmount)}: faltam ${money(gap.missing)}. Já ganho no período: ${money(gap.wonAmount)}.`,
        facts: [
          { label: 'Meta', value: money(gap.targetAmount) },
          { label: 'Previsão ponderada', value: money(gap.weightedAmount) },
          { label: 'Falta', value: money(gap.missing) },
        ],
        href: `/${slug}/crm/forecast`,
        prompt: `A previsão de ${gap.periodLabel} está abaixo da meta. Quais oportunidades com fechamento neste período têm mais chance de cobrir a diferença e o que fazer em cada uma?`,
      })
    }
  }
  return drafts
}

/* ------------------------------- Comunicação ------------------------------ */

export interface ZapConversationSignal {
  id: string
  contactName: string | null
  assignedUserId: string | null
  teamId: string | null
  /** Waiting since (last message, else creation) — waiting signals. */
  since: Date
  /** Average sentiment — sentiment signals. */
  score: number | null
}

export interface ZapInsightViewer {
  userId: string
  scope: WhatsAppConversationScope
}

function contactLabel(name: string | null): string {
  return name?.trim() ? clip(name, 40) : 'um contato'
}

/**
 * May the viewer be told about this conversation's sentiment? Who sees
 * everything, the assignee, and the leaders of its team or of its agent.
 * Plain queue members (agents) are not: the alert goes to who acts on it.
 */
function followsConversation(
  scope: WhatsAppConversationScope,
  conversation: ZapConversationSignal,
): boolean {
  if (!canSeeConversation(scope, conversation)) return false
  if (scope.mode === 'ALL') return true
  const { assignedUserId, teamId } = conversation
  return (
    assignedUserId === scope.userId ||
    (assignedUserId !== null && scope.ledAgentIds.includes(assignedUserId)) ||
    (teamId !== null && scope.leadsTeamIds.includes(teamId))
  )
}

/**
 * Comunicação: conversations waiting for an agent (same rule as
 * `WhatsAppConversationService.listWaiting`, filtered here by how long)
 * and conversations whose sentiment fell to the workspace threshold. Both
 * respect the Equipes visibility of each viewer.
 */
export function buildZapInsights(input: {
  slug: string
  now: Date
  waiting: ZapConversationSignal[]
  negative: ZapConversationSignal[]
  threshold: number
  viewers: ZapInsightViewer[]
}): AiInsightDraft[] {
  const { slug, now } = input
  const minWait = PROACTIVE_RULES.zapWaitingMinutes
  const waiting = input.waiting
    .filter((c) => minutesBetween(c.since, now) >= minWait)
    .sort((a, b) => a.since.getTime() - b.since.getTime())
  const negative = input.negative
    .filter((c) => c.score !== null && c.score <= input.threshold)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))

  const drafts: AiInsightDraft[] = []
  for (const viewer of input.viewers) {
    const queue = waiting.filter((c) => canSeeConversation(viewer.scope, c))
    if (queue.length > 0) {
      const oldest = queue[0]
      const waited = minutesBetween(oldest.since, now)
      drafts.push({
        userId: viewer.userId,
        kind: 'ZAP_WAITING_TOO_LONG',
        module: 'COMMUNICATION',
        severity:
          waited >= PROACTIVE_RULES.zapWaitingCriticalMinutes
            ? 'CRITICAL'
            : 'WARNING',
        dedupeKey: 'zap-waiting:queue',
        title: `${plural(queue.length, 'conversa aguarda', 'conversas aguardam')} atendente há mais de ${minWait} min`,
        body: `A mais antiga, de ${contactLabel(oldest.contactName)}, espera há ${duration(waited)}.`,
        facts: [
          { label: 'Na fila', value: String(queue.length) },
          { label: 'Maior espera', value: duration(waited) },
        ],
        href:
          queue.length === 1
            ? `/${slug}/zap?conversa=${oldest.id}`
            : `/${slug}/zap`,
        prompt: `Quais conversas do WhatsApp estão aguardando atendente há mais de ${minWait} minutos? Resuma cada uma e sugira quem deve assumir.`,
      })
    }

    const followed = negative
      .filter((c) => followsConversation(viewer.scope, c))
      .slice(0, PROACTIVE_RULES.zapSentimentMaxPerUser)
    for (const conversation of followed) {
      const value = conversation.score as number
      const contact = contactLabel(conversation.contactName)
      drafts.push({
        userId: viewer.userId,
        kind: 'ZAP_NEGATIVE_SENTIMENT',
        module: 'COMMUNICATION',
        severity:
          value <= PROACTIVE_RULES.zapSentimentCritical
            ? 'CRITICAL'
            : 'WARNING',
        dedupeKey: `zap-sentiment:${conversation.id}`,
        title: `O sentimento de ${contact} caiu`,
        body: `Média de ${score(value)} nas últimas mensagens (o alerta do workspace começa em ${score(input.threshold)}, numa escala de -1 a 1).`,
        facts: [
          { label: 'Sentimento', value: score(value) },
          { label: 'Limiar', value: score(input.threshold) },
        ],
        href: `/${slug}/zap?conversa=${conversation.id}`,
        prompt: `Resuma a conversa do WhatsApp com ${contact}, explique o que deixou o cliente insatisfeito e sugira uma resposta.`,
      })
    }
  }
  return drafts
}
