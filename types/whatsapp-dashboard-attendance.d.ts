/**
 * Rows of the attendance and team sources of the Comunicação (WhatsApp)
 * dashboards (`GET /api/workspaces/[id]/whatsapp/dashboards/sources/[source]`).
 * Labels come in pt-BR (the widget engine groups/filters by text). `*Pct`
 * fields are 0 or 100 (or `null` when they do not apply): their **average**
 * is the rate. Times are in minutes. No row carries the contact's name,
 * phone or any message text, so the sources are safe for a TV.
 */

/** Positivo, Neutro, Negativo, Sem classificação. */
export type WaSentimentBandLabel =
  | 'Positivo'
  | 'Neutro'
  | 'Negativo'
  | 'Sem classificação'

/** `whatsapp-attendances`: one row per conversation (not deleted). */
export interface WaAttendanceDashboardRow {
  id: string
  /** Nova, Em atendimento, Encerrada. */
  status: string
  isOpen: boolean
  /** Label of the connection (the workspace's own number). */
  connection: string
  /** Z-API, Meta, Widget. */
  provider: string
  team: string | null
  attendant: string | null
  /** Open or closed without an assignee. */
  isUnassigned: boolean
  aiCampaign: string | null
  /** The AI is answering the conversation. */
  aiActive: boolean
  /** The AI handed the conversation to a human attendant. */
  aiHandoff: boolean
  unreadCount: number
  /**
   * The contact is waiting for a person: the conversation is open, the AI
   * is not answering it and either (a) the contact wrote in the current
   * attendance and no person answered yet (`firstInboundAt` set and
   * `firstResponseAt` empty — both only exist while an SLA policy is on) or
   * (b) there are messages nobody read (`unreadCount > 0`). `queuedAt` is
   * not part of the rule: it only marks a streak without an assignee.
   */
  isWaiting: boolean
  /**
   * Minutes from the first message of the contact to the first human
   * answer in the current attendance. `null` without both marks (they are
   * only written while an SLA policy is on).
   */
  firstResponseMinutes: number | null
  /** Minutes from the creation to the close; `null` while open. */
  durationMinutes: number | null
  /**
   * Minutes since the conversation was created, while it is open (the age
   * of the open conversation); `null` once closed.
   */
  openMinutes: number | null
  /**
   * Minutes the contact has been waiting for a person right now: since the
   * contact's last message, only while `isWaiting`; otherwise `null`.
   */
  waitingMinutes: number | null
  /**
   * Average minutes between each message of the contact (the first of a
   * sequence) and the next human answer, over the whole conversation.
   * `null` when no contact message was answered by a person yet.
   */
  avgResponseMinutes: number | null
  /** Deu certo, Não deu; `null` without a close classification. */
  outcome: string | null
  /** Close statuses picked by the attendant (tabulação). */
  closeStatus: string[]
  /** Reason typed by the attendant when closing. */
  closeReason: string | null
  /** Average sentiment of the contact's messages, from -1 to 1. */
  sentimentScore: number | null
  sentimentLabel: WaSentimentBandLabel
  archived: boolean
  createdAt: string
  lastMessageAt: string | null
  lastInboundAt: string | null
  closedAt: string | null
}

/** `whatsapp-conversation-events`: one row per timeline event. */
export interface WaConversationEventDashboardRow {
  id: string
  /** Conversa fechada, Conversa reaberta, Atribuição, Ação da IA… */
  kind: string
  /** Atendente, Contato, Inatividade, Campanha de IA, SLA… */
  source: string
  /** Workspace user who caused the event; `null` for automatic ones. */
  actor: string | null
  /**
   * Detail of the event, only for the kinds whose reason is structured or
   * typed by the staff (close, reopen, button label, assignee, team, SLA
   * target, chatbot destination, AI unavailable). For an AI action, only
   * the action label. `null` for the kinds whose reason is free text about
   * the conversation (transfer summary, guardrail note, Pix description,
   * sentiment alert).
   */
  reason: string | null
  /** Deu certo, Não deu; only on a classified close. */
  outcome: string | null
  closeStatus: string[]
  /** Current team, attendant, campaign and number of the conversation. */
  team: string | null
  attendant: string | null
  aiCampaign: string | null
  connection: string
  createdAt: string
}

/**
 * State of an SLA target (ADR 0048). `Cumprido`/`Estourado` once it was
 * evaluated; `No prazo`/`Em risco` while it runs; `Não avaliado` when the
 * attendance closed before the deadline without an answer; `Sem meta` when
 * the policy does not track the resolution.
 */
export type WaSlaStateLabel =
  | 'No prazo'
  | 'Em risco'
  | 'Estourado'
  | 'Cumprido'
  | 'Não avaliado'
  | 'Sem meta'

/** `whatsapp-sla-cycles`: one row per SLA cycle (one attendance). */
export interface WaSlaCycleDashboardRow {
  id: string
  /**
   * Policy copied to the cycle: `Padrão` (workspace default),
   * `Equipe <name>` (team exception) or `Política removida`.
   */
  policy: string
  /** Team of the first message (snapshot); `Equipe removida` when gone. */
  team: string | null
  /** Who owned the attendance at the last milestone (snapshot). */
  attendant: string | null
  connection: string
  aiCampaign: string | null
  /** The attendance is still running (not resolved). */
  isOpen: boolean
  /** The clock only ran inside the business hours. */
  businessHoursOnly: boolean
  firstResponseState: WaSlaStateLabel
  resolutionState: WaSlaStateLabel
  firstResponseBreached: boolean
  resolutionBreached: boolean
  /** Any target breached. */
  slaBreached: boolean
  /** Open, some target at risk and none breached. */
  slaAtRisk: boolean
  /** 100 = answered in time, 0 = breached; `null` when not evaluated. */
  firstResponseMetPct: number | null
  /** 100 = resolved in time, 0 = breached; `null` when not evaluated. */
  resolutionMetPct: number | null
  /** Target of the policy, in minutes. */
  firstResponseTargetMinutes: number
  resolutionTargetMinutes: number | null
  /**
   * Minutes counted until the first response (business time when the
   * cycle is business-hours-only); `null` while unanswered.
   */
  firstResponseMinutes: number | null
  /** Elapsed minutes from the start to the close; `null` while open. */
  resolutionMinutes: number | null
  startedAt: string
  firstResponseDueAt: string
  firstResponseAt: string | null
  resolutionDueAt: string | null
  resolvedAt: string | null
  createdAt: string
}

/** `whatsapp-team-members`: one row per team membership (current state). */
export interface WaTeamMemberDashboardRow {
  id: string
  team: string
  attendant: string
  /** Líder, Agente. */
  role: string
  /** Disponível, Ausente (the attendant's own toggle). */
  presence: string
  /** The attendant is available to receive conversations. */
  isOnline: boolean
  /** Open conversations of this team assigned to this attendant. */
  openConversations: number
  /** Last conversation received from the automatic distribution. */
  lastAssignedAt: string | null
  /** Last time the attendant changed the presence toggle. */
  presenceChangedAt: string | null
  /** When the attendant joined the team. */
  createdAt: string
}
