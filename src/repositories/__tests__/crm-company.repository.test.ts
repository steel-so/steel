import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmCompanyRepository } from '../crm-company.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CrmCompanyRepository', () => {
  describe('findById()', () => {
    it('should return the company when it exists in the workspace', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const seeded = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme',
      })

      const result = await CrmCompanyRepository.findById(
        seeded.id,
        workspace.id,
      )

      const company = expectOk(result)
      expect(company.name).toBe('Acme')
    })

    it('should return RESOURCE_NOT_FOUND for a soft-deleted company', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const seeded = await seedCrmCompany(workspace.id, user.id, {
        deletedAt: new Date(),
      })

      const result = await CrmCompanyRepository.findById(
        seeded.id,
        workspace.id,
      )
      expectErr(result, 'RESOURCE_NOT_FOUND')
    })

    it('should return RESOURCE_NOT_FOUND for another workspace', async () => {
      const [workspaceA, workspaceB, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const seeded = await seedCrmCompany(workspaceA.id, user.id)

      const result = await CrmCompanyRepository.findById(
        seeded.id,
        workspaceB.id,
      )
      expectErr(result, 'RESOURCE_NOT_FOUND')
    })
  })

  describe('listByWorkspace()', () => {
    it('should list companies ordered by position, excluding soft-deleted', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const a = await seedCrmCompany(workspace.id, user.id, { name: 'A' })
      const b = await seedCrmCompany(workspace.id, user.id, { name: 'B' })
      await seedCrmCompany(workspace.id, user.id, {
        name: 'C',
        deletedAt: new Date(),
      })

      const result = await CrmCompanyRepository.listByWorkspace(workspace.id)

      const list = expectOk(result)
      expect(list.map((c) => c.id)).toEqual([a.id, b.id])
    })

    it('should filter by icp when provided', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const icp = await seedCrmCompany(workspace.id, user.id, { icp: true })
      await seedCrmCompany(workspace.id, user.id, { icp: false })

      const result = await CrmCompanyRepository.listByWorkspace(workspace.id, {
        icp: true,
      })

      const list = expectOk(result)
      expect(list.map((c) => c.id)).toEqual([icp.id])
    })
  })

  describe('create()', () => {
    it('should assign the next position within the workspace', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      await seedCrmCompany(workspace.id, user.id)

      const result = await CrmCompanyRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Second',
      })

      const company = expectOk(result)
      expect(company.position).toBe(1)
    })

    it('should return CRM_COMPANY_CONFLICT on duplicate domain', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      await seedCrmCompany(workspace.id, user.id, { domain: 'acme.com' })

      const result = await CrmCompanyRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Dup',
        domain: 'acme.com',
      })

      expectErr(result, 'CRM_COMPANY_CONFLICT')
    })
  })

  describe('softDelete()', () => {
    it('should set deletedAt and exclude the company from listing', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const seeded = await seedCrmCompany(workspace.id, user.id)

      expectOk(await CrmCompanyRepository.softDelete(seeded.id))

      const stored = await prisma.crmCompany.findUnique({
        where: { id: seeded.id },
      })
      expect(stored?.deletedAt).not.toBeNull()
    })
  })

  describe('registry fields', () => {
    it('should persist and clear the registry columns', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const created = expectOk(
        await CrmCompanyRepository.create({
          workspaceId: workspace.id,
          createdById: user.id,
          name: 'Reg',
          legalName: 'REG LTDA',
          emails: ['a@reg.com'],
          phones: ['(11) 2395-8400'],
          size: 'EPP',
          openedAt: '2015-03-02',
          shareCapital: 1234.5,
        }),
      )
      expect(created.emails).toEqual(['a@reg.com'])
      expect(created.openedAt?.toISOString()).toBe('2015-03-02T00:00:00.000Z')
      expect(Number(created.shareCapital)).toBe(1234.5)

      const cleared = expectOk(
        await CrmCompanyRepository.update(created.id, {
          openedAt: null,
          shareCapital: null,
          legalName: null,
          emails: [],
        }),
      )
      expect(cleared.openedAt).toBeNull()
      expect(cleared.shareCapital).toBeNull()
      expect(cleared.legalName).toBeNull()
      expect(cleared.emails).toEqual([])
      expect(cleared.size).toBe('EPP')
    })
  })

  describe('domainTaken()', () => {
    it('should detect a live company with the domain, ignoring the given id', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const seeded = await seedCrmCompany(workspace.id, user.id, {
        domain: 'acme.com',
      })
      expect(
        expectOk(
          await CrmCompanyRepository.domainTaken(workspace.id, 'acme.com'),
        ),
      ).toBe(true)
      expect(
        expectOk(
          await CrmCompanyRepository.domainTaken(
            workspace.id,
            'acme.com',
            seeded.id,
          ),
        ),
      ).toBe(false)
      expect(
        expectOk(
          await CrmCompanyRepository.domainTaken(workspace.id, 'other.com'),
        ),
      ).toBe(false)
    })
  })

  describe('update()', () => {
    it('should clear optional fields and the address when given null', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const seeded = await seedCrmCompany(workspace.id, user.id, {
        domain: 'acme.com',
        linkedin: 'https://linkedin.com/company/acme',
        employees: 10,
      })
      expectOk(
        await CrmCompanyRepository.update(seeded.id, {
          address: { city: 'São Paulo' },
        }),
      )

      const company = expectOk(
        await CrmCompanyRepository.update(seeded.id, {
          domain: null,
          linkedin: null,
          employees: null,
          address: null,
        }),
      )

      expect(company.domain).toBeNull()
      expect(company.linkedin).toBeNull()
      expect(company.employees).toBeNull()
      expect(company.address).toBeNull()
    })
  })

  describe('reorder()', () => {
    it('should update positions to match the given order', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const a = await seedCrmCompany(workspace.id, user.id)
      const b = await seedCrmCompany(workspace.id, user.id)

      expectOk(await CrmCompanyRepository.reorder(workspace.id, [b.id, a.id]))

      const list = expectOk(
        await CrmCompanyRepository.listByWorkspace(workspace.id),
      )
      expect(list.map((c) => c.id)).toEqual([b.id, a.id])
    })
  })

  describe('conflicts and database failures', () => {
    it('should return CRM_COMPANY_CONFLICT when updating to a taken domain', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      await seedCrmCompany(workspace.id, user.id, { domain: 'taken.com' })
      const other = await seedCrmCompany(workspace.id, user.id)

      expectErr(
        await CrmCompanyRepository.update(other.id, { domain: 'taken.com' }),
        'CRM_COMPANY_CONFLICT',
      )
    })

    it('should free cnpj and domain on soft delete so they can be reused', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const seeded = await seedCrmCompany(workspace.id, user.id, {
        domain: 'reuse.com',
      })
      expectOk(await CrmCompanyRepository.softDelete(seeded.id))

      const again = expectOk(
        await CrmCompanyRepository.create({
          workspaceId: workspace.id,
          createdById: user.id,
          name: 'Nova',
          domain: 'reuse.com',
        }),
      )
      expect(again.domain).toBe('reuse.com')
    })

    it('should return DATABASE_ERROR when writes hit missing rows or FKs', async () => {
      const user = await seedUser()
      expectErr(
        await CrmCompanyRepository.create({
          workspaceId: 'missing',
          createdById: user.id,
          name: 'X',
        }),
        'DATABASE_ERROR',
      )
      expectErr(
        await CrmCompanyRepository.update('missing', { name: 'X' }),
        'DATABASE_ERROR',
      )
      expectErr(
        await CrmCompanyRepository.softDelete('missing'),
        'DATABASE_ERROR',
      )
    })

    it('should not reorder companies of another workspace', async () => {
      const [workspace, other, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const foreign = await seedCrmCompany(other.id, user.id, { position: 5 })

      expectErr(
        await CrmCompanyRepository.reorder(workspace.id, [foreign.id]),
        'DATABASE_ERROR',
      )
      const stored = await prisma.crmCompany.findUniqueOrThrow({
        where: { id: foreign.id },
      })
      expect(stored.position).toBe(5)
    })

    it('should return DATABASE_ERROR when reads throw', async () => {
      vi.spyOn(prisma.crmCompany, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      vi.spyOn(prisma.crmCompany, 'findFirst').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmCompanyRepository.listByWorkspace('w'),
        'DATABASE_ERROR',
      )
      expectErr(await CrmCompanyRepository.findById('c', 'w'), 'DATABASE_ERROR')
    })
  })
})
