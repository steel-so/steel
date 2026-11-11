import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CRM_AI_TOOLS } from '@/src/lib/ai/tools/crm'
import {
  afterFields,
  changeFields,
  companyName,
  crmPath,
  excerpt,
  formatDate,
  formatMoney,
  formatValue,
  matchesQuery,
  paginate,
  personName,
  recordHref,
  resolveByName,
  resolveMember,
  resolvePerson,
  resolveStage,
  zodParser,
} from '@/src/lib/ai/tools/crm/shared'
import { err, ok } from '@/src/lib/result'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmMemberService } from '@/src/services/crm-member.service'
import { CrmPersonService } from '@/src/services/crm-person.service'
import {
  company,
  ctx,
  expectErr,
  expectOk,
  members,
  person,
  pipelines,
  stagesByPipeline,
} from './ai-tools-crm.fixtures'

vi.mock('@/src/services/workspace.service', () => ({
  WorkspaceService: { getById: vi.fn() },
}))
vi.mock('@/src/services/crm-member.service', () => ({
  CrmMemberService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-person.service', () => ({
  CrmPersonService: { list: vi.fn(), getById: vi.fn() },
}))
vi.mock('@/src/services/crm-company.service', () => ({
  CrmCompanyService: { list: vi.fn(), getById: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(CrmMemberService.list).mockResolvedValue(ok(members))
})

describe('CRM_AI_TOOLS registry', () => {
  it('has unique snake_case names prefixed with crm_', () => {
    const names = CRM_AI_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toMatch(/^crm_[a-z0-9_]{1,59}$/)
    }
  })

  it('ports every tool of the old CRM assistant', () => {
    const names = CRM_AI_TOOLS.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'crm_list_pipelines',
        'crm_list_opportunities',
        'crm_list_leads',
        'crm_list_proposals',
        'crm_list_competitors',
        'crm_get_competitor_growth',
        'crm_get_trending_posts',
        'crm_create_lead',
        'crm_create_dashboard',
        'crm_create_form',
        'crm_create_proposal',
        'crm_list_proposal_documents',
      ]),
    )
  })

  it('declares module CRM, a pt-BR label and an object schema', () => {
    for (const tool of CRM_AI_TOOLS) {
      expect(tool.module).toBe('CRM')
      expect(tool.label.length).toBeGreaterThan(3)
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.parameters.type).toBe('object')
    }
  })

  it('gives every write tool a preview', () => {
    const writes = CRM_AI_TOOLS.filter((t) => t.kind !== 'READ')
    expect(writes.length).toBeGreaterThan(20)
    for (const tool of writes) {
      expect(typeof tool.preview, tool.name).toBe('function')
    }
  })

  it('names deletes as DELETE tools (double confirmation in the runtime)', () => {
    const deletes = CRM_AI_TOOLS.filter((t) => t.name.startsWith('crm_delete_'))
    expect(deletes.map((t) => t.kind)).toEqual(deletes.map(() => 'DELETE'))
    expect(deletes.map((t) => t.name).sort()).toEqual([
      'crm_delete_company',
      'crm_delete_lead',
      'crm_delete_note',
      'crm_delete_opportunity',
      'crm_delete_person',
      'crm_delete_task',
    ])
  })
})

describe('shared helpers', () => {
  const items = [
    { id: 'a', name: 'São Paulo Matriz' },
    { id: 'b', name: 'Sao Paulo Filial' },
    { id: 'c', name: 'Rio de Janeiro' },
  ]
  const opts = {
    label: 'filial',
    id: (i: { id: string }) => i.id,
    name: (i: { name: string }) => i.name,
  }

  it('resolves by id, exact name (accent-insensitive) and unique partial', () => {
    expect(expectOk(resolveByName(items, 'b', opts)).id).toBe('b')
    expect(expectOk(resolveByName(items, 'sao paulo matriz', opts)).id).toBe(
      'a',
    )
    expect(expectOk(resolveByName(items, 'janeiro', opts)).id).toBe('c')
  })

  it('never picks silently between several matches', () => {
    const error = expectErr(
      resolveByName(items, 'paulo', opts),
      'VALIDATION_ERROR',
    )
    expect(error.message).toContain('São Paulo Matriz (id a)')
    expect(error.message).toContain('Sao Paulo Filial (id b)')
    const dup = [
      { id: 'x', name: 'Dup' },
      { id: 'y', name: 'dup' },
    ]
    expectErr(resolveByName(dup, 'DUP', opts), 'VALIDATION_ERROR')
  })

  it('lists options (up to 10) when nothing matches', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `${i}`,
      name: `Item ${i}`,
    }))
    const error = expectErr(
      resolveByName(many, 'zzz', opts),
      'RESOURCE_NOT_FOUND',
    )
    expect(error.message).toContain('Item 0')
    expect(error.message).toContain('…')
    expect(
      (error.details as { candidates: unknown[] }).candidates,
    ).toHaveLength(10)
    const empty = expectErr(
      resolveByName<{ id: string; name: string }>([], 'zzz', opts),
      'RESOURCE_NOT_FOUND',
    )
    expect(empty.message).toBe('Nenhum(a) filial corresponde a "zzz".')
  })

  it('resolves members by "me", e-mail and name', async () => {
    expect(expectOk(await resolveMember(ctx, 'eu')).id).toBe(ctx.actorId)
    expect(expectOk(await resolveMember(ctx, 'BRUNA@acme.com')).id).toBe(
      'user_bruna',
    )
    vi.mocked(CrmMemberService.list).mockResolvedValue(ok([members[1]]))
    expectErr(await resolveMember(ctx, 'me'), 'RESOURCE_NOT_FOUND')
  })

  it('describes people and nameless members in ambiguity errors', async () => {
    vi.mocked(CrmPersonService.list).mockResolvedValue(
      ok([
        person({ id: 'p1', name: 'Rafa Alves' }),
        person({ id: 'p2', name: 'Rafa Souza', emails: [] }),
      ]),
    )
    const error = expectErr(
      await resolvePerson(ctx, 'rafa'),
      'VALIDATION_ERROR',
    )
    expect(error.message).toContain('Rafa Alves <daniela@acme.com>')
    expect(error.message).toContain('Rafa Souza (id p2)')

    vi.mocked(CrmMemberService.list).mockResolvedValue(
      ok([
        { id: 'u1', name: '', email: 'x@acme.com', image: null },
        { id: 'u2', name: '', email: 'y@acme.com', image: null },
      ]),
    )
    const members = expectErr(
      await resolveMember(ctx, 'acme'),
      'VALIDATION_ERROR',
    )
    expect(members.message).toContain('x@acme.com <x@acme.com>')
  })

  it('names linked records, falling back to the id', async () => {
    expect(await companyName(ctx, null)).toBeNull()
    expect(await personName(ctx, null)).toBeNull()
    vi.mocked(CrmCompanyService.getById).mockResolvedValue(ok(company()))
    expect(await companyName(ctx, 'company_1')).toBe('Acme Ltda')
    vi.mocked(CrmCompanyService.getById).mockResolvedValue(
      err({ code: 'FORBIDDEN', message: 'x' }),
    )
    expect(await companyName(ctx, 'company_1')).toBe('company_1')
    vi.mocked(CrmPersonService.getById).mockResolvedValue(ok(person()))
    expect(await personName(ctx, 'person_1')).toBe('Daniela Rocha')
  })

  it('resolves stages scoped to a pipeline', () => {
    const catalog = pipelines.map((p) => ({
      ...p,
      stages: stagesByPipeline[p.id],
    }))
    const ref = expectOk(
      resolveStage(catalog, { stage: 'negociação', pipeline: 'Renovação' }),
    )
    expect(ref.stage.id).toBe('stage_r_neg')
    expectErr(
      resolveStage(catalog, { stage: 'x', pipeline: 'Nada' }),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('paginates', () => {
    const page = paginate(
      [1, 2, 3, 4, 5],
      { limit: 2, offset: 2 },
      (n) => n * 10,
    )
    expect(page).toEqual({
      total: 5,
      offset: 2,
      limit: 2,
      hasMore: true,
      items: [30, 40],
    })
  })

  it('formats values for previews', () => {
    expect(formatValue(null)).toBeNull()
    expect(formatValue('')).toBeNull()
    expect(formatValue([])).toBeNull()
    expect(formatValue(['a', 'b'])).toBe('a, b')
    expect(formatValue(true)).toBe('Sim')
    expect(formatValue(false)).toBe('Não')
    expect(formatValue(new Date('2026-02-03'))).toBe('03/02/2026')
    expect(formatValue(42)).toBe('42')
    expect(formatDate('2026-12-31T00:00:00.000Z')).toBe('31/12/2026')
    expect(formatDate(null)).toBeNull()
    expect(formatMoney(undefined)).toBeNull()
    expect(formatMoney(10)).toContain('10,00')
    expect(excerpt(null)).toBeNull()
    expect(excerpt('abc', 2)).toBe('a…')
    expect(excerpt('ab', 2)).toBe('ab')
  })

  it('builds create and change rows', () => {
    expect(
      afterFields([
        ['A', 'x'],
        ['B', null],
      ]),
    ).toEqual([{ label: 'A', after: 'x' }])
    expect(
      changeFields([
        ['A', 'x', undefined],
        ['B', 'x', 'x'],
        ['C', null, 'y'],
      ]),
    ).toEqual([{ label: 'C', before: null, after: 'y' }])
  })

  it('builds links only when the workspace slug is known', () => {
    expect(recordHref(null, 'lead', 'l')).toBeUndefined()
    expect(recordHref('/acme/crm', 'proposal', 'p')).toBe(
      '/acme/crm/proposals/p',
    )
    expect(recordHref('/acme/crm', 'note', 'n')).toBe(
      '/acme/crm/notes?record=n',
    )
    expect(crmPath(null, 'forecast')).toBeUndefined()
  })

  it('matches queries across values ignoring accents and case', () => {
    expect(matchesQuery(undefined, [])).toBe(true)
    expect(matchesQuery('JOSE', [null, 'José'])).toBe(true)
    expect(matchesQuery('x', [null, undefined])).toBe(false)
  })

  it('reports Zod issues in the parser message', () => {
    const parse = zodParser(
      z.object({ a: z.string() }).refine(() => false, { message: 'regra' }),
    )
    const error = expectErr(parse({ a: 'ok' }), 'VALIDATION_ERROR')
    expect(error.message).toBe('Argumentos inválidos: regra')
    const field = expectErr(parse({}), 'VALIDATION_ERROR')
    expect(field.message).toContain('a: ')
    expect(
      expectOk(
        zodParser(z.object({}))(
          undefined as unknown as Record<string, unknown>,
        ),
      ),
    ).toEqual({})
  })
})
