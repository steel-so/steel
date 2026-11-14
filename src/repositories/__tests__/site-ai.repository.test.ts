import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { seedCrmProduct } from '@/src/__tests__/factories/crm-product.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SiteAiRepository } from '../site-ai.repository'

describe('SiteAiRepository', () => {
  describe('listProducts()', () => {
    it('lists active products of the workspace in CRM order', async () => {
      const [workspace, other, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const second = await seedCrmProduct(workspace.id, user.id, {
        name: 'Bolo',
        position: 2,
        unitPrice: new Prisma.Decimal('45.5'),
      })
      const first = await seedCrmProduct(workspace.id, user.id, {
        name: 'Pão',
        position: 1,
      })
      await seedCrmProduct(workspace.id, user.id, { active: false })
      await seedCrmProduct(workspace.id, user.id, { deletedAt: new Date() })
      await seedCrmProduct(other.id, user.id)

      const all = expectOk(await SiteAiRepository.listProducts(workspace.id))
      expect(all.map((product) => product.id)).toEqual([first.id, second.id])
      expect(all[1]).toMatchObject({
        name: 'Bolo',
        currency: 'BRL',
        description: null,
      })
      expect(all[1].unitPrice.toString()).toBe('45.5')

      const picked = expectOk(
        await SiteAiRepository.listProducts(workspace.id, [second.id]),
      )
      expect(picked.map((product) => product.id)).toEqual([second.id])
      expect(
        expectOk(await SiteAiRepository.listProducts(workspace.id, [])),
      ).toEqual([])
    })

    it('returns DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.crmProduct, 'findMany').mockRejectedValueOnce(
        new Error('down'),
      )
      expectErr(await SiteAiRepository.listProducts('ws'), 'DATABASE_ERROR')
    })
  })
})
