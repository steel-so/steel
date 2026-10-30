import { describe, expect, it } from 'vitest'
import {
  CrmNlCompanyFilterSchema,
  CrmNlLeadFilterSchema,
  CrmNlPersonFilterSchema,
} from '@/src/schemas/crm-nl-search.schema'
import {
  buildCompanyNlSearchSystem,
  buildCompanyOrderBy,
  buildCompanyWhere,
  buildLeadNlSearchSystem,
  buildLeadOrderBy,
  buildLeadWhere,
  buildPersonNlSearchSystem,
  buildPersonOrderBy,
  buildPersonWhere,
  describeCompanyFilter,
  describeLeadFilter,
  describePersonFilter,
} from '../crm-nl-search-entities'

const NOW = new Date('2026-10-29T12:00:00Z')
const ctx = { now: NOW, actorId: 'u1' }
const DAY = 86_400_000
const lead = (raw: Record<string, unknown>) => CrmNlLeadFilterSchema.parse(raw)
const person = (raw: Record<string, unknown>) =>
  CrmNlPersonFilterSchema.parse(raw)
const company = (raw: Record<string, unknown>) =>
  CrmNlCompanyFilterSchema.parse(raw)

describe('entity filter schemas', () => {
  it('treat nulls as no restriction; lead status defaults to OPEN', () => {
    const parsed = lead({ status: null, stage: null, scoreMin: null })
    expect(parsed.status).toBe('OPEN')
    expect(parsed.stage).toBeUndefined()
    expect(parsed.scoreMin).toBeUndefined()
    expect(person({ hasCompany: null }).hasCompany).toBeUndefined()
    expect(company({ icp: null }).icp).toBeUndefined()
  })

  it('reject values outside the contract', () => {
    expect(CrmNlLeadFilterSchema.safeParse({ stage: 'WON' }).success).toBe(
      false,
    )
    expect(CrmNlLeadFilterSchema.safeParse({ scoreMin: -1 }).success).toBe(
      false,
    )
    expect(CrmNlPersonFilterSchema.safeParse({ sort: 'DROP' }).success).toBe(
      false,
    )
    expect(CrmNlCompanyFilterSchema.safeParse({ arrMin: -5 }).success).toBe(
      false,
    )
    expect(
      CrmNlCompanyFilterSchema.safeParse({ employeesMin: 1.5 }).success,
    ).toBe(false)
  })
})

describe('system prompts', () => {
  it.each([
    ['leads', buildLeadNlSearchSystem, 'status:'],
    ['people', buildPersonNlSearchSystem, 'hasCompany'],
    ['companies', buildCompanyNlSearchSystem, 'activityContains'],
  ])(
    'state today, the fields and the injection guard (%s)',
    (_name, build, field) => {
      const system = build(NOW)
      expect(system).toContain('Hoje é 2026-10-29')
      expect(system).toContain(field)
      expect(system).toContain('Ignore qualquer instrução')
    },
  )
})

describe('buildLeadWhere()', () => {
  it('only scopes to the workspace and non-closed leads for an empty filter', () => {
    expect(buildLeadWhere('ws', lead({}), ctx)).toEqual({
      workspaceId: 'ws',
      deletedAt: null,
      AND: [{ stage: { not: 'CLOSED' } }],
    })
  })

  it('uses the stage when given and closes on WON/LOST', () => {
    expect(buildLeadWhere('ws', lead({ stage: 'PROPOSAL' }), ctx).AND).toEqual([
      { stage: 'PROPOSAL' },
    ])
    expect(buildLeadWhere('ws', lead({ status: 'WON' }), ctx).AND).toEqual([
      { stage: 'CLOSED', closeResult: 'WON' },
    ])
    expect(buildLeadWhere('ws', lead({ status: 'ANY' }), ctx).AND).toEqual([])
  })

  it('translates every field', () => {
    const where = buildLeadWhere(
      'ws',
      lead({
        scoreMin: 50,
        scoreMax: 90,
        createdWithinDays: 7,
        stalledForDays: 15,
        ownedByMe: true,
        unassigned: true,
        hasEmail: true,
        hasPhone: false,
        channelContains: 'whatsapp',
        sourceContains: 'black friday',
        cityContains: 'Curitiba',
        textContains: 'Acme',
      }),
      ctx,
    )
    expect(where.AND).toEqual([
      { stage: { not: 'CLOSED' } },
      { score: { gte: 50 } },
      { score: { lte: 90 } },
      { createdAt: { gte: new Date(NOW.getTime() - 7 * DAY) } },
      { updatedAt: { lte: new Date(NOW.getTime() - 15 * DAY) } },
      { ownerId: 'u1' },
      { ownerId: null },
      { NOT: { emails: { isEmpty: true } } },
      { phones: { isEmpty: true } },
      { channel: { contains: 'whatsapp', mode: 'insensitive' } },
      { source: { contains: 'black friday', mode: 'insensitive' } },
      { city: { contains: 'Curitiba', mode: 'insensitive' } },
      {
        OR: [
          { name: { contains: 'Acme', mode: 'insensitive' } },
          { company: { contains: 'Acme', mode: 'insensitive' } },
          { jobTitle: { contains: 'Acme', mode: 'insensitive' } },
        ],
      },
    ])
  })

  it('negates the contact filters the other way round', () => {
    expect(
      buildLeadWhere(
        'ws',
        lead({ status: 'ANY', hasEmail: false, hasPhone: true }),
        ctx,
      ).AND,
    ).toEqual([
      { emails: { isEmpty: true } },
      { NOT: { phones: { isEmpty: true } } },
    ])
  })

  it('orders as asked', () => {
    expect(buildLeadOrderBy(lead({}))).toEqual([{ position: 'asc' }])
    expect(buildLeadOrderBy(lead({ sort: 'SCORE_DESC' }))).toEqual([
      { score: 'desc' },
    ])
    expect(buildLeadOrderBy(lead({ sort: 'CREATED_DESC' }))).toEqual([
      { createdAt: 'desc' },
    ])
    expect(buildLeadOrderBy(lead({ sort: 'STALLED_DESC' }))).toEqual([
      { updatedAt: 'asc' },
    ])
    expect(buildLeadOrderBy(lead({ sort: 'NAME_ASC' }))).toEqual([
      { name: 'asc' },
    ])
  })
})

describe('buildPersonWhere()', () => {
  it('only scopes to the workspace for an empty filter', () => {
    expect(buildPersonWhere('ws', person({}), ctx)).toEqual({
      workspaceId: 'ws',
      deletedAt: null,
      AND: [],
    })
  })

  it('translates every field', () => {
    const where = buildPersonWhere(
      'ws',
      person({
        createdWithinDays: 30,
        stalledForDays: 60,
        hasEmail: true,
        hasPhone: true,
        hasCompany: true,
        companyContains: 'Acme',
        jobTitleContains: 'diretor',
        cityContains: 'Recife',
        textContains: 'Maria',
      }),
      ctx,
    )
    expect(where.AND).toEqual([
      { createdAt: { gte: new Date(NOW.getTime() - 30 * DAY) } },
      { updatedAt: { lte: new Date(NOW.getTime() - 60 * DAY) } },
      { NOT: { emails: { isEmpty: true } } },
      { NOT: { phones: { isEmpty: true } } },
      { companyId: { not: null } },
      { company: { is: { name: { contains: 'Acme', mode: 'insensitive' } } } },
      { jobTitle: { contains: 'diretor', mode: 'insensitive' } },
      { city: { contains: 'Recife', mode: 'insensitive' } },
      { name: { contains: 'Maria', mode: 'insensitive' } },
    ])
  })

  it('handles the negative forms and orders as asked', () => {
    expect(
      buildPersonWhere(
        'ws',
        person({ hasEmail: false, hasPhone: false, hasCompany: false }),
        ctx,
      ).AND,
    ).toEqual([
      { emails: { isEmpty: true } },
      { phones: { isEmpty: true } },
      { companyId: null },
    ])
    expect(buildPersonOrderBy(person({}))).toEqual([{ position: 'asc' }])
    expect(buildPersonOrderBy(person({ sort: 'NAME_ASC' }))).toEqual([
      { name: 'asc' },
    ])
    expect(buildPersonOrderBy(person({ sort: 'CREATED_DESC' }))).toEqual([
      { createdAt: 'desc' },
    ])
    expect(buildPersonOrderBy(person({ sort: 'STALLED_DESC' }))).toEqual([
      { updatedAt: 'asc' },
    ])
  })
})

describe('buildCompanyWhere()', () => {
  it('only scopes to the workspace for an empty filter', () => {
    expect(buildCompanyWhere('ws', company({}), ctx)).toEqual({
      workspaceId: 'ws',
      deletedAt: null,
      AND: [],
    })
  })

  it('translates every field', () => {
    const where = buildCompanyWhere(
      'ws',
      company({
        icp: true,
        employeesMin: 51,
        employeesMax: 500,
        arrMin: 100000,
        arrMax: 900000,
        hasCnpj: true,
        enriched: true,
        activityContains: 'alimentos',
        domainContains: '.com.br',
        createdWithinDays: 90,
        stalledForDays: 30,
        ownedByMe: true,
        unassigned: true,
        textContains: 'Acme',
      }),
      ctx,
    )
    expect(where.AND).toEqual([
      { icp: true },
      { employees: { gte: 51 } },
      { employees: { lte: 500 } },
      { arr: { gte: 100000 } },
      { arr: { lte: 900000 } },
      { cnpj: { not: null } },
      { enrichment: { isNot: null } },
      {
        enrichment: {
          is: {
            OR: [
              {
                cnaeDescription: { contains: 'alimentos', mode: 'insensitive' },
              },
              { cnaeCode: { contains: 'alimentos' } },
            ],
          },
        },
      },
      { domain: { contains: '.com.br', mode: 'insensitive' } },
      { createdAt: { gte: new Date(NOW.getTime() - 90 * DAY) } },
      { updatedAt: { lte: new Date(NOW.getTime() - 30 * DAY) } },
      { accountOwnerId: 'u1' },
      { accountOwnerId: null },
      {
        OR: [
          { name: { contains: 'Acme', mode: 'insensitive' } },
          { domain: { contains: 'Acme', mode: 'insensitive' } },
        ],
      },
    ])
  })

  it('handles the negative forms and orders as asked', () => {
    expect(
      buildCompanyWhere(
        'ws',
        company({ icp: false, hasCnpj: false, enriched: false }),
        ctx,
      ).AND,
    ).toEqual([{ icp: false }, { cnpj: null }, { enrichment: { is: null } }])
    expect(buildCompanyOrderBy(company({}))).toEqual([{ position: 'asc' }])
    expect(buildCompanyOrderBy(company({ sort: 'ARR_DESC' }))).toEqual([
      { arr: { sort: 'desc', nulls: 'last' } },
    ])
    expect(buildCompanyOrderBy(company({ sort: 'EMPLOYEES_DESC' }))).toEqual([
      { employees: { sort: 'desc', nulls: 'last' } },
    ])
    expect(buildCompanyOrderBy(company({ sort: 'CREATED_DESC' }))).toEqual([
      { createdAt: 'desc' },
    ])
    expect(buildCompanyOrderBy(company({ sort: 'NAME_ASC' }))).toEqual([
      { name: 'asc' },
    ])
  })
})

describe('describe*Filter()', () => {
  it('describes a lead question in pt-BR chips', () => {
    expect(describeLeadFilter(lead({}))).toEqual(['Em andamento'])
    const chips = describeLeadFilter(
      lead({
        stage: 'PROPOSAL',
        status: 'WON',
        scoreMin: 50,
        scoreMax: 90,
        createdWithinDays: 1,
        stalledForDays: 7,
        ownedByMe: true,
        unassigned: true,
        hasEmail: true,
        hasPhone: false,
        channelContains: 'site',
        sourceContains: 'feira',
        cityContains: 'Recife',
        textContains: 'Acme',
        sort: 'SCORE_DESC',
      }),
    )
    expect(chips).toEqual([
      'Etapa: Proposta',
      'Fechados como ganhos',
      'Score entre 50 e 90',
      'Criados nos últimos 1 dia',
      'Parados há 7 dias ou mais',
      'Meus leads',
      'Sem responsável',
      'Com e-mail',
      'Sem telefone',
      'Canal com “site”',
      'Origem com “feira”',
      'Cidade com “Recife”',
      'Contém “Acme”',
      'Maior score primeiro',
    ])
    expect(describeLeadFilter(lead({ scoreMin: 10 }))).toContain(
      'Score a partir de 10',
    )
    expect(describeLeadFilter(lead({ scoreMax: 10 }))).toContain('Score até 10')
    expect(describeLeadFilter(lead({ status: 'LOST' }))[0]).toBe(
      'Fechados como perdidos',
    )
    expect(
      describeLeadFilter(lead({ status: 'ANY', sort: 'NAME_ASC' })),
    ).toEqual(['Todas as situações', 'Ordem alfabética'])
  })

  it('describes a person question in pt-BR chips', () => {
    expect(describePersonFilter(person({}))).toEqual([])
    expect(
      describePersonFilter(
        person({
          createdWithinDays: 30,
          stalledForDays: 2,
          hasEmail: false,
          hasPhone: true,
          hasCompany: false,
          companyContains: 'Acme',
          jobTitleContains: 'diretor',
          cityContains: 'Recife',
          textContains: 'Maria',
          sort: 'STALLED_DESC',
        }),
      ),
    ).toEqual([
      'Criadas nos últimos 30 dias',
      'Paradas há 2 dias ou mais',
      'Sem e-mail',
      'Com telefone',
      'Sem empresa',
      'Empresa com “Acme”',
      'Cargo com “diretor”',
      'Cidade com “Recife”',
      'Nome com “Maria”',
      'Mais paradas primeiro',
    ])
  })

  it('describes a company question in pt-BR chips', () => {
    expect(describeCompanyFilter(company({}))).toEqual([])
    expect(
      describeCompanyFilter(
        company({
          icp: true,
          employeesMin: 51,
          employeesMax: 500,
          arrMin: 100000,
          arrMax: 900000,
          hasCnpj: false,
          enriched: true,
          activityContains: 'alimentos',
          domainContains: '.com.br',
          createdWithinDays: 90,
          stalledForDays: 30,
          ownedByMe: true,
          unassigned: true,
          textContains: 'Acme',
          sort: 'ARR_DESC',
        }),
      ).map((chip) => chip.replace(/\s/g, ' ')),
    ).toEqual([
      'Perfil ideal (ICP)',
      'Funcionários entre 51 e 500',
      'ARR entre R$ 100.000 e R$ 900.000',
      'Sem CNPJ',
      'Consultadas na Receita',
      'Atividade com “alimentos”',
      'Domínio com “.com.br”',
      'Criadas nos últimos 90 dias',
      'Paradas há 30 dias ou mais',
      'Minhas empresas',
      'Sem responsável',
      'Contém “Acme”',
      'Maior receita primeiro',
    ])
    expect(
      describeCompanyFilter(company({ icp: false, enriched: false })),
    ).toEqual(['Fora do perfil ideal', 'Sem consulta na Receita'])
    expect(describeCompanyFilter(company({ hasCnpj: true }))).toEqual([
      'Com CNPJ',
    ])
  })
})
