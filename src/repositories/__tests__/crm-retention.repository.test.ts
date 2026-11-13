import { describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  seedCrmPipeline,
  seedCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmRetentionRepository as Repo } from '../crm-retention.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  await seedMembership({
    userId: user.id,
    workspaceId: workspace.id,
    role: 'OWNER',
  })
  return { workspace, user }
}

describe('CrmRetentionRepository', () => {
  describe('settings', () => {
    it('should return null, then the saved row, and update in place', async () => {
      const { workspace, user } = await setup()
      expect(expectOk(await Repo.findSettings(workspace.id))).toBeNull()

      const created = expectOk(
        await Repo.upsertSettings(workspace.id, {
          createOpportunity: true,
          updatedById: user.id,
        }),
      )
      expect(created).toMatchObject({
        onDetractor: true,
        onHealthDrop: true,
        createOpportunity: true,
        taskDueDays: 2,
      })

      const updated = expectOk(
        await Repo.upsertSettings(workspace.id, {
          taskDueDays: 9,
          updatedById: user.id,
        }),
      )
      expect(updated.taskDueDays).toBe(9)
      expect(updated.createOpportunity).toBe(true)
      expect(expectOk(await Repo.findSettings(workspace.id))?.taskDueDays).toBe(
        9,
      )
    })
  })

  describe('claim() / complete() / release()', () => {
    it('should claim a key once and let it be released', async () => {
      const { workspace } = await setup()
      const claim = () => Repo.claim(workspace.id, 'SURVEY_DETRACTOR', 'k1')

      expect(expectOk(await claim())).toBe(true)
      expect(expectOk(await claim())).toBe(false)

      expectOk(await Repo.complete(workspace.id, 'k1', { taskId: 't1' }))
      const row = await prisma.crmRetentionAction.findFirst({
        where: { workspaceId: workspace.id, dedupeKey: 'k1' },
      })
      expect(row?.taskId).toBe('t1')

      expectOk(await Repo.release(workspace.id, 'k1'))
      expect(expectOk(await claim())).toBe(true)
    })

    it('should scope keys by workspace', async () => {
      const [a, b] = await Promise.all([seedWorkspace(), seedWorkspace()])
      expect(expectOk(await Repo.claim(a.id, 'HEALTH_DROP', 'k'))).toBe(true)
      expect(expectOk(await Repo.claim(b.id, 'HEALTH_DROP', 'k'))).toBe(true)
    })

    it('should return DATABASE_ERROR on unexpected failures', async () => {
      vi.spyOn(prisma.crmRetentionAction, 'create').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(await Repo.claim('w', 'HEALTH_DROP', 'k'), 'DATABASE_ERROR')
      expectErr(await Repo.complete('w', 'missing', {}), 'DATABASE_ERROR')
      vi.spyOn(prisma.crmRetentionAction, 'deleteMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(await Repo.release('w', 'k'), 'DATABASE_ERROR')
    })
  })

  describe('lookups', () => {
    it('should resolve a person with company and account owner', async () => {
      const { workspace, user } = await setup()
      const company = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme',
        accountOwnerId: user.id,
      })
      const person = await seedCrmPerson(workspace.id, user.id, {
        name: 'Ana',
        companyId: company.id,
        emails: ['ana@acme.com'],
      })
      const orphan = await seedCrmPerson(workspace.id, user.id, {
        name: 'Solo',
      })

      expect(
        expectOk(await Repo.findPersonContext(workspace.id, person.id)),
      ).toEqual({
        personId: person.id,
        personName: 'Ana',
        companyId: company.id,
        companyName: 'Acme',
        accountOwnerId: user.id,
      })
      expect(
        expectOk(await Repo.findPersonContext(workspace.id, orphan.id)),
      ).toMatchObject({ companyId: null, accountOwnerId: null })
      expect(
        expectOk(await Repo.findPersonContext('other', person.id)),
      ).toBeNull()

      expect(
        expectOk(await Repo.findPersonIdByEmail(workspace.id, 'ANA@acme.com')),
      ).toBe(person.id)
      expect(
        expectOk(await Repo.findPersonIdByEmail(workspace.id, 'x@y.com')),
      ).toBeNull()

      expect(expectOk(await Repo.findCompany(workspace.id, company.id))).toEqual(
        { id: company.id, name: 'Acme', accountOwnerId: user.id },
      )
      expect(expectOk(await Repo.findCompany('other', company.id))).toBeNull()
    })

    it('should find a company by CNPJ digits or by name', async () => {
      const { workspace, user } = await setup()
      const company = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme',
        cnpj: '12.345.678/0001-90',
        accountOwnerId: user.id,
      })

      const byDocument = expectOk(
        await Repo.findCompanyByIdentity(workspace.id, {
          document: '12345678000190',
          names: [],
        }),
      )
      expect(byDocument).toEqual({
        id: company.id,
        name: 'Acme',
        accountOwnerId: user.id,
      })
      expect(
        expectOk(
          await Repo.findCompanyByIdentity(workspace.id, {
            document: '99999999000100',
            names: ['ACME', ''],
          }),
        ),
      ).toMatchObject({ id: company.id })
      expect(
        expectOk(
          await Repo.findCompanyByIdentity(workspace.id, {
            document: null,
            names: [' '],
          }),
        ),
      ).toBeNull()
      expect(
        expectOk(
          await Repo.findCompanyByIdentity('other', {
            document: '12345678000190',
            names: ['Acme'],
          }),
        ),
      ).toBeNull()
    })

    it('should find the phone of a WhatsApp contact of the workspace', async () => {
      const { workspace } = await setup()
      const contact = await prisma.whatsAppContact.create({
        data: { workspaceId: workspace.id, waId: '5511999990000' },
      })
      expect(
        expectOk(await Repo.findContactPhone(workspace.id, contact.id)),
      ).toBe('5511999990000')
      expect(
        expectOk(await Repo.findContactPhone('other', contact.id)),
      ).toBeNull()
    })

    it('should pick the first open stage of the default pipeline', async () => {
      const { workspace, user } = await setup()
      expect(expectOk(await Repo.findRetentionStage(workspace.id))).toBeNull()

      const plain = await seedCrmPipeline(workspace.id, user.id, {
        position: 0,
      })
      await seedCrmPipelineStage(plain.id, { position: 0 })
      const preferred = await seedCrmPipeline(workspace.id, user.id, {
        isDefault: true,
        position: 1,
      })
      await seedCrmPipelineStage(preferred.id, {
        position: 0,
        category: 'WON',
      })
      const open = await seedCrmPipelineStage(preferred.id, { position: 1 })

      expect(expectOk(await Repo.findRetentionStage(workspace.id))).toEqual({
        pipelineId: preferred.id,
        stageId: open.id,
      })
    })

    it('should return null when the pipeline has no open stage', async () => {
      const { workspace, user } = await setup()
      const pipeline = await seedCrmPipeline(workspace.id, user.id)
      await seedCrmPipelineStage(pipeline.id, { category: 'WON' })
      expect(expectOk(await Repo.findRetentionStage(workspace.id))).toBeNull()
    })

    it('should find only an open retention deal of the company', async () => {
      const { workspace, user } = await setup()
      const company = await seedCrmCompany(workspace.id, user.id)
      const pipeline = await seedCrmPipeline(workspace.id, user.id)
      const open = await seedCrmPipelineStage(pipeline.id)
      const won = await seedCrmPipelineStage(pipeline.id, { category: 'WON' })
      const base = {
        workspaceId: workspace.id,
        createdById: user.id,
        pipelineId: pipeline.id,
        companyId: company.id,
      }
      await prisma.crmOpportunity.create({
        data: { ...base, name: 'Other', stageId: open.id, source: 'web' },
      })
      await prisma.crmOpportunity.create({
        data: { ...base, name: 'Closed', stageId: won.id, source: 'retention' },
      })
      expect(
        expectOk(
          await Repo.findOpenOpportunityOfCompany(workspace.id, company.id),
        ),
      ).toBeNull()

      const retention = await prisma.crmOpportunity.create({
        data: { ...base, name: 'Ret', stageId: open.id, source: 'retention' },
      })
      expect(
        expectOk(
          await Repo.findOpenOpportunityOfCompany(workspace.id, company.id),
        ),
      ).toEqual({ id: retention.id })
    })

    it('should prefer the OWNER as the fallback user', async () => {
      const workspace = await seedWorkspace()
      expect(expectOk(await Repo.findFallbackUserId(workspace.id))).toBeNull()

      const [admin, owner] = await Promise.all([seedUser(), seedUser()])
      await seedMembership({
        userId: admin.id,
        workspaceId: workspace.id,
        role: 'ADMIN',
      })
      await seedMembership({
        userId: owner.id,
        workspaceId: workspace.id,
        role: 'OWNER',
      })
      expect(expectOk(await Repo.findFallbackUserId(workspace.id))).toBe(
        owner.id,
      )
    })
  })

  describe('failures', () => {
    it.each([
      ['findSettings', () => Repo.findSettings('w'), 'crmRetentionSettings', 'findUnique'],
      ['findPersonContext', () => Repo.findPersonContext('w', 'p'), 'crmPerson', 'findFirst'],
      ['findPersonIdByEmail', () => Repo.findPersonIdByEmail('w', 'a@b.c'), 'crmPerson', 'findFirst'],
      ['findContactPhone', () => Repo.findContactPhone('w', 'c'), 'whatsAppContact', 'findFirst'],
      ['findCompany', () => Repo.findCompany('w', 'c'), 'crmCompany', 'findFirst'],
      ['findCompanyByIdentity', () => Repo.findCompanyByIdentity('w', { document: null, names: ['A'] }), 'crmCompany', 'findFirst'],
      ['findRetentionStage', () => Repo.findRetentionStage('w'), 'crmPipeline', 'findFirst'],
      ['findOpenOpportunityOfCompany', () => Repo.findOpenOpportunityOfCompany('w', 'c'), 'crmOpportunity', 'findFirst'],
      ['findFallbackUserId', () => Repo.findFallbackUserId('w'), 'membership', 'findFirst'],
    ] as const)('%s should return DATABASE_ERROR', async (_name, call, model, method) => {
      vi.spyOn(
        prisma[model] as unknown as Record<string, () => unknown>,
        method,
      ).mockRejectedValueOnce(new Error('boom'))
      expectErr(await call(), 'DATABASE_ERROR')
    })

    it('upsertSettings should return DATABASE_ERROR for a missing workspace', async () => {
      expectErr(
        await Repo.upsertSettings('missing', { updatedById: 'u' }),
        'DATABASE_ERROR',
      )
    })
  })
})
