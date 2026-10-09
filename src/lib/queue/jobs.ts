export const QueueName = {
  DataRetention: 'data-retention',
  AccountLifecycle: 'account-lifecycle',
  DataExport: 'data-export',
  TrialLifecycle: 'trial-lifecycle',
  WhatsappMedia: 'whatsapp-media',
  WhatsappAiReply: 'whatsapp-ai-reply',
  WhatsappSentiment: 'whatsapp-sentiment',
  WhatsappBroadcast: 'whatsapp-broadcast',
  WhatsappTemplateSync: 'whatsapp-template-sync',
  WhatsappConversationLifecycle: 'whatsapp-conversation-lifecycle',
  CrmScheduledSend: 'crm-scheduled-send',
  CrmWorkflowSchedule: 'crm-workflow-schedule',
  CrmCompetitorSync: 'crm-competitor-sync',
  CrmSocialPostsTick: 'crm-social-posts-tick',
  CrmSocialPublish: 'crm-social-publish',
  CrmProposalExpiry: 'crm-proposal-expiry',
  Changelog: 'changelog',
  DatabaseBackup: 'database-backup',
  StatusCollect: 'status-collect',
  UsageRollup: 'usage-rollup',
  ServicedeskSla: 'servicedesk-sla',
  ServicedeskAi: 'servicedesk-ai',
  ServicedeskMail: 'servicedesk-mail',
  ServicedeskDigest: 'servicedesk-digest',
  ServicedeskRecurring: 'servicedesk-recurring',
  ServicedeskBilling: 'servicedesk-billing',
  ServicedeskReports: 'servicedesk-reports',
  ServicedeskRisk: 'servicedesk-risk',
  ServicedeskIntegrations: 'servicedesk-integrations',
  CrmTaskReminders: 'crm-task-reminders',
  ServicedeskTaskReminders: 'servicedesk-task-reminders',
  SteelAgents: 'steel-agents',
  Notifications: 'notifications',
  SearchReindex: 'search-reindex',
  AiUsageWeeklyEmail: 'ai-usage-weekly-email',
  WorkspaceExport: 'workspace-export',
  WorkspaceIntegrations: 'workspace-integrations',
  CrmCampaigns: 'crm-campaigns',
  CrmWorkflowDelay: 'crm-workflow-delay',
} as const

export type QueueName = (typeof QueueName)[keyof typeof QueueName]

export const DataRetentionJob = {
  CleanupExpiredSessions: 'cleanup-expired-sessions',
  CleanupExpiredVerificationTokens: 'cleanup-expired-verification-tokens',
  ExpireStaleInvitations: 'expire-stale-invitations',
} as const

export type DataRetentionJob =
  (typeof DataRetentionJob)[keyof typeof DataRetentionJob]

export type DataRetentionJobPayload = {
  [DataRetentionJob.CleanupExpiredSessions]: Record<string, never>
  [DataRetentionJob.CleanupExpiredVerificationTokens]: Record<string, never>
  [DataRetentionJob.ExpireStaleInvitations]: Record<string, never>
}

export const AccountLifecycleJob = {
  DeleteAccount: 'delete-account',
} as const

export type AccountLifecycleJob =
  (typeof AccountLifecycleJob)[keyof typeof AccountLifecycleJob]

export type AccountLifecycleJobPayload = {
  [AccountLifecycleJob.DeleteAccount]: { userId: string }
}

export const DataExportJob = {
  ExportUserData: 'export-user-data',
} as const

export type DataExportJob = (typeof DataExportJob)[keyof typeof DataExportJob]

export type DataExportJobPayload = {
  [DataExportJob.ExportUserData]: { userId: string }
}

export const TrialLifecycleJob = {
  RevertExpiredTrials: 'revert-expired-trials',
} as const

export type TrialLifecycleJob =
  (typeof TrialLifecycleJob)[keyof typeof TrialLifecycleJob]

export type TrialLifecycleJobPayload = {
  [TrialLifecycleJob.RevertExpiredTrials]: Record<string, never>
}

export const WhatsappMediaJob = {
  DownloadInboundMedia: 'download-inbound-media',
} as const

export type WhatsappMediaJob =
  (typeof WhatsappMediaJob)[keyof typeof WhatsappMediaJob]

export type WhatsappMediaJobPayload = {
  [WhatsappMediaJob.DownloadInboundMedia]: { messageId: string }
}

export const WhatsappAiReplyJob = {
  GenerateAiReply: 'generate-ai-reply',
} as const

export type WhatsappAiReplyJob =
  (typeof WhatsappAiReplyJob)[keyof typeof WhatsappAiReplyJob]

export type WhatsappAiReplyJobPayload = {
  [WhatsappAiReplyJob.GenerateAiReply]: {
    conversationId: string
    messageId: string
  }
}

export const WhatsappSentimentJob = {
  AnalyzeMessage: 'analyze-message',
} as const

export type WhatsappSentimentJob =
  (typeof WhatsappSentimentJob)[keyof typeof WhatsappSentimentJob]

export type WhatsappSentimentJobPayload = {
  [WhatsappSentimentJob.AnalyzeMessage]: { messageId: string }
}

export const WhatsappBroadcastJob = {
  SendBroadcastMessage: 'send-broadcast-message',
  RunScheduleTick: 'run-schedule-tick',
} as const

export type WhatsappBroadcastJob =
  (typeof WhatsappBroadcastJob)[keyof typeof WhatsappBroadcastJob]

export type WhatsappBroadcastJobPayload = {
  [WhatsappBroadcastJob.SendBroadcastMessage]: {
    broadcastListId: string
    recipientId: string
  }
  [WhatsappBroadcastJob.RunScheduleTick]: Record<string, never>
}

export const WhatsappConversationLifecycleJob = {
  AutoCloseInactive: 'auto-close-inactive',
} as const

export type WhatsappConversationLifecycleJob =
  (typeof WhatsappConversationLifecycleJob)[keyof typeof WhatsappConversationLifecycleJob]

export type WhatsappConversationLifecycleJobPayload = {
  [WhatsappConversationLifecycleJob.AutoCloseInactive]: Record<string, never>
}

export const WhatsappTemplateSyncJob = {
  SyncTemplates: 'sync-templates',
} as const

export type WhatsappTemplateSyncJob =
  (typeof WhatsappTemplateSyncJob)[keyof typeof WhatsappTemplateSyncJob]

export type WhatsappTemplateSyncJobPayload = {
  [WhatsappTemplateSyncJob.SyncTemplates]: { connectionId: string }
}

export const CrmScheduledSendJob = {
  RunTick: 'run-tick',
} as const

export type CrmScheduledSendJob =
  (typeof CrmScheduledSendJob)[keyof typeof CrmScheduledSendJob]

export type CrmScheduledSendJobPayload = {
  [CrmScheduledSendJob.RunTick]: Record<string, never>
}

export const CrmWorkflowScheduleJob = {
  RunTick: 'run-tick',
} as const

export type CrmWorkflowScheduleJob =
  (typeof CrmWorkflowScheduleJob)[keyof typeof CrmWorkflowScheduleJob]

export type CrmWorkflowScheduleJobPayload = {
  [CrmWorkflowScheduleJob.RunTick]: Record<string, never>
}

export const CrmSocialPostsTickJob = {
  RunTick: 'run-tick',
} as const

export type CrmSocialPostsTickJob =
  (typeof CrmSocialPostsTickJob)[keyof typeof CrmSocialPostsTickJob]

export type CrmSocialPostsTickJobPayload = {
  [CrmSocialPostsTickJob.RunTick]: Record<string, never>
}

/**
 * Tick diário que marca como EXPIRED as propostas enviadas/vistas com a
 * validade vencida e avisa o responsável (`CrmProposalService.expireDue`).
 */
export const CrmProposalExpiryJob = {
  RunTick: 'run-tick',
} as const

export type CrmProposalExpiryJob =
  (typeof CrmProposalExpiryJob)[keyof typeof CrmProposalExpiryJob]

export type CrmProposalExpiryJobPayload = {
  [CrmProposalExpiryJob.RunTick]: Record<string, never>
}

export const CrmCompetitorSyncJob = {
  RunTick: 'run-tick',
} as const

export type CrmCompetitorSyncJob =
  (typeof CrmCompetitorSyncJob)[keyof typeof CrmCompetitorSyncJob]

export type CrmCompetitorSyncJobPayload = {
  [CrmCompetitorSyncJob.RunTick]: Record<string, never>
}

/**
 * Publish interativo (disparado pela UI, não pelo agendador) de mídia grande
 * demais pra caber num único request síncrono sem esbarrar em timeout de
 * proxy — a rota grava os bytes num bucket temporário e enfileira aqui; o
 * worker chama o mesmo `publishVideo`/`publishPost` que o `crm-social-posts-tick`
 * já usa pros posts agendados. Sem retry automático (`attempts: 1` na
 * chamada de `add`) — publicar não é idempotente, então uma falha após o
 * post já ter ido ao ar não deve tentar de novo.
 */
export const CrmSocialPublishJob = {
  PublishYoutubeVideo: 'publish-youtube-video',
  PublishInstagramMedia: 'publish-instagram-media',
  PublishFacebookVideo: 'publish-facebook-video',
} as const

export type CrmSocialPublishJob =
  (typeof CrmSocialPublishJob)[keyof typeof CrmSocialPublishJob]

export type CrmSocialPublishJobPayload = {
  [CrmSocialPublishJob.PublishYoutubeVideo]: {
    actorId: string
    workspaceId: string
    objectKey: string
    contentType: string
    title: string
    description: string
    tags: string[]
    privacyStatus: 'private' | 'unlisted' | 'public'
  }
  [CrmSocialPublishJob.PublishInstagramMedia]: {
    actorId: string
    workspaceId: string
    connectionId?: string
    objectKey: string
    contentType: string
    kind: 'IMAGE' | 'VIDEO'
    caption: string
    postType: 'FEED' | 'REELS' | 'STORIES'
    /** Capa opcional (só Reels) — mesmo bucket temporário da mídia principal. */
    coverObjectKey?: string
    coverContentType?: string
  }
  [CrmSocialPublishJob.PublishFacebookVideo]: {
    actorId: string
    workspaceId: string
    connectionId?: string
    objectKey: string
    contentType: string
    message: string
    link: string | null
  }
}

export const ChangelogJob = {
  SendChangelogEmail: 'send-changelog-email',
} as const

export type ChangelogJob = (typeof ChangelogJob)[keyof typeof ChangelogJob]

export type ChangelogJobPayload = {
  [ChangelogJob.SendChangelogEmail]: {
    changelogId: string
    recipientId: string
  }
}

/**
 * `DeleteWorkspace` e `RestoreWorkspace` são operações do painel admin
 * (`admin_operations`) e rodam nesta mesma fila de propósito: o worker de
 * backup processa um job por vez, então exclusão/restauração nunca correm em
 * paralelo com um backup do mesmo banco. Enfileiradas com `attempts: 1` —
 * operação destrutiva não é refeita sozinha; o admin decide repetir.
 */
export const DatabaseBackupJob = {
  RunFullBackup: 'run-full-backup',
  RunWorkspaceBackup: 'run-workspace-backup',
  PruneExpiredBackups: 'prune-expired-backups',
  CopyToOffsite: 'copy-to-offsite',
  DeleteWorkspace: 'delete-workspace',
  RestoreWorkspace: 'restore-workspace',
} as const

export type DatabaseBackupJob =
  (typeof DatabaseBackupJob)[keyof typeof DatabaseBackupJob]

export type DatabaseBackupJobPayload = {
  /** `triggeredById` = admin que disparou pelo painel (cron/CLI: ausente). */
  [DatabaseBackupJob.RunFullBackup]: { triggeredById?: string }
  [DatabaseBackupJob.RunWorkspaceBackup]: {
    workspaceId: string
    triggeredById?: string
  }
  [DatabaseBackupJob.PruneExpiredBackups]: Record<string, never>
  [DatabaseBackupJob.CopyToOffsite]: { backupId: string }
  [DatabaseBackupJob.DeleteWorkspace]: { operationId: string }
  [DatabaseBackupJob.RestoreWorkspace]: { operationId: string }
}

/**
 * Coleta periódica do status page (`/status`). Cada job roda os probes de um
 * tier e grava `HealthCheck`/`ComponentDaily`/incidentes via `StatusService`.
 * As rotas `POST /api/status/collect/{core,peripheral}` seguem existindo para
 * disparo manual.
 */
export const StatusCollectJob = {
  CollectCore: 'collect-core',
  CollectPeripheral: 'collect-peripheral',
} as const

export type StatusCollectJob =
  (typeof StatusCollectJob)[keyof typeof StatusCollectJob]

export type StatusCollectJobPayload = {
  [StatusCollectJob.CollectCore]: Record<string, never>
  [StatusCollectJob.CollectPeripheral]: Record<string, never>
}

/**
 * Copia os contadores de uso por módulo do Redis (hash por dia, alimentado
 * pelo `withAxiom`) para `module_usage_daily`. Grava valor absoluto, então
 * reprocessar o mesmo dia é idempotente.
 */
export const UsageRollupJob = {
  RollupModuleUsage: 'rollup-module-usage',
} as const

export type UsageRollupJob =
  (typeof UsageRollupJob)[keyof typeof UsageRollupJob]

export type UsageRollupJobPayload = {
  [UsageRollupJob.RollupModuleUsage]: Record<string, never>
}

/**
 * Tick de SLA do ServiceDesk (1×/min): marca risco/violação, dispara
 * escalonamentos/automações e fecha chamados resolvidos
 * (`SdSlaMonitorService.runTick`).
 */
export const ServicedeskSlaJob = {
  RunTick: 'run-tick',
} as const

export type ServicedeskSlaJob =
  (typeof ServicedeskSlaJob)[keyof typeof ServicedeskSlaJob]

export type ServicedeskSlaJobPayload = {
  [ServicedeskSlaJob.RunTick]: Record<string, never>
}

/**
 * Agente de IA do ServiceDesk (`SdAiService`): triagem automática de um
 * chamado recém-aberto e a resposta da IA a uma mensagem recebida numa
 * conversa do WhatsApp do ServiceDesk (pré-atendimento ou resposta
 * automática enquanto o chamado não tem atendente).
 */
export const ServicedeskAiJob = {
  TriageTicket: 'triage-ticket',
  WhatsappReply: 'whatsapp-reply',
} as const

export type ServicedeskAiJob =
  (typeof ServicedeskAiJob)[keyof typeof ServicedeskAiJob]

export type ServicedeskAiJobPayload = {
  [ServicedeskAiJob.TriageTicket]: { ticketId: string }
  [ServicedeskAiJob.WhatsappReply]: {
    conversationId: string
    messageId: string
  }
}

/**
 * Canal de e-mail do ServiceDesk (1×/min): lê por IMAP as caixas ativas
 * (`SdMailbox`) e abre/atualiza chamados com o que chegou
 * (`SdMailInboundService`). `SyncMailbox` é a leitura de uma caixa só,
 * enfileirada pela tela de configurações.
 */
export const ServicedeskMailJob = {
  PollMailboxes: 'poll-mailboxes',
  SyncMailbox: 'sync-mailbox',
} as const

export type ServicedeskMailJob =
  (typeof ServicedeskMailJob)[keyof typeof ServicedeskMailJob]

export type ServicedeskMailJobPayload = {
  [ServicedeskMailJob.PollMailboxes]: Record<string, never>
  [ServicedeskMailJob.SyncMailbox]: { mailboxId: string }
}

/**
 * Resumo diário opcional do ServiceDesk (`SdDigestService.runTick`). O tick
 * roda de hora em hora e só envia aos agentes do workspace cuja hora local é
 * a combinada (`SD_DIGEST_HOUR`) — por isso cada agente recebe no máximo um
 * resumo por dia sem precisar de carimbo de controle.
 */
export const ServicedeskDigestJob = {
  RunTick: 'run-tick',
} as const

export type ServicedeskDigestJob =
  (typeof ServicedeskDigestJob)[keyof typeof ServicedeskDigestJob]

export type ServicedeskDigestJobPayload = {
  [ServicedeskDigestJob.RunTick]: Record<string, never>
}

/**
 * Chamados recorrentes do ServiceDesk (manutenção preventiva), a cada 5
 * min: abre os chamados das regras com `nextRunAt` vencido
 * (`SdRecurringTicketRunner.runTick`). Idempotente pelo par
 * `(recurringId, scheduledFor)`.
 */
export const ServicedeskRecurringJob = {
  RunTick: 'run-tick',
} as const

export type ServicedeskRecurringJob =
  (typeof ServicedeskRecurringJob)[keyof typeof ServicedeskRecurringJob]

export type ServicedeskRecurringJobPayload = {
  [ServicedeskRecurringJob.RunTick]: Record<string, never>
}

/**
 * Faturamento dos contratos de atendimento
 * (`SdContractBillingService.runTick`). O tick diário abre o período do
 * ciclo corrente de cada contrato ativo e fecha os anteriores já vencidos,
 * consolidando os apontamentos de hora. Idempotente por
 * `(contractId, periodStart)`.
 */
export const ServicedeskBillingJob = {
  RunTick: 'run-tick',
} as const

export type ServicedeskBillingJob =
  (typeof ServicedeskBillingJob)[keyof typeof ServicedeskBillingJob]

export type ServicedeskBillingJobPayload = {
  [ServicedeskBillingJob.RunTick]: Record<string, never>
}

/**
 * Relatórios agendados do ServiceDesk (`SdReportService`). O tick horário
 * procura os agendamentos com `nextRunAt` vencido e enfileira um
 * `generate-report` por agendamento; `generate-report` apura o período, grava
 * PDF/CSV no MinIO e manda o e-mail para os destinatários. Idempotente por
 * `(reportId, periodStart)` — a execução é registrada em `SdReportRun`.
 * `reportId` ausente = relatório sob demanda (`requestedById` preenchido).
 */
export const ServicedeskReportsJob = {
  RunTick: 'run-tick',
  GenerateReport: 'generate-report',
} as const

export type ServicedeskReportsJob =
  (typeof ServicedeskReportsJob)[keyof typeof ServicedeskReportsJob]

export type ServicedeskReportsJobPayload = {
  [ServicedeskReportsJob.RunTick]: Record<string, never>
  [ServicedeskReportsJob.GenerateReport]: {
    workspaceId: string
    reportId?: string
    /** Sob demanda: quem pediu (recebe o link quando fica pronto). */
    requestedById?: string
    periodStart?: string
    periodEnd?: string
    /** Sobrepõe os destinatários do agendamento (envio pontual). */
    recipients?: string[]
  }
}

/**
 * Análise preditiva do ServiceDesk (`SdRiskService`, heurística explicável —
 * sem modelo treinado). `recompute-risk` recalcula o risco de violação de
 * SLA dos chamados abertos de um workspace (a cada 10 min); `scan-clusters`
 * agrupa incidentes parecidos e sugere abrir um problema (de hora em hora).
 * Sem `workspaceId` o tick varre todos os workspaces com o módulo ligado.
 */
export const ServicedeskRiskJob = {
  RecomputeRisk: 'recompute-risk',
  ScanClusters: 'scan-clusters',
} as const

export type ServicedeskRiskJob =
  (typeof ServicedeskRiskJob)[keyof typeof ServicedeskRiskJob]

export type ServicedeskRiskJobPayload = {
  [ServicedeskRiskJob.RecomputeRisk]: { workspaceId?: string }
  [ServicedeskRiskJob.ScanClusters]: { workspaceId?: string }
}

/**
 * Saída para Slack e GitHub (`SdIntegrationDispatcher`). Fica em fila
 * própria porque depende de serviço externo: uma indisponibilidade do Slack
 * não pode atrasar o SLA nem o e-mail. `sync-github-state` reconcilia o
 * estado das issues/PRs vinculadas (de hora em hora), para o caso de um
 * webhook ter sido perdido.
 */
export const ServicedeskIntegrationsJob = {
  DeliverEvent: 'deliver-event',
  SyncGithubState: 'sync-github-state',
} as const

export type ServicedeskIntegrationsJob =
  (typeof ServicedeskIntegrationsJob)[keyof typeof ServicedeskIntegrationsJob]

export type ServicedeskIntegrationsJobPayload = {
  [ServicedeskIntegrationsJob.DeliverEvent]: {
    workspaceId: string
    integrationId: string
    /** Chave do catálogo de notificações (`SD_NOTIFICATION_EVENTS`). */
    event: string
    ticketId?: string
    payload?: Record<string, unknown>
  }
  [ServicedeskIntegrationsJob.SyncGithubState]: { workspaceId?: string }
}

/**
 * CRM task reminders: every 15 min, notifies the assignee of tasks due within
 * the next hour and of tasks that just became overdue — once each, through
 * the notification `dedupeKey`.
 */
export const CrmTaskRemindersJob = {
  RunTick: 'run-tick',
} as const

export type CrmTaskRemindersJob =
  (typeof CrmTaskRemindersJob)[keyof typeof CrmTaskRemindersJob]

export type CrmTaskRemindersJobPayload = {
  [CrmTaskRemindersJob.RunTick]: Record<string, never>
}

/**
 * Due-date notices of ticket tasks (`SdTaskReminderService`): every 15 min
 * the tick tells each assignee once when a task is due within the hour and
 * once when it is past due. Idempotent through the stamps on the task.
 */
export const ServicedeskTaskRemindersJob = {
  RunTick: 'run-tick',
} as const

export type ServicedeskTaskRemindersJob =
  (typeof ServicedeskTaskRemindersJob)[keyof typeof ServicedeskTaskRemindersJob]

export type ServicedeskTaskRemindersJobPayload = {
  [ServicedeskTaskRemindersJob.RunTick]: Record<string, never>
}

/**
 * Steel Agents: `tick` (every minute) dispatches SCHEDULE agents whose cron
 * occurrence is due (croner + `lastRunAt` dedupe) and expires overdue
 * approvals; `run` executes (or resumes, after an approval decision) one
 * `SteelAgentRun`. Single attempt — a retry could repeat automatic writes;
 * failures are persisted on the run.
 */
export const SteelAgentsJob = {
  Tick: 'tick',
  Run: 'run',
} as const

export type SteelAgentsJob =
  (typeof SteelAgentsJob)[keyof typeof SteelAgentsJob]

export type SteelAgentsJobPayload = {
  [SteelAgentsJob.Tick]: Record<string, never>
  [SteelAgentsJob.Run]: { runId: string }
}

/**
 * Inbox housekeeping: `ai-action-expiry-tick` (every minute) warns the
 * requester ~5 minutes before a pending Steel AI action expires, once per
 * action (`dedupeKey`).
 */
export const NotificationsJob = {
  AiActionExpiryTick: 'ai-action-expiry-tick',
} as const

export type NotificationsJob =
  (typeof NotificationsJob)[keyof typeof NotificationsJob]

export type NotificationsJobPayload = {
  [NotificationsJob.AiActionExpiryTick]: Record<string, never>
}

/**
 * Global search index (`search_documents`): `reindex-all` (nightly) rebuilds
 * every workspace and drops documents of records deleted behind the
 * services' backs; `reindex-workspace` rebuilds one workspace on demand.
 * Idempotent — a retry just rewrites the same rows.
 */
export const SearchReindexJob = {
  ReindexAll: 'reindex-all',
  ReindexWorkspace: 'reindex-workspace',
} as const

export type SearchReindexJob =
  (typeof SearchReindexJob)[keyof typeof SearchReindexJob]

export type SearchReindexJobPayload = {
  [SearchReindexJob.ReindexAll]: Record<string, never>
  [SearchReindexJob.ReindexWorkspace]: { workspaceId: string }
}

/**
 * Weekly Steel AI usage e-mail to the workspace owners: `tick` (Mondays
 * 08:00 America/Sao_Paulo) plans the previous UTC week and fans out one
 * `send-workspace` per eligible workspace, with a deterministic job id
 * (`ai-usage-weekly-email-<workspaceId>-<weekKey>`); a Redis marker per
 * owner keeps retries from mailing twice.
 */
export const AiUsageWeeklyEmailJob = {
  Tick: 'tick',
  SendWorkspace: 'send-workspace',
} as const

export type AiUsageWeeklyEmailJob =
  (typeof AiUsageWeeklyEmailJob)[keyof typeof AiUsageWeeklyEmailJob]

export type AiUsageWeeklyEmailJobPayload = {
  [AiUsageWeeklyEmailJob.Tick]: Record<string, never>
  /** `weekStart`: Monday of the reported week, `YYYY-MM-DD` (UTC). */
  [AiUsageWeeklyEmailJob.SendWorkspace]: {
    workspaceId: string
    weekStart: string
  }
}

/**
 * Ajustes › Exportações: `run` builds one requested export (complete data
 * or Axiom logs) into a ZIP in MinIO and notifies the requester; the daily
 * `prune-expired` deletes the files past their 7 days.
 */
export const WorkspaceExportJob = {
  Run: 'run',
  PruneExpired: 'prune-expired',
} as const

export type WorkspaceExportJob =
  (typeof WorkspaceExportJob)[keyof typeof WorkspaceExportJob]

export type WorkspaceExportJobPayload = {
  [WorkspaceExportJob.Run]: { exportId: string }
  [WorkspaceExportJob.PruneExpired]: Record<string, never>
}

/**
 * Workspace-level integrations (Ajustes > Integrações, ADR 0024):
 * `slack-notify` delivers one routed event of any module to its Slack
 * channel(s), off the request path; `communication-waiting-tick` (every 5
 * min) announces WhatsApp conversations waiting longer than the workspace's
 * threshold.
 */
export const WorkspaceIntegrationsJob = {
  SlackNotify: 'slack-notify',
  CommunicationWaitingTick: 'communication-waiting-tick',
} as const

export type WorkspaceIntegrationsJob =
  (typeof WorkspaceIntegrationsJob)[keyof typeof WorkspaceIntegrationsJob]

export type WorkspaceIntegrationsJobPayload = {
  [WorkspaceIntegrationsJob.SlackNotify]: {
    workspaceId: string
    integrationId: string
    /** Catalog key (`crm.deal.won`, `agents.approval.pending`…). */
    event: string
    title: string
    body: string
    /** Absolute link to the record in Steel. */
    url: string | null
  }
  [WorkspaceIntegrationsJob.CommunicationWaitingTick]: Record<string, never>
}

/**
 * CRM multichannel campaigns (ADR 0025): `dispatch` (delayed until a
 * channel's start or the next send-window opening) queues a batch of
 * `send` jobs; `send` claims one recipient row and sends one message;
 * `tick` (every 5 min) starts due campaigns, re-dispatches pending work,
 * frees rows stuck in SENDING and closes drained campaigns.
 */
export const CrmCampaignsJob = {
  Dispatch: 'dispatch',
  Send: 'send',
  Tick: 'tick',
} as const

export type CrmCampaignsJob =
  (typeof CrmCampaignsJob)[keyof typeof CrmCampaignsJob]

export type CrmCampaignsJobPayload = {
  [CrmCampaignsJob.Dispatch]: {
    campaignId: string
    channel: 'EMAIL' | 'WHATSAPP'
  }
  [CrmCampaignsJob.Send]: {
    campaignId: string
    recipientId: string
    channel: 'EMAIL' | 'WHATSAPP'
  }
  [CrmCampaignsJob.Tick]: Record<string, never>
}

/**
 * CRM workflow "Atraso" (delay) step: a delayed job that resumes the paused
 * run when the delay is over. The run is persisted as WAITING with its scope
 * and pending steps (`run.state`), so nothing is held in memory meanwhile.
 */
export const CrmWorkflowDelayJob = {
  Resume: 'resume',
} as const

export type CrmWorkflowDelayJob =
  (typeof CrmWorkflowDelayJob)[keyof typeof CrmWorkflowDelayJob]

export type CrmWorkflowDelayJobPayload = {
  [CrmWorkflowDelayJob.Resume]: { runId: string; stepId: string }
}
