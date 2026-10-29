import { describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmCompanyEnrichmentRepository } from '../crm-company-enrichment.repository'

const data = {
  cnpj: '11222333000181',
  legalName: 'ACME LTDA',
  cnaeCode: '4711302',
  size: 'EPP',
  partners: [{ name: 'MARIA', qualification: null, enteredAt: null }],
  source: 'brasilapi',
}

describe('CrmCompanyEnrichmentRepository', () => {
  it('returns null before the first enrichment, then upserts in place', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    const company = await seedCrmCompany(ws.id, user.id)

    expect(
      expectOk(
        await CrmCompanyEnrichmentRepository.findByCompany(company.id, ws.id),
      ),
    ).toBeNull()

    const created = expectOk(
      await CrmCompanyEnrichmentRepository.upsert(company.id, ws.id, data),
    )
    expect(created).toMatchObject({
      companyId: company.id,
      legalName: 'ACME LTDA',
    })

    const updated = expectOk(
      await CrmCompanyEnrichmentRepository.upsert(company.id, ws.id, {
        ...data,
        legalName: 'ACME S.A.',
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.legalName).toBe('ACME S.A.')
    expect(await prisma.crmCompanyEnrichment.count()).toBe(1)
  })

  it('does not leak a profile across workspaces', async () => {
    const [ws, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const company = await seedCrmCompany(ws.id, user.id)
    await CrmCompanyEnrichmentRepository.upsert(company.id, ws.id, data)

    expect(
      expectOk(
        await CrmCompanyEnrichmentRepository.findByCompany(
          company.id,
          other.id,
        ),
      ),
    ).toBeNull()
  })

  it('is removed with its company', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    const company = await seedCrmCompany(ws.id, user.id)
    await CrmCompanyEnrichmentRepository.upsert(company.id, ws.id, data)
    await prisma.crmCompany.delete({ where: { id: company.id } })
    expect(await prisma.crmCompanyEnrichment.count()).toBe(0)
  })

  it('returns database errors', async () => {
    expectErr(
      await CrmCompanyEnrichmentRepository.upsert('missing', 'ws', data),
      'DATABASE_ERROR',
    )
    const spy = vi
      .spyOn(prisma.crmCompanyEnrichment, 'findFirst')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await CrmCompanyEnrichmentRepository.findByCompany('c', 'w'),
      'DATABASE_ERROR',
    )
    spy.mockRestore()
  })
})
