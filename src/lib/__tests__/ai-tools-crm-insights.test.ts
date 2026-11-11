import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmDocumentSummaryDTO } from '@/src/__tests__/factories/document-migration.factory'
import {
  crmCreateDashboardTool,
  crmCreateFormTool,
  crmCreateProposalTool,
  crmListProposalDocumentsTool,
} from '@/src/lib/ai/tools/crm/builders'
import {
  crmGetForecastTool,
  crmGetRecordTimelineTool,
  crmGetRecordTool,
  crmListPipelinesTool,
  crmListProposalsTool,
} from '@/src/lib/ai/tools/crm/insights'
import {
  crmGetCompetitorGrowthTool,
  crmGetTrendingPostsTool,
  crmListCompetitorsTool,
} from '@/src/lib/ai/tools/crm/social'
import { err, ok } from '@/src/lib/result'
import { CrmActivityService } from '@/src/services/crm-activity.service'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmCompetitorService } from '@/src/services/crm-competitor.service'
import { CrmDashboardService } from '@/src/services/crm-dashboard.service'
import { CrmForecastService } from '@/src/services/crm-forecast.service'
import { CrmFormService } from '@/src/services/crm-form.service'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { CrmNoteService } from '@/src/services/crm-note.service'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import { CrmPersonService } from '@/src/services/crm-person.service'
import {
  CrmPipelineService,
  CrmPipelineStageService,
} from '@/src/services/crm-pipeline.service'
import { CrmProposalService } from '@/src/services/crm-proposal.service'
import { CrmSocialTrendingService } from '@/src/services/crm-social-trending.service'
import { CrmTaskService } from '@/src/services/crm-task.service'
import { DocumentCrmService } from '@/src/services/document-crm.service'
import type { CrmProposalDTO } from '@/types/crm-proposal'
import {
  company,
  dbErr,
  expectErr,
  expectOk,
  forbiddenErr,
  lead,
  ME,
  opportunity,
  person,
  previewOf,
  run,
  taskDto,
  WS,
  wireDefaults,
} from './ai-tools-crm.fixtures'

vi.mock('@/src/services/workspace.service', () => ({
  WorkspaceService: { getById: vi.fn() },
}))
vi.mock('@/src/services/crm-member.service', () => ({
  CrmMemberService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-pipeline.service', () => ({
  CrmPipelineService: { list: vi.fn() },
  CrmPipelineStageService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-company.service', () => ({
  CrmCompanyService: { list: vi.fn(), getById: vi.fn() },
}))
vi.mock('@/src/services/crm-person.service', () => ({
  CrmPersonService: { list: vi.fn(), getById: vi.fn() },
}))
vi.mock('@/src/services/crm-lead.service', () => ({
  CrmLeadService: { getById: vi.fn() },
}))
vi.mock('@/src/services/crm-opportunity.service', () => ({
  CrmOpportunityService: { list: vi.fn(), getById: vi.fn() },
}))
vi.mock('@/src/services/crm-task.service', () => ({
  CrmTaskService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-note.service', () => ({
  CrmNoteService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-activity.service', () => ({
  CrmActivityService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-proposal.service', () => ({
  CrmProposalService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-forecast.service', () => ({
  CrmForecastService: { getForecast: vi.fn() },
}))
vi.mock('@/src/services/crm-competitor.service', () => ({
  CrmCompetitorService: { list: vi.fn(), getMetrics: vi.fn() },
}))
vi.mock('@/src/services/crm-social-trending.service', () => ({
  CrmSocialTrendingService: { getTodayRanking: vi.fn() },
}))
vi.mock('@/src/services/crm-dashboard.service', () => ({
  CrmDashboardService: { create: vi.fn() },
}))
vi.mock('@/src/services/crm-form.service', () => ({
  CrmFormService: { create: vi.fn() },
}))
vi.mock('@/src/services/document-crm.service', () => ({
  DocumentCrmService: {
    createProposal: vi.fn(),
    createForOpportunity: vi.fn(),
    listProposals: vi.fn(),
  },
}))

type Page = { total: number; items: Array<Record<string, unknown>> }

function proposal(over: Partial<CrmProposalDTO> = {}): CrmProposalDTO {
  return {
    id: 'prop_1',
    name: 'Proposta Acme',
    templateId: null,
    companyId: 'company_1',
    contactId: null,
    opportunityId: 'opp_1',
    leadId: null,
    responsibleId: ME,
    validUntil: null,
    status: 'SENT',
    isExpired: false,
    acceptedAt: null,
    acceptedByName: null,
    expiredAt: null,
    shareToken: 'tok',
    viewsCount: 2,
    sections: [],
    workspaceId: WS,
    createdById: ME,
    updatedById: null,
    position: 0,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...over,
  }
}

function note(over: Record<string, unknown> = {}) {
  return {
    id: 'note_1',
    title: 'Nota',
    body: 'Texto',
    companyId: null,
    personId: null,
    opportunityId: null,
    leadId: null,
    workspaceId: WS,
    createdById: ME,
    updatedById: null,
    position: 0,
    createdAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
    ...over,
  }
}

function activity(over: Record<string, unknown> = {}) {
  return {
    id: 'act_1',
    workspaceId: WS,
    actorUserId: ME,
    action: 'updated',
    entity: 'opportunity',
    entityId: 'opp_1',
    companyId: null,
    personId: null,
    opportunityId: 'opp_1',
    summary: 'Valor alterado',
    createdAt: '2026-10-03T12:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  wireDefaults()
})

describe('crm_list_pipelines', () => {
  it('lists pipelines with ordered stages', async () => {
    const out = expectOk(await run(crmListPipelinesTool, {}))
    const data = out.data as {
      href: string
      items: Array<{ name: string; stages: { name: string }[] }>
    }
    expect(data.href).toBe('/acme/crm/pipelines')
    expect(data.items[0].stages.map((s) => s.name)).toEqual([
      'Novo',
      'Negociação',
      'Ganho',
      'Perdido',
    ])
    expect(out.summary).toBe('2 pipeline(s)')
  })

  it('maps pipeline and stage errors', async () => {
    vi.mocked(CrmPipelineStageService.list).mockResolvedValue(err(dbErr))
    expectErr(await run(crmListPipelinesTool, {}), 'DATABASE_ERROR')
    vi.mocked(CrmPipelineService.list).mockResolvedValue(err(forbiddenErr))
    expectErr(await run(crmListPipelinesTool, {}), 'FORBIDDEN')
  })
})

describe('crm_list_proposals', () => {
  beforeEach(() => {
    vi.mocked(CrmProposalService.list).mockResolvedValue(
      ok([
        proposal(),
        proposal({
          id: 'prop_2',
          name: 'Proposta Beta',
          status: 'ACCEPTED',
          opportunityId: null,
          leadId: 'lead_1',
          companyId: null,
          responsibleId: 'user_bruno',
        }),
      ]),
    )
  })

  it('lists with links and filters', async () => {
    const all = expectOk(await run(crmListProposalsTool, {}))
    expect((all.data as Page).items[0]).toMatchObject({
      href: '/acme/crm/proposals/prop_1',
      viewsCount: 2,
    })
    const filtered = [
      { status: 'ACCEPTED' },
      { leadId: 'lead_1' },
      { responsible: 'Bruno Lima' },
      { query: 'beta' },
    ]
    for (const args of filtered) {
      const out = expectOk(await run(crmListProposalsTool, args))
      expect((out.data as Page).items.map((i) => i.id)).toEqual(['prop_2'])
    }
    const byOpp = expectOk(
      await run(crmListProposalsTool, {
        opportunityId: 'opp_1',
        companyId: 'company_1',
      }),
    )
    expect((byOpp.data as Page).total).toBe(1)
  })

  it('maps errors', async () => {
    expectErr(
      await run(crmListProposalsTool, { responsible: 'lima' }),
      'VALIDATION_ERROR',
    )
    vi.mocked(CrmProposalService.list).mockResolvedValue(err(forbiddenErr))
    expectErr(await run(crmListProposalsTool, {}), 'FORBIDDEN')
  })
})

describe('crm_get_forecast', () => {
  const row = (over: Record<string, unknown>) => ({
    ownerId: ME,
    ownerName: 'Ana Souza',
    periodKey: '2026-10',
    wonAmount: 1000,
    weightedOpenAmount: 500,
    forecastAmount: 1500,
    openCount: 1,
    wonCount: 1,
    quotaAmount: 3000,
    attainmentPct: 50,
    ...over,
  })

  beforeEach(() => {
    vi.mocked(CrmForecastService.getForecast).mockResolvedValue(
      ok({
        period: 'MONTH',
        rows: [
          row({}),
          row({ periodKey: '2026-11' }),
          row({
            ownerId: 'user_bruno',
            ownerName: 'Bruno Lima',
            quotaAmount: 0,
            attainmentPct: null,
          }),
        ],
      }),
    )
  })

  it('totals the rows with attainment', async () => {
    const out = expectOk(
      await run(crmGetForecastTool, { periodKey: '2026-10' }),
    )
    const data = out.data as {
      rows: unknown[]
      totals: Record<string, unknown>
      href: string
    }
    expect(data.rows).toHaveLength(2)
    expect(data.totals).toEqual({
      wonAmount: 2000,
      weightedOpenAmount: 1000,
      forecastAmount: 3000,
      quotaAmount: 3000,
      attainmentPct: 100,
    })
    expect(data.href).toBe('/acme/crm/forecast')
    expect(out.summary).toContain('(100% da meta)')
    expect(CrmForecastService.getForecast).toHaveBeenCalledWith(ME, WS, 'MONTH')
  })

  it('filters by owner and omits attainment without quota', async () => {
    const out = expectOk(
      await run(crmGetForecastTool, { owner: 'Bruno Lima', period: 'QUARTER' }),
    )
    expect(
      (out.data as { totals: { attainmentPct: null } }).totals.attainmentPct,
    ).toBeNull()
    expect(out.summary).not.toContain('meta')
  })

  it('maps errors', async () => {
    expectErr(
      await run(crmGetForecastTool, { owner: 'Zé' }),
      'RESOURCE_NOT_FOUND',
    )
    vi.mocked(CrmForecastService.getForecast).mockResolvedValue(
      err(forbiddenErr),
    )
    expectErr(await run(crmGetForecastTool, {}), 'FORBIDDEN')
  })
})

describe('crm_get_record_timeline', () => {
  it('merges notes and activities, newest first', async () => {
    vi.mocked(CrmNoteService.list).mockResolvedValue(ok([note()]))
    vi.mocked(CrmActivityService.list).mockResolvedValue(ok([activity()]))
    const out = expectOk(
      await run(crmGetRecordTimelineTool, {
        recordType: 'opportunity',
        recordId: 'opp_1',
      }),
    )
    const items = (out.data as Page).items
    expect(items.map((i) => i.kind)).toEqual(['activity', 'note'])
    expect(CrmNoteService.list).toHaveBeenCalledWith(ME, WS, {
      opportunityId: 'opp_1',
    })
    expect(out.summary).toBe('1 nota(s) e 1 atividade(s)')

    await run(crmGetRecordTimelineTool, {
      recordType: 'company',
      recordId: 'c',
    })
    expect(CrmActivityService.list).toHaveBeenLastCalledWith(ME, WS, {
      companyId: 'c',
    })
    await run(crmGetRecordTimelineTool, { recordType: 'person', recordId: 'p' })
    expect(CrmActivityService.list).toHaveBeenLastCalledWith(ME, WS, {
      personId: 'p',
    })
  })

  it('reads lead notes by leadId and has no lead activities', async () => {
    vi.mocked(CrmNoteService.list).mockResolvedValue(
      ok([note({ leadId: 'lead_1' }), note({ id: 'note_2', leadId: 'other' })]),
    )
    const out = expectOk(
      await run(crmGetRecordTimelineTool, {
        recordType: 'lead',
        recordId: 'lead_1',
      }),
    )
    expect((out.data as Page).total).toBe(1)
    expect(CrmActivityService.list).not.toHaveBeenCalled()
  })

  it('maps note and activity errors', async () => {
    vi.mocked(CrmNoteService.list).mockResolvedValue(err(forbiddenErr))
    vi.mocked(CrmActivityService.list).mockResolvedValue(ok([]))
    expectErr(
      await run(crmGetRecordTimelineTool, {
        recordType: 'lead',
        recordId: 'l',
      }),
      'FORBIDDEN',
    )
    expectErr(
      await run(crmGetRecordTimelineTool, {
        recordType: 'person',
        recordId: 'p',
      }),
      'FORBIDDEN',
    )
    vi.mocked(CrmNoteService.list).mockResolvedValue(ok([]))
    vi.mocked(CrmActivityService.list).mockResolvedValue(err(forbiddenErr))
    expectErr(
      await run(crmGetRecordTimelineTool, {
        recordType: 'person',
        recordId: 'p',
      }),
      'FORBIDDEN',
    )
  })
})

describe('crm_get_record', () => {
  beforeEach(() => {
    vi.mocked(CrmProposalService.list).mockResolvedValue(
      ok([
        proposal(),
        proposal({ id: 'prop_lead', opportunityId: null, leadId: 'lead_1' }),
      ]),
    )
    vi.mocked(CrmNoteService.list).mockResolvedValue(ok([note()]))
    vi.mocked(CrmActivityService.list).mockResolvedValue(
      ok([
        activity(),
        activity({ id: 'act_0', createdAt: '2026-09-01T00:00:00.000Z' }),
      ]),
    )
    vi.mocked(CrmTaskService.list).mockResolvedValue(ok([taskDto()]))
    vi.mocked(CrmCompanyService.getById).mockResolvedValue(ok(company()))
    vi.mocked(CrmPersonService.getById).mockResolvedValue(ok(person()))
    vi.mocked(CrmOpportunityService.list).mockResolvedValue(
      ok([
        opportunity({ companyId: 'company_1', pointOfContactId: 'person_1' }),
        opportunity({ id: 'opp_other' }),
      ]),
    )
    vi.mocked(CrmPersonService.list).mockResolvedValue(ok([person()]))
  })

  it('returns a lead with its converted person, notes and proposals', async () => {
    vi.mocked(CrmLeadService.getById).mockResolvedValue(
      ok(lead({ convertedPersonId: 'person_1' })),
    )
    vi.mocked(CrmNoteService.list).mockResolvedValue(
      ok([note({ leadId: 'lead_1' })]),
    )
    const out = expectOk(
      await run(crmGetRecordTool, { recordType: 'lead', recordId: 'lead_1' }),
    )
    const data = out.data as Record<string, any>
    expect(data.record).toMatchObject({ id: 'lead_1', jobTitle: 'CTO' })
    expect(data.convertedPerson).toMatchObject({ id: 'person_1' })
    expect(data.notes.total).toBe(1)
    expect(data.proposals.items.map((p: { id: string }) => p.id)).toEqual([
      'prop_lead',
    ])
    expect(out.summary).toBe('Lead “Carlos Pereira”')
  })

  it('returns a lead without person and reports related errors inline', async () => {
    vi.mocked(CrmLeadService.getById).mockResolvedValue(ok(lead()))
    vi.mocked(CrmProposalService.list).mockResolvedValue(err(forbiddenErr))
    const data = expectOk(
      await run(crmGetRecordTool, { recordType: 'lead', recordId: 'lead_1' }),
    ).data as Record<string, any>
    expect(data.convertedPerson).toBeNull()
    expect(data.proposals).toEqual({ error: 'Sem permissão' })
    expect(CrmPersonService.getById).not.toHaveBeenCalled()
  })

  it('returns an opportunity with company, contact and related items', async () => {
    vi.mocked(CrmOpportunityService.getById).mockResolvedValue(
      ok(
        opportunity({
          companyId: 'company_1',
          pointOfContactId: 'person_1',
          customFields: { cf_1: 'x' },
        }),
      ),
    )
    const data = expectOk(
      await run(crmGetRecordTool, {
        recordType: 'opportunity',
        recordId: 'opp_1',
      }),
    ).data as Record<string, any>
    expect(data.record).toMatchObject({
      stage: 'Novo',
      customFields: { cf_1: 'x' },
    })
    expect(data.company).toMatchObject({ id: 'company_1' })
    expect(data.pointOfContact).toMatchObject({ id: 'person_1' })
    expect(data.tasks.total).toBe(1)
    expect(data.proposals.items).toHaveLength(1)
    expect(data.activities.items.map((a: { id: string }) => a.id)).toEqual([
      'act_1',
      'act_0',
    ])
  })

  it('handles an opportunity without links and with failing lookups', async () => {
    vi.mocked(CrmOpportunityService.getById).mockResolvedValue(
      ok(opportunity()),
    )
    vi.mocked(CrmPipelineService.list).mockResolvedValue(err(forbiddenErr))
    vi.mocked(CrmProposalService.list).mockResolvedValue(err(forbiddenErr))
    vi.mocked(CrmActivityService.list).mockResolvedValue(err(forbiddenErr))
    const data = expectOk(
      await run(crmGetRecordTool, {
        recordType: 'opportunity',
        recordId: 'opp_1',
      }),
    ).data as Record<string, any>
    expect(data.company).toBeNull()
    expect(data.pointOfContact).toBeNull()
    expect(data.record.stage).toBeNull()
    expect(data.proposals).toEqual({ error: 'Sem permissão' })
    expect(data.activities).toEqual({ error: 'Sem permissão' })
  })

  it('returns a person with company and opportunities as contact', async () => {
    vi.mocked(CrmPersonService.getById).mockResolvedValue(
      ok(person({ companyId: 'company_1' })),
    )
    const data = expectOk(
      await run(crmGetRecordTool, {
        recordType: 'person',
        recordId: 'person_1',
      }),
    ).data as Record<string, any>
    expect(data.company).toMatchObject({ id: 'company_1' })
    expect(data.opportunities.items.map((o: { id: string }) => o.id)).toEqual([
      'opp_1',
    ])
    expect(data.activities.total).toBe(2)
  })

  it('returns a person without company and with failing lists', async () => {
    vi.mocked(CrmPersonService.getById).mockResolvedValue(ok(person()))
    vi.mocked(CrmOpportunityService.list).mockResolvedValue(err(forbiddenErr))
    vi.mocked(CrmActivityService.list).mockResolvedValue(err(forbiddenErr))
    const data = expectOk(
      await run(crmGetRecordTool, {
        recordType: 'person',
        recordId: 'person_1',
      }),
    ).data as Record<string, any>
    expect(data.company).toBeNull()
    expect(data.opportunities).toEqual({ error: 'Sem permissão' })
    expect(data.activities).toEqual({ error: 'Sem permissão' })
  })

  it('returns a company with people and opportunities', async () => {
    const data = expectOk(
      await run(crmGetRecordTool, {
        recordType: 'company',
        recordId: 'company_1',
      }),
    ).data as Record<string, any>
    expect(data.record).toMatchObject({
      id: 'company_1',
      address: { city: 'Campinas' },
    })
    expect(data.people.total).toBe(1)
    expect(data.opportunities.items).toHaveLength(1)
    expect(CrmPersonService.list).toHaveBeenCalledWith(ME, WS, {
      companyId: 'company_1',
    })

    vi.mocked(CrmOpportunityService.list).mockResolvedValue(err(forbiddenErr))
    vi.mocked(CrmActivityService.list).mockResolvedValue(err(forbiddenErr))
    const partial = expectOk(
      await run(crmGetRecordTool, {
        recordType: 'company',
        recordId: 'company_1',
      }),
    ).data as Record<string, any>
    expect(partial.opportunities).toEqual({ error: 'Sem permissão' })
    expect(partial.activities).toEqual({ error: 'Sem permissão' })
  })

  it('maps a missing main record for every type', async () => {
    const notFound = { code: 'RESOURCE_NOT_FOUND', message: 'x' } as const
    vi.mocked(CrmLeadService.getById).mockResolvedValue(err(notFound))
    vi.mocked(CrmOpportunityService.getById).mockResolvedValue(err(notFound))
    vi.mocked(CrmPersonService.getById).mockResolvedValue(err(notFound))
    vi.mocked(CrmCompanyService.getById).mockResolvedValue(err(notFound))
    for (const recordType of ['lead', 'opportunity', 'person', 'company']) {
      expectErr(
        await run(crmGetRecordTool, { recordType, recordId: 'x' }),
        'RESOURCE_NOT_FOUND',
      )
    }
    expectErr(
      crmGetRecordTool.parse({ recordType: 'task', recordId: 'x' }),
      'VALIDATION_ERROR',
    )
  })
})

describe('social tools (ported)', () => {
  it('lists competitors with links', async () => {
    vi.mocked(CrmCompetitorService.list).mockResolvedValue(
      ok([
        {
          id: 'comp_1',
          platform: 'INSTAGRAM',
          handle: 'rival',
          displayName: 'Rival',
          followersCount: 1000,
          syncStatus: 'OK',
          lastSyncedAt: null,
        } as never,
      ]),
    )
    const out = expectOk(await run(crmListCompetitorsTool, {}))
    expect((out.data as Page).items[0]).toMatchObject({
      handle: 'rival',
      href: '/acme/crm/social/competitors/comp_1',
    })
    vi.mocked(CrmCompetitorService.list).mockResolvedValue(err(forbiddenErr))
    expectErr(await run(crmListCompetitorsTool, {}), 'FORBIDDEN')
  })

  it('returns competitor growth with the default range', async () => {
    vi.mocked(CrmCompetitorService.getMetrics).mockResolvedValue(
      ok({ range: '30d', competitor: {}, ownAccount: null } as never),
    )
    const out = expectOk(
      await run(crmGetCompetitorGrowthTool, { competitorId: 'comp_1' }),
    )
    expect(CrmCompetitorService.getMetrics).toHaveBeenCalledWith(
      ME,
      WS,
      'comp_1',
      '30d',
    )
    expect(out.data).toMatchObject({
      range: '30d',
      href: '/acme/crm/social/competitors/comp_1',
    })
    expectErr(
      crmGetCompetitorGrowthTool.parse({ competitorId: 'c', range: '1y' }),
      'VALIDATION_ERROR',
    )
    vi.mocked(CrmCompetitorService.getMetrics).mockResolvedValue(
      err(forbiddenErr),
    )
    expectErr(
      await run(crmGetCompetitorGrowthTool, { competitorId: 'comp_1' }),
      'FORBIDDEN',
    )
  })

  it('pages the trending ranking', async () => {
    vi.mocked(CrmSocialTrendingService.getTodayRanking).mockResolvedValue(
      ok(Array.from({ length: 25 }, (_, i) => ({ id: `p${i}` })) as never),
    )
    const out = expectOk(await run(crmGetTrendingPostsTool, { limit: 5 }))
    expect(out.data).toMatchObject({
      total: 25,
      hasMore: true,
      href: '/acme/crm/social/trending',
    })
    vi.mocked(CrmSocialTrendingService.getTodayRanking).mockResolvedValue(
      err(forbiddenErr),
    )
    expectErr(await run(crmGetTrendingPostsTool, {}), 'FORBIDDEN')
  })
})

describe('builder tools (ported)', () => {
  it('creates a dashboard after a preview', async () => {
    const preview = expectOk(
      await previewOf(crmCreateDashboardTool, { title: 'Vendas Q4' }),
    )
    expect(preview.fields).toEqual([{ label: 'Título', after: 'Vendas Q4' }])
    expect(CrmDashboardService.create).not.toHaveBeenCalled()
    vi.mocked(CrmDashboardService.create).mockResolvedValue(
      ok({ id: 'dash_1', title: 'Vendas Q4' } as never),
    )
    const out = expectOk(
      await run(crmCreateDashboardTool, { title: 'Vendas Q4' }),
    )
    expect(out.target?.href).toBe('/acme/crm/dashboards/dash_1')
    vi.mocked(CrmDashboardService.create).mockResolvedValue(err(dbErr))
    expectErr(
      await run(crmCreateDashboardTool, { title: 'X' }),
      'DATABASE_ERROR',
    )
    expectErr(crmCreateDashboardTool.parse({}), 'VALIDATION_ERROR')
  })

  it('creates a form with mapped fields', async () => {
    const args = {
      name: 'Contato',
      action: 'LEAD',
      fields: [
        {
          key: 'nome',
          label: 'Nome',
          type: 'text',
          required: true,
          mapping: { target: 'lead', attribute: 'name' },
        },
        {
          key: 'email',
          label: 'E-mail',
          type: 'email',
          mapping: { target: 'lead', attribute: 'email' },
        },
      ],
    }
    const preview = expectOk(await previewOf(crmCreateFormTool, args))
    expect(preview.summary).toBe('Cria um lead a cada envio. 2 campo(s).')
    expect(preview.fields).toContainEqual({
      label: 'Campos',
      after: 'Nome * (text), E-mail (email)',
    })
    vi.mocked(CrmFormService.create).mockResolvedValue(
      ok({ id: 'form_1', name: 'Contato', status: 'DRAFT' } as never),
    )
    const out = expectOk(await run(crmCreateFormTool, args))
    expect(out.data).toMatchObject({ href: '/acme/crm/forms/form_1' })
    vi.mocked(CrmFormService.create).mockResolvedValue(err(dbErr))
    expectErr(await run(crmCreateFormTool, args), 'DATABASE_ERROR')
  })

  it('rejects a form field mapped to an invalid attribute', () => {
    expectErr(
      crmCreateFormTool.parse({
        name: 'X',
        action: 'LEAD',
        fields: [
          {
            key: 'k',
            label: 'K',
            type: 'text',
            mapping: { target: 'lead', attribute: 'salary' },
          },
        ],
      }),
      'VALIDATION_ERROR',
    )
  })

  it('creates a proposal document from an opportunity or standalone', async () => {
    const fromDeal = { title: 'Proposta Acme', opportunityId: 'opp_1' }
    const preview = expectOk(await previewOf(crmCreateProposalTool, fromDeal))
    expect(preview.summary).toBe(
      'Com os itens da oportunidade na tabela de preços.',
    )
    expect(preview.fields).toContainEqual({
      label: 'Oportunidade',
      after: 'opp_1',
    })
    vi.mocked(DocumentCrmService.createForOpportunity).mockResolvedValue(
      ok(createFakeCrmDocumentSummaryDTO({ id: 'doc_1', title: 'Proposta Acme' })),
    )
    const out = expectOk(await run(crmCreateProposalTool, fromDeal))
    expect(out.target?.href).toBe('/acme/crm/documents/doc_1')
    expect(DocumentCrmService.createForOpportunity).toHaveBeenCalledWith(
      ME,
      WS,
      'opp_1',
      { title: 'Proposta Acme', templateId: undefined },
    )

    const standalone = { title: 'Avulsa', companyId: 'company_1' }
    const quiet = expectOk(await previewOf(crmCreateProposalTool, standalone))
    expect(quiet.summary).toBe('Em rascunho, para editar no app.')
    vi.mocked(DocumentCrmService.createProposal).mockResolvedValue(
      ok(createFakeCrmDocumentSummaryDTO({ id: 'doc_2', title: 'Avulsa' })),
    )
    expectOk(await run(crmCreateProposalTool, standalone))
    expect(DocumentCrmService.createProposal).toHaveBeenCalledWith(ME, WS, {
      title: 'Avulsa',
      companyId: 'company_1',
      personId: undefined,
      leadId: undefined,
      templateId: undefined,
    })

    vi.mocked(DocumentCrmService.createProposal).mockResolvedValue(err(dbErr))
    expectErr(await run(crmCreateProposalTool, standalone), 'DATABASE_ERROR')
    expectErr(crmCreateProposalTool.parse({ title: '' }), 'VALIDATION_ERROR')
  })

  it('lists proposal documents with filters and links', async () => {
    const docs = [
      createFakeCrmDocumentSummaryDTO({
        id: 'doc_1',
        title: 'Proposta Acme',
        status: 'SENT',
        companyId: 'company_1',
      }),
      createFakeCrmDocumentSummaryDTO({
        id: 'doc_2',
        title: 'Proposta Beta',
        companyId: 'company_2',
      }),
    ]
    vi.mocked(DocumentCrmService.listProposals).mockResolvedValue(ok(docs))

    const all = expectOk(await run(crmListProposalDocumentsTool, {}))
    const page = all.data as Page
    expect(page.total).toBe(2)
    expect(page.items[0]).toMatchObject({
      id: 'doc_1',
      statusLabel: 'Enviado',
      href: '/acme/crm/documents/doc_1',
    })
    expect(DocumentCrmService.listProposals).toHaveBeenCalledWith(ME, WS, {
      status: undefined,
      opportunityId: undefined,
      leadId: undefined,
      isTemplate: false,
    })

    const acme = expectOk(
      await run(crmListProposalDocumentsTool, {
        query: 'acme',
        companyId: 'company_1',
        templates: true,
        status: 'SENT',
      }),
    )
    expect((acme.data as Page).items.map((i) => i.id)).toEqual(['doc_1'])
    expect(DocumentCrmService.listProposals).toHaveBeenLastCalledWith(ME, WS, {
      status: 'SENT',
      opportunityId: undefined,
      leadId: undefined,
      isTemplate: true,
    })

    vi.mocked(DocumentCrmService.listProposals).mockResolvedValue(
      err(forbiddenErr),
    )
    expectErr(await run(crmListProposalDocumentsTool, {}), 'FORBIDDEN')
  })
})
