import type {
  WhatsAppConversationEventKind,
  WhatsAppConversationEventSource,
  WhatsAppConversationStatus,
  WhatsAppPresenceStatus,
  WhatsAppProvider,
  WhatsAppTeamRole,
} from '@prisma/client'
import type {
  WaDashboardAttendance,
  WaDashboardEvent,
  WaDashboardSlaCycle,
  WaSlaCycleData,
  WaTeamMemberData,
} from '@/src/repositories/whatsapp-dashboard-attendance.repository'
import type {
  WaAttendanceDashboardRow,
  WaConversationEventDashboardRow,
  WaSentimentBandLabel,
  WaSlaCycleDashboardRow,
  WaSlaStateLabel,
  WaTeamMemberDashboardRow,
} from '@/types/whatsapp-dashboard-attendance'
import { WA_CLOSE_OUTCOME_LABELS } from './whatsapp-dashboard-source.mapper'

/* --------------------------------- labels ---------------------------------- */

export const WA_CONVERSATION_STATUS_LABELS: Record<
  WhatsAppConversationStatus,
  string
> = {
  NEW: 'Nova',
  IN_PROGRESS: 'Em atendimento',
  CLOSED: 'Encerrada',
}

export const WA_PROVIDER_LABELS: Record<WhatsAppProvider, string> = {
  ZAPI: 'Z-API',
  META: 'Meta',
  WIDGET: 'Widget',
}

export const WA_EVENT_KIND_LABELS: Record<
  WhatsAppConversationEventKind,
  string
> = {
  CLOSED: 'Conversa fechada',
  REOPENED: 'Conversa reaberta',
  SENTIMENT_ALERT: 'Alerta de sentimento negativo',
  BUTTON_CLICKED: 'Clique em botão',
  ASSIGNED: 'Atribuição',
  TEAM_CHANGED: 'Troca de equipe',
  AI_GUARDRAIL_HANDOFF: 'IA transferiu para atendente',
  AI_ACTION: 'Ação da IA',
  SLA_BREACHED: 'SLA estourado',
  CHATBOT_HANDOFF: 'Chatbot transferiu',
  PIX_PAID: 'Pix recebido',
  TRANSFER_SUMMARY: 'Resumo de transferência',
  AI_UNAVAILABLE: 'IA indisponível',
}

export const WA_EVENT_SOURCE_LABELS: Record<
  WhatsAppConversationEventSource,
  string
> = {
  AGENT: 'Atendente',
  CONTACT: 'Contato',
  INACTIVITY: 'Inatividade',
  SENTIMENT: 'Análise de sentimento',
  BUTTON_ACTION: 'Ação de botão',
  AI_GUARDRAIL: 'Proteções da IA',
  AUTO_OUTREACH: 'Disparo automático',
  AI_CAMPAIGN: 'Campanha de IA',
  DISTRIBUTION: 'Distribuição automática',
  SLA: 'SLA',
  CHATBOT: 'Chatbot',
  PIX: 'Pix',
  COPILOT: 'Copiloto',
  AI_REPLY: 'Resposta automática da IA',
}

/**
 * What the row shows of the event's `reason`: `keep` for the kinds whose
 * reason is structured or typed by the staff, `label` for the AI action
 * (`"action label: why"` — only the label), `drop` for free text about the
 * conversation (it may quote the contact).
 */
const EVENT_REASON_POLICY: Record<
  WhatsAppConversationEventKind,
  'keep' | 'label' | 'drop'
> = {
  CLOSED: 'keep',
  REOPENED: 'keep',
  BUTTON_CLICKED: 'keep',
  ASSIGNED: 'keep',
  TEAM_CHANGED: 'keep',
  SLA_BREACHED: 'keep',
  CHATBOT_HANDOFF: 'keep',
  AI_UNAVAILABLE: 'keep',
  AI_ACTION: 'label',
  SENTIMENT_ALERT: 'drop',
  AI_GUARDRAIL_HANDOFF: 'drop',
  PIX_PAID: 'drop',
  TRANSFER_SUMMARY: 'drop',
}

export const WA_TEAM_ROLE_LABELS: Record<WhatsAppTeamRole, string> = {
  LEADER: 'Líder',
  AGENT: 'Agente',
}

export const WA_PRESENCE_LABELS: Record<WhatsAppPresenceStatus, string> = {
  AVAILABLE: 'Disponível',
  AWAY: 'Ausente',
}

export const WA_SLA_POLICY_DEFAULT = 'Padrão'
export const WA_SLA_POLICY_REMOVED = 'Política removida'
export const WA_SLA_TEAM_REMOVED = 'Equipe removida'

/* --------------------------------- helpers --------------------------------- */

const MINUTE_MS = 60_000

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

/** Whole minutes between two instants; `null` without both or if negative. */
function minutesBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null
  const delta = to.getTime() - from.getTime()
  return delta < 0 ? null : Math.round(delta / MINUTE_MS)
}

const SENTIMENT_POSITIVE_THRESHOLD = 0.2
const SENTIMENT_NEGATIVE_THRESHOLD = -0.2

/**
 * Sentiment band of an average score. Same thresholds the widget engine
 * uses for `whatsapp-conversations` (`sentimentLabelFor` in
 * `app/_components/crm/dashboard/widget-data.ts`).
 */
export function waSentimentBandLabel(
  score: number | null,
): WaSentimentBandLabel {
  if (score === null) return 'Sem classificação'
  if (score >= SENTIMENT_POSITIVE_THRESHOLD) return 'Positivo'
  if (score <= SENTIMENT_NEGATIVE_THRESHOLD) return 'Negativo'
  return 'Neutro'
}

/* ------------------------------- attendances ------------------------------- */

function toAttendanceRow(
  conversation: WaDashboardAttendance,
): WaAttendanceDashboardRow {
  const isOpen = conversation.status !== 'CLOSED'
  const unanswered =
    conversation.firstInboundAt !== null &&
    conversation.firstResponseAt === null
  return {
    id: conversation.id,
    status: WA_CONVERSATION_STATUS_LABELS[conversation.status],
    isOpen,
    connection: conversation.connection.label,
    provider: WA_PROVIDER_LABELS[conversation.connection.provider],
    team: conversation.team?.name ?? null,
    attendant: conversation.assignedUser?.name ?? null,
    isUnassigned: conversation.assignedUserId === null,
    aiCampaign: conversation.aiCampaign?.name ?? null,
    aiActive: conversation.aiActive,
    aiHandoff: conversation.aiHandoff,
    unreadCount: conversation.unreadCount,
    isWaiting:
      isOpen &&
      !conversation.aiActive &&
      (unanswered || conversation.unreadCount > 0),
    firstResponseMinutes: minutesBetween(
      conversation.firstInboundAt,
      conversation.firstResponseAt,
    ),
    durationMinutes: isOpen
      ? null
      : minutesBetween(conversation.createdAt, conversation.closedAt),
    outcome: conversation.closeOutcome
      ? WA_CLOSE_OUTCOME_LABELS[conversation.closeOutcome]
      : null,
    closeStatus: conversation.closeStatusLabels,
    closeReason: conversation.closeReason,
    sentimentScore: conversation.avgSentimentScore,
    sentimentLabel: waSentimentBandLabel(conversation.avgSentimentScore),
    archived: conversation.archivedAt !== null,
    createdAt: conversation.createdAt.toISOString(),
    lastMessageAt: iso(conversation.lastMessageAt),
    lastInboundAt: iso(conversation.lastInboundAt),
    closedAt: iso(conversation.closedAt),
  }
}

/** One row per conversation, in the order the repository answered. */
export function toWaAttendanceRows(
  conversations: WaDashboardAttendance[],
): WaAttendanceDashboardRow[] {
  return conversations.map(toAttendanceRow)
}

/* ---------------------------------- events --------------------------------- */

function eventReason(event: WaDashboardEvent): string | null {
  const policy = EVENT_REASON_POLICY[event.kind]
  const reason = event.reason?.trim()
  if (!reason || policy === 'drop') return null
  if (policy === 'keep') return reason
  return reason.split(':')[0].trim() || null
}

function toEventRow(event: WaDashboardEvent): WaConversationEventDashboardRow {
  return {
    id: event.id,
    kind: WA_EVENT_KIND_LABELS[event.kind],
    source: WA_EVENT_SOURCE_LABELS[event.source],
    actor: event.actorUser?.name ?? null,
    reason: eventReason(event),
    outcome: event.closeOutcome
      ? WA_CLOSE_OUTCOME_LABELS[event.closeOutcome]
      : null,
    closeStatus: event.closeStatusLabels,
    team: event.conversation.team?.name ?? null,
    attendant: event.conversation.assignedUser?.name ?? null,
    aiCampaign: event.conversation.aiCampaign?.name ?? null,
    connection: event.conversation.connection.label,
    createdAt: event.createdAt.toISOString(),
  }
}

/** One row per event, in the order the repository answered. */
export function toWaConversationEventRows(
  events: WaDashboardEvent[],
): WaConversationEventDashboardRow[] {
  return events.map(toEventRow)
}

/* -------------------------------- SLA cycles ------------------------------- */

/**
 * State of the first-response target, with the rule of the SLA report
 * (`src/lib/whatsapp/sla-report.ts`): answered at or before the deadline
 * is met; closed before the deadline without an answer is not evaluated.
 */
function firstResponseState(
  cycle: WaDashboardSlaCycle,
  now: Date,
): WaSlaStateLabel {
  if (cycle.firstResponseAt) {
    return cycle.firstResponseAt <= cycle.firstResponseDueAt
      ? 'Cumprido'
      : 'Estourado'
  }
  if (cycle.resolvedAt) {
    return cycle.resolvedAt < cycle.firstResponseDueAt
      ? 'Não avaliado'
      : 'Estourado'
  }
  if (cycle.firstResponseDueAt <= now) return 'Estourado'
  return cycle.firstResponseWarnAt <= now ? 'Em risco' : 'No prazo'
}

function resolutionState(
  cycle: WaDashboardSlaCycle,
  now: Date,
): WaSlaStateLabel {
  if (!cycle.resolutionDueAt) return 'Sem meta'
  if (cycle.resolvedAt) {
    return cycle.resolvedAt <= cycle.resolutionDueAt ? 'Cumprido' : 'Estourado'
  }
  if (cycle.resolutionDueAt <= now) return 'Estourado'
  return cycle.resolutionWarnAt && cycle.resolutionWarnAt <= now
    ? 'Em risco'
    : 'No prazo'
}

function metPct(state: WaSlaStateLabel): number | null {
  if (state === 'Cumprido') return 100
  return state === 'Estourado' ? 0 : null
}

interface SlaIndexes {
  /** Policy id → team id of the policy (`null` = workspace default). */
  policyTeam: Map<string, string | null>
  teamName: Map<string, string>
  agentName: Map<string, string>
}

function policyLabel(cycle: WaDashboardSlaCycle, indexes: SlaIndexes): string {
  if (!cycle.policyId || !indexes.policyTeam.has(cycle.policyId)) {
    return WA_SLA_POLICY_REMOVED
  }
  const teamId = indexes.policyTeam.get(cycle.policyId)
  if (!teamId) return WA_SLA_POLICY_DEFAULT
  return `Equipe ${indexes.teamName.get(teamId) ?? 'removida'}`
}

function toSlaCycleRow(
  cycle: WaDashboardSlaCycle,
  indexes: SlaIndexes,
  now: Date,
): WaSlaCycleDashboardRow {
  const isOpen = cycle.resolvedAt === null
  const first = firstResponseState(cycle, now)
  const resolution = resolutionState(cycle, now)
  const slaBreached = first === 'Estourado' || resolution === 'Estourado'
  let team: string | null = null
  if (cycle.teamId) {
    team = indexes.teamName.get(cycle.teamId) ?? WA_SLA_TEAM_REMOVED
  }
  return {
    id: cycle.id,
    policy: policyLabel(cycle, indexes),
    team,
    attendant: cycle.agentUserId
      ? (indexes.agentName.get(cycle.agentUserId) ?? null)
      : null,
    connection: cycle.conversation.connection.label,
    aiCampaign: cycle.conversation.aiCampaign?.name ?? null,
    isOpen,
    businessHoursOnly: cycle.businessHoursOnly,
    firstResponseState: first,
    resolutionState: resolution,
    firstResponseBreached: first === 'Estourado',
    resolutionBreached: resolution === 'Estourado',
    slaBreached,
    slaAtRisk:
      isOpen &&
      !slaBreached &&
      (first === 'Em risco' || resolution === 'Em risco'),
    firstResponseMetPct: metPct(first),
    resolutionMetPct: metPct(resolution),
    firstResponseTargetMinutes: cycle.firstResponseMinutes,
    resolutionTargetMinutes: cycle.resolutionMinutes,
    firstResponseMinutes:
      cycle.firstResponseSeconds !== null
        ? Math.round(cycle.firstResponseSeconds / 60)
        : minutesBetween(cycle.startedAt, cycle.firstResponseAt),
    resolutionMinutes: minutesBetween(cycle.startedAt, cycle.resolvedAt),
    startedAt: cycle.startedAt.toISOString(),
    firstResponseDueAt: cycle.firstResponseDueAt.toISOString(),
    firstResponseAt: iso(cycle.firstResponseAt),
    resolutionDueAt: iso(cycle.resolutionDueAt),
    resolvedAt: iso(cycle.resolvedAt),
    createdAt: cycle.createdAt.toISOString(),
  }
}

/** One row per SLA cycle, in the order the repository answered. */
export function toWaSlaCycleRows(
  data: WaSlaCycleData,
  now: Date,
): WaSlaCycleDashboardRow[] {
  const indexes: SlaIndexes = {
    policyTeam: new Map(data.policies.map((p) => [p.id, p.teamId])),
    teamName: new Map(data.teams.map((team) => [team.id, team.name])),
    agentName: new Map(data.agents.map((agent) => [agent.id, agent.name])),
  }
  return data.cycles.map((cycle) => toSlaCycleRow(cycle, indexes, now))
}

/* ------------------------------- team members ------------------------------ */

/**
 * One row per team membership, in the order the repository answered. A
 * member without a presence row never touched the toggle: available.
 */
export function toWaTeamMemberRows(
  data: WaTeamMemberData,
): WaTeamMemberDashboardRow[] {
  const presenceByUser = new Map(
    data.presences.map((presence) => [presence.userId, presence]),
  )
  const openByMember = new Map(
    data.openCounts.map((row) => [`${row.teamId}:${row.userId}`, row.count]),
  )
  return data.members.map((member) => {
    const presence = presenceByUser.get(member.userId)
    const status = presence?.status ?? 'AVAILABLE'
    return {
      id: member.id,
      team: member.team.name,
      attendant: member.user.name,
      role: WA_TEAM_ROLE_LABELS[member.role],
      presence: WA_PRESENCE_LABELS[status],
      isOnline: status === 'AVAILABLE',
      openConversations:
        openByMember.get(`${member.teamId}:${member.userId}`) ?? 0,
      lastAssignedAt: iso(presence?.lastAssignedAt ?? null),
      presenceChangedAt: iso(presence?.updatedAt ?? null),
      createdAt: member.createdAt.toISOString(),
    }
  })
}
