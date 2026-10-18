import type { Job } from 'bullmq'
import { describe, expect, it } from 'vitest'
import { seedApiToken } from '@/src/__tests__/factories/api-token.factory'
import { seedInvitation } from '@/src/__tests__/factories/invitation.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { prisma } from '@/src/lib/prisma'
import { DataRetentionJob } from '../../jobs'
import { processDataRetention } from '../data-retention'

function expireJob(): Job {
  return {
    name: DataRetentionJob.ExpireStaleInvitations,
    id: 'test-expire',
  } as unknown as Job
}

describe('processDataRetention() - ExpiresStaleInvitation', () => {
  it('should flip only past-due PENDING ivites to EXPIRED', async () => {
    const [inviter, ws] = await Promise.all([
      seedUser({ email: `inviter-${Date.now()}@xample.com` }),
      seedWorkspace(),
    ])

    const stale = await seedInvitation({
      invitedById: inviter.id,
      workspaceId: ws.id,
      email: 'stale@example.com',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 60_000),
    })
    const live = await seedInvitation({
      invitedById: inviter.id,
      workspaceId: ws.id,
      email: 'live@example.com',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const accepted = await seedInvitation({
      invitedById: inviter.id,
      workspaceId: ws.id,
      email: 'accepted@example.com',
      status: 'ACCEPTED',
      expiresAt: new Date(Date.now() - 60_000),
    })

    const result = (await processDataRetention(expireJob())) as {
      deleted: number
    }

    expect(result.deleted).toBe(1)

    const [staleAfter, liveAfter, acceptedAfter] = await Promise.all([
      prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: stale.id } }),
      prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: live.id } }),
      prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: accepted.id },
      }),
    ])

    expect(staleAfter.status).toBe('EXPIRED')
    expect(liveAfter.status).toBe('PENDING')
    expect(acceptedAfter.status).toBe('ACCEPTED')
  })
})

describe('processDataRetention() - CleanupApiTokens', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('should delete only tokens revoked or expired more than 90 days ago', async () => {
    const [user, ws] = await Promise.all([
      seedUser({ email: `tokens-${Date.now()}@example.com` }),
      seedWorkspace(),
    ])
    const owner = { userId: user.id, workspaceId: ws.id }
    const now = Date.now()

    const live = await seedApiToken({ ...owner, name: 'live' })
    const recentlyRevoked = await seedApiToken({
      ...owner,
      name: 'recently-revoked',
      revokedAt: new Date(now - 10 * DAY),
    })
    const recentlyExpired = await seedApiToken({
      ...owner,
      name: 'recently-expired',
      expiresAt: new Date(now - 10 * DAY),
    })
    const oldRevoked = await seedApiToken({
      ...owner,
      name: 'old-revoked',
      revokedAt: new Date(now - 91 * DAY),
    })
    const oldExpired = await seedApiToken({
      ...owner,
      name: 'old-expired',
      expiresAt: new Date(now - 91 * DAY),
    })

    const result = await processDataRetention({
      name: DataRetentionJob.CleanupApiTokens,
      id: 'test-api-tokens',
    } as unknown as Job)

    expect(result.deleted).toBe(2)
    const left = await prisma.apiToken.findMany({
      where: { userId: user.id },
      select: { id: true },
    })
    expect(left.map((t) => t.id).sort()).toEqual(
      [live.row.id, recentlyRevoked.row.id, recentlyExpired.row.id].sort(),
    )
    expect(left.map((t) => t.id)).not.toContain(oldRevoked.row.id)
    expect(left.map((t) => t.id)).not.toContain(oldExpired.row.id)
  })
})
