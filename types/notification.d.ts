import type { AiPendingActionDTO } from './steel-ai'

export type NotificationKindDTO =
  | 'WHATSAPP_NEGATIVE_SENTIMENT'
  | 'SD_TICKET_ASSIGNED'
  | 'SD_TICKET_MESSAGE'
  | 'SD_SLA_AT_RISK'
  | 'SD_SLA_BREACHED'
  | 'SD_TICKET_ESCALATED'
  | 'SD_APPROVAL_RESPONDED'
  | 'SD_TICKET_CREATED'
  | 'SD_TICKET_MENTIONED'
  | 'SD_TICKET_PHASE_CHANGED'
  | 'SD_TICKET_RESOLVED'
  | 'SD_TICKET_REOPENED'
  | 'SD_APPROVAL_REQUESTED'
  | 'SD_TASK_ASSIGNED'
  | 'SD_TICKET_CSAT'
  | 'SD_DIGEST'
  | 'SD_SLA_BREACH_PREDICTED'
  | 'SD_PROBLEM_SUGGESTED'
  | 'SD_KB_REVIEW'
  | 'SD_REPORT_READY'
  | 'CRM_LEAD_ASSIGNED'
  | 'CRM_OPPORTUNITY_ASSIGNED'
  | 'CRM_DEAL_CLOSED'
  | 'CRM_TASK_ASSIGNED'
  | 'CRM_TASK_DUE'
  | 'CRM_PROPOSAL_VIEWED'
  | 'CRM_PROPOSAL_ACCEPTED'
  | 'CRM_APOLLO_IMPORT_DONE'
  | 'CRM_PROPOSAL_EXPIRED'
  | 'CRM_FORM_SUBMITTED'
  | 'CRM_CAMPAIGN_FINISHED'
  | 'CRM_WORKFLOW_FAILED'
  | 'CRM_WORKFLOW_WAITING'
  | 'CRM_SOCIAL_POST_FAILED'
  | 'CRM_COMPETITOR_SYNC_FAILED'
  | 'MEMBER_JOINED'
  | 'DATA_EXPORT_READY'
  | 'TRIAL_ENDED'
  | 'BILLING_PAYMENT_FAILED'
  | 'BILLING_SUBSCRIPTION_CANCELED'
  | 'AI_QUOTA_WARNING'
  | 'AI_QUOTA_EXCEEDED'
  | 'SD_APPROVAL_CANCELED'
  | 'SD_APPROVAL_EXPIRED'
  | 'SD_TASK_DUE'
  | 'SD_ONCALL_SHIFT'
  | 'SD_CONTRACT_FRANCHISE'
  | 'SD_KB_COMMENT'
  | 'SD_MONITOR_ALERT'
  | 'WHATSAPP_CONVERSATION_ASSIGNED'
  | 'WHATSAPP_AI_HANDOFF'
  | 'WHATSAPP_CONNECTION_LOST'
  | 'WHATSAPP_BROADCAST_FINISHED'
  | 'WHATSAPP_TEMPLATE_REJECTED'
  | 'WHATSAPP_TEMPLATE_QUALITY'
  | 'WHATSAPP_USAGE_WARNING'
  | 'WHATSAPP_USAGE_LIMIT_REACHED'
  | 'WHATSAPP_CONVERSATION_UNATTENDED'
  | 'WHATSAPP_SLA_AT_RISK'
  | 'WHATSAPP_SLA_BREACHED'
  | 'WHATSAPP_COST_BUDGET_WARNING'
  | 'WHATSAPP_COST_BUDGET_REACHED'
  | 'AGENT_APPROVAL_REQUESTED'
  | 'AGENT_RUN_FAILED'
  | 'AI_ACTION_EXPIRING'
  | 'WEBHOOK_ENDPOINT_DISABLED'
  | 'AI_DAILY_DIGEST'
  | 'CRM_SENDING_DOMAIN_VERIFIED'
  | 'CRM_SENDING_DOMAIN_FAILED'
  | 'CRM_NEWSLETTER_ISSUE_FINISHED'
  | 'CRM_NEWSLETTER_USAGE_WARNING'
  | 'CRM_NEWSLETTER_USAGE_LIMIT_REACHED'

export type NotificationModuleDTO =
  | 'SERVICE_DESK'
  | 'COMMUNICATION'
  | 'CRM'
  | 'OTHER'

export interface NotificationDTO {
  id: string
  workspaceId: string
  kind: NotificationKindDTO
  title: string
  body: string
  href: string | null
  read: boolean
  /** ISO 8601, ou `null` quando não lida. */
  readAt: string | null
  archived: boolean
  /** ISO 8601, ou `null` quando não arquivada. */
  archivedAt: string | null
  /**
   * ISO 8601 do adiamento, ou `null`. No futuro = escondida (pasta
   * "Adiadas"); no passado = já voltou para a caixa de entrada.
   */
  snoozedUntil: string | null
  /** Módulo de origem, derivado do `kind` (`src/lib/notification-kind.ts`). */
  module: NotificationModuleDTO
  /** Nome do módulo em pt-BR — o "remetente" da linha. */
  moduleLabel: string
  /** O que aconteceu, em pt-BR (ex.: "SLA em risco"). */
  kindLabel: string
  /** Chave de ícone resolvida pela interface. */
  icon: string
  /** Cor base Tailwind do marcador (ex.: `amber`). */
  color: string
  createdAt: string
}

/** Contagem por pasta, para os marcadores das abas. */
export interface NotificationFolderCountsDTO {
  all: number
  unread: number
  archived: number
  /** Adiadas que ainda não voltaram. */
  snoozed: number
}

export interface NotificationListDTO {
  items: NotificationDTO[]
  unreadCount: number
  /** Id para a próxima página, ou `null` no fim da lista. */
  nextCursor: string | null
  counts: NotificationFolderCountsDTO
}

/** Resultado de uma ação (individual ou em lote). */
export interface NotificationActionResultDTO {
  updated: number
}

/** Resultado do adiamento: quantas e até quando (ISO 8601). */
export interface NotificationSnoozeResultDTO {
  updated: number
  snoozedUntil: string
}

/** One row of the notification preferences screen (non-ServiceDesk kinds). */
export interface NotificationPreferenceDTO {
  kind: NotificationKindDTO
  module: NotificationModuleDTO
  /** Module name in pt-BR (group header). */
  moduleLabel: string
  /** What happened, in pt-BR. */
  label: string
  icon: string
  color: string
  /** In-app delivery on (default) or muted. */
  inApp: boolean
}

/** Delivery channels of the inbox for the user in the workspace. */
export interface NotificationDeliveryDTO {
  /** Desktop notifications for urgent kinds while the tab is hidden. */
  browserEnabled: boolean
}

/**
 * One "Pendências da IA" item of the inbox: an assistant action the user
 * must confirm (Build mode) or a Steel Agent write waiting for approval.
 */
export interface InboxAiPendingItemDTO {
  source: 'ASSISTANT' | 'AGENT'
  action: AiPendingActionDTO
  /** Where it came from, inside the workspace (prefix with `/<slug>`). */
  path: string
  conversation: { id: string; title: string | null } | null
  agent: { id: string; name: string } | null
  runId: string | null
  /** External AI client (MCP) that proposed it; null for chat and agents. */
  client: { id: string; name: string | null } | null
}

export interface InboxAiPendingListDTO {
  /** Most urgent (closest expiry) first. */
  items: InboxAiPendingItemDTO[]
  count: number
}
