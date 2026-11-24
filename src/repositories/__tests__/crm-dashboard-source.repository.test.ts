import { describe, expect, it } from 'vitest'
import { seedCrmActivity } from '@/src/__tests__/factories/crm-activity.factory'
import { seedCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import { seedCrmQuota } from '@/src/__tests__/factories/crm-quota.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmDashboardSourceRepository } from '../crm-dashboard-source.repository'

const LONG_AGO = new Date('2020-01-01T00:00:00.000Z')

async function setup() {
  const [workspace, user, other] = await Promise.all([
    seedWorkspace(),
    seedUser(),
    seedWorkspace(),
  ])
  return { workspace, user, other }
}

describe('CrmDashboardSourceRepository', () => {
  describe('proposals()', () => {
    it('lists only this workspace and skips soft-deleted proposals', async () => {
      const { workspace, user, other } = await setup()
      const kept = await seedCrmProposal(workspace.id, user.id)
      await seedCrmProposal(workspace.id, user.id, { deletedAt: new Date() })
      await seedCrmProposal(other.id, user.id)

      const rows = expectOk(
        await CrmDashboardSourceRepository.proposals(
          workspace.id,
          LONG_AGO,
          100,
        ),
      )

      expect(rows.map((r) => r.id)).toEqual([kept.id])
    })

    it('respects the row ceiling', async () => {
      const { workspace, user } = await setup()
      await seedCrmProposal(workspace.id, user.id)
      await seedCrmProposal(workspace.id, user.id)

      const rows = expectOk(
        await CrmDashboardSourceRepository.proposals(workspace.id, LONG_AGO, 1),
      )

      expect(rows).toHaveLength(1)
    })
  })

  describe('activities()', () => {
    it('lists only this workspace inside the window', async () => {
      const { workspace, other } = await setup()
      const recent = await seedCrmActivity(workspace.id)
      const old = await seedCrmActivity(workspace.id)
      await prisma.crmActivity.update({
        where: { id: old.id },
        data: { createdAt: LONG_AGO },
      })
      await seedCrmActivity(other.id)

      const rows = expectOk(
        await CrmDashboardSourceRepository.activities(
          workspace.id,
          new Date('2021-01-01T00:00:00.000Z'),
          100,
        ),
      )

      expect(rows.map((r) => r.id)).toEqual([recent.id])
    })
  })

  describe('quotas()', () => {
    it('lists the quotas of the workspace newest period first', async () => {
      const { workspace, user, other } = await setup()
      await seedCrmQuota(workspace.id, user.id, user.id, {
        periodKey: '2026-07',
      })
      await seedCrmQuota(workspace.id, user.id, user.id, {
        periodKey: '2026-08',
      })
      await seedCrmQuota(other.id, user.id, user.id)

      const rows = expectOk(
        await CrmDashboardSourceRepository.quotas(workspace.id, 100),
      )

      expect(rows.map((r) => r.periodKey)).toEqual(['2026-08', '2026-07'])
    })
  })
})
