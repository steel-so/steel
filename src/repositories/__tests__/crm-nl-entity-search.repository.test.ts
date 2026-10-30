import { describe, expect, it, vi } from 'vitest'
import {
  seedSearchableCompany,
  seedSearchableLead,
  seedSearchablePerson,
} from '@/src/__tests__/factories/nov-ai-crm-followups.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  buildCompanyOrderBy,
  buildCompanyWhere,
  buildLeadOrderBy,
  buildLeadWhere,
  buildPersonOrderBy,
  buildPersonWhere,
} from '@/src/lib/crm-nl-search-entities'
import { prisma } from '@/src/lib/prisma'
import {
  CrmNlCompanyFilterSchema,
  CrmNlLeadFilterSchema,
  CrmNlPersonFilterSchema,
} from '@/src/schemas/crm-nl-search.schema'
import { CrmCompanyRepository } from '../crm-company.repository'
import { CrmLeadRepository } from '../crm-lead.repository'
import { CrmPersonRepository } from '../crm-person.repository'

const NOW = new Date('2026-10-29T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  return { workspace, other, user }
}

describe('CrmLeadRepository.search() with the NL lead filter', () => {
  function run(
    workspaceId: string,
    actorId: string,
    raw: Record<string, unknown>,
  ) {
    const filter = CrmNlLeadFilterSchema.parse(raw)
    return CrmLeadRepository.search(
      buildLeadWhere(workspaceId, filter, { now: NOW, actorId }),
      buildLeadOrderBy(filter),
      50,
    )
  }

  it('is scoped to the workspace and live rows, open by default', async () => {
    const { workspace, other, user } = await setup()
    const mine = await seedSearchableLead(workspace.id, user.id, { name: 'A' })
    await seedSearchableLead(workspace.id, user.id, {
      name: 'Fechado',
      stage: 'CLOSED',
      closeResult: 'WON',
    })
    await seedSearchableLead(workspace.id, user.id, {
      name: 'Apagado',
      deletedAt: new Date(),
    })
    await seedSearchableLead(other.id, user.id, { name: 'Outro workspace' })

    const rows = expectOk(await run(workspace.id, user.id, {}))
    expect(rows.map((r) => r.id)).toEqual([mine.id])

    const won = expectOk(await run(workspace.id, user.id, { status: 'WON' }))
    expect(won.map((r) => r.name)).toEqual(['Fechado'])
  })

  it('filters by score, channel, contacts, owner and text, and orders by score', async () => {
    const { workspace, user } = await setup()
    await seedSearchableLead(workspace.id, user.id, {
      name: 'Quente',
      score: 80,
      channel: 'WhatsApp',
      city: 'Curitiba',
      emails: ['q@acme.com'],
      ownerId: user.id,
      company: 'Acme',
    })
    await seedSearchableLead(workspace.id, user.id, {
      name: 'Morno',
      score: 55,
      channel: 'Site',
      phones: ['5541999999999'],
    })
    await seedSearchableLead(workspace.id, user.id, { name: 'Frio', score: 10 })

    const names = async (raw: Record<string, unknown>) =>
      expectOk(await run(workspace.id, user.id, raw)).map((r) => r.name)

    expect(await names({ scoreMin: 50, sort: 'SCORE_DESC' })).toEqual([
      'Quente',
      'Morno',
    ])
    expect(await names({ channelContains: 'whats' })).toEqual(['Quente'])
    expect(await names({ cityContains: 'curi' })).toEqual(['Quente'])
    expect(await names({ hasEmail: true })).toEqual(['Quente'])
    expect(await names({ hasPhone: true })).toEqual(['Morno'])
    expect(await names({ ownedByMe: true })).toEqual(['Quente'])
    expect(await names({ unassigned: true, sort: 'NAME_ASC' })).toEqual([
      'Frio',
      'Morno',
    ])
    expect(await names({ textContains: 'acme' })).toEqual(['Quente'])
  })

  it('filters stalled leads and orders the most stalled first', async () => {
    const { workspace, user } = await setup()
    await seedSearchableLead(workspace.id, user.id, {
      name: 'Parado 30',
      updatedAt: daysAgo(30),
    })
    await seedSearchableLead(workspace.id, user.id, {
      name: 'Parado 10',
      updatedAt: daysAgo(10),
    })
    await seedSearchableLead(workspace.id, user.id, {
      name: 'Recente',
      updatedAt: daysAgo(1),
    })
    const rows = expectOk(
      await run(workspace.id, user.id, {
        stalledForDays: 7,
        sort: 'STALLED_DESC',
      }),
    )
    expect(rows.map((r) => r.name)).toEqual(['Parado 30', 'Parado 10'])
  })

  it('wraps a database failure', async () => {
    const spy = vi
      .spyOn(prisma.crmLead, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(await CrmLeadRepository.search({}, [], 1), 'DATABASE_ERROR')
    spy.mockRestore()
  })
})

describe('CrmPersonRepository.search() with the NL person filter', () => {
  function run(workspaceId: string, raw: Record<string, unknown>) {
    const filter = CrmNlPersonFilterSchema.parse(raw)
    return CrmPersonRepository.search(
      buildPersonWhere(workspaceId, filter, { now: NOW, actorId: 'u' }),
      buildPersonOrderBy(filter),
      50,
    )
  }

  it('is scoped to the workspace and filters by company, job title and contacts', async () => {
    const { workspace, other, user } = await setup()
    const acme = await prisma.crmCompany.create({
      data: { name: 'Acme', workspaceId: workspace.id, createdById: user.id },
    })
    await seedSearchablePerson(workspace.id, user.id, {
      name: 'Maria',
      jobTitle: 'Diretora Financeira',
      companyId: acme.id,
      emails: ['m@acme.com'],
      city: 'Recife',
    })
    await seedSearchablePerson(workspace.id, user.id, {
      name: 'João',
      phones: ['5511999999999'],
    })
    await seedSearchablePerson(workspace.id, user.id, {
      name: 'Apagado',
      deletedAt: new Date(),
    })
    await seedSearchablePerson(other.id, user.id, { name: 'Outro' })

    const names = async (raw: Record<string, unknown>) =>
      expectOk(await run(workspace.id, raw)).map((r) => r.name)

    expect(await names({ sort: 'NAME_ASC' })).toEqual(['João', 'Maria'])
    expect(await names({ companyContains: 'acm' })).toEqual(['Maria'])
    expect(await names({ jobTitleContains: 'diretor' })).toEqual(['Maria'])
    expect(await names({ cityContains: 'recife' })).toEqual(['Maria'])
    expect(await names({ hasEmail: true })).toEqual(['Maria'])
    expect(await names({ hasPhone: true })).toEqual(['João'])
    expect(await names({ hasCompany: false })).toEqual(['João'])
    expect(await names({ textContains: 'jo' })).toEqual(['João'])
  })

  it('filters stalled people and wraps a database failure', async () => {
    const { workspace, user } = await setup()
    await seedSearchablePerson(workspace.id, user.id, {
      name: 'Parada',
      updatedAt: daysAgo(40),
    })
    await seedSearchablePerson(workspace.id, user.id, { name: 'Nova' })
    const rows = expectOk(
      await run(workspace.id, { stalledForDays: 30, sort: 'CREATED_DESC' }),
    )
    expect(rows.map((r) => r.name)).toEqual(['Parada'])

    const spy = vi
      .spyOn(prisma.crmPerson, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(await CrmPersonRepository.search({}, [], 1), 'DATABASE_ERROR')
    spy.mockRestore()
  })
})

describe('CrmCompanyRepository.search() with the NL company filter', () => {
  function run(
    workspaceId: string,
    actorId: string,
    raw: Record<string, unknown>,
  ) {
    const filter = CrmNlCompanyFilterSchema.parse(raw)
    return CrmCompanyRepository.search(
      buildCompanyWhere(workspaceId, filter, { now: NOW, actorId }),
      buildCompanyOrderBy(filter),
      50,
    )
  }

  it('is scoped to the workspace and filters by size, ICP, CNPJ and owner', async () => {
    const { workspace, other, user } = await setup()
    await seedSearchableCompany(workspace.id, user.id, {
      name: 'Grande',
      employees: 200,
      arr: 900000,
      icp: true,
      cnpj: '11222333000181',
      domain: 'grande.com.br',
      accountOwnerId: user.id,
    })
    await seedSearchableCompany(workspace.id, user.id, {
      name: 'Pequena',
      employees: 5,
      arr: 1000,
    })
    await seedSearchableCompany(workspace.id, user.id, {
      name: 'Apagada',
      deletedAt: new Date(),
    })
    await seedSearchableCompany(other.id, user.id, { name: 'Outra' })

    const names = async (raw: Record<string, unknown>) =>
      expectOk(await run(workspace.id, user.id, raw)).map((r) => r.name)

    expect(await names({ sort: 'ARR_DESC' })).toEqual(['Grande', 'Pequena'])
    expect(await names({ sort: 'EMPLOYEES_DESC' })).toEqual([
      'Grande',
      'Pequena',
    ])
    expect(await names({ employeesMin: 51 })).toEqual(['Grande'])
    expect(await names({ employeesMax: 10 })).toEqual(['Pequena'])
    expect(await names({ arrMin: 100000 })).toEqual(['Grande'])
    expect(await names({ icp: true })).toEqual(['Grande'])
    expect(await names({ hasCnpj: true })).toEqual(['Grande'])
    expect(await names({ hasCnpj: false })).toEqual(['Pequena'])
    expect(await names({ domainContains: '.com.br' })).toEqual(['Grande'])
    expect(await names({ ownedByMe: true })).toEqual(['Grande'])
    expect(await names({ unassigned: true })).toEqual(['Pequena'])
    expect(await names({ textContains: 'peq' })).toEqual(['Pequena'])
    expect(await names({ sort: 'NAME_ASC' })).toEqual(['Grande', 'Pequena'])
  })

  it('filters by the Receita profile (enriched, activity) and stalled companies', async () => {
    const { workspace, user } = await setup()
    const food = await seedSearchableCompany(workspace.id, user.id, {
      name: 'Alimentos SA',
      cnpj: '11222333000181',
      updatedAt: daysAgo(50),
    })
    await seedSearchableCompany(workspace.id, user.id, { name: 'Sem Receita' })
    await prisma.crmCompanyEnrichment.create({
      data: {
        companyId: food.id,
        workspaceId: workspace.id,
        cnpj: '11222333000181',
        cnaeCode: '4711302',
        cnaeDescription: 'Comércio varejista de alimentos',
      },
    })
    // Seeding the enrichment row bumped nothing on the company itself.
    const names = async (raw: Record<string, unknown>) =>
      expectOk(await run(workspace.id, user.id, raw)).map((r) => r.name)

    expect(await names({ enriched: true })).toEqual(['Alimentos SA'])
    expect(await names({ enriched: false })).toEqual(['Sem Receita'])
    expect(await names({ activityContains: 'ALIMENTOS' })).toEqual([
      'Alimentos SA',
    ])
    expect(await names({ activityContains: '4711' })).toEqual(['Alimentos SA'])
    expect(await names({ stalledForDays: 30 })).toEqual(['Alimentos SA'])
    expect(
      await names({ createdWithinDays: 3650, sort: 'CREATED_DESC' }),
    ).toEqual(['Sem Receita', 'Alimentos SA'])
  })

  it('wraps a database failure', async () => {
    const spy = vi
      .spyOn(prisma.crmCompany, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(await CrmCompanyRepository.search({}, [], 1), 'DATABASE_ERROR')
    spy.mockRestore()
  })
})
