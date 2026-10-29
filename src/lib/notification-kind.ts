/**
 * Metadados de um tipo de notificação (`Notification.kind`): a que módulo
 * pertence, como se chama em pt-BR, que ícone e cor usar. Parte **pura** —
 * sem React, sem Prisma, sem I/O — para que o mapper, o service (filtro por
 * módulo) e a interface leiam a mesma tabela em vez de espalharem `switch`.
 *
 * Tipo novo entra em `NOTIFICATION_KINDS` (abaixo). Tipo desconhecido (de uma
 * versão mais nova do servidor, por exemplo) não quebra nada: o módulo é
 * inferido pelo prefixo (`SD_`, `WHATSAPP_`, `CRM_`) e o rótulo cai no nome
 * cru. É por isso que a função aceita `string`.
 */

/** Módulo que originou a notificação. `OTHER` = plataforma/base. */
export const NOTIFICATION_MODULES = [
  'SERVICE_DESK',
  'COMMUNICATION',
  'CRM',
  'OTHER',
] as const

export type NotificationModule = (typeof NOTIFICATION_MODULES)[number]

/**
 * Chave de ícone. Fica como string (e não como componente) para a lib
 * continuar pura: a interface resolve a chave num único mapa
 * (`app/_components/notifications/notification-kind-icon.tsx`).
 */
export const NOTIFICATION_ICONS = [
  'ticket',
  'ticket-check',
  'ticket-alert',
  'message',
  'mention',
  'alarm',
  'escalate',
  'approval',
  'task',
  'digest',
  'forecast',
  'problem',
  'article',
  'report',
  'star',
  'chat',
  'deal',
  'bell',
  'assign',
  'proposal',
  'form',
  'mail',
  'workflow',
  'hourglass',
  'social',
  'competitor',
  'member',
  'download',
  'billing',
  'sparkles',
  'approval-off',
  'oncall',
  'contract',
  'comment',
  'monitor',
  'handoff',
  'disconnected',
  'broadcast',
  'template',
  'agent',
] as const

export type NotificationIcon = (typeof NOTIFICATION_ICONS)[number]

export interface NotificationKindInfo {
  kind: string
  module: NotificationModule
  /** Nome do módulo em pt-BR (o "remetente" da linha). */
  moduleLabel: string
  /** O que aconteceu, em pt-BR (o "assunto técnico" da linha). */
  label: string
  icon: NotificationIcon
  /**
   * Cor base Tailwind do marcador. A interface monta
   * `bg-<c>-500/10 text-<c>-700 dark:text-<c>-300`, que é o padrão do repo e
   * funciona igual no claro e no escuro.
   */
  color: string
}

export const NOTIFICATION_MODULE_LABELS: Record<NotificationModule, string> = {
  SERVICE_DESK: 'ServiceDesk',
  COMMUNICATION: 'Comunicação',
  CRM: 'CRM',
  OTHER: 'Plataforma',
}

type KindEntry = Omit<NotificationKindInfo, 'kind' | 'moduleLabel'>

/**
 * Catálogo dos tipos conhecidos. Os do ServiceDesk espelham
 * `src/config/servicedesk-notifications.ts` (`SdNotificationEventSpec.kind`),
 * mas aqui o recorte é o que o usuário lê na caixa de entrada.
 */
const NOTIFICATION_KINDS: Record<string, KindEntry> = {
  WHATSAPP_NEGATIVE_SENTIMENT: {
    module: 'COMMUNICATION',
    label: 'Sentimento negativo',
    icon: 'chat',
    color: 'rose',
  },
  SD_TICKET_CREATED: {
    module: 'SERVICE_DESK',
    label: 'Chamado aberto',
    icon: 'ticket',
    color: 'sky',
  },
  SD_TICKET_ASSIGNED: {
    module: 'SERVICE_DESK',
    label: 'Chamado atribuído',
    icon: 'ticket',
    color: 'sky',
  },
  SD_TICKET_MESSAGE: {
    module: 'SERVICE_DESK',
    label: 'Nova mensagem',
    icon: 'message',
    color: 'indigo',
  },
  SD_TICKET_MENTIONED: {
    module: 'SERVICE_DESK',
    label: 'Menção',
    icon: 'mention',
    color: 'violet',
  },
  SD_TICKET_PHASE_CHANGED: {
    module: 'SERVICE_DESK',
    label: 'Mudança de fase',
    icon: 'ticket',
    color: 'blue',
  },
  SD_TICKET_RESOLVED: {
    module: 'SERVICE_DESK',
    label: 'Chamado resolvido',
    icon: 'ticket-check',
    color: 'emerald',
  },
  SD_TICKET_REOPENED: {
    module: 'SERVICE_DESK',
    label: 'Chamado reaberto',
    icon: 'ticket-alert',
    color: 'amber',
  },
  SD_SLA_AT_RISK: {
    module: 'SERVICE_DESK',
    label: 'SLA em risco',
    icon: 'alarm',
    color: 'amber',
  },
  SD_SLA_BREACHED: {
    module: 'SERVICE_DESK',
    label: 'SLA violado',
    icon: 'alarm',
    color: 'rose',
  },
  SD_TICKET_ESCALATED: {
    module: 'SERVICE_DESK',
    label: 'Escalonamento',
    icon: 'escalate',
    color: 'orange',
  },
  SD_APPROVAL_REQUESTED: {
    module: 'SERVICE_DESK',
    label: 'Aprovação solicitada',
    icon: 'approval',
    color: 'violet',
  },
  SD_APPROVAL_RESPONDED: {
    module: 'SERVICE_DESK',
    label: 'Aprovação respondida',
    icon: 'approval',
    color: 'emerald',
  },
  SD_TASK_ASSIGNED: {
    module: 'SERVICE_DESK',
    label: 'Tarefa atribuída',
    icon: 'task',
    color: 'teal',
  },
  SD_TICKET_CSAT: {
    module: 'SERVICE_DESK',
    label: 'Avaliação recebida',
    icon: 'star',
    color: 'yellow',
  },
  SD_DIGEST: {
    module: 'SERVICE_DESK',
    label: 'Resumo diário',
    icon: 'digest',
    color: 'slate',
  },
  SD_SLA_BREACH_PREDICTED: {
    module: 'SERVICE_DESK',
    label: 'Risco de violar o SLA',
    icon: 'forecast',
    color: 'amber',
  },
  SD_PROBLEM_SUGGESTED: {
    module: 'SERVICE_DESK',
    label: 'Incidentes repetidos',
    icon: 'problem',
    color: 'orange',
  },
  SD_KB_REVIEW: {
    module: 'SERVICE_DESK',
    label: 'Revisão de artigo',
    icon: 'article',
    color: 'indigo',
  },
  SD_REPORT_READY: {
    module: 'SERVICE_DESK',
    label: 'Relatório pronto',
    icon: 'report',
    color: 'sky',
  },
  CRM_LEAD_ASSIGNED: {
    module: 'CRM',
    label: 'Lead atribuído',
    icon: 'assign',
    color: 'violet',
  },
  CRM_OPPORTUNITY_ASSIGNED: {
    module: 'CRM',
    label: 'Oportunidade atribuída',
    icon: 'assign',
    color: 'violet',
  },
  CRM_DEAL_CLOSED: {
    module: 'CRM',
    label: 'Negócio fechado',
    icon: 'deal',
    color: 'emerald',
  },
  CRM_TASK_ASSIGNED: {
    module: 'CRM',
    label: 'Tarefa atribuída',
    icon: 'task',
    color: 'teal',
  },
  CRM_TASK_DUE: {
    module: 'CRM',
    label: 'Tarefa vencendo',
    icon: 'alarm',
    color: 'amber',
  },
  CRM_PROPOSAL_VIEWED: {
    module: 'CRM',
    label: 'Proposta visualizada',
    icon: 'proposal',
    color: 'sky',
  },
  CRM_APOLLO_IMPORT_DONE: {
    module: 'CRM',
    label: 'Importação da Apollo concluída',
    icon: 'assign',
    color: 'violet',
  },
  CRM_PROPOSAL_ACCEPTED: {
    module: 'CRM',
    label: 'Proposta aceita',
    icon: 'proposal',
    color: 'emerald',
  },
  CRM_PROPOSAL_EXPIRED: {
    module: 'CRM',
    label: 'Proposta expirada',
    icon: 'proposal',
    color: 'amber',
  },
  CRM_FORM_SUBMITTED: {
    module: 'CRM',
    label: 'Formulário respondido',
    icon: 'form',
    color: 'indigo',
  },
  CRM_CAMPAIGN_FINISHED: {
    module: 'CRM',
    label: 'Campanha concluída',
    icon: 'mail',
    color: 'sky',
  },
  CRM_WORKFLOW_FAILED: {
    module: 'CRM',
    label: 'Falha no workflow',
    icon: 'workflow',
    color: 'rose',
  },
  CRM_WORKFLOW_WAITING: {
    module: 'CRM',
    label: 'Workflow aguardando ação',
    icon: 'hourglass',
    color: 'amber',
  },
  CRM_SOCIAL_POST_FAILED: {
    module: 'CRM',
    label: 'Falha na publicação',
    icon: 'social',
    color: 'rose',
  },
  CRM_COMPETITOR_SYNC_FAILED: {
    module: 'CRM',
    label: 'Falha ao sincronizar concorrentes',
    icon: 'competitor',
    color: 'orange',
  },
  CRM_NEWSLETTER_ISSUE_FINISHED: {
    module: 'CRM',
    label: 'Edição da newsletter enviada',
    icon: 'mail',
    color: 'sky',
  },
  CRM_NEWSLETTER_USAGE_WARNING: {
    module: 'CRM',
    label: 'Limite mensal da newsletter em 50% / 80%',
    icon: 'hourglass',
    color: 'amber',
  },
  CRM_NEWSLETTER_USAGE_LIMIT_REACHED: {
    module: 'CRM',
    label: 'Limite mensal da newsletter atingido',
    icon: 'hourglass',
    color: 'rose',
  },
  CRM_NEWSLETTER_REENGAGEMENT_SUMMARY: {
    module: 'CRM',
    label: 'Resumo do reengajamento da newsletter',
    icon: 'mail',
    color: 'sky',
  },
  CRM_NEWSLETTER_DIGEST_READY: {
    module: 'CRM',
    label: 'Resumo automático da newsletter pronto para revisar',
    icon: 'mail',
    color: 'violet',
  },
  CRM_NEWSLETTER_DIGEST_SKIPPED: {
    module: 'CRM',
    label: 'Resumo automático da newsletter não enviado',
    icon: 'mail',
    color: 'amber',
  },
  MEMBER_JOINED: {
    module: 'OTHER',
    label: 'Novo membro',
    icon: 'member',
    color: 'emerald',
  },
  DATA_EXPORT_READY: {
    module: 'OTHER',
    label: 'Exportação pronta',
    icon: 'download',
    color: 'sky',
  },
  TRIAL_ENDED: {
    module: 'OTHER',
    label: 'Período de teste encerrado',
    icon: 'billing',
    color: 'amber',
  },
  BILLING_PAYMENT_FAILED: {
    module: 'OTHER',
    label: 'Falha no pagamento',
    icon: 'billing',
    color: 'rose',
  },
  BILLING_SUBSCRIPTION_CANCELED: {
    module: 'OTHER',
    label: 'Assinatura cancelada',
    icon: 'billing',
    color: 'orange',
  },
  AI_QUOTA_WARNING: {
    module: 'OTHER',
    label: 'Cota de IA em 80%',
    icon: 'sparkles',
    color: 'amber',
  },
  AI_QUOTA_EXCEEDED: {
    module: 'OTHER',
    label: 'Cota de IA esgotada',
    icon: 'sparkles',
    color: 'rose',
  },
  SD_APPROVAL_CANCELED: {
    module: 'SERVICE_DESK',
    label: 'Aprovação cancelada',
    icon: 'approval-off',
    color: 'slate',
  },
  SD_APPROVAL_EXPIRED: {
    module: 'SERVICE_DESK',
    label: 'Aprovação expirada',
    icon: 'hourglass',
    color: 'amber',
  },
  SD_TASK_DUE: {
    module: 'SERVICE_DESK',
    label: 'Prazo de tarefa',
    icon: 'hourglass',
    color: 'orange',
  },
  SD_ONCALL_SHIFT: {
    module: 'SERVICE_DESK',
    label: 'Plantão',
    icon: 'oncall',
    color: 'indigo',
  },
  SD_CONTRACT_FRANCHISE: {
    module: 'SERVICE_DESK',
    label: 'Franquia do contrato',
    icon: 'contract',
    color: 'amber',
  },
  SD_KB_COMMENT: {
    module: 'SERVICE_DESK',
    label: 'Comentário em artigo',
    icon: 'comment',
    color: 'indigo',
  },
  SD_MONITOR_ALERT: {
    module: 'SERVICE_DESK',
    label: 'Alerta do monitoramento',
    icon: 'monitor',
    color: 'rose',
  },
  WHATSAPP_CONVERSATION_ASSIGNED: {
    module: 'COMMUNICATION',
    label: 'Conversa atribuída',
    icon: 'assign',
    color: 'emerald',
  },
  WHATSAPP_AI_HANDOFF: {
    module: 'COMMUNICATION',
    label: 'IA transferiu a conversa',
    icon: 'handoff',
    color: 'violet',
  },
  WHATSAPP_CONVERSATION_UNATTENDED: {
    module: 'COMMUNICATION',
    label: 'Conversa sem atendente',
    icon: 'hourglass',
    color: 'amber',
  },
  WHATSAPP_CONNECTION_LOST: {
    module: 'COMMUNICATION',
    label: 'Conexão perdida',
    icon: 'disconnected',
    color: 'rose',
  },
  WHATSAPP_BROADCAST_FINISHED: {
    module: 'COMMUNICATION',
    label: 'Transmissão finalizada',
    icon: 'broadcast',
    color: 'teal',
  },
  WHATSAPP_TEMPLATE_REJECTED: {
    module: 'COMMUNICATION',
    label: 'Template reprovado',
    icon: 'template',
    color: 'rose',
  },
  WHATSAPP_TEMPLATE_QUALITY: {
    module: 'COMMUNICATION',
    label: 'Qualidade do template em risco',
    icon: 'template',
    color: 'amber',
  },
  WHATSAPP_USAGE_WARNING: {
    module: 'COMMUNICATION',
    label: 'Limite mensal do WhatsApp em 50% / 80%',
    icon: 'hourglass',
    color: 'amber',
  },
  WHATSAPP_USAGE_LIMIT_REACHED: {
    module: 'COMMUNICATION',
    label: 'Limite mensal do WhatsApp atingido',
    icon: 'hourglass',
    color: 'rose',
  },
  WHATSAPP_SLA_AT_RISK: {
    module: 'COMMUNICATION',
    label: 'SLA do WhatsApp em risco',
    icon: 'alarm',
    color: 'amber',
  },
  WHATSAPP_SLA_BREACHED: {
    module: 'COMMUNICATION',
    label: 'SLA do WhatsApp estourado',
    icon: 'alarm',
    color: 'rose',
  },
  WHATSAPP_COST_BUDGET_WARNING: {
    module: 'COMMUNICATION',
    label: 'Custo do WhatsApp em 80% do orçamento',
    icon: 'hourglass',
    color: 'amber',
  },
  WHATSAPP_COST_BUDGET_REACHED: {
    module: 'COMMUNICATION',
    label: 'Orçamento de custo do WhatsApp atingido',
    icon: 'hourglass',
    color: 'rose',
  },
  AGENT_APPROVAL_REQUESTED: {
    module: 'OTHER',
    label: 'Agente aguardando aprovação',
    icon: 'agent',
    color: 'violet',
  },
  AGENT_RUN_FAILED: {
    module: 'OTHER',
    label: 'Falha na execução do agente',
    icon: 'agent',
    color: 'rose',
  },
  AI_ACTION_EXPIRING: {
    module: 'OTHER',
    label: 'Ação da IA expirando',
    icon: 'sparkles',
    color: 'amber',
  },
  WEBHOOK_ENDPOINT_DISABLED: {
    module: 'OTHER',
    label: 'Webhook desativado por falhas',
    icon: 'disconnected',
    color: 'rose',
  },
  AI_DAILY_DIGEST: {
    module: 'OTHER',
    label: 'Resumo diário da IA',
    icon: 'digest',
    color: 'violet',
  },
  CRM_SENDING_DOMAIN_VERIFIED: {
    module: 'CRM',
    label: 'Domínio de e-mail verificado',
    icon: 'mail',
    color: 'emerald',
  },
  CRM_SENDING_DOMAIN_FAILED: {
    module: 'CRM',
    label: 'Domínio de e-mail com falha',
    icon: 'mail',
    color: 'rose',
  },
}

const MODULE_BY_PREFIX: [string, NotificationModule][] = [
  ['SD_', 'SERVICE_DESK'],
  ['WHATSAPP_', 'COMMUNICATION'],
  ['CRM_', 'CRM'],
]

const ICON_BY_MODULE: Record<NotificationModule, NotificationIcon> = {
  SERVICE_DESK: 'ticket',
  COMMUNICATION: 'chat',
  CRM: 'deal',
  OTHER: 'bell',
}

const COLOR_BY_MODULE: Record<NotificationModule, string> = {
  SERVICE_DESK: 'sky',
  COMMUNICATION: 'emerald',
  CRM: 'violet',
  OTHER: 'slate',
}

/** Módulo de um tipo, pela tabela ou pelo prefixo. */
export function notificationModuleOf(kind: string): NotificationModule {
  const known = NOTIFICATION_KINDS[kind]
  if (known) return known.module
  for (const [prefix, module] of MODULE_BY_PREFIX) {
    if (kind.startsWith(prefix)) return module
  }
  return 'OTHER'
}

/**
 * Rótulo de fallback para um tipo fora da tabela: `CRM_DEAL_WON` →
 * `Crm deal won`. Feio de propósito — avisa que falta entrada no catálogo
 * sem mostrar `undefined` para o usuário.
 */
function fallbackLabel(kind: string): string {
  const words = kind.toLowerCase().replace(/_/g, ' ').trim()
  if (words.length === 0) return 'Notificação'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Metadados de um tipo. Nunca falha. */
export function notificationKindInfo(kind: string): NotificationKindInfo {
  const known = NOTIFICATION_KINDS[kind]
  const module = known?.module ?? notificationModuleOf(kind)
  return {
    kind,
    module,
    moduleLabel: NOTIFICATION_MODULE_LABELS[module],
    label: known?.label ?? fallbackLabel(kind),
    icon: known?.icon ?? ICON_BY_MODULE[module],
    color: known?.color ?? COLOR_BY_MODULE[module],
  }
}

/** Todos os tipos conhecidos de um módulo (filtro por módulo da listagem). */
export function notificationKindsOfModule(
  module: NotificationModule,
): string[] {
  return Object.keys(NOTIFICATION_KINDS).filter(
    (kind) => NOTIFICATION_KINDS[kind].module === module,
  )
}

/** Catálogo para montar os filtros da interface, agrupado por módulo. */
export function notificationKindCatalog(): NotificationKindInfo[] {
  return Object.keys(NOTIFICATION_KINDS).map(notificationKindInfo)
}

/**
 * Chamado referenciado por um `href` de notificação
 * (`/<slug>/servicedesk/tickets/<numero>`), para o painel de leitura mostrar
 * um resumo do chamado sem a caixa de entrada conhecer o ServiceDesk. `null`
 * quando o link não é de chamado — e aí o painel degrada para o simples.
 */
export function notificationTicketRef(
  href: string | null | undefined,
): { slug: string; ticketRef: string } | null {
  if (!href) return null
  const match = /^\/([^/?#]+)\/servicedesk\/tickets\/([^/?#]+)/.exec(href)
  if (!match) return null
  return { slug: match[1], ticketRef: match[2] }
}

/**
 * Kinds with their own preference card (channels of their own), kept out of
 * the generic per-kind list so there are never two switches for one thing:
 * the daily AI digest (`AiDigestSetting`, ADR 0040).
 */
export const SELF_MANAGED_NOTIFICATION_KINDS: readonly string[] = [
  'AI_DAILY_DIGEST',
]

/**
 * Kinds a user can mute on the notification preferences screen: everything
 * outside the ServiceDesk, which has its own preference model
 * (`SdNotificationPreference`, per event and channel).
 */
export function isConfigurableNotificationKind(kind: string): boolean {
  return (
    notificationModuleOf(kind) !== 'SERVICE_DESK' &&
    !SELF_MANAGED_NOTIFICATION_KINDS.includes(kind)
  )
}

/** Catalog of the configurable kinds (preferences screen), groupable by module. */
export function configurableNotificationKinds(): NotificationKindInfo[] {
  return notificationKindCatalog().filter((info) =>
    isConfigurableNotificationKind(info.kind),
  )
}

/**
 * Inbox quick filters that are a fixed set of kinds: mentions and "assigned
 * to me" (tickets, tasks, leads, opportunities and conversations).
 */
export const NOTIFICATION_QUICK_FILTERS = {
  mentions: ['SD_TICKET_MENTIONED'],
  assigned: [
    'SD_TICKET_ASSIGNED',
    'SD_TASK_ASSIGNED',
    'CRM_LEAD_ASSIGNED',
    'CRM_OPPORTUNITY_ASSIGNED',
    'CRM_TASK_ASSIGNED',
    'WHATSAPP_CONVERSATION_ASSIGNED',
  ],
} as const satisfies Record<string, readonly string[]>

export type NotificationQuickFilter = keyof typeof NOTIFICATION_QUICK_FILTERS

export const NOTIFICATION_QUICK_FILTER_KEYS = Object.keys(
  NOTIFICATION_QUICK_FILTERS,
) as [NotificationQuickFilter, ...NotificationQuickFilter[]]

/**
 * Kinds urgent enough for a desktop (browser) notification while the tab is
 * hidden: SLA breached/at risk, approvals waiting on someone, assignments
 * and an assistant action about to expire.
 */
export const URGENT_NOTIFICATION_KINDS: readonly string[] = [
  'SD_SLA_BREACHED',
  'SD_SLA_AT_RISK',
  'SD_APPROVAL_REQUESTED',
  'AGENT_APPROVAL_REQUESTED',
  'SD_TICKET_ASSIGNED',
  'WHATSAPP_CONVERSATION_ASSIGNED',
  'AI_ACTION_EXPIRING',
  'WHATSAPP_SLA_BREACHED',
]

export function isUrgentNotificationKind(kind: string): boolean {
  return URGENT_NOTIFICATION_KINDS.includes(kind)
}

/**
 * WhatsApp conversation referenced by a notification `href`
 * (`/<slug>/zap?conversa=<id>`), so the inbox can offer "assign to me"
 * without knowing the module. `null` when the link is not a conversation.
 */
export function notificationConversationRef(
  href: string | null | undefined,
): { slug: string; conversationId: string } | null {
  if (!href) return null
  const match = /^\/([^/?#]+)\/zap\?(?:[^#]*&)?conversa=([^&#]+)/.exec(href)
  if (!match) return null
  return { slug: match[1], conversationId: decodeURIComponent(match[2]) }
}
