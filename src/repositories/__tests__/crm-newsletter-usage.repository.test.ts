import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterUsageRepository as Repo } from '../crm-newsletter-usage.repository'

describe('CrmNewsletterUsageRepository', () => {
  it('reads the plan and saves the override', async () => {
    const [workspace, user] = await Promise.all([
      seedWorkspace({ activePlan: 'PRO' }),
      seedUser(),
    ])
    expect(expectOk(await Repo.findWorkspacePlan(workspace.id))).toEqual({
      activePlan: 'PRO',
      slug: workspace.slug,
    })
    expect(expectOk(await Repo.findWorkspacePlan('missing'))).toBeNull()

    expect(expectOk(await Repo.findSettings(workspace.id))).toBeNull()
    const saved = expectOk(
      await Repo.upsertSettings(workspace.id, {
        monthlyEmailLimitOverride: 500,
        updatedById: user.id,
      }),
    )
    expect(saved.monthlyEmailLimitOverride).toBe(500)
    const cleared = expectOk(
      await Repo.upsertSettings(workspace.id, {
        monthlyEmailLimitOverride: null,
        updatedById: user.id,
      }),
    )
    expect(cleared.monthlyEmailLimitOverride).toBeNull()
  })

  it('increments the month and claims each threshold once', async () => {
    const workspace = await seedWorkspace()
    expect(expectOk(await Repo.findUsage(workspace.id, '2026-10'))).toBeNull()
    expectOk(await Repo.increment(workspace.id, '2026-10', 40))
    const usage = expectOk(await Repo.increment(workspace.id, '2026-10', 10))
    expect(usage.emailsSent).toBe(50)

    expect(
      expectOk(await Repo.claimThreshold(workspace.id, '2026-10', 50)),
    ).toBe(true)
    expect(
      expectOk(await Repo.claimThreshold(workspace.id, '2026-10', 50)),
    ).toBe(false)
    const read = expectOk(await Repo.findUsage(workspace.id, '2026-10'))
    expect(read?.notifiedThresholds).toEqual([50])
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const spies = [
      vi
        .spyOn(prisma.workspace, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterSettings, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterSettings, 'upsert')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterUsageMonthly, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterUsageMonthly, 'upsert')
        .mockImplementation(down as never),
      vi.spyOn(prisma, '$executeRaw').mockImplementation(down as never),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(await Repo.findWorkspacePlan('w'), code)
    expectErr(await Repo.findSettings('w'), code)
    expectErr(
      await Repo.upsertSettings('w', {
        monthlyEmailLimitOverride: 1,
        updatedById: 'u',
      }),
      code,
    )
    expectErr(await Repo.findUsage('w', 'm'), code)
    expectErr(await Repo.increment('w', 'm', 1), code)
    expectErr(await Repo.claimThreshold('w', 'm', 50), code)
    for (const spy of spies) spy.mockRestore()
  })
})
