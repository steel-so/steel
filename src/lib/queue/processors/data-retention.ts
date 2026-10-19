import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { prisma } from '@/src/lib/prisma'
import { IntegrationGrantLifecycleService } from '@/src/services/integration-grant-lifecycle.service'
import { PhoneCallRecordingService } from '@/src/services/phone-call-recording.service'
import { DataRetentionJob } from '../jobs'
import { RetentionWindowMs } from '../retention'

type CleanupResult = {
  deleted: number
  cutoff: string
}

async function cleanupExpiredSessions(): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - RetentionWindowMs.sessionAfterExpiry)
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  })
  return { deleted: count, cutoff: cutoff.toISOString() }
}

async function cleanupExpiredVerifications(): Promise<CleanupResult> {
  const cutoff = new Date(
    Date.now() - RetentionWindowMs.verificationAfterExpiry,
  )
  const { count } = await prisma.verification.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  })
  return { deleted: count, cutoff: cutoff.toISOString() }
}

async function expireStaleInvitations(): Promise<CleanupResult> {
  const cutoff = new Date()
  const { count } = await prisma.workspaceInvitation.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: cutoff } },
    data: { status: 'EXPIRED' },
  })
  return { deleted: count, cutoff: cutoff.toISOString() }
}

/** Outbound webhook delivery log: 30 days (ADR 0036). */
async function cleanupWebhookDeliveries(): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - RetentionWindowMs.webhookDeliveries)
  const { count } = await prisma.webhookDelivery.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return { deleted: count, cutoff: cutoff.toISOString() }
}

/**
 * Personal API tokens (ADR 0035) revoked or expired more than 90 days ago.
 * Live tokens are never touched. The CLI device-flow codes need no cleanup:
 * they live only in Redis, with a TTL (`device-authorization.cache.ts`).
 */
async function cleanupApiTokens(): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - RetentionWindowMs.apiTokensAfterEnd)
  const { count } = await prisma.apiToken.deleteMany({
    where: {
      OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    },
  })
  return { deleted: count, cutoff: cutoff.toISOString() }
}

/**
 * "Apps conectados" entries no token can use any more (ADR 0033): grants
 * idle for a day whose tokens were all revoked or expired are retired.
 */
async function pruneDeadIntegrationGrants(): Promise<CleanupResult> {
  const now = new Date()
  const retired =
    await IntegrationGrantLifecycleService.pruneWithoutLiveTokens(now)
  // Throw so BullMQ retries; the other cleanups never fail this way.
  if (!retired.ok) throw new Error(retired.error.message)
  return { deleted: retired.value, cutoff: now.toISOString() }
}

/**
 * PABX call recordings (ADR 0043): audio past its retention date, then
 * objects whose call is gone (deleted with its conversation or contact).
 */
async function purgeCallRecordings(): Promise<
  CleanupResult & { orphans: number }
> {
  const now = new Date()
  const expired = await PhoneCallRecordingService.purgeExpired(now)
  if (!expired.ok) throw new Error(expired.error.message)
  const orphans = await PhoneCallRecordingService.sweepOrphans(now)
  if (!orphans.ok) throw new Error(orphans.error.message)
  return {
    deleted: expired.value,
    orphans: orphans.value,
    cutoff: now.toISOString(),
  }
}

export async function processDataRetention(job: Job): Promise<CleanupResult> {
  switch (job.name) {
    case DataRetentionJob.CleanupExpiredSessions: {
      const result = await cleanupExpiredSessions()
      logger.info('queue.data_retention.sessions_cleaned', {
        component: 'Worker',
        jobId: job.id,
        deleted: result.deleted,
        cutoff: result.cutoff,
      })
      return result
    }
    case DataRetentionJob.CleanupExpiredVerificationTokens: {
      const result = await cleanupExpiredVerifications()
      logger.info('queue.data_retention.verifications_cleaned', {
        component: 'Worker',
        jobId: job.id,
        deleted: result.deleted,
        cutoff: result.cutoff,
      })
      return result
    }
    case DataRetentionJob.ExpireStaleInvitations: {
      const result = await expireStaleInvitations()
      logger.info('queue.data_retention.invitations_expired', {
        component: 'Worker',
        jobId: job.id,
        expired: result.deleted,
        cutoff: result.cutoff,
      })
      return result
    }
    case DataRetentionJob.CleanupWebhookDeliveries: {
      const result = await cleanupWebhookDeliveries()
      logger.info('queue.data_retention.webhook_deliveries_cleaned', {
        component: 'Worker',
        jobId: job.id,
        deleted: result.deleted,
        cutoff: result.cutoff,
      })
      return result
    }
    case DataRetentionJob.CleanupApiTokens: {
      const result = await cleanupApiTokens()
      logger.info('queue.data_retention.api_tokens_cleaned', {
        component: 'Worker',
        jobId: job.id,
        deleted: result.deleted,
        cutoff: result.cutoff,
      })
      return result
    }
    case DataRetentionJob.PruneDeadIntegrationGrants: {
      const result = await pruneDeadIntegrationGrants()
      logger.info('queue.data_retention.integration_grants_pruned', {
        component: 'Worker',
        jobId: job.id,
        retired: result.deleted,
        cutoff: result.cutoff,
      })
      return result
    }
    case DataRetentionJob.PurgeCallRecordings: {
      const result = await purgeCallRecordings()
      logger.info('queue.data_retention.call_recordings_purged', {
        component: 'Worker',
        jobId: job.id,
        deleted: result.deleted,
        orphans: result.orphans,
        cutoff: result.cutoff,
      })
      return result
    }
    default:
      throw new Error(
        `Unknown data-retention job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
