import { Queue } from 'bullmq'
import { getQueueConnection } from './connection'
import {
  type AccountLifecycleJob,
  type AccountLifecycleJobPayload,
  type AiUsageWeeklyEmailJob,
  type AiUsageWeeklyEmailJobPayload,
  type ChangelogJob,
  type ChangelogJobPayload,
  type CrmCampaignsJob,
  type CrmCampaignsJobPayload,
  type CrmCompetitorSyncJob,
  type CrmCompetitorSyncJobPayload,
  type CrmProposalExpiryJob,
  type CrmProposalExpiryJobPayload,
  type CrmScheduledSendJob,
  type CrmScheduledSendJobPayload,
  type CrmSocialPostsTickJob,
  type CrmSocialPostsTickJobPayload,
  type CrmSocialPublishJob,
  type CrmSocialPublishJobPayload,
  type CrmTaskRemindersJob,
  type CrmTaskRemindersJobPayload,
  type CrmWorkflowDelayJob,
  type CrmWorkflowDelayJobPayload,
  type CrmWorkflowScheduleJob,
  type CrmWorkflowScheduleJobPayload,
  type DatabaseBackupJob,
  type DatabaseBackupJobPayload,
  type DataExportJob,
  type DataExportJobPayload,
  type DataRetentionJob,
  type DataRetentionJobPayload,
  type NotificationsJob,
  type NotificationsJobPayload,
  QueueName,
  type SearchReindexJob,
  type SearchReindexJobPayload,
  type ServicedeskAiJob,
  type ServicedeskAiJobPayload,
  type ServicedeskBillingJob,
  type ServicedeskBillingJobPayload,
  type ServicedeskDigestJob,
  type ServicedeskDigestJobPayload,
  type ServicedeskIntegrationsJob,
  type ServicedeskIntegrationsJobPayload,
  type ServicedeskMailJob,
  type ServicedeskMailJobPayload,
  type ServicedeskRecurringJob,
  type ServicedeskRecurringJobPayload,
  type ServicedeskReportsJob,
  type ServicedeskReportsJobPayload,
  type ServicedeskRiskJob,
  type ServicedeskRiskJobPayload,
  type ServicedeskSlaJob,
  type ServicedeskSlaJobPayload,
  type ServicedeskTaskRemindersJob,
  type ServicedeskTaskRemindersJobPayload,
  type StatusCollectJob,
  type StatusCollectJobPayload,
  type SteelAgentsJob,
  type SteelAgentsJobPayload,
  type TrialLifecycleJob,
  type TrialLifecycleJobPayload,
  type UsageRollupJob,
  type UsageRollupJobPayload,
  type WhatsappAiReplyJob,
  type WhatsappAiReplyJobPayload,
  type WhatsappBroadcastJob,
  type WhatsappBroadcastJobPayload,
  type WhatsappConversationLifecycleJob,
  type WhatsappConversationLifecycleJobPayload,
  type WhatsappMediaJob,
  type WhatsappMediaJobPayload,
  type WhatsappSentimentJob,
  type WhatsappSentimentJobPayload,
  type WhatsappTemplateSyncJob,
  type WhatsappTemplateSyncJobPayload,
  type WorkspaceExportJob,
  type WorkspaceExportJobPayload,
  type WorkspaceIntegrationsJob,
  type WorkspaceIntegrationsJobPayload,
} from './jobs'

const defaultJobOptions = {
  removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
} as const

let dataRetentionQueue: Queue | null = null
let accountLifecycleQueue: Queue | null = null
let dataExportQueue: Queue | null = null
let trialLifecycleQueue: Queue | null = null
let whatsappMediaQueue: Queue | null = null
let whatsappAiReplyQueue: Queue | null = null
let whatsappSentimentQueue: Queue | null = null
let whatsappBroadcastQueue: Queue | null = null
let whatsappTemplateSyncQueue: Queue | null = null
let whatsappConversationLifecycleQueue: Queue | null = null
let crmScheduledSendQueue: Queue | null = null
let crmWorkflowScheduleQueue: Queue | null = null
let crmCompetitorSyncQueue: Queue | null = null
let crmProposalExpiryQueue: Queue | null = null
let crmTaskRemindersQueue: Queue | null = null
let crmSocialPostsTickQueue: Queue | null = null
let crmSocialPublishQueue: Queue | null = null
let changelogQueue: Queue | null = null
let databaseBackupQueue: Queue | null = null
let statusCollectQueue: Queue | null = null
let usageRollupQueue: Queue | null = null
let servicedeskSlaQueue: Queue | null = null
let servicedeskAiQueue: Queue | null = null
let servicedeskMailQueue: Queue | null = null
let servicedeskDigestQueue: Queue | null = null
let servicedeskRecurringQueue: Queue | null = null
let servicedeskBillingQueue: Queue | null = null
let servicedeskReportsQueue: Queue | null = null
let servicedeskRiskQueue: Queue | null = null
let servicedeskIntegrationsQueue: Queue | null = null
let servicedeskTaskRemindersQueue: Queue | null = null
let steelAgentsQueue: Queue | null = null
let notificationsQueue: Queue | null = null
let searchReindexQueue: Queue | null = null
let aiUsageWeeklyEmailQueue: Queue | null = null
let workspaceExportQueue: Queue | null = null
let workspaceIntegrationsQueue: Queue | null = null
let crmCampaignsQueue: Queue | null = null
let crmWorkflowDelayQueue: Queue | null = null

export function getDataRetentionQueue(): Queue<
  DataRetentionJobPayload[DataRetentionJob],
  unknown,
  DataRetentionJob
> {
  if (!dataRetentionQueue) {
    dataRetentionQueue = new Queue(QueueName.DataRetention, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return dataRetentionQueue as Queue<
    DataRetentionJobPayload[DataRetentionJob],
    unknown,
    DataRetentionJob
  >
}

export function getAccountLifecycleQueue(): Queue<
  AccountLifecycleJobPayload[AccountLifecycleJob],
  unknown,
  AccountLifecycleJob
> {
  if (!accountLifecycleQueue) {
    accountLifecycleQueue = new Queue(QueueName.AccountLifecycle, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return accountLifecycleQueue as Queue<
    AccountLifecycleJobPayload[AccountLifecycleJob],
    unknown,
    AccountLifecycleJob
  >
}

export function getDataExportQueue(): Queue<
  DataExportJobPayload[DataExportJob],
  unknown,
  DataExportJob
> {
  if (!dataExportQueue) {
    dataExportQueue = new Queue(QueueName.DataExport, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return dataExportQueue as Queue<
    DataExportJobPayload[DataExportJob],
    unknown,
    DataExportJob
  >
}

export function getTrialLifecycleQueue(): Queue<
  TrialLifecycleJobPayload[TrialLifecycleJob],
  unknown,
  TrialLifecycleJob
> {
  if (!trialLifecycleQueue) {
    trialLifecycleQueue = new Queue(QueueName.TrialLifecycle, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return trialLifecycleQueue as Queue<
    TrialLifecycleJobPayload[TrialLifecycleJob],
    unknown,
    TrialLifecycleJob
  >
}

export function getWhatsappMediaQueue(): Queue<
  WhatsappMediaJobPayload[WhatsappMediaJob],
  unknown,
  WhatsappMediaJob
> {
  if (!whatsappMediaQueue) {
    whatsappMediaQueue = new Queue(QueueName.WhatsappMedia, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return whatsappMediaQueue as Queue<
    WhatsappMediaJobPayload[WhatsappMediaJob],
    unknown,
    WhatsappMediaJob
  >
}

export function getWhatsappAiReplyQueue(): Queue<
  WhatsappAiReplyJobPayload[WhatsappAiReplyJob],
  unknown,
  WhatsappAiReplyJob
> {
  if (!whatsappAiReplyQueue) {
    whatsappAiReplyQueue = new Queue(QueueName.WhatsappAiReply, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return whatsappAiReplyQueue as Queue<
    WhatsappAiReplyJobPayload[WhatsappAiReplyJob],
    unknown,
    WhatsappAiReplyJob
  >
}

export function getWhatsappSentimentQueue(): Queue<
  WhatsappSentimentJobPayload[WhatsappSentimentJob],
  unknown,
  WhatsappSentimentJob
> {
  if (!whatsappSentimentQueue) {
    whatsappSentimentQueue = new Queue(QueueName.WhatsappSentiment, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return whatsappSentimentQueue as Queue<
    WhatsappSentimentJobPayload[WhatsappSentimentJob],
    unknown,
    WhatsappSentimentJob
  >
}

export function getWhatsappBroadcastQueue(): Queue<
  WhatsappBroadcastJobPayload[WhatsappBroadcastJob],
  unknown,
  WhatsappBroadcastJob
> {
  if (!whatsappBroadcastQueue) {
    whatsappBroadcastQueue = new Queue(QueueName.WhatsappBroadcast, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return whatsappBroadcastQueue as Queue<
    WhatsappBroadcastJobPayload[WhatsappBroadcastJob],
    unknown,
    WhatsappBroadcastJob
  >
}

export function getWhatsappConversationLifecycleQueue(): Queue<
  WhatsappConversationLifecycleJobPayload[WhatsappConversationLifecycleJob],
  unknown,
  WhatsappConversationLifecycleJob
> {
  if (!whatsappConversationLifecycleQueue) {
    whatsappConversationLifecycleQueue = new Queue(
      QueueName.WhatsappConversationLifecycle,
      { connection: getQueueConnection(), defaultJobOptions },
    )
  }
  return whatsappConversationLifecycleQueue as Queue<
    WhatsappConversationLifecycleJobPayload[WhatsappConversationLifecycleJob],
    unknown,
    WhatsappConversationLifecycleJob
  >
}

export function getChangelogQueue(): Queue<
  ChangelogJobPayload[ChangelogJob],
  unknown,
  ChangelogJob
> {
  if (!changelogQueue) {
    changelogQueue = new Queue(QueueName.Changelog, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return changelogQueue as Queue<
    ChangelogJobPayload[ChangelogJob],
    unknown,
    ChangelogJob
  >
}

export function getWhatsappTemplateSyncQueue(): Queue<
  WhatsappTemplateSyncJobPayload[WhatsappTemplateSyncJob],
  unknown,
  WhatsappTemplateSyncJob
> {
  if (!whatsappTemplateSyncQueue) {
    whatsappTemplateSyncQueue = new Queue(QueueName.WhatsappTemplateSync, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return whatsappTemplateSyncQueue as Queue<
    WhatsappTemplateSyncJobPayload[WhatsappTemplateSyncJob],
    unknown,
    WhatsappTemplateSyncJob
  >
}

export function getCrmScheduledSendQueue(): Queue<
  CrmScheduledSendJobPayload[CrmScheduledSendJob],
  unknown,
  CrmScheduledSendJob
> {
  if (!crmScheduledSendQueue) {
    crmScheduledSendQueue = new Queue(QueueName.CrmScheduledSend, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmScheduledSendQueue as Queue<
    CrmScheduledSendJobPayload[CrmScheduledSendJob],
    unknown,
    CrmScheduledSendJob
  >
}

export function getCrmWorkflowScheduleQueue(): Queue<
  CrmWorkflowScheduleJobPayload[CrmWorkflowScheduleJob],
  unknown,
  CrmWorkflowScheduleJob
> {
  if (!crmWorkflowScheduleQueue) {
    crmWorkflowScheduleQueue = new Queue(QueueName.CrmWorkflowSchedule, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmWorkflowScheduleQueue as Queue<
    CrmWorkflowScheduleJobPayload[CrmWorkflowScheduleJob],
    unknown,
    CrmWorkflowScheduleJob
  >
}

export function getCrmCompetitorSyncQueue(): Queue<
  CrmCompetitorSyncJobPayload[CrmCompetitorSyncJob],
  unknown,
  CrmCompetitorSyncJob
> {
  if (!crmCompetitorSyncQueue) {
    crmCompetitorSyncQueue = new Queue(QueueName.CrmCompetitorSync, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmCompetitorSyncQueue as Queue<
    CrmCompetitorSyncJobPayload[CrmCompetitorSyncJob],
    unknown,
    CrmCompetitorSyncJob
  >
}

export function getCrmProposalExpiryQueue(): Queue<
  CrmProposalExpiryJobPayload[CrmProposalExpiryJob],
  unknown,
  CrmProposalExpiryJob
> {
  if (!crmProposalExpiryQueue) {
    crmProposalExpiryQueue = new Queue(QueueName.CrmProposalExpiry, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmProposalExpiryQueue as Queue<
    CrmProposalExpiryJobPayload[CrmProposalExpiryJob],
    unknown,
    CrmProposalExpiryJob
  >
}

export function getCrmSocialPostsTickQueue(): Queue<
  CrmSocialPostsTickJobPayload[CrmSocialPostsTickJob],
  unknown,
  CrmSocialPostsTickJob
> {
  if (!crmSocialPostsTickQueue) {
    crmSocialPostsTickQueue = new Queue(QueueName.CrmSocialPostsTick, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmSocialPostsTickQueue as Queue<
    CrmSocialPostsTickJobPayload[CrmSocialPostsTickJob],
    unknown,
    CrmSocialPostsTickJob
  >
}

export function getCrmSocialPublishQueue(): Queue<
  CrmSocialPublishJobPayload[CrmSocialPublishJob],
  unknown,
  CrmSocialPublishJob
> {
  if (!crmSocialPublishQueue) {
    crmSocialPublishQueue = new Queue(QueueName.CrmSocialPublish, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmSocialPublishQueue as Queue<
    CrmSocialPublishJobPayload[CrmSocialPublishJob],
    unknown,
    CrmSocialPublishJob
  >
}

export function getDatabaseBackupQueue(): Queue<
  DatabaseBackupJobPayload[DatabaseBackupJob],
  unknown,
  DatabaseBackupJob
> {
  if (!databaseBackupQueue) {
    databaseBackupQueue = new Queue(QueueName.DatabaseBackup, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return databaseBackupQueue as Queue<
    DatabaseBackupJobPayload[DatabaseBackupJob],
    unknown,
    DatabaseBackupJob
  >
}

/**
 * Sem retry: a coleta é um tick — se um probe falhar, o próximo tick (1–5 min)
 * já coleta de novo, e repetir só empilharia checks atrasados. Guarda poucos
 * jobs concluídos porque o core roda a cada minuto.
 */
const statusCollectJobOptions = {
  removeOnComplete: { age: 60 * 60, count: 100 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
  attempts: 1,
} as const

export function getStatusCollectQueue(): Queue<
  StatusCollectJobPayload[StatusCollectJob],
  unknown,
  StatusCollectJob
> {
  if (!statusCollectQueue) {
    statusCollectQueue = new Queue(QueueName.StatusCollect, {
      connection: getQueueConnection(),
      defaultJobOptions: statusCollectJobOptions,
    })
  }
  return statusCollectQueue as Queue<
    StatusCollectJobPayload[StatusCollectJob],
    unknown,
    StatusCollectJob
  >
}

/**
 * Sem retry: o rollup é um tick idempotente — o próximo (15 min) regrava os
 * mesmos dias.
 */
const usageRollupJobOptions = {
  removeOnComplete: { age: 60 * 60 * 24, count: 100 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
  attempts: 1,
} as const

export function getUsageRollupQueue(): Queue<
  UsageRollupJobPayload[UsageRollupJob],
  unknown,
  UsageRollupJob
> {
  if (!usageRollupQueue) {
    usageRollupQueue = new Queue(QueueName.UsageRollup, {
      connection: getQueueConnection(),
      defaultJobOptions: usageRollupJobOptions,
    })
  }
  return usageRollupQueue as Queue<
    UsageRollupJobPayload[UsageRollupJob],
    unknown,
    UsageRollupJob
  >
}

export function getServicedeskSlaQueue(): Queue<
  ServicedeskSlaJobPayload[ServicedeskSlaJob],
  unknown,
  ServicedeskSlaJob
> {
  if (!servicedeskSlaQueue) {
    servicedeskSlaQueue = new Queue(QueueName.ServicedeskSla, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return servicedeskSlaQueue as Queue<
    ServicedeskSlaJobPayload[ServicedeskSlaJob],
    unknown,
    ServicedeskSlaJob
  >
}

/**
 * IA do ServiceDesk. Duas tentativas: falha de provedor já vira desfecho
 * (`failed`/`skipped`) no service; só erro de banco volta a tentar.
 */
export function getServicedeskAiQueue(): Queue<
  ServicedeskAiJobPayload[ServicedeskAiJob],
  unknown,
  ServicedeskAiJob
> {
  if (!servicedeskAiQueue) {
    servicedeskAiQueue = new Queue(QueueName.ServicedeskAi, {
      connection: getQueueConnection(),
      defaultJobOptions: { ...defaultJobOptions, attempts: 2 },
    })
  }
  return servicedeskAiQueue as Queue<
    ServicedeskAiJobPayload[ServicedeskAiJob],
    unknown,
    ServicedeskAiJob
  >
}

/**
 * Canal de e-mail do ServiceDesk. Uma tentativa só: a leitura volta no
 * minuto seguinte e repetir o IMAP na hora costuma bater no mesmo erro.
 */
export function getServicedeskMailQueue(): Queue<
  ServicedeskMailJobPayload[ServicedeskMailJob],
  unknown,
  ServicedeskMailJob
> {
  if (!servicedeskMailQueue) {
    servicedeskMailQueue = new Queue(QueueName.ServicedeskMail, {
      connection: getQueueConnection(),
      defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
    })
  }
  return servicedeskMailQueue as Queue<
    ServicedeskMailJobPayload[ServicedeskMailJob],
    unknown,
    ServicedeskMailJob
  >
}

/**
 * Resumo diário: sem retry. O tick é horário e só dispara na hora local
 * combinada do workspace — repetir um job que já enviou resumos mandaria
 * e-mail duplicado.
 */
export function getServicedeskDigestQueue(): Queue<
  ServicedeskDigestJobPayload[ServicedeskDigestJob],
  unknown,
  ServicedeskDigestJob
> {
  if (!servicedeskDigestQueue) {
    servicedeskDigestQueue = new Queue(QueueName.ServicedeskDigest, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: 60 * 60 * 24 * 7, count: 100 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
        attempts: 1,
      },
    })
  }
  return servicedeskDigestQueue as Queue<
    ServicedeskDigestJobPayload[ServicedeskDigestJob],
    unknown,
    ServicedeskDigestJob
  >
}

/**
 * Chamados recorrentes do ServiceDesk. Uma tentativa só: o tick volta em 5
 * minutos e a trava `(recurringId, scheduledFor)` já garante que reprocessar
 * não duplica chamado.
 */
export function getServicedeskRecurringQueue(): Queue<
  ServicedeskRecurringJobPayload[ServicedeskRecurringJob],
  unknown,
  ServicedeskRecurringJob
> {
  if (!servicedeskRecurringQueue) {
    servicedeskRecurringQueue = new Queue(QueueName.ServicedeskRecurring, {
      connection: getQueueConnection(),
      defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
    })
  }
  return servicedeskRecurringQueue as Queue<
    ServicedeskRecurringJobPayload[ServicedeskRecurringJob],
    unknown,
    ServicedeskRecurringJob
  >
}

/**
 * Faturamento dos contratos: duas tentativas. O tick é idempotente por
 * `(contractId, periodStart)`, então repetir não duplica período nem valor.
 */
export function getServicedeskBillingQueue(): Queue<
  ServicedeskBillingJobPayload[ServicedeskBillingJob],
  unknown,
  ServicedeskBillingJob
> {
  if (!servicedeskBillingQueue) {
    servicedeskBillingQueue = new Queue(QueueName.ServicedeskBilling, {
      connection: getQueueConnection(),
      defaultJobOptions: { ...defaultJobOptions, attempts: 2 },
    })
  }
  return servicedeskBillingQueue as Queue<
    ServicedeskBillingJobPayload[ServicedeskBillingJob],
    unknown,
    ServicedeskBillingJob
  >
}

/**
 * Relatórios agendados: três tentativas. Gerar PDF e subir no MinIO pode
 * falhar por rede, e a trava `(reportId, periodStart)` evita mandar o mesmo
 * relatório duas vezes se a tentativa anterior já tinha enviado.
 */
export function getServicedeskReportsQueue(): Queue<
  ServicedeskReportsJobPayload[ServicedeskReportsJob],
  unknown,
  ServicedeskReportsJob
> {
  if (!servicedeskReportsQueue) {
    servicedeskReportsQueue = new Queue(QueueName.ServicedeskReports, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return servicedeskReportsQueue as Queue<
    ServicedeskReportsJobPayload[ServicedeskReportsJob],
    unknown,
    ServicedeskReportsJob
  >
}

/**
 * Análise preditiva: uma tentativa só. É recálculo periódico — se falhar, o
 * próximo tick (10 min) refaz tudo do zero.
 */
export function getServicedeskRiskQueue(): Queue<
  ServicedeskRiskJobPayload[ServicedeskRiskJob],
  unknown,
  ServicedeskRiskJob
> {
  if (!servicedeskRiskQueue) {
    servicedeskRiskQueue = new Queue(QueueName.ServicedeskRisk, {
      connection: getQueueConnection(),
      defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
    })
  }
  return servicedeskRiskQueue as Queue<
    ServicedeskRiskJobPayload[ServicedeskRiskJob],
    unknown,
    ServicedeskRiskJob
  >
}

/**
 * Saída para Slack/GitHub: mantém as três tentativas com backoff do padrão,
 * que é justamente o caso de uso (instabilidade momentânea do provedor).
 */
export function getServicedeskIntegrationsQueue(): Queue<
  ServicedeskIntegrationsJobPayload[ServicedeskIntegrationsJob],
  unknown,
  ServicedeskIntegrationsJob
> {
  if (!servicedeskIntegrationsQueue) {
    servicedeskIntegrationsQueue = new Queue(
      QueueName.ServicedeskIntegrations,
      { connection: getQueueConnection(), defaultJobOptions },
    )
  }
  return servicedeskIntegrationsQueue as Queue<
    ServicedeskIntegrationsJobPayload[ServicedeskIntegrationsJob],
    unknown,
    ServicedeskIntegrationsJob
  >
}

/**
 * Task due-date notices: a single attempt. The stamps make the tick
 * idempotent and the next one (15 min) picks up whatever was left.
 */
export function getServicedeskTaskRemindersQueue(): Queue<
  ServicedeskTaskRemindersJobPayload[ServicedeskTaskRemindersJob],
  unknown,
  ServicedeskTaskRemindersJob
> {
  if (!servicedeskTaskRemindersQueue) {
    servicedeskTaskRemindersQueue = new Queue(
      QueueName.ServicedeskTaskReminders,
      {
        connection: getQueueConnection(),
        defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
      },
    )
  }
  return servicedeskTaskRemindersQueue as Queue<
    ServicedeskTaskRemindersJobPayload[ServicedeskTaskRemindersJob],
    unknown,
    ServicedeskTaskRemindersJob
  >
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    dataRetentionQueue?.close(),
    accountLifecycleQueue?.close(),
    dataExportQueue?.close(),
    trialLifecycleQueue?.close(),
    whatsappMediaQueue?.close(),
    whatsappAiReplyQueue?.close(),
    whatsappSentimentQueue?.close(),
    whatsappBroadcastQueue?.close(),
    whatsappTemplateSyncQueue?.close(),
    whatsappConversationLifecycleQueue?.close(),
    crmScheduledSendQueue?.close(),
    crmWorkflowScheduleQueue?.close(),
    crmCompetitorSyncQueue?.close(),
    crmProposalExpiryQueue?.close(),
    crmSocialPostsTickQueue?.close(),
    crmSocialPublishQueue?.close(),
    changelogQueue?.close(),
    databaseBackupQueue?.close(),
    statusCollectQueue?.close(),
    usageRollupQueue?.close(),
    servicedeskSlaQueue?.close(),
    servicedeskAiQueue?.close(),
    servicedeskMailQueue?.close(),
    servicedeskDigestQueue?.close(),
    servicedeskRecurringQueue?.close(),
    servicedeskBillingQueue?.close(),
    servicedeskReportsQueue?.close(),
    servicedeskRiskQueue?.close(),
    servicedeskIntegrationsQueue?.close(),
    crmTaskRemindersQueue?.close(),
    servicedeskTaskRemindersQueue?.close(),
    steelAgentsQueue?.close(),
    searchReindexQueue?.close(),
    aiUsageWeeklyEmailQueue?.close(),
    workspaceExportQueue?.close(),
    workspaceIntegrationsQueue?.close(),
  ])
  dataRetentionQueue = null
  accountLifecycleQueue = null
  dataExportQueue = null
  trialLifecycleQueue = null
  whatsappMediaQueue = null
  whatsappAiReplyQueue = null
  whatsappSentimentQueue = null
  whatsappBroadcastQueue = null
  whatsappTemplateSyncQueue = null
  whatsappConversationLifecycleQueue = null
  crmScheduledSendQueue = null
  crmCompetitorSyncQueue = null
  crmProposalExpiryQueue = null
  crmTaskRemindersQueue = null
  crmSocialPostsTickQueue = null
  crmSocialPublishQueue = null
  changelogQueue = null
  databaseBackupQueue = null
  statusCollectQueue = null
  usageRollupQueue = null
  servicedeskSlaQueue = null
  servicedeskAiQueue = null
  servicedeskMailQueue = null
  servicedeskDigestQueue = null
  servicedeskRecurringQueue = null
  servicedeskBillingQueue = null
  servicedeskReportsQueue = null
  servicedeskRiskQueue = null
  servicedeskIntegrationsQueue = null
  servicedeskTaskRemindersQueue = null
  steelAgentsQueue = null
  searchReindexQueue = null
  aiUsageWeeklyEmailQueue = null
  workspaceExportQueue = null
  workspaceIntegrationsQueue = null
}

export function getCrmTaskRemindersQueue(): Queue<
  CrmTaskRemindersJobPayload[CrmTaskRemindersJob],
  unknown,
  CrmTaskRemindersJob
> {
  if (!crmTaskRemindersQueue) {
    crmTaskRemindersQueue = new Queue(QueueName.CrmTaskReminders, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmTaskRemindersQueue as Queue<
    CrmTaskRemindersJobPayload[CrmTaskRemindersJob],
    unknown,
    CrmTaskRemindersJob
  >
}

/** Steel Agents: single attempt (a retry could repeat automatic writes). */
export function getSteelAgentsQueue(): Queue<
  SteelAgentsJobPayload[SteelAgentsJob],
  unknown,
  SteelAgentsJob
> {
  if (!steelAgentsQueue) {
    steelAgentsQueue = new Queue(QueueName.SteelAgents, {
      connection: getQueueConnection(),
      defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
    })
  }
  return steelAgentsQueue as Queue<
    SteelAgentsJobPayload[SteelAgentsJob],
    unknown,
    SteelAgentsJob
  >
}

/** Inbox housekeeping ticks (idempotent: deduped notices). */
export function getNotificationsQueue(): Queue<
  NotificationsJobPayload[NotificationsJob],
  unknown,
  NotificationsJob
> {
  if (!notificationsQueue) {
    notificationsQueue = new Queue(QueueName.Notifications, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return notificationsQueue as Queue<
    NotificationsJobPayload[NotificationsJob],
    unknown,
    NotificationsJob
  >
}

/** Global search reindex (nightly rebuild + on-demand per workspace). */
export function getSearchReindexQueue(): Queue<
  SearchReindexJobPayload[SearchReindexJob],
  unknown,
  SearchReindexJob
> {
  if (!searchReindexQueue) {
    searchReindexQueue = new Queue(QueueName.SearchReindex, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return searchReindexQueue as Queue<
    SearchReindexJobPayload[SearchReindexJob],
    unknown,
    SearchReindexJob
  >
}

/** Weekly Steel AI usage e-mail (tick + one job per workspace). */
export function getAiUsageWeeklyEmailQueue(): Queue<
  AiUsageWeeklyEmailJobPayload[AiUsageWeeklyEmailJob],
  unknown,
  AiUsageWeeklyEmailJob
> {
  if (!aiUsageWeeklyEmailQueue) {
    aiUsageWeeklyEmailQueue = new Queue(QueueName.AiUsageWeeklyEmail, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return aiUsageWeeklyEmailQueue as Queue<
    AiUsageWeeklyEmailJobPayload[AiUsageWeeklyEmailJob],
    unknown,
    AiUsageWeeklyEmailJob
  >
}

/** Ajustes › Exportações (run one export + daily prune of expired files). */
export function getWorkspaceExportQueue(): Queue<
  WorkspaceExportJobPayload[WorkspaceExportJob],
  unknown,
  WorkspaceExportJob
> {
  if (!workspaceExportQueue) {
    workspaceExportQueue = new Queue(QueueName.WorkspaceExport, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return workspaceExportQueue as Queue<
    WorkspaceExportJobPayload[WorkspaceExportJob],
    unknown,
    WorkspaceExportJob
  >
}

/** Workspace-level integrations (Slack notifications, waiting tick). */
export function getWorkspaceIntegrationsQueue(): Queue<
  WorkspaceIntegrationsJobPayload[WorkspaceIntegrationsJob],
  unknown,
  WorkspaceIntegrationsJob
> {
  if (!workspaceIntegrationsQueue) {
    workspaceIntegrationsQueue = new Queue(QueueName.WorkspaceIntegrations, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return workspaceIntegrationsQueue as Queue<
    WorkspaceIntegrationsJobPayload[WorkspaceIntegrationsJob],
    unknown,
    WorkspaceIntegrationsJob
  >
}

export function getCrmCampaignsQueue(): Queue<
  CrmCampaignsJobPayload[CrmCampaignsJob],
  unknown,
  CrmCampaignsJob
> {
  if (!crmCampaignsQueue) {
    crmCampaignsQueue = new Queue(QueueName.CrmCampaigns, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmCampaignsQueue as Queue<
    CrmCampaignsJobPayload[CrmCampaignsJob],
    unknown,
    CrmCampaignsJob
  >
}

export function getCrmWorkflowDelayQueue(): Queue<
  CrmWorkflowDelayJobPayload[CrmWorkflowDelayJob],
  unknown,
  CrmWorkflowDelayJob
> {
  if (!crmWorkflowDelayQueue) {
    crmWorkflowDelayQueue = new Queue(QueueName.CrmWorkflowDelay, {
      connection: getQueueConnection(),
      defaultJobOptions,
    })
  }
  return crmWorkflowDelayQueue as Queue<
    CrmWorkflowDelayJobPayload[CrmWorkflowDelayJob],
    unknown,
    CrmWorkflowDelayJob
  >
}

// Typed as a full record so a new queue without an entry fails the build.
const QUEUE_GETTERS: Record<QueueName, () => unknown> = {
  [QueueName.DataRetention]: getDataRetentionQueue,
  [QueueName.AccountLifecycle]: getAccountLifecycleQueue,
  [QueueName.DataExport]: getDataExportQueue,
  [QueueName.TrialLifecycle]: getTrialLifecycleQueue,
  [QueueName.WhatsappMedia]: getWhatsappMediaQueue,
  [QueueName.WhatsappAiReply]: getWhatsappAiReplyQueue,
  [QueueName.WhatsappSentiment]: getWhatsappSentimentQueue,
  [QueueName.WhatsappBroadcast]: getWhatsappBroadcastQueue,
  [QueueName.WhatsappTemplateSync]: getWhatsappTemplateSyncQueue,
  [QueueName.WhatsappConversationLifecycle]:
    getWhatsappConversationLifecycleQueue,
  [QueueName.CrmScheduledSend]: getCrmScheduledSendQueue,
  [QueueName.CrmWorkflowSchedule]: getCrmWorkflowScheduleQueue,
  [QueueName.CrmCompetitorSync]: getCrmCompetitorSyncQueue,
  [QueueName.CrmSocialPostsTick]: getCrmSocialPostsTickQueue,
  [QueueName.CrmSocialPublish]: getCrmSocialPublishQueue,
  [QueueName.CrmProposalExpiry]: getCrmProposalExpiryQueue,
  [QueueName.Changelog]: getChangelogQueue,
  [QueueName.DatabaseBackup]: getDatabaseBackupQueue,
  [QueueName.StatusCollect]: getStatusCollectQueue,
  [QueueName.UsageRollup]: getUsageRollupQueue,
  [QueueName.ServicedeskSla]: getServicedeskSlaQueue,
  [QueueName.ServicedeskAi]: getServicedeskAiQueue,
  [QueueName.ServicedeskMail]: getServicedeskMailQueue,
  [QueueName.ServicedeskDigest]: getServicedeskDigestQueue,
  [QueueName.ServicedeskRecurring]: getServicedeskRecurringQueue,
  [QueueName.ServicedeskBilling]: getServicedeskBillingQueue,
  [QueueName.ServicedeskReports]: getServicedeskReportsQueue,
  [QueueName.ServicedeskRisk]: getServicedeskRiskQueue,
  [QueueName.ServicedeskIntegrations]: getServicedeskIntegrationsQueue,
  [QueueName.CrmTaskReminders]: getCrmTaskRemindersQueue,
  [QueueName.ServicedeskTaskReminders]: getServicedeskTaskRemindersQueue,
  [QueueName.SteelAgents]: getSteelAgentsQueue,
  [QueueName.Notifications]: getNotificationsQueue,
  [QueueName.SearchReindex]: getSearchReindexQueue,
  [QueueName.AiUsageWeeklyEmail]: getAiUsageWeeklyEmailQueue,
  [QueueName.WorkspaceExport]: getWorkspaceExportQueue,
  [QueueName.WorkspaceIntegrations]: getWorkspaceIntegrationsQueue,
  [QueueName.CrmCampaigns]: getCrmCampaignsQueue,
  [QueueName.CrmWorkflowDelay]: getCrmWorkflowDelayQueue,
}

/** Resolves a queue singleton by name, for code that is generic over queues. */
export function getQueueByName(name: QueueName): Queue {
  return QUEUE_GETTERS[name]() as Queue
}
