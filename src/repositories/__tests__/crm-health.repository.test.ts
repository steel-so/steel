import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { seedHealthWorkspace } from '@/src/__tests__/factories/nov-health-scores.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { HealthComputation } from '@/src/lib/crm-health'
import { prisma } from '@/src/lib/prisma'
import { CrmHealthRepository as Repo } from '../crm-health.repository'

afterEach(async () => {
  vi.restoreAllMocks()
})

function computation(
  riskScore: number,
  level: HealthComputation['level'],
): HealthComputation {
  return {
    riskScore,
    level,
    factors: [
      {
        key: 'engagement',
        label: 'Sem interação recente',
        points: 10,
        max: 20,
        detail: 'x',
      },
    ],
    missing: ['Chamados abertos'],
    nextAction: { key: 'reach_out', label: 'Retomar', detail: 'Ligue' },
  }
}

describe('CrmHealthRepository - workspaces and companies', () => {
  it('lists only active workspaces with the CRM module on', async () => {
    const { workspace, user } = await seedHealthWorkspace()
    const other = await seedHealthWorkspace()
    await prisma.workspaceModuleAccess.update({
      where: {
        workspaceId_module: { workspaceId: other.workspace.id, module: 'CRM' },
      },
      data: { enabled: false },
    })
    void user
    const ids = expectOk(await Repo.listCrmWorkspaceIds())
    expect(ids).toContain(workspace.id)
    expect(ids).not.toContain(other.workspace.id)
  })

  it('finds a company and hides deleted or foreign ones', async () => {
    const { workspace, user } = await seedHealthWorkspace()
    const company = await seedCrmCompany(workspace.id, user.id, {
      name: 'Acme',
      cnpj: '11222333000181',
    })
    const found = expectOk(await Repo.findCompany(workspace.id, company.id))
    expect(found).toMatchObject({ name: 'Acme', cnpj: '11222333000181' })

    expect(expectOk(await Repo.findCompany('other', company.id))).toBeNull()
    await prisma.crmCompany.update({
      where: { id: company.id },
      data: { deletedAt: new Date() },
    })
    expect(
      expectOk(await Repo.findCompany(workspace.id, company.id)),
    ).toBeNull()
  })

  it('orders the worklist: never scored first, then the stalest score', async () => {
    const { workspace, user } = await seedHealthWorkspace()
    const fresh = await seedCrmCompany(workspace.id, user.id, { name: 'Nova' })
    const old = await seedCrmCompany(workspace.id, user.id, { name: 'Antiga' })
    const recent = await seedCrmCompany(workspace.id, user.id, {
      name: 'Recente',
    })
    await seedCrmCompany(workspace.id, user.id, {
      name: 'Excluída',
      deletedAt: new Date(),
    })
    await Repo.upsertCustomerHealth(
      workspace.id,
      old.id,
      computation(10, 'LOW'),
      {},
      new Date('2026-10-01T00:00:00Z'),
    )
    await Repo.upsertCustomerHealth(
      workspace.id,
      recent.id,
      computation(10, 'LOW'),
      {},
      new Date('2026-10-20T00:00:00Z'),
    )

    expect(
      expectOk(await Repo.listCompaniesToCompute(workspace.id, 10)),
    ).toEqual([fresh.id, old.id, recent.id])
    expect(
      expectOk(await Repo.listCompaniesToCompute(workspace.id, 2)),
    ).toEqual([fresh.id, old.id])
  })

  it('upserts a customer score remembering the previous one', async () => {
    const { workspace, user } = await seedHealthWorkspace()
    const company = await seedCrmCompany(workspace.id, user.id)
    const first = expectOk(
      await Repo.upsertCustomerHealth(
        workspace.id,
        company.id,
        computation(30, 'LOW'),
        { a: 1 },
        new Date('2026-10-01T00:00:00Z'),
      ),
    )
    expect(first.previousScore).toBeNull()
    expect(first.previousLevel).toBeNull()
    expect(first.row.missing).toEqual(['Chamados abertos'])

    const second = expectOk(
      await Repo.upsertCustomerHealth(
        workspace.id,
        company.id,
        computation(75, 'HIGH'),
        { a: 2 },
        new Date('2026-10-02T00:00:00Z'),
      ),
    )
    expect(second.previousScore).toBe(30)
    expect(second.previousLevel).toBe('LOW')
    expect(second.row).toMatchObject({
      riskScore: 75,
      level: 'HIGH',
      previousScore: 30,
      previousLevel: 'LOW',
    })
    expect(await prisma.crmCustomerHealth.count()).toBe(1)
  })

  it('reads and lists customer health ranked by risk, with filters', async () => {
    const { workspace, user } = await seedHealthWorkspace()
    const a = await seedCrmCompany(workspace.id, user.id, { name: 'A' })
    const b = await seedCrmCompany(workspace.id, user.id, { name: 'B' })
    const gone = await seedCrmCompany(workspace.id, user.id, { name: 'C' })
    const at = new Date()
    await Repo.upsertCustomerHealth(
      workspace.id,
      a.id,
      computation(20, 'LOW'),
      {},
      at,
    )
    await Repo.upsertCustomerHealth(
      workspace.id,
      b.id,
      computation(80, 'HIGH'),
      {},
      at,
    )
    await Repo.upsertCustomerHealth(
      workspace.id,
      gone.id,
      computation(90, 'HIGH'),
      {},
      at,
    )
    await prisma.crmCompany.update({
      where: { id: gone.id },
      data: { deletedAt: new Date() },
    })

    const all = expectOk(
      await Repo.listCustomerHealth(workspace.id, { limit: 10 }),
    )
    expect(all.map((row) => row.company.name)).toEqual(['B', 'A'])
    const high = expectOk(
      await Repo.listCustomerHealth(workspace.id, { level: 'HIGH', limit: 10 }),
    )
    expect(high.map((row) => row.companyId)).toEqual([b.id])
    expect(
      expectOk(await Repo.listCustomerHealth(workspace.id, { limit: 1 })),
    ).toHaveLength(1)

    expect(
      expectOk(await Repo.getCustomerHealth(workspace.id, a.id))?.riskScore,
    ).toBe(20)
    expect(
      expectOk(await Repo.getCustomerHealth(workspace.id, gone.id)),
    ).toBeNull()
    expect(expectOk(await Repo.getCustomerHealth('other', a.id))).toBeNull()
  })
})

describe('CrmHealthRepository - opportunities', () => {
  async function deals() {
    const ctx = await seedHealthWorkspace()
    const { workspace, user, pipeline, open, won } = ctx
    const company = await seedCrmCompany(workspace.id, user.id)
    const dealOpen = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      { name: 'Aberta', companyId: company.id },
    )
    const dealWon = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      won.id,
      { name: 'Ganha', companyId: company.id },
    )
    return { ...ctx, company, dealOpen, dealWon }
  }

  it('finds a deal with its open flag', async () => {
    const { workspace, dealOpen, dealWon } = await deals()
    expect(
      expectOk(await Repo.findOpportunity(workspace.id, dealOpen.id)),
    ).toMatchObject({
      name: 'Aberta',
      isOpen: true,
    })
    expect(
      expectOk(await Repo.findOpportunity(workspace.id, dealWon.id))?.isOpen,
    ).toBe(false)
    expect(
      expectOk(await Repo.findOpportunity('other', dealOpen.id)),
    ).toBeNull()
    await prisma.crmOpportunity.update({
      where: { id: dealOpen.id },
      data: { deletedAt: new Date() },
    })
    expect(
      expectOk(await Repo.findOpportunity(workspace.id, dealOpen.id)),
    ).toBeNull()
  })

  it('lists only open deals to compute, never scored first', async () => {
    const { workspace, user, pipeline, open, dealOpen } = await deals()
    const stale = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      {
        name: 'Velha',
      },
    )
    await Repo.upsertOpportunityHealth(
      workspace.id,
      stale.id,
      computation(10, 'LOW'),
      {},
      new Date('2026-10-01T00:00:00Z'),
    )
    expect(
      expectOk(await Repo.listOpportunitiesToCompute(workspace.id, 10)),
    ).toEqual([dealOpen.id, stale.id])
    expect(
      expectOk(await Repo.listOpportunitiesToCompute(workspace.id, 1)),
    ).toEqual([dealOpen.id])
  })

  it('upserts, reads and lists deal health with filters', async () => {
    const { workspace, user, pipeline, open, dealOpen } = await deals()
    const other = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      {
        name: 'Outra',
      },
    )
    const at = new Date()
    const first = expectOk(
      await Repo.upsertOpportunityHealth(
        workspace.id,
        dealOpen.id,
        computation(40, 'MEDIUM'),
        {},
        at,
      ),
    )
    expect(first.previousScore).toBeNull()
    const second = expectOk(
      await Repo.upsertOpportunityHealth(
        workspace.id,
        dealOpen.id,
        computation(80, 'HIGH'),
        {},
        at,
      ),
    )
    expect(second).toMatchObject({ previousScore: 40, previousLevel: 'MEDIUM' })
    await Repo.upsertOpportunityHealth(
      workspace.id,
      other.id,
      computation(10, 'LOW'),
      {},
      at,
    )

    const all = expectOk(
      await Repo.listOpportunityHealth(workspace.id, { limit: 10 }),
    )
    expect(all.map((row) => row.opportunity.name)).toEqual(['Aberta', 'Outra'])
    expect(
      expectOk(
        await Repo.listOpportunityHealth(workspace.id, {
          level: 'LOW',
          limit: 10,
        }),
      ),
    ).toHaveLength(1)
    expect(
      expectOk(
        await Repo.listOpportunityHealth(workspace.id, {
          pipelineId: 'nope',
          limit: 10,
        }),
      ),
    ).toEqual([])
    expect(
      expectOk(await Repo.getOpportunityHealth(workspace.id, dealOpen.id))
        ?.riskScore,
    ).toBe(80)
    expect(
      expectOk(await Repo.getOpportunityHealth('other', dealOpen.id)),
    ).toBeNull()
  })

  it('counts the open deals of a company by level', async () => {
    const { workspace, company, dealOpen, dealWon } = await deals()
    const at = new Date()
    await Repo.upsertOpportunityHealth(
      workspace.id,
      dealOpen.id,
      computation(90, 'HIGH'),
      {},
      at,
    )
    await Repo.upsertOpportunityHealth(
      workspace.id,
      dealWon.id,
      computation(90, 'HIGH'),
      {},
      at,
    )
    expect(
      expectOk(await Repo.countOpenDealsByLevel(workspace.id, company.id)),
    ).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 1 })
  })

  it('drops the rows of closed or deleted deals', async () => {
    const { workspace, user, pipeline, open, dealOpen, dealWon } = await deals()
    const deleted = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
    )
    const at = new Date()
    for (const id of [dealOpen.id, dealWon.id, deleted.id]) {
      await Repo.upsertOpportunityHealth(
        workspace.id,
        id,
        computation(50, 'MEDIUM'),
        {},
        at,
      )
    }
    await prisma.crmOpportunity.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    })
    expect(
      expectOk(await Repo.deleteClosedOpportunityHealth(workspace.id)),
    ).toBe(2)
    expect(await prisma.crmOpportunityHealth.count()).toBe(1)

    expectOk(await Repo.deleteOpportunityHealth(dealOpen.id))
    expect(await prisma.crmOpportunityHealth.count()).toBe(0)
  })
})

describe('CrmHealthRepository - database errors', () => {
  const boom = new Error('db down')

  it.each([
    ['crmCustomerHealth', 'findFirst', () => Repo.getCustomerHealth('w', 'c')],
    [
      'crmCustomerHealth',
      'findMany',
      () => Repo.listCustomerHealth('w', { limit: 1 }),
    ],
    [
      'crmCustomerHealth',
      'findUnique',
      () =>
        Repo.upsertCustomerHealth(
          'w',
          'c',
          computation(1, 'LOW'),
          {},
          new Date(),
        ),
    ],
    [
      'crmOpportunityHealth',
      'findFirst',
      () => Repo.getOpportunityHealth('w', 'o'),
    ],
    [
      'crmOpportunityHealth',
      'findMany',
      () => Repo.listOpportunityHealth('w', { limit: 1 }),
    ],
    [
      'crmOpportunityHealth',
      'findUnique',
      () =>
        Repo.upsertOpportunityHealth(
          'w',
          'o',
          computation(1, 'LOW'),
          {},
          new Date(),
        ),
    ],
    [
      'crmOpportunityHealth',
      'deleteMany',
      () => Repo.deleteClosedOpportunityHealth('w'),
    ],
    [
      'crmOpportunityHealth',
      'deleteMany',
      () => Repo.deleteOpportunityHealth('o'),
    ],
    [
      'crmOpportunityHealth',
      'groupBy',
      () => Repo.countOpenDealsByLevel('w', 'c'),
    ],
    ['crmCompany', 'findFirst', () => Repo.findCompany('w', 'c')],
    ['crmCompany', 'findMany', () => Repo.listCompaniesToCompute('w', 5)],
    ['crmOpportunity', 'findFirst', () => Repo.findOpportunity('w', 'o')],
    [
      'crmOpportunity',
      'findMany',
      () => Repo.listOpportunitiesToCompute('w', 5),
    ],
    ['workspaceModuleAccess', 'findMany', () => Repo.listCrmWorkspaceIds()],
  ] as const)(
    'returns DATABASE_ERROR when %s.%s fails',
    async (model, method, call) => {
      vi.spyOn(
        prisma[model] as unknown as Record<string, () => unknown>,
        method,
      ).mockRejectedValue(boom)
      expectErr(await call(), 'DATABASE_ERROR')
    },
  )

  it('also fails when the second page of a worklist fails', async () => {
    const { workspace, user } = await seedHealthWorkspace()
    await seedCrmCompany(workspace.id, user.id)
    const spy = vi.spyOn(prisma.crmCompany, 'findMany')
    spy.mockResolvedValueOnce([])
    spy.mockRejectedValueOnce(boom)
    expectErr(
      await Repo.listCompaniesToCompute(workspace.id, 5),
      'DATABASE_ERROR',
    )

    const deals = vi.spyOn(prisma.crmOpportunity, 'findMany')
    deals.mockResolvedValueOnce([])
    deals.mockRejectedValueOnce(boom)
    expectErr(
      await Repo.listOpportunitiesToCompute(workspace.id, 5),
      'DATABASE_ERROR',
    )
  })

  it('fails the upserts when the write itself fails', async () => {
    const { workspace, user } = await seedHealthWorkspace()
    const company = await seedCrmCompany(workspace.id, user.id)
    vi.spyOn(prisma.crmCustomerHealth, 'upsert').mockRejectedValue(boom)
    expectErr(
      await Repo.upsertCustomerHealth(
        workspace.id,
        company.id,
        computation(1, 'LOW'),
        {},
        new Date(),
      ),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmOpportunityHealth, 'upsert').mockRejectedValue(boom)
    expectErr(
      await Repo.upsertOpportunityHealth(
        workspace.id,
        'o',
        computation(1, 'LOW'),
        {},
        new Date(),
      ),
      'DATABASE_ERROR',
    )
  })
})
