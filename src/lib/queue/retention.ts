const DAY_MS = 24 * 60 * 60 * 1000

export const RetentionWindowMs = {
  sessionAfterExpiry: 30 * DAY_MS,
  verificationAfterExpiry: 1 * DAY_MS,
  /** Outbound webhook delivery log (ADR 0036). */
  webhookDeliveries: 30 * DAY_MS,
  /**
   * Personal API tokens (ADR 0035) kept after they were revoked or expired,
   * so the settings list and audit lookups still resolve the token name.
   */
  apiTokensAfterEnd: 90 * DAY_MS,
  /**
   * Entry log of IP-restricted workspaces (ADR 0053): 5 years, the horizon
   * banks keep access records for under BACEN rules (5 × 365 days).
   */
  workspaceAccessLogs: 5 * 365 * DAY_MS,
  /** Per-block chatbot metrics: the editor shows 30 days, 60 are kept. */
  chatbotNodeStats: 60 * DAY_MS,
} as const

export const RetentionCron = {
  dataRetention: '0 3 * * *',
} as const

export const RetentionTimezone = 'America/Sao_Paulo' as const

/** Frequência do tick que dispara campanhas de e-mail agendadas. */
export const CrmScheduledSendCron = '*/5 * * * *' as const

/** Frequência do tick que dispara workflows com trigger `on-a-schedule`. */
export const CrmWorkflowScheduleCron = '*/1 * * * *' as const

/** Frequência do sync de métricas de concorrentes (Instagram/YouTube). */
export const CrmCompetitorSyncCron = '0 4 * * *' as const

/**
 * Expiração diária de propostas: logo após a meia-noite (São Paulo), quando
 * termina o último dia de validade.
 */
export const CrmProposalExpiryCron = '5 0 * * *' as const

/** Frequência do tick que publica posts sociais agendados vencidos. */
export const CrmSocialPostsTickCron = '* * * * *' as const

/** Frequência do tick de SLA do ServiceDesk (risco, violação, escalonamento). */
export const ServicedeskSlaCron = '* * * * *' as const

/** Frequência da leitura das caixas de e-mail do ServiceDesk (IMAP). */
export const ServicedeskMailCron = '* * * * *' as const
/**
 * Resumo diário do ServiceDesk: de hora em hora, no minuto 5. O service só
 * envia aos workspaces cuja hora local é a combinada (`SD_DIGEST_HOUR`), o
 * que dá exatamente um envio por dia por workspace.
 */
export const ServicedeskDigestCron = '5 * * * *' as const

/**
 * Chamados recorrentes do ServiceDesk (manutenção preventiva): a cada 5
 * minutos. A regra guarda o horário exato da ocorrência, então o tick só
 * precisa ser frequente o bastante para não atrasar a abertura.
 */
export const ServicedeskRecurringCron = '*/5 * * * *' as const

/**
 * Faturamento dos contratos do ServiceDesk: todo dia às 00:20. No dia 1 do
 * ciclo o tick abre o período novo e fecha o anterior; nos outros dias é
 * inócuo (idempotente por `(contractId, periodStart)`).
 */
export const ServicedeskBillingCron = '20 0 * * *' as const

/**
 * Relatórios agendados do ServiceDesk: de hora em hora, aos 10 minutos. O
 * agendamento guarda dia, hora e fuso próprios, então o tick só precisa
 * acordar com frequência suficiente para acertar a hora local de cada um.
 */
export const ServicedeskReportsCron = '10 * * * *' as const

/**
 * Risco de violação de SLA: a cada 10 minutos. Mais frequente que isso só
 * recalcularia a mesma coisa — o selo no quadro muda de faixa em escala de
 * minutos, não de segundos.
 */
export const ServicedeskRiskCron = '*/10 * * * *' as const
export const ServicedeskInventoryCron = '*/5 * * * *' as const
/** Descoberta por ping/ARP: faixas com opt-in cuja hora chegou. */
export const ServicedeskDiscoveryCron = '*/10 * * * *' as const
/** Avisos de licença de software vencendo/vencida: uma vez ao dia, 07:00. */
export const ServicedeskLicenseExpiryCron = '0 7 * * *' as const

/**
 * Agrupamento de incidentes repetidos (candidatos a problema): de hora em
 * hora, aos 25 minutos, longe do tick de relatórios.
 */
export const ServicedeskClusterCron = '25 * * * *' as const

/**
 * Reconciliação do estado das issues/PRs vinculadas no GitHub: de hora em
 * hora, aos 40 minutos. É rede de segurança para webhook perdido.
 */
export const ServicedeskIntegrationsCron = '40 * * * *' as const

/** Frequência do tick que dispara destinatários de broadcast agendados. */
export const WhatsappBroadcastScheduleCron = '*/5 * * * *' as const

/** Frequência do fechamento automático de conversas inativas do WhatsApp. */
export const WhatsappConversationAutoCloseCron = '*/15 * * * *' as const

/** Frequência da distribuição da fila e dos lembretes de conversa sem atendente. */
export const WhatsappDistributionTickCron = '* * * * *' as const
/** Every minute: warn / flag breaches of the Communication SLA (ADR 0048). */
export const WhatsappSlaTickCron = '* * * * *' as const

export const BackupRetentionDays = 90

export const DatabaseBackupCron = {
  fullBackup: '15 3 * * *',
  pruneExpired: '30 3 * * *',
} as const

/**
 * Coleta do status page. Core (app, banco, Redis, auth) a cada minuto — é o
 * que define "fora do ar"; periféricos (pagamento, e-mail, storage) a cada 5
 * min, porque batem em APIs externas com quota.
 */
export const StatusCollectCron = {
  core: '* * * * *',
  peripheral: '*/5 * * * *',
} as const

/** Rollup do uso por módulo (Redis → `module_usage_daily`). */
export const UsageRollupCron = '*/15 * * * *'

/** CRM task reminders (due within 1 h / overdue): every 15 minutes. */
export const CrmTaskRemindersCron = '*/15 * * * *' as const

/** Duplicate scan of every CRM workspace: once a day, off-peak. */
export const CrmDuplicatesCron = '40 2 * * *' as const

/** Meeting reminders: every 5 minutes. */
export const CrmMeetingsCron = '*/5 * * * *' as const

/** CRM health scores: hourly, at minute 20 (off the :00 and :15 peaks). */
export const CrmHealthCron = '20 * * * *' as const

/** Sales cadences: due steps run every minute. */
export const CrmCadencesCron = '* * * * *' as const

/**
 * Due-date notices of ticket tasks: every 15 minutes, so "due within the
 * hour" is announced with at least 45 minutes to spare.
 */
export const ServicedeskTaskRemindersCron = '*/15 * * * *' as const

/** Steel Agents tick: every minute (cron agents have minute precision). */
export const SteelAgentsTickCron = '* * * * *' as const

/** Inbox: warning before a pending Steel AI action expires — every minute. */
export const NotificationsAiActionExpiryCron = '* * * * *' as const

/**
 * Global search full reindex: 02:30, before the 03:00 retention and the
 * 03:15 backup, so it never competes with pg_dump.
 */
export const SearchReindexCron = '30 2 * * *' as const

/**
 * Weekly Steel AI usage e-mail to the owners: Mondays 08:00 (São Paulo),
 * after the UTC week (the quota's clock) closed at 21:00 on Sunday.
 */
export const AiUsageWeeklyEmailCron = '0 8 * * 1' as const

/**
 * Ajustes › Exportações: delete the export files past their 7 days — 04:45,
 * after the 03:15 backup and its 03:30 prune.
 */
export const WorkspaceExportPruneCron = '45 4 * * *' as const
/** Comunicação "conversation waiting" Slack alert: every 5 minutes. */
export const CommunicationWaitingCron = '*/5 * * * *' as const

/** CRM multichannel campaigns safety-net tick: every 5 minutes. */
export const CrmCampaignsTickCron = '*/5 * * * *' as const

/** Site blog: publish the scheduled posts that are due — every minute. */
export const SitePostsPublishCron = '* * * * *' as const

/**
 * Steel AI knowledge index full rebuild (ADR 0037): 02:45, after the 02:30
 * global search reindex and before the 03:00 retention and 03:15 backup.
 * Only changed chunks are re-embedded, so the provider cost is the delta.
 */
export const AiIndexReindexCron = '45 2 * * *' as const

/** Proactive AI insights (ADR 0040): every 15 minutes, off the hour marks. */
export const AiProactiveInsightsCron = '7,22,37,52 * * * *' as const

/**
 * Proactive AI daily digest: hourly at :10 (after the :07 insights tick),
 * each person at the digest hour of their own time zone.
 */
export const AiProactiveDigestCron = '10 * * * *' as const

/**
 * WhatsApp archive for banks (ADR 0052): the weekly package on Monday at
 * 02:00 (previous Monday → Sunday), the monthly full package on day 1 at
 * 02:30 (all history up to the end of the previous month), and the prune of
 * expired packages at 04:50 (after the backup and export prunes).
 */
export const WhatsappArchiveCron = {
  weekly: '0 2 * * 1',
  monthlyFull: '30 2 1 * *',
  pruneExpired: '50 4 * * *',
} as const

/** How long each package is kept (MinIO and the off-site copy). */
export const WhatsappArchiveRetention = {
  weeklyDays: 90,
  monthlyFullMonths: 12,
} as const

/** Sending domains (ADR 0054): re-check tick every 10 minutes, off :00. */
export const SendingDomainsCheckCron = '4,14,24,34,44,54 * * * *' as const
/** CRM newsletter (ADR 0054): due scheduled issues and the send safety net. */
export const CrmNewsletterTickCron = '* * * * *' as const
/**
 * Newsletter automation (newsletter2, nl2-automation): welcome series every
 * 5 minutes, re-engagement e-mails on the 1st of the month at 09:00 and the
 * end of the grace periods every day at 08:30 (America/Sao_Paulo).
 */
export const CrmNewsletterAutomationCron = {
  welcomeTick: '2-59/5 * * * *',
  reengagementMonthly: '0 9 1 * *',
  reengagementResolve: '30 8 * * *',
} as const
/** newsletter2 nl2-digest-ai: digests run at whole hours (SP), so a tick
 * every 5 minutes starts them by HH:05. */
export const CrmNewsletterDigestTickCron = '*/5 * * * *' as const
/** newsletter2 nl2-digest-ai: subject A/B decisions, off the digest tick. */
export const CrmNewsletterAbTickCron = '2-59/5 * * * *' as const
