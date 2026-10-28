import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-newsletter-usage.repository')
vi.mock('@/src/lib/admin-audit', () => ({ recordAdminAction: vi.fn() }))
vi.mock('@/src/services/authz', () => ({
  assertModuleMember: vi.fn(),
  assertPlatformAdmin: vi.fn(),
}))
vi.mock('@/src/services/crm-newsletter-notifications', () => ({
  notifyNewsletterUsage: vi.fn(async () => 1),
}))

import { recordAdminAction } from '@/src/lib/admin-audit'
import { CrmNewsletterUsageRepository } from '@/src/repositories/crm-newsletter-usage.repository'
import { assertModuleMember, assertPlatformAdmin } from '../authz'
import { notifyNewsletterUsage } from '../crm-newsletter-notifications'
import {
  newsletterUsageMonth,
  reachedThresholds,
  CrmNewsletterUsageService as Service,
} from '../crm-newsletter-usage.service'

const repo = vi.mocked(CrmNewsletterUsageRepository)
const NOW = new Date('2026-10-28T13:00:00.000Z')
const AT = NOW

function usageRow(emailsSent: number, notifiedThresholds: number[] = []) {
  return {
    workspaceId: 'ws1',
    month: '2026-10',
    emailsSent,
    notifiedThresholds,
    updatedAt: AT,
  }
}

function setup(opts: {
  plan?: 'FREE' | 'PRO' | 'BUSINESS' | 'ENTERPRISE'
  override?: number | null
  sent?: number
}) {
  repo.findWorkspacePlan.mockResolvedValue(
    ok({ activePlan: opts.plan ?? 'FREE', slug: 'acme' }),
  )
  repo.findSettings.mockResolvedValue(
    ok(
      opts.override === undefined
        ? null
        : {
            workspaceId: 'ws1',
            monthlyEmailLimitOverride: opts.override,
            updatedById: null,
            updatedAt: AT,
          },
    ),
  )
  repo.findUsage.mockResolvedValue(
    ok(opts.sent === undefined ? null : usageRow(opts.sent)),
  )
}

describe('CrmNewsletterUsageService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the São Paulo month', () => {
    // 2026-11-01 01:00 UTC is still October 31 in São Paulo.
    expect(newsletterUsageMonth(new Date('2026-11-01T01:00:00Z'))).toBe(
      '2026-10',
    )
  })

  it('lists the thresholds reached', () => {
    expect(reachedThresholds(1500, 3000)).toEqual([50])
    expect(reachedThresholds(3000, 3000)).toEqual([50, 80, 100])
    expect(reachedThresholds(10, 0)).toEqual([])
  })

  it('reads the plan limit, the override and unlimited plans', async () => {
    setup({ plan: 'PRO', sent: 10 })
    expect(expectOk(await Service.getUsage('ws1', NOW))).toEqual({
      month: '2026-10',
      emailsSent: 10,
      limit: 30_000,
      limitSource: 'PLAN',
    })
    setup({ plan: 'PRO', override: 99 })
    expect(expectOk(await Service.getUsage('ws1', NOW)).limit).toBe(99)
    setup({ plan: 'ENTERPRISE' })
    const usage = expectOk(await Service.getUsage('ws1', NOW))
    expect(usage.limit).toBeNull()
    expect(Service.remaining(usage)).toBeNull()
    expect(Service.remaining({ ...usage, limit: 5, emailsSent: 9 })).toBe(0)
  })

  it('propagates read errors and a missing workspace', async () => {
    setup({})
    repo.findWorkspacePlan.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.getUsage('ws1', NOW), 'DATABASE_ERROR')
    repo.findSettings.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.getUsage('ws1', NOW), 'DATABASE_ERROR')
    repo.findUsage.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.getUsage('ws1', NOW), 'DATABASE_ERROR')
    repo.findWorkspacePlan.mockResolvedValueOnce(ok(null))
    expectErr(await Service.getUsage('ws1', NOW), 'RESOURCE_NOT_FOUND')
  })

  it('lets CRM members with e-mail VIEW read the usage', async () => {
    setup({ sent: 1 })
    vi.mocked(assertModuleMember).mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.forMember('u1', 'ws1', NOW), 'FORBIDDEN')
    vi.mocked(assertModuleMember).mockResolvedValueOnce(
      ok({ role: 'MEMBER', isPrivileged: false, permissions: null }),
    )
    expect(expectOk(await Service.forMember('u1', 'ws1', NOW)).emailsSent).toBe(
      1,
    )
    expect(assertModuleMember).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
  })

  it('records usage and announces only the highest new threshold', async () => {
    setup({ plan: 'FREE', sent: 2500 })
    repo.increment.mockResolvedValue(ok(usageRow(2500, [])))
    repo.claimThreshold.mockResolvedValue(ok(true))
    expectOk(await Service.record('ws1', 2500, NOW))
    expect(repo.claimThreshold).toHaveBeenCalledTimes(2)
    expect(notifyNewsletterUsage).toHaveBeenCalledTimes(1)
    expect(notifyNewsletterUsage).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      month: '2026-10',
      threshold: 80,
      used: 2500,
      limit: 3000,
    })
  })

  it('skips notified, lost and failed claims, and unlimited plans', async () => {
    setup({ plan: 'FREE', sent: 3000 })
    repo.increment.mockResolvedValue(ok(usageRow(3000, [50])))
    repo.claimThreshold
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValueOnce(ok(false))
    expectOk(await Service.record('ws1', 1, NOW))
    expect(notifyNewsletterUsage).not.toHaveBeenCalled()

    setup({ plan: 'ENTERPRISE', sent: 10 })
    expectOk(await Service.record('ws1', 1, NOW))
    expect(repo.claimThreshold).toHaveBeenCalledTimes(2)
  })

  it('fails when the counter or the read fails', async () => {
    setup({})
    repo.increment.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.record('ws1', 1, NOW), 'DATABASE_ERROR')
    repo.increment.mockResolvedValueOnce(ok(usageRow(1)))
    repo.findWorkspacePlan.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.record('ws1', 1, NOW), 'DATABASE_ERROR')
  })

  it('admin: reads and overrides the limit with an audit trail', async () => {
    setup({ sent: 0 })
    vi.mocked(assertPlatformAdmin).mockResolvedValue(
      ok({ userId: 'admin', email: 'a@stratustelecom.com.br' }),
    )
    expect(expectOk(await Service.adminGet('admin', 'ws1', NOW)).limit).toBe(
      3000,
    )
    repo.upsertSettings.mockResolvedValue(
      ok({
        workspaceId: 'ws1',
        monthlyEmailLimitOverride: 100,
        updatedById: 'admin',
        updatedAt: AT,
      }),
    )
    expectOk(
      await Service.adminUpdate(
        'admin',
        'ws1',
        { monthlyEmailLimitOverride: 100 },
        NOW,
      ),
    )
    expect(repo.upsertSettings).toHaveBeenCalledWith('ws1', {
      monthlyEmailLimitOverride: 100,
      updatedById: 'admin',
    })
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'crm_newsletter.limit_override',
        targetId: 'ws1',
        targetLabel: 'acme',
      }),
    )
  })

  it('admin: refuses non-admins and reports missing workspaces and errors', async () => {
    vi.mocked(assertPlatformAdmin).mockResolvedValue(err(forbidden()))
    expectErr(await Service.adminGet('u1', 'ws1', NOW), 'FORBIDDEN')
    expectErr(
      await Service.adminUpdate(
        'u1',
        'ws1',
        { monthlyEmailLimitOverride: null },
        NOW,
      ),
      'FORBIDDEN',
    )
    vi.mocked(assertPlatformAdmin).mockResolvedValue(
      ok({ userId: 'admin', email: 'a@stratustelecom.com.br' }),
    )
    repo.findWorkspacePlan.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.adminUpdate(
        'admin',
        'ws1',
        { monthlyEmailLimitOverride: null },
        NOW,
      ),
      'DATABASE_ERROR',
    )
    repo.findWorkspacePlan.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.adminUpdate(
        'admin',
        'ws1',
        { monthlyEmailLimitOverride: null },
        NOW,
      ),
      'RESOURCE_NOT_FOUND',
    )
    setup({})
    repo.upsertSettings.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.adminUpdate(
        'admin',
        'ws1',
        { monthlyEmailLimitOverride: null },
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})
