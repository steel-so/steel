import { logger } from '@/lib/axiom/logger'
import { TRIAL_EXPIRY_CRON } from '@/src/config/trial'
import {
  AiIndexJob,
  AiProactiveJob,
  AiUsageWeeklyEmailJob,
  CrmCampaignsJob,
  CrmCompetitorSyncJob,
  CrmProposalExpiryJob,
  CrmScheduledSendJob,
  CrmSocialPostsTickJob,
  CrmTaskRemindersJob,
  CrmWorkflowScheduleJob,
  DatabaseBackupJob,
  DataRetentionJob,
  NotificationsJob,
  SearchReindexJob,
  ServicedeskBillingJob,
  ServicedeskDigestJob,
  ServicedeskIntegrationsJob,
  ServicedeskMailJob,
  ServicedeskRecurringJob,
  ServicedeskReportsJob,
  ServicedeskRiskJob,
  ServicedeskSlaJob,
  ServicedeskTaskRemindersJob,
  SitePostsJob,
  StatusCollectJob,
  SteelAgentsJob,
  TrialLifecycleJob,
  UsageRollupJob,
  WhatsappBroadcastJob,
  WhatsappConversationLifecycleJob,
  WorkspaceExportJob,
  WorkspaceIntegrationsJob,
} from './jobs'
import {
  getAiIndexQueue,
  getAiProactiveQueue,
  getAiUsageWeeklyEmailQueue,
  getCrmCampaignsQueue,
  getCrmCompetitorSyncQueue,
  getCrmProposalExpiryQueue,
  getCrmScheduledSendQueue,
  getCrmSocialPostsTickQueue,
  getCrmTaskRemindersQueue,
  getCrmWorkflowScheduleQueue,
  getDatabaseBackupQueue,
  getDataRetentionQueue,
  getNotificationsQueue,
  getSearchReindexQueue,
  getServicedeskBillingQueue,
  getServicedeskDigestQueue,
  getServicedeskIntegrationsQueue,
  getServicedeskMailQueue,
  getServicedeskRecurringQueue,
  getServicedeskReportsQueue,
  getServicedeskRiskQueue,
  getServicedeskSlaQueue,
  getServicedeskTaskRemindersQueue,
  getSitePostsQueue,
  getStatusCollectQueue,
  getSteelAgentsQueue,
  getTrialLifecycleQueue,
  getUsageRollupQueue,
  getWhatsappBroadcastQueue,
  getWhatsappConversationLifecycleQueue,
  getWorkspaceExportQueue,
  getWorkspaceIntegrationsQueue,
} from './queues'
import {
  AiIndexReindexCron,
  AiProactiveDigestCron,
  AiProactiveInsightsCron,
  AiUsageWeeklyEmailCron,
  CommunicationWaitingCron,
  CrmCampaignsTickCron,
  CrmCompetitorSyncCron,
  CrmProposalExpiryCron,
  CrmScheduledSendCron,
  CrmSocialPostsTickCron,
  CrmTaskRemindersCron,
  CrmWorkflowScheduleCron,
  DatabaseBackupCron,
  NotificationsAiActionExpiryCron,
  RetentionCron,
  RetentionTimezone,
  SearchReindexCron,
  ServicedeskBillingCron,
  ServicedeskClusterCron,
  ServicedeskDigestCron,
  ServicedeskIntegrationsCron,
  ServicedeskMailCron,
  ServicedeskRecurringCron,
  ServicedeskReportsCron,
  ServicedeskRiskCron,
  ServicedeskSlaCron,
  ServicedeskTaskRemindersCron,
  SitePostsPublishCron,
  StatusCollectCron,
  SteelAgentsTickCron,
  UsageRollupCron,
  WhatsappBroadcastScheduleCron,
  WhatsappConversationAutoCloseCron,
  WorkspaceExportPruneCron,
} from './retention'

export async function scheduleDataRetentionJobs(): Promise<void> {
  const queue = getDataRetentionQueue()
  const repeat = {
    pattern: RetentionCron.dataRetention,
    tz: RetentionTimezone,
  }

  await queue.upsertJobScheduler(
    DataRetentionJob.CleanupExpiredSessions,
    repeat,
    { name: DataRetentionJob.CleanupExpiredSessions, data: {} },
  )

  await queue.upsertJobScheduler(
    DataRetentionJob.CleanupExpiredVerificationTokens,
    repeat,
    { name: DataRetentionJob.CleanupExpiredVerificationTokens, data: {} },
  )

  await queue.upsertJobScheduler(
    DataRetentionJob.ExpireStaleInvitations,
    repeat,
    { name: DataRetentionJob.ExpireStaleInvitations, data: {} },
  )

  await queue.upsertJobScheduler(
    DataRetentionJob.CleanupWebhookDeliveries,
    repeat,
    { name: DataRetentionJob.CleanupWebhookDeliveries, data: {} },
  )

  await queue.upsertJobScheduler(DataRetentionJob.CleanupApiTokens, repeat, {
    name: DataRetentionJob.CleanupApiTokens,
    data: {},
  })

  await queue.upsertJobScheduler(
    DataRetentionJob.PruneDeadIntegrationGrants,
    repeat,
    { name: DataRetentionJob.PruneDeadIntegrationGrants, data: {} },
  )

  await queue.upsertJobScheduler(DataRetentionJob.PurgeCallRecordings, repeat, {
    name: DataRetentionJob.PurgeCallRecordings,
    data: {},
  })

  logger.info('queue.scheduler.data_retention_registered', {
    component: 'Worker',
    pattern: RetentionCron.dataRetention,
    timezone: RetentionTimezone,
    jobs: [
      DataRetentionJob.CleanupExpiredSessions,
      DataRetentionJob.CleanupExpiredVerificationTokens,
      DataRetentionJob.ExpireStaleInvitations,
      DataRetentionJob.CleanupWebhookDeliveries,
      DataRetentionJob.CleanupApiTokens,
      DataRetentionJob.PruneDeadIntegrationGrants,
      DataRetentionJob.PurgeCallRecordings,
    ],
  })
}

export async function scheduleTrialLifecycleJobs(): Promise<void> {
  const queue = getTrialLifecycleQueue()
  await queue.upsertJobScheduler(
    TrialLifecycleJob.RevertExpiredTrials,
    { pattern: TRIAL_EXPIRY_CRON, tz: RetentionTimezone },
    { name: TrialLifecycleJob.RevertExpiredTrials, data: {} },
  )

  logger.info('queue.scheduler.trial_lifecycle_registered', {
    component: 'Worker',
    pattern: TRIAL_EXPIRY_CRON,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmScheduledSendJobs(): Promise<void> {
  const queue = getCrmScheduledSendQueue()
  await queue.upsertJobScheduler(
    CrmScheduledSendJob.RunTick,
    { pattern: CrmScheduledSendCron, tz: RetentionTimezone },
    { name: CrmScheduledSendJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.crm_scheduled_send_registered', {
    component: 'Worker',
    pattern: CrmScheduledSendCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmWorkflowScheduleJobs(): Promise<void> {
  const queue = getCrmWorkflowScheduleQueue()
  await queue.upsertJobScheduler(
    CrmWorkflowScheduleJob.RunTick,
    { pattern: CrmWorkflowScheduleCron, tz: RetentionTimezone },
    { name: CrmWorkflowScheduleJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.crm_workflow_schedule_registered', {
    component: 'Worker',
    pattern: CrmWorkflowScheduleCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleWhatsappBroadcastJobs(): Promise<void> {
  const queue = getWhatsappBroadcastQueue()
  await queue.upsertJobScheduler(
    WhatsappBroadcastJob.RunScheduleTick,
    { pattern: WhatsappBroadcastScheduleCron, tz: RetentionTimezone },
    { name: WhatsappBroadcastJob.RunScheduleTick, data: {} },
  )

  logger.info('queue.scheduler.whatsapp_broadcast_schedule_registered', {
    component: 'Worker',
    pattern: WhatsappBroadcastScheduleCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleWhatsappConversationLifecycleJobs(): Promise<void> {
  const queue = getWhatsappConversationLifecycleQueue()
  await queue.upsertJobScheduler(
    WhatsappConversationLifecycleJob.AutoCloseInactive,
    { pattern: WhatsappConversationAutoCloseCron, tz: RetentionTimezone },
    { name: WhatsappConversationLifecycleJob.AutoCloseInactive, data: {} },
  )

  logger.info('queue.scheduler.whatsapp_conversation_lifecycle_registered', {
    component: 'Worker',
    pattern: WhatsappConversationAutoCloseCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmCompetitorSyncJobs(): Promise<void> {
  const queue = getCrmCompetitorSyncQueue()
  await queue.upsertJobScheduler(
    CrmCompetitorSyncJob.RunTick,
    { pattern: CrmCompetitorSyncCron, tz: RetentionTimezone },
    { name: CrmCompetitorSyncJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.crm_competitor_sync_registered', {
    component: 'Worker',
    pattern: CrmCompetitorSyncCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmProposalExpiryJobs(): Promise<void> {
  const queue = getCrmProposalExpiryQueue()
  await queue.upsertJobScheduler(
    CrmProposalExpiryJob.RunTick,
    { pattern: CrmProposalExpiryCron, tz: RetentionTimezone },
    { name: CrmProposalExpiryJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.crm_proposal_expiry_registered', {
    component: 'Worker',
    pattern: CrmProposalExpiryCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmSocialPostsTickJobs(): Promise<void> {
  const queue = getCrmSocialPostsTickQueue()
  await queue.upsertJobScheduler(
    CrmSocialPostsTickJob.RunTick,
    { pattern: CrmSocialPostsTickCron, tz: RetentionTimezone },
    { name: CrmSocialPostsTickJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.crm_social_posts_tick_registered', {
    component: 'Worker',
    pattern: CrmSocialPostsTickCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleDatabaseBackupJobs(): Promise<void> {
  const queue = getDatabaseBackupQueue()

  await queue.upsertJobScheduler(
    DatabaseBackupJob.RunFullBackup,
    { pattern: DatabaseBackupCron.fullBackup, tz: RetentionTimezone },
    { name: DatabaseBackupJob.RunFullBackup, data: {} },
  )

  await queue.upsertJobScheduler(
    DatabaseBackupJob.PruneExpiredBackups,
    { pattern: DatabaseBackupCron.pruneExpired, tz: RetentionTimezone },
    { name: DatabaseBackupJob.PruneExpiredBackups, data: {} },
  )

  logger.info('queue.scheduler.database_backup_registered', {
    component: 'Worker',
    fullBackupPattern: DatabaseBackupCron.fullBackup,
    prunePattern: DatabaseBackupCron.pruneExpired,
    timezone: RetentionTimezone,
  })
}

export async function scheduleStatusCollectJobs(): Promise<void> {
  const queue = getStatusCollectQueue()

  await queue.upsertJobScheduler(
    StatusCollectJob.CollectCore,
    { pattern: StatusCollectCron.core, tz: RetentionTimezone },
    { name: StatusCollectJob.CollectCore, data: {} },
  )

  await queue.upsertJobScheduler(
    StatusCollectJob.CollectPeripheral,
    { pattern: StatusCollectCron.peripheral, tz: RetentionTimezone },
    { name: StatusCollectJob.CollectPeripheral, data: {} },
  )

  logger.info('queue.scheduler.status_collect_registered', {
    component: 'Worker',
    corePattern: StatusCollectCron.core,
    peripheralPattern: StatusCollectCron.peripheral,
    timezone: RetentionTimezone,
  })
}

export async function scheduleUsageRollupJobs(): Promise<void> {
  const queue = getUsageRollupQueue()

  await queue.upsertJobScheduler(
    UsageRollupJob.RollupModuleUsage,
    { pattern: UsageRollupCron, tz: RetentionTimezone },
    { name: UsageRollupJob.RollupModuleUsage, data: {} },
  )

  logger.info('queue.scheduler.usage_rollup_registered', {
    component: 'Worker',
    pattern: UsageRollupCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskSlaJobs(): Promise<void> {
  const queue = getServicedeskSlaQueue()
  await queue.upsertJobScheduler(
    ServicedeskSlaJob.RunTick,
    { pattern: ServicedeskSlaCron, tz: RetentionTimezone },
    { name: ServicedeskSlaJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_sla_registered', {
    component: 'Worker',
    pattern: ServicedeskSlaCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskMailJobs(): Promise<void> {
  const queue = getServicedeskMailQueue()
  await queue.upsertJobScheduler(
    ServicedeskMailJob.PollMailboxes,
    { pattern: ServicedeskMailCron, tz: RetentionTimezone },
    { name: ServicedeskMailJob.PollMailboxes, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_mail_registered', {
    component: 'Worker',
    pattern: ServicedeskMailCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskDigestJobs(): Promise<void> {
  const queue = getServicedeskDigestQueue()
  await queue.upsertJobScheduler(
    ServicedeskDigestJob.RunTick,
    { pattern: ServicedeskDigestCron, tz: RetentionTimezone },
    { name: ServicedeskDigestJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_digest_registered', {
    component: 'Worker',
    pattern: ServicedeskDigestCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskRecurringJobs(): Promise<void> {
  const queue = getServicedeskRecurringQueue()
  await queue.upsertJobScheduler(
    ServicedeskRecurringJob.RunTick,
    { pattern: ServicedeskRecurringCron, tz: RetentionTimezone },
    { name: ServicedeskRecurringJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_recurring_registered', {
    component: 'Worker',
    pattern: ServicedeskRecurringCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskBillingJobs(): Promise<void> {
  const queue = getServicedeskBillingQueue()
  await queue.upsertJobScheduler(
    ServicedeskBillingJob.RunTick,
    { pattern: ServicedeskBillingCron, tz: RetentionTimezone },
    { name: ServicedeskBillingJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_billing_registered', {
    component: 'Worker',
    pattern: ServicedeskBillingCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskReportsJobs(): Promise<void> {
  const queue = getServicedeskReportsQueue()
  await queue.upsertJobScheduler(
    ServicedeskReportsJob.RunTick,
    { pattern: ServicedeskReportsCron, tz: RetentionTimezone },
    { name: ServicedeskReportsJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_reports_registered', {
    component: 'Worker',
    pattern: ServicedeskReportsCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskRiskJobs(): Promise<void> {
  const queue = getServicedeskRiskQueue()
  await queue.upsertJobScheduler(
    ServicedeskRiskJob.RecomputeRisk,
    { pattern: ServicedeskRiskCron, tz: RetentionTimezone },
    { name: ServicedeskRiskJob.RecomputeRisk, data: {} },
  )
  await queue.upsertJobScheduler(
    ServicedeskRiskJob.ScanClusters,
    { pattern: ServicedeskClusterCron, tz: RetentionTimezone },
    { name: ServicedeskRiskJob.ScanClusters, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_risk_registered', {
    component: 'Worker',
    pattern: ServicedeskRiskCron,
    clusterPattern: ServicedeskClusterCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskIntegrationsJobs(): Promise<void> {
  const queue = getServicedeskIntegrationsQueue()
  await queue.upsertJobScheduler(
    ServicedeskIntegrationsJob.SyncGithubState,
    { pattern: ServicedeskIntegrationsCron, tz: RetentionTimezone },
    { name: ServicedeskIntegrationsJob.SyncGithubState, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_integrations_registered', {
    component: 'Worker',
    pattern: ServicedeskIntegrationsCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmTaskRemindersJobs(): Promise<void> {
  const queue = getCrmTaskRemindersQueue()
  await queue.upsertJobScheduler(
    CrmTaskRemindersJob.RunTick,
    { pattern: CrmTaskRemindersCron, tz: RetentionTimezone },
    { name: CrmTaskRemindersJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.crm_task_reminders_registered', {
    component: 'Worker',
    pattern: CrmTaskRemindersCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleServicedeskTaskRemindersJobs(): Promise<void> {
  const queue = getServicedeskTaskRemindersQueue()
  await queue.upsertJobScheduler(
    ServicedeskTaskRemindersJob.RunTick,
    { pattern: ServicedeskTaskRemindersCron, tz: RetentionTimezone },
    { name: ServicedeskTaskRemindersJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_task_reminders_registered', {
    component: 'Worker',
    pattern: ServicedeskTaskRemindersCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleSteelAgentsJobs(): Promise<void> {
  const queue = getSteelAgentsQueue()
  await queue.upsertJobScheduler(
    SteelAgentsJob.Tick,
    { pattern: SteelAgentsTickCron, tz: RetentionTimezone },
    { name: SteelAgentsJob.Tick, data: {} },
  )

  logger.info('queue.scheduler.steel_agents_registered', {
    component: 'Worker',
    pattern: SteelAgentsTickCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleNotificationsJobs(): Promise<void> {
  const queue = getNotificationsQueue()
  await queue.upsertJobScheduler(
    NotificationsJob.AiActionExpiryTick,
    { pattern: NotificationsAiActionExpiryCron, tz: RetentionTimezone },
    { name: NotificationsJob.AiActionExpiryTick, data: {} },
  )

  logger.info('queue.scheduler.notifications_registered', {
    component: 'Worker',
    pattern: NotificationsAiActionExpiryCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleSearchReindexJobs(): Promise<void> {
  const queue = getSearchReindexQueue()
  await queue.upsertJobScheduler(
    SearchReindexJob.ReindexAll,
    { pattern: SearchReindexCron, tz: RetentionTimezone },
    { name: SearchReindexJob.ReindexAll, data: {} },
  )

  logger.info('queue.scheduler.search_reindex_registered', {
    component: 'Worker',
    pattern: SearchReindexCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleAiUsageWeeklyEmailJobs(): Promise<void> {
  const queue = getAiUsageWeeklyEmailQueue()
  await queue.upsertJobScheduler(
    AiUsageWeeklyEmailJob.Tick,
    { pattern: AiUsageWeeklyEmailCron, tz: RetentionTimezone },
    { name: AiUsageWeeklyEmailJob.Tick, data: {} },
  )

  logger.info('queue.scheduler.ai_usage_weekly_email_registered', {
    component: 'Worker',
    pattern: AiUsageWeeklyEmailCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleWorkspaceExportJobs(): Promise<void> {
  const queue = getWorkspaceExportQueue()
  await queue.upsertJobScheduler(
    WorkspaceExportJob.PruneExpired,
    { pattern: WorkspaceExportPruneCron, tz: RetentionTimezone },
    { name: WorkspaceExportJob.PruneExpired, data: {} },
  )

  logger.info('queue.scheduler.workspace_export_registered', {
    component: 'Worker',
    pattern: WorkspaceExportPruneCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleWorkspaceIntegrationsJobs(): Promise<void> {
  const queue = getWorkspaceIntegrationsQueue()
  await queue.upsertJobScheduler(
    WorkspaceIntegrationsJob.CommunicationWaitingTick,
    { pattern: CommunicationWaitingCron, tz: RetentionTimezone },
    { name: WorkspaceIntegrationsJob.CommunicationWaitingTick, data: {} },
  )

  logger.info('queue.scheduler.workspace_integrations_registered', {
    component: 'Worker',
    pattern: CommunicationWaitingCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmCampaignsJobs(): Promise<void> {
  const queue = getCrmCampaignsQueue()
  await queue.upsertJobScheduler(
    CrmCampaignsJob.Tick,
    { pattern: CrmCampaignsTickCron, tz: RetentionTimezone },
    { name: CrmCampaignsJob.Tick, data: {} },
  )

  logger.info('queue.scheduler.crm_campaigns_registered', {
    component: 'Worker',
    pattern: CrmCampaignsTickCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleSitePostsJobs(): Promise<void> {
  const queue = getSitePostsQueue()
  await queue.upsertJobScheduler(
    SitePostsJob.PublishDue,
    { pattern: SitePostsPublishCron, tz: RetentionTimezone },
    { name: SitePostsJob.PublishDue, data: {} },
  )

  logger.info('queue.scheduler.site_posts_registered', {
    component: 'Worker',
    pattern: SitePostsPublishCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleAiIndexJobs(): Promise<void> {
  const queue = getAiIndexQueue()
  await queue.upsertJobScheduler(
    AiIndexJob.ReindexAll,
    { pattern: AiIndexReindexCron, tz: RetentionTimezone },
    { name: AiIndexJob.ReindexAll, data: {} },
  )

  logger.info('queue.scheduler.ai_index_registered', {
    component: 'Worker',
    pattern: AiIndexReindexCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleAiProactiveJobs(): Promise<void> {
  const queue = getAiProactiveQueue()
  await queue.upsertJobScheduler(
    AiProactiveJob.InsightsTick,
    { pattern: AiProactiveInsightsCron, tz: RetentionTimezone },
    { name: AiProactiveJob.InsightsTick, data: {} },
  )
  await queue.upsertJobScheduler(
    AiProactiveJob.DigestTick,
    { pattern: AiProactiveDigestCron, tz: RetentionTimezone },
    { name: AiProactiveJob.DigestTick, data: {} },
  )

  logger.info('queue.scheduler.ai_proactive_registered', {
    component: 'Worker',
    insightsPattern: AiProactiveInsightsCron,
    digestPattern: AiProactiveDigestCron,
    timezone: RetentionTimezone,
  })
}
