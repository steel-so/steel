import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  revertExpiredTrials: vi.fn(),
  workspaceCacheInvalidate: vi.fn(),
  featuresCacheInvalidate: vi.fn(),
  syncAll: vi.fn(),
  listDueScheduled: vi.fn(),
  setCampaignStatus: vi.fn(),
  sendCampaign: vi.fn(),
  notifyCampaignFinished: vi.fn(),
  notifyTrialEnded: vi.fn(),
  pruneWithoutLiveTokens: vi.fn(),
  purgeExpiredRecordings: vi.fn(),
  sweepOrphanRecordings: vi.fn(),
  prisma: {
    session: { deleteMany: vi.fn() },
    verification: { deleteMany: vi.fn() },
    workspaceInvitation: { updateMany: vi.fn() },
    webhookDelivery: { deleteMany: vi.fn() },
    apiToken: { deleteMany: vi.fn() },
  },
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.loggerMock }))
vi.mock('@/src/repositories/workspace.repository', () => ({
  WorkspaceRepository: { revertExpiredTrials: mocks.revertExpiredTrials },
}))
vi.mock('@/src/cache/workspace.cache', () => ({
  WorkspaceCache: { invalidate: mocks.workspaceCacheInvalidate },
}))
vi.mock('@/src/cache/workspace-features.cache', () => ({
  WorkspaceFeaturesCache: { invalidate: mocks.featuresCacheInvalidate },
}))
vi.mock('@/src/services/crm-competitor.service', () => ({
  CrmCompetitorService: { syncAll: mocks.syncAll },
}))
vi.mock('@/src/repositories/crm-email-campaign.repository', () => ({
  CrmEmailCampaignRepository: {
    listDueScheduled: mocks.listDueScheduled,
    setStatus: mocks.setCampaignStatus,
  },
}))
vi.mock('@/src/services/crm-email-campaign.service', () => ({
  CrmEmailCampaignService: { send: mocks.sendCampaign },
}))
vi.mock('@/src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/src/services/integration-grant-lifecycle.service', () => ({
  IntegrationGrantLifecycleService: {
    pruneWithoutLiveTokens: mocks.pruneWithoutLiveTokens,
  },
}))
vi.mock('@/src/services/phone-call-recording.service', () => ({
  PhoneCallRecordingService: {
    purgeExpired: mocks.purgeExpiredRecordings,
    sweepOrphans: mocks.sweepOrphanRecordings,
  },
}))
vi.mock('@/src/services/crm-notifications', () => ({
  notifyCrmCampaignFinished: mocks.notifyCampaignFinished,
}))
vi.mock('@/src/services/platform-notifications', () => ({
  notifyTrialEnded: mocks.notifyTrialEnded,
}))

import {
  CrmCompetitorSyncJob,
  CrmScheduledSendJob,
  DataRetentionJob,
  TrialLifecycleJob,
} from '@/src/lib/queue/jobs'
import { processCrmCompetitorSync } from '@/src/lib/queue/processors/crm-competitor-sync'
import { processCrmScheduledSend } from '@/src/lib/queue/processors/crm-scheduled-send'
import { processDataRetention } from '@/src/lib/queue/processors/data-retention'
import { processTrialLifecycle } from '@/src/lib/queue/processors/trial-lifecycle'

function fakeJob(name: string, id: string | null = 'job-1'): Job {
  return { id: id ?? undefined, name, data: {} } as unknown as Job
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processTrialLifecycle', () => {
  it('reverts expired trials and invalidates both caches per workspace', async () => {
    mocks.revertExpiredTrials.mockResolvedValue({
      ok: true,
      value: ['ws-1', 'ws-2'],
    })

    const result = await processTrialLifecycle(
      fakeJob(TrialLifecycleJob.RevertExpiredTrials),
    )

    expect(result).toEqual({ reverted: 2 })
    expect(mocks.workspaceCacheInvalidate).toHaveBeenCalledWith('ws-1')
    expect(mocks.workspaceCacheInvalidate).toHaveBeenCalledWith('ws-2')
    expect(mocks.featuresCacheInvalidate).toHaveBeenCalledTimes(2)
    expect(mocks.notifyTrialEnded).toHaveBeenCalledTimes(2)
    expect(mocks.notifyTrialEnded).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.trial_lifecycle.trials_reverted',
      expect.objectContaining({ reverted: ['ws-1', 'ws-2'] }),
    )
  })

  it('throws when the repository fails', async () => {
    mocks.revertExpiredTrials.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(
      processTrialLifecycle(fakeJob(TrialLifecycleJob.RevertExpiredTrials)),
    ).rejects.toThrow('revertExpiredTrials failed: DATABASE_ERROR')
    expect(mocks.workspaceCacheInvalidate).not.toHaveBeenCalled()
  })

  it('throws on an unknown job name', async () => {
    await expect(processTrialLifecycle(fakeJob('nope', null))).rejects.toThrow(
      'Unknown trial-lifecycle job: nope (id=unknown)',
    )
  })
})

describe('processCrmCompetitorSync', () => {
  it('syncs all competitors and returns the tick counters', async () => {
    mocks.syncAll.mockResolvedValue({ processed: 3, synced: 2, failed: 1 })

    const result = await processCrmCompetitorSync(
      fakeJob(CrmCompetitorSyncJob.RunTick),
    )

    expect(result).toEqual({ processed: 3, synced: 2, failed: 1 })
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.crm_competitor_sync.tick_completed',
      expect.objectContaining({ processed: 3, synced: 2, failed: 1 }),
    )
  })

  it('throws on an unknown job name', async () => {
    await expect(
      processCrmCompetitorSync(fakeJob('other', null)),
    ).rejects.toThrow('Unknown crm-competitor-sync job: other (id=unknown)')
    expect(mocks.syncAll).not.toHaveBeenCalled()
  })
})

describe('processCrmScheduledSend', () => {
  const campaign = (id: string) => ({
    id,
    workspaceId: 'ws-1',
    createdById: 'user-1',
  })

  it('sends every due campaign and counts successes and failures', async () => {
    mocks.listDueScheduled.mockResolvedValue({
      ok: true,
      value: [campaign('c1'), campaign('c2'), campaign('c3')],
    })
    mocks.sendCampaign
      .mockResolvedValueOnce({ ok: true, value: {} })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS', message: 'x' },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'DATABASE_ERROR', message: 'y' },
      })

    const result = await processCrmScheduledSend(
      fakeJob(CrmScheduledSendJob.RunTick),
    )

    expect(result).toEqual({ due: 3, sent: 1, failed: 2 })
    expect(mocks.sendCampaign).toHaveBeenCalledWith('user-1', 'ws-1', 'c1')
    // Só a campanha sem destinatários é marcada FAILED.
    expect(mocks.setCampaignStatus).toHaveBeenCalledTimes(1)
    expect(mocks.setCampaignStatus).toHaveBeenCalledWith('c2', 'FAILED')
    // Terminal failure (no recipients) tells the creator; retryable ones don't.
    expect(mocks.notifyCampaignFinished).toHaveBeenCalledTimes(1)
    expect(mocks.notifyCampaignFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        status: 'FAILED',
        actorId: null,
        campaign: expect.objectContaining({ id: 'c2' }),
      }),
    )
    expect(mocks.loggerMock.error).toHaveBeenCalledTimes(2)
  })

  it('throws when listing due campaigns fails', async () => {
    mocks.listDueScheduled.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(
      processCrmScheduledSend(fakeJob(CrmScheduledSendJob.RunTick)),
    ).rejects.toThrow('Failed to list due CRM email campaigns: DATABASE_ERROR')
  })

  it('throws on an unknown job name', async () => {
    await expect(processCrmScheduledSend(fakeJob('x', null))).rejects.toThrow(
      'Unknown crm-scheduled-send job: x (id=unknown)',
    )
  })
})

describe('processDataRetention', () => {
  it('deletes sessions expired before the retention cutoff', async () => {
    mocks.prisma.session.deleteMany.mockResolvedValue({ count: 4 })

    const result = await processDataRetention(
      fakeJob(DataRetentionJob.CleanupExpiredSessions),
    )

    expect(result.deleted).toBe(4)
    const where = mocks.prisma.session.deleteMany.mock.calls[0][0].where
    expect(where.expiresAt.lt).toBeInstanceOf(Date)
    expect(where.expiresAt.lt.toISOString()).toBe(result.cutoff)
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.data_retention.sessions_cleaned',
      expect.objectContaining({ deleted: 4 }),
    )
  })

  it('deletes verification tokens expired before the retention cutoff', async () => {
    mocks.prisma.verification.deleteMany.mockResolvedValue({ count: 2 })

    const result = await processDataRetention(
      fakeJob(DataRetentionJob.CleanupExpiredVerificationTokens),
    )

    expect(result.deleted).toBe(2)
    expect(new Date(result.cutoff).getTime()).toBeLessThan(Date.now())
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.data_retention.verifications_cleaned',
      expect.objectContaining({ deleted: 2 }),
    )
  })

  it('expires stale pending invitations', async () => {
    mocks.prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 1 })

    const result = await processDataRetention(
      fakeJob(DataRetentionJob.ExpireStaleInvitations),
    )

    expect(result.deleted).toBe(1)
    expect(mocks.prisma.workspaceInvitation.updateMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', expiresAt: { lt: expect.any(Date) } },
      data: { status: 'EXPIRED' },
    })
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.data_retention.invitations_expired',
      expect.objectContaining({ expired: 1 }),
    )
  })

  it('deletes webhook deliveries older than 30 days', async () => {
    mocks.prisma.webhookDelivery.deleteMany.mockResolvedValue({ count: 7 })

    const result = await processDataRetention(
      fakeJob(DataRetentionJob.CleanupWebhookDeliveries),
    )

    expect(result.deleted).toBe(7)
    const where = mocks.prisma.webhookDelivery.deleteMany.mock.calls[0][0].where
    const days = (Date.now() - where.createdAt.lt.getTime()) / 86_400_000
    expect(Math.round(days)).toBe(30)
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.data_retention.webhook_deliveries_cleaned',
      expect.objectContaining({ deleted: 7 }),
    )
  })

  it('deletes API tokens revoked or expired more than 90 days ago', async () => {
    mocks.prisma.apiToken.deleteMany.mockResolvedValue({ count: 3 })

    const result = await processDataRetention(
      fakeJob(DataRetentionJob.CleanupApiTokens),
    )

    expect(result.deleted).toBe(3)
    const where = mocks.prisma.apiToken.deleteMany.mock.calls[0][0].where
    const [revoked, expired] = where.OR
    expect(revoked.revokedAt.lt).toBe(expired.expiresAt.lt)
    const days = (Date.now() - revoked.revokedAt.lt.getTime()) / 86_400_000
    expect(Math.round(days)).toBe(90)
    expect(revoked.revokedAt.lt.toISOString()).toBe(result.cutoff)
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.data_retention.api_tokens_cleaned',
      expect.objectContaining({ deleted: 3 }),
    )
  })

  it('retires connected apps left without live tokens', async () => {
    mocks.pruneWithoutLiveTokens.mockResolvedValue({ ok: true, value: 3 })

    const result = await processDataRetention(
      fakeJob(DataRetentionJob.PruneDeadIntegrationGrants),
    )

    expect(result.deleted).toBe(3)
    expect(mocks.pruneWithoutLiveTokens).toHaveBeenCalledWith(
      new Date(result.cutoff),
    )
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.data_retention.integration_grants_pruned',
      expect.objectContaining({ retired: 3 }),
    )
  })

  it('throws so BullMQ retries when pruning connected apps fails', async () => {
    mocks.pruneWithoutLiveTokens.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'db down' },
    })

    await expect(
      processDataRetention(
        fakeJob(DataRetentionJob.PruneDeadIntegrationGrants),
      ),
    ).rejects.toThrow('db down')
  })

  it('purges expired and orphan call recordings', async () => {
    mocks.purgeExpiredRecordings.mockResolvedValue({ ok: true, value: 4 })
    mocks.sweepOrphanRecordings.mockResolvedValue({ ok: true, value: 1 })

    const result = await processDataRetention(
      fakeJob(DataRetentionJob.PurgeCallRecordings),
    )

    expect(result).toMatchObject({ deleted: 4, orphans: 1 })
    expect(mocks.purgeExpiredRecordings).toHaveBeenCalledWith(
      new Date(result.cutoff),
    )
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.data_retention.call_recordings_purged',
      expect.objectContaining({ deleted: 4, orphans: 1 }),
    )
  })

  it('throws so BullMQ retries when purging call recordings fails', async () => {
    mocks.purgeExpiredRecordings.mockResolvedValueOnce({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'db down' },
    })
    await expect(
      processDataRetention(fakeJob(DataRetentionJob.PurgeCallRecordings)),
    ).rejects.toThrow('db down')

    mocks.purgeExpiredRecordings.mockResolvedValueOnce({ ok: true, value: 0 })
    mocks.sweepOrphanRecordings.mockResolvedValueOnce({
      ok: false,
      error: { code: 'STORAGE_ERROR', message: 's3 down' },
    })
    await expect(
      processDataRetention(fakeJob(DataRetentionJob.PurgeCallRecordings)),
    ).rejects.toThrow('s3 down')
  })

  it('throws on an unknown job name', async () => {
    await expect(processDataRetention(fakeJob('bogus', null))).rejects.toThrow(
      'Unknown data-retention job: bogus (id=unknown)',
    )
  })
})
