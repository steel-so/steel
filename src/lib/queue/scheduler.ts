import { logger } from '@/lib/axiom/logger'
import { TRIAL_EXPIRY_CRON } from '@/src/config/trial'
import {
  AiIndexJob,
  AiProactiveJob,
  AiUsageWeeklyEmailJob,
  CrmCadencesJob,
  CrmCampaignsJob,
  CrmCompetitorSyncJob,
  CrmDealsJob,
  CrmDuplicatesJob,
  CrmHealthJob,
  CrmNewsletterAutomationJob,
  CrmNewsletterJob,
  CrmProposalExpiryJob,
  CrmScheduledSendJob,
  CrmSocialPostsTickJob,
  CrmTaskRemindersJob,
  CrmWorkflowScheduleJob,
  DatabaseBackupJob,
  DataRetentionJob,
  DocumentsAnalyticsJob,
  DocumentsExpiryJob,
  DocumentsLegacyImportJob,
  NotificationsJob,
  SearchReindexJob,
  SendingDomainsJob,
  ServicedeskBillingJob,
  ServicedeskDigestJob,
  ServicedeskIntegrationsJob,
  ServicedeskInventoryJob,
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
  WhatsappArchiveJob,
  WhatsappAutomationsJob,
  WhatsappBroadcastJob,
  WhatsappConversationLifecycleJob,
  WhatsappMetaSpendJob,
  WorkspaceExportJob,
  WorkspaceIntegrationsJob,
} from './jobs'
import { clearFinishedJob } from './processors/clear-finished-job'
import {
  getAiIndexQueue,
  getAiProactiveQueue,
  getAiUsageWeeklyEmailQueue,
  getCrmCadencesQueue,
  getCrmCampaignsQueue,
  getCrmCompetitorSyncQueue,
  getCrmDealsQueue,
  getCrmDuplicatesQueue,
  getCrmHealthQueue,
  getCrmNewsletterAutomationQueue,
  getCrmNewsletterQueue,
  getCrmProposalExpiryQueue,
  getCrmScheduledSendQueue,
  getCrmSocialPostsTickQueue,
  getCrmTaskRemindersQueue,
  getCrmWorkflowScheduleQueue,
  getDatabaseBackupQueue,
  getDataRetentionQueue,
  getDocumentsAnalyticsQueue,
  getDocumentsExpiryQueue,
  getDocumentsLegacyImportQueue,
  getNotificationsQueue,
  getSearchReindexQueue,
  getSendingDomainsQueue,
  getServicedeskBillingQueue,
  getServicedeskDigestQueue,
  getServicedeskIntegrationsQueue,
  getServicedeskInventoryQueue,
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
  getWhatsappArchiveQueue,
  getWhatsappAutomationsQueue,
  getWhatsappBroadcastQueue,
  getWhatsappConversationLifecycleQueue,
  getWhatsappMetaSpendQueue,
  getWorkspaceExportQueue,
  getWorkspaceIntegrationsQueue,
} from './queues'
import {
  AiIndexReindexCron,
  AiProactiveDigestCron,
  AiProactiveInsightsCron,
  AiUsageWeeklyEmailCron,
  CommunicationWaitingCron,
  CrmCadencesCron,
  CrmCampaignsTickCron,
  CrmCompetitorSyncCron,
  CrmDealsCron,
  CrmDuplicatesCron,
  CrmHealthCron,
  CrmNewsletterAbTickCron,
  CrmNewsletterAutomationCron,
  CrmNewsletterDigestTickCron,
  CrmNewsletterTickCron,
  CrmScheduledSendCron,
  CrmSocialPostsTickCron,
  CrmTaskRemindersCron,
  CrmWorkflowScheduleCron,
  DatabaseBackupCron,
  DocumentsAnalyticsFlushCron,
  DocumentsExpiryCron,
  NotificationsAiActionExpiryCron,
  RetentionCron,
  RetentionTimezone,
  SearchReindexCron,
  SendingDomainsCheckCron,
  ServicedeskBillingCron,
  ServicedeskClusterCron,
  ServicedeskDigestCron,
  ServicedeskDiscoveryCron,
  ServicedeskIntegrationsCron,
  ServicedeskInventoryCron,
  ServicedeskLicenseExpiryCron,
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
  WhatsappArchiveCron,
  WhatsappAutomationsCron,
  WhatsappBroadcastScheduleCron,
  WhatsappConversationAutoCloseCron,
  WhatsappDistributionTickCron,
  WhatsappMetaSpendCron,
  WhatsappSlaTickCron,
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

  await queue.upsertJobScheduler(
    DataRetentionJob.CleanupWorkspaceAccessLogs,
    repeat,
    { name: DataRetentionJob.CleanupWorkspaceAccessLogs, data: {} },
  )

  await queue.upsertJobScheduler(
    DataRetentionJob.CleanupChatbotNodeStats,
    repeat,
    { name: DataRetentionJob.CleanupChatbotNodeStats, data: {} },
  )

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
      DataRetentionJob.CleanupWorkspaceAccessLogs,
      DataRetentionJob.CleanupChatbotNodeStats,
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
  await queue.upsertJobScheduler(
    WhatsappConversationLifecycleJob.DistributionTick,
    { pattern: WhatsappDistributionTickCron, tz: RetentionTimezone },
    { name: WhatsappConversationLifecycleJob.DistributionTick, data: {} },
  )

  logger.info('queue.scheduler.whatsapp_conversation_lifecycle_registered', {
    component: 'Worker',
    pattern: WhatsappConversationAutoCloseCron,
    timezone: RetentionTimezone,
  })

  await queue.upsertJobScheduler(
    WhatsappConversationLifecycleJob.SlaTick,
    { pattern: WhatsappSlaTickCron, tz: RetentionTimezone },
    { name: WhatsappConversationLifecycleJob.SlaTick, data: {} },
  )

  logger.info('queue.scheduler.whatsapp_sla_tick_registered', {
    component: 'Worker',
    pattern: WhatsappSlaTickCron,
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

/**
 * The legacy proposal expiry is replaced by `documents-expiry` (ADR 0063):
 * drop its repeatable so the old daily tick stops running.
 */
export async function unscheduleCrmProposalExpiryJobs(): Promise<void> {
  const queue = getCrmProposalExpiryQueue()
  await queue.removeJobScheduler(CrmProposalExpiryJob.RunTick)

  logger.info('queue.scheduler.crm_proposal_expiry_removed', {
    component: 'Worker',
  })
}

/**
 * Fixed id: a boot while a run is still waiting or running does not add a
 * second one; a finished run is cleared first, so every boot runs again.
 */
export const DOCUMENTS_LEGACY_IMPORT_JOB_ID = 'documents-legacy-import-run'

/**
 * Legacy proposals → documents (ADR 0063), once per worker boot. Re-runs
 * are harmless (idempotent) and pick up records an earlier run skipped.
 */
export async function enqueueDocumentsLegacyImport(): Promise<void> {
  const queue = getDocumentsLegacyImportQueue()
  await clearFinishedJob(queue, DOCUMENTS_LEGACY_IMPORT_JOB_ID)
  await queue.add(
    DocumentsLegacyImportJob.Run,
    {},
    { jobId: DOCUMENTS_LEGACY_IMPORT_JOB_ID },
  )

  logger.info('queue.scheduler.documents_legacy_import_enqueued', {
    component: 'Worker',
    jobId: DOCUMENTS_LEGACY_IMPORT_JOB_ID,
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

export async function scheduleServicedeskInventoryJobs(): Promise<void> {
  const queue = getServicedeskInventoryQueue()
  await queue.upsertJobScheduler(
    ServicedeskInventoryJob.ScanDue,
    { pattern: ServicedeskInventoryCron, tz: RetentionTimezone },
    { name: ServicedeskInventoryJob.ScanDue, data: {} },
  )
  await queue.upsertJobScheduler(
    ServicedeskInventoryJob.DiscoveryDue,
    { pattern: ServicedeskDiscoveryCron, tz: RetentionTimezone },
    { name: ServicedeskInventoryJob.DiscoveryDue, data: {} },
  )
  await queue.upsertJobScheduler(
    ServicedeskInventoryJob.LicenseExpiry,
    { pattern: ServicedeskLicenseExpiryCron, tz: RetentionTimezone },
    { name: ServicedeskInventoryJob.LicenseExpiry, data: {} },
  )

  logger.info('queue.scheduler.servicedesk_inventory_registered', {
    component: 'Worker',
    pattern: ServicedeskInventoryCron,
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

export async function scheduleCrmDuplicatesJobs(): Promise<void> {
  const queue = getCrmDuplicatesQueue()
  await queue.upsertJobScheduler(
    CrmDuplicatesJob.RunScan,
    { pattern: CrmDuplicatesCron, tz: RetentionTimezone },
    { name: CrmDuplicatesJob.RunScan, data: {} },
  )

  logger.info('queue.scheduler.crm_duplicates_registered', {
    component: 'Worker',
    pattern: CrmDuplicatesCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmHealthJobs(): Promise<void> {
  const queue = getCrmHealthQueue()
  await queue.upsertJobScheduler(
    CrmHealthJob.Recompute,
    { pattern: CrmHealthCron, tz: RetentionTimezone },
    { name: CrmHealthJob.Recompute, data: {} },
  )

  logger.info('queue.scheduler.crm_health_registered', {
    component: 'Worker',
    pattern: CrmHealthCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmDealsJobs(): Promise<void> {
  const queue = getCrmDealsQueue()
  await queue.upsertJobScheduler(
    CrmDealsJob.RenewalScan,
    { pattern: CrmDealsCron, tz: RetentionTimezone },
    { name: CrmDealsJob.RenewalScan, data: {} },
  )

  logger.info('queue.scheduler.crm_deals_registered', {
    component: 'Worker',
    pattern: CrmDealsCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleCrmCadencesJobs(): Promise<void> {
  const queue = getCrmCadencesQueue()
  await queue.upsertJobScheduler(
    CrmCadencesJob.RunTick,
    { pattern: CrmCadencesCron, tz: RetentionTimezone },
    { name: CrmCadencesJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.crm_cadences_registered', {
    component: 'Worker',
    pattern: CrmCadencesCron,
    timezone: RetentionTimezone,
  })
}

export async function scheduleWhatsappAutomationsJobs(): Promise<void> {
  const queue = getWhatsappAutomationsQueue()

  // 'ecom-tick' was removed with the e-commerce triggers (Z8/Z9); drop the
  // orphaned repeatable so it stops producing dead jobs.
  for (const legacy of ['ecom-tick']) {
    await queue.removeJobScheduler(legacy)
  }

  for (const name of [WhatsappAutomationsJob.SchedulingTick]) {
    await queue.upsertJobScheduler(
      name,
      { pattern: WhatsappAutomationsCron, tz: RetentionTimezone },
      { name, data: {} },
    )
  }

  logger.info('queue.scheduler.whatsapp_automations_registered', {
    component: 'Worker',
    pattern: WhatsappAutomationsCron,
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

/** WhatsApp archive for banks (ADR 0052): weekly, monthly full and prune. */
export async function scheduleWhatsappArchiveJobs(): Promise<void> {
  const queue = getWhatsappArchiveQueue()
  await queue.upsertJobScheduler(
    WhatsappArchiveJob.ScheduleWeekly,
    { pattern: WhatsappArchiveCron.weekly, tz: RetentionTimezone },
    { name: WhatsappArchiveJob.ScheduleWeekly, data: {} },
  )
  await queue.upsertJobScheduler(
    WhatsappArchiveJob.ScheduleMonthly,
    { pattern: WhatsappArchiveCron.monthlyFull, tz: RetentionTimezone },
    { name: WhatsappArchiveJob.ScheduleMonthly, data: {} },
  )
  await queue.upsertJobScheduler(
    WhatsappArchiveJob.PruneExpired,
    { pattern: WhatsappArchiveCron.pruneExpired, tz: RetentionTimezone },
    { name: WhatsappArchiveJob.PruneExpired, data: {} },
  )

  logger.info('queue.scheduler.whatsapp_archive_registered', {
    component: 'Worker',
    weeklyPattern: WhatsappArchiveCron.weekly,
    monthlyFullPattern: WhatsappArchiveCron.monthlyFull,
    prunePattern: WhatsappArchiveCron.pruneExpired,
    timezone: RetentionTimezone,
  })
}

/** Sending domains (ADR 0054): the 10-minute re-check tick. */
export async function scheduleSendingDomainsJobs(): Promise<void> {
  const queue = getSendingDomainsQueue()
  await queue.upsertJobScheduler(
    SendingDomainsJob.CheckTick,
    { pattern: SendingDomainsCheckCron, tz: RetentionTimezone },
    { name: SendingDomainsJob.CheckTick, data: {} },
  )

  logger.info('queue.scheduler.sending_domains_registered', {
    component: 'Worker',
    pattern: SendingDomainsCheckCron,
    timezone: RetentionTimezone,
  })
}

/** zap-spend-cap (ADR 0064): Meta spend of capped numbers every 15 min. */
export async function scheduleWhatsappMetaSpendJobs(): Promise<void> {
  const queue = getWhatsappMetaSpendQueue()
  await queue.upsertJobScheduler(
    WhatsappMetaSpendJob.RefreshTick,
    { pattern: WhatsappMetaSpendCron, tz: RetentionTimezone },
    { name: WhatsappMetaSpendJob.RefreshTick, data: {} },
  )

  logger.info('queue.scheduler.whatsapp_meta_spend_registered', {
    component: 'Worker',
    pattern: WhatsappMetaSpendCron,
    timezone: RetentionTimezone,
  })
}

/** CRM newsletter (ADR 0054): every minute. */
export async function scheduleCrmNewsletterJobs(): Promise<void> {
  const queue = getCrmNewsletterQueue()
  await queue.upsertJobScheduler(
    CrmNewsletterJob.Tick,
    { pattern: CrmNewsletterTickCron, tz: RetentionTimezone },
    { name: CrmNewsletterJob.Tick, data: {} },
  )
  await queue.upsertJobScheduler(
    CrmNewsletterJob.DigestTick,
    { pattern: CrmNewsletterDigestTickCron, tz: RetentionTimezone },
    { name: CrmNewsletterJob.DigestTick, data: {} },
  )
  await queue.upsertJobScheduler(
    CrmNewsletterJob.AbTick,
    { pattern: CrmNewsletterAbTickCron, tz: RetentionTimezone },
    { name: CrmNewsletterJob.AbTick, data: {} },
  )

  logger.info('queue.scheduler.crm_newsletter_registered', {
    component: 'Worker',
    pattern: CrmNewsletterTickCron,
    timezone: RetentionTimezone,
  })
}

/** Newsletter automation (nl2-automation): welcome, monthly, daily. */
export async function scheduleCrmNewsletterAutomationJobs(): Promise<void> {
  const queue = getCrmNewsletterAutomationQueue()
  const cron = CrmNewsletterAutomationCron
  await queue.upsertJobScheduler(
    CrmNewsletterAutomationJob.WelcomeTick,
    { pattern: cron.welcomeTick, tz: RetentionTimezone },
    { name: CrmNewsletterAutomationJob.WelcomeTick, data: {} },
  )
  await queue.upsertJobScheduler(
    CrmNewsletterAutomationJob.ReengagementMonthly,
    { pattern: cron.reengagementMonthly, tz: RetentionTimezone },
    { name: CrmNewsletterAutomationJob.ReengagementMonthly, data: {} },
  )
  await queue.upsertJobScheduler(
    CrmNewsletterAutomationJob.ReengagementResolve,
    { pattern: cron.reengagementResolve, tz: RetentionTimezone },
    { name: CrmNewsletterAutomationJob.ReengagementResolve, data: {} },
  )

  logger.info('queue.scheduler.crm_newsletter_automation_registered', {
    component: 'Worker',
    ...cron,
    timezone: RetentionTimezone,
  })
}

/** documents backend (ADR 0063): daily expiry of sent documents (00:10). */
export async function scheduleDocumentsExpiryJobs(): Promise<void> {
  const queue = getDocumentsExpiryQueue()
  await queue.upsertJobScheduler(
    DocumentsExpiryJob.RunTick,
    { pattern: DocumentsExpiryCron, tz: RetentionTimezone },
    { name: DocumentsExpiryJob.RunTick, data: {} },
  )

  logger.info('queue.scheduler.documents_expiry_registered', {
    component: 'Worker',
    pattern: DocumentsExpiryCron,
    timezone: RetentionTimezone,
  })
}

/** documents analytics: reading buffer → Postgres, every minute. */
export async function scheduleDocumentsAnalyticsJobs(): Promise<void> {
  const queue = getDocumentsAnalyticsQueue()
  await queue.upsertJobScheduler(
    DocumentsAnalyticsJob.Flush,
    { pattern: DocumentsAnalyticsFlushCron, tz: RetentionTimezone },
    { name: DocumentsAnalyticsJob.Flush, data: {} },
  )

  logger.info('queue.scheduler.documents_analytics_registered', {
    component: 'Worker',
    pattern: DocumentsAnalyticsFlushCron,
    timezone: RetentionTimezone,
  })
}
