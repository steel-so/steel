import { z } from 'zod'
import { ok, type Result } from '@/src/lib/result'
import { CrmActivityService } from '@/src/services/crm-activity.service'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmForecastService } from '@/src/services/crm-forecast.service'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { CrmNoteService } from '@/src/services/crm-note.service'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import { CrmPersonService } from '@/src/services/crm-person.service'
import { CrmProposalService } from '@/src/services/crm-proposal.service'
import { CrmTaskService } from '@/src/services/crm-task.service'
import type { CrmActivityDTO } from '@/types/crm-activity'
import type { CrmNoteDTO } from '@/types/crm-note'
import type { CrmProposalDTO } from '@/types/crm-proposal'
import type { AiToolContext, SteelAiTool } from '../types'
import { compactCompany, compactPerson } from './contacts'
import { compactLead } from './leads'
import { compactOpportunity } from './opportunities'
import {
  crmBase,
  crmPath,
  formatMoney,
  indexStages,
  loadPipelines,
  matchesQuery,
  memberNames,
  ownerParameter,
  type PipelineWithStages,
  pageParameters,
  pageSchema,
  paginate,
  recordHref,
  resolveMember,
  type StageRef,
  zodParser,
} from './shared'
import { compactNote, compactTask } from './work'

/* -------------------------------- pipelines ------------------------------- */

const NoArgs = z.object({})

export const crmListPipelinesTool: SteelAiTool<z.output<typeof NoArgs>> = {
  name: 'crm_list_pipelines',
  label: 'Consultando pipelines',
  module: 'CRM',
  kind: 'READ',
  description:
    'Lista os pipelines de vendas do workspace com suas etapas (nome, posição, probabilidade e categoria OPEN/WON/LOST). Use para descobrir os nomes das etapas antes de filtrar ou mover oportunidades.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  permission: { resource: 'pipelines', action: 'VIEW' },
  parse: zodParser(NoArgs),
  async execute(ctx) {
    const pipelines = await loadPipelines(ctx)
    if (!pipelines.ok) return pipelines
    const base = await crmBase(ctx)
    return ok({
      data: {
        href: crmPath(base, 'pipelines'),
        items: pipelines.value.map((p) => ({
          id: p.id,
          name: p.name,
          isDefault: p.isDefault,
          stages: p.stages.map((s) => ({
            id: s.id,
            name: s.name,
            position: s.position,
            category: s.category,
            probability: s.probability,
          })),
        })),
      },
      summary: `${pipelines.value.length} pipeline(s)`,
    })
  },
}

/* -------------------------------- proposals ------------------------------- */

const PROPOSAL_STATUS = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
] as const

function compactProposal(p: CrmProposalDTO, base: string | null) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    isExpired: p.isExpired,
    validUntil: p.validUntil,
    viewsCount: p.viewsCount,
    acceptedAt: p.acceptedAt,
    opportunityId: p.opportunityId,
    leadId: p.leadId,
    companyId: p.companyId,
    contactId: p.contactId,
    responsibleId: p.responsibleId,
    href: recordHref(base, 'proposal', p.id),
  }
}

const ListProposalsArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  status: z.enum(PROPOSAL_STATUS).optional(),
  opportunityId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  responsible: z.string().trim().min(1).optional(),
  ...pageSchema,
})

export const crmListProposalsTool: SteelAiTool<
  z.output<typeof ListProposalsArgs>
> = {
  name: 'crm_list_proposals',
  label: 'Consultando propostas',
  module: 'CRM',
  kind: 'READ',
  description:
    'Lista as propostas comerciais com filtros e paginação — nome, status (DRAFT, SENT, VIEWED, ACCEPTED, REJECTED, EXPIRED), validade, visualizações e vínculos (oportunidade, lead, empresa), com link.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      status: { type: 'string', enum: [...PROPOSAL_STATUS] },
      opportunityId: {
        type: 'string',
        description: 'Só as da oportunidade (id).',
      },
      leadId: { type: 'string', description: 'Só as do lead (id).' },
      companyId: { type: 'string', description: 'Só as da empresa (id).' },
      responsible: ownerParameter,
      ...pageParameters,
    },
    additionalProperties: false,
  },
  permission: { resource: 'documents', action: 'VIEW' },
  parse: zodParser(ListProposalsArgs),
  async execute(ctx, args) {
    let responsibleId: string | undefined
    if (args.responsible) {
      const member = await resolveMember(ctx, args.responsible)
      if (!member.ok) return member
      responsibleId = member.value.id
    }
    const proposals = await CrmProposalService.list(
      ctx.actorId,
      ctx.workspaceId,
    )
    if (!proposals.ok) return proposals
    const filtered = proposals.value.filter(
      (p) =>
        matchesQuery(args.query, [p.name]) &&
        (!args.status || p.status === args.status) &&
        (!args.opportunityId || p.opportunityId === args.opportunityId) &&
        (!args.leadId || p.leadId === args.leadId) &&
        (!args.companyId || p.companyId === args.companyId) &&
        (!responsibleId || p.responsibleId === responsibleId),
    )
    const base = await crmBase(ctx)
    const page = paginate(filtered, args, (p) => compactProposal(p, base))
    return ok({
      data: page,
      summary: `${page.total} proposta(s) encontrada(s)`,
    })
  },
}

/* -------------------------------- forecast -------------------------------- */

const ForecastArgs = z.object({
  period: z.enum(['MONTH', 'QUARTER']).default('MONTH'),
  periodKey: z.string().trim().min(1).optional(),
  owner: z.string().trim().min(1).optional(),
})

export const crmGetForecastTool: SteelAiTool<z.output<typeof ForecastArgs>> = {
  name: 'crm_get_forecast',
  label: 'Consultando previsão de receita',
  module: 'CRM',
  kind: 'READ',
  description:
    'Previsão de receita por responsável e período (mês ou trimestre, pela data de fechamento): receita ganha, pipeline em aberto ponderado pela probabilidade, previsão (ganho + ponderado), meta e atingimento da meta em %. `periodKey` filtra um período ("2026-10" para mês, "2026-Q4" para trimestre).',
  parameters: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: ['MONTH', 'QUARTER'] },
      periodKey: {
        type: 'string',
        description: 'Ex.: "2026-10" (mês) ou "2026-Q4" (trimestre).',
      },
      owner: ownerParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'opportunities', action: 'VIEW' },
  parse: zodParser(ForecastArgs),
  async execute(ctx, args) {
    let ownerId: string | undefined
    if (args.owner) {
      const member = await resolveMember(ctx, args.owner)
      if (!member.ok) return member
      ownerId = member.value.id
    }
    const forecast = await CrmForecastService.getForecast(
      ctx.actorId,
      ctx.workspaceId,
      args.period,
    )
    if (!forecast.ok) return forecast
    const rows = forecast.value.rows.filter(
      (r) =>
        (!args.periodKey || r.periodKey === args.periodKey) &&
        (!ownerId || r.ownerId === ownerId),
    )
    const totals = rows.reduce(
      (t, r) => ({
        wonAmount: t.wonAmount + r.wonAmount,
        weightedOpenAmount: t.weightedOpenAmount + r.weightedOpenAmount,
        forecastAmount: t.forecastAmount + r.forecastAmount,
        quotaAmount: t.quotaAmount + r.quotaAmount,
      }),
      {
        wonAmount: 0,
        weightedOpenAmount: 0,
        forecastAmount: 0,
        quotaAmount: 0,
      },
    )
    const attainmentPct =
      totals.quotaAmount > 0
        ? Math.round((totals.forecastAmount / totals.quotaAmount) * 100)
        : null
    const base = await crmBase(ctx)
    return ok({
      data: {
        period: forecast.value.period,
        rows,
        totals: { ...totals, attainmentPct },
        href: crmPath(base, 'forecast'),
      },
      summary: `Previsão de ${formatMoney(totals.forecastAmount)}${
        attainmentPct === null ? '' : ` (${attainmentPct}% da meta)`
      }`,
    })
  },
}

/* --------------------------------- records -------------------------------- */

const RECORD_TYPES = ['lead', 'opportunity', 'person', 'company'] as const
type RecordType = (typeof RECORD_TYPES)[number]

const RELATED_LIMIT = 10

function stagesOf(pipelines: Result<PipelineWithStages[]>) {
  return pipelines.ok
    ? indexStages(pipelines.value)
    : new Map<string, StageRef>()
}

function compactActivity(a: CrmActivityDTO) {
  return {
    id: a.id,
    action: a.action,
    entity: a.entity,
    summary: a.summary,
    actorUserId: a.actorUserId,
    createdAt: a.createdAt,
  }
}

function byNewest<T extends { createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Filter key of the activity/note/task lists for a record type. */
function linkFilter(type: RecordType, id: string) {
  if (type === 'company') return { companyId: id }
  if (type === 'person') return { personId: id }
  return { opportunityId: id }
}

/**
 * Notes of a record. Notes of a lead are not filterable by the service, so
 * they are read from the workspace list and matched on `leadId`.
 */
async function notesOf(
  ctx: AiToolContext,
  type: RecordType,
  id: string,
): Promise<Result<CrmNoteDTO[]>> {
  if (type === 'lead') {
    const notes = await CrmNoteService.list(ctx.actorId, ctx.workspaceId, {})
    if (!notes.ok) return notes
    return ok(notes.value.filter((n) => n.leadId === id))
  }
  return CrmNoteService.list(ctx.actorId, ctx.workspaceId, linkFilter(type, id))
}

async function activitiesOf(
  ctx: AiToolContext,
  type: RecordType,
  id: string,
): Promise<Result<CrmActivityDTO[]>> {
  // Lead history lives in its own stage records, not in the activity feed.
  if (type === 'lead') return ok([])
  return CrmActivityService.list(
    ctx.actorId,
    ctx.workspaceId,
    linkFilter(type, id),
  )
}

const TimelineArgs = z.object({
  recordType: z.enum(RECORD_TYPES),
  recordId: z.string().min(1),
  ...pageSchema,
})

export const crmGetRecordTimelineTool: SteelAiTool<
  z.output<typeof TimelineArgs>
> = {
  name: 'crm_get_record_timeline',
  label: 'Consultando histórico do registro',
  module: 'CRM',
  kind: 'READ',
  description:
    'Histórico de um registro do CRM (lead, oportunidade, pessoa ou empresa): atividades registradas (criações, alterações) e notas, das mais recentes para as mais antigas, paginadas.',
  parameters: {
    type: 'object',
    properties: {
      recordType: { type: 'string', enum: [...RECORD_TYPES] },
      recordId: {
        type: 'string',
        description: 'Id do registro (de uma listagem do CRM ou de ws_search).',
      },
      ...pageParameters,
    },
    required: ['recordType', 'recordId'],
    additionalProperties: false,
  },
  parse: zodParser(TimelineArgs),
  async execute(ctx, args) {
    const [notes, activities] = await Promise.all([
      notesOf(ctx, args.recordType, args.recordId),
      activitiesOf(ctx, args.recordType, args.recordId),
    ])
    if (!notes.ok) return notes
    if (!activities.ok) return activities
    const base = await crmBase(ctx)
    const entries = byNewest([
      ...notes.value.map((n) => ({
        kind: 'note' as const,
        createdAt: n.createdAt,
        note: compactNote(n, base),
      })),
      ...activities.value.map((a) => ({
        kind: 'activity' as const,
        createdAt: a.createdAt,
        activity: compactActivity(a),
      })),
    ])
    const page = paginate(entries, args, (e) => e)
    return ok({
      data: page,
      summary: `${notes.value.length} nota(s) e ${activities.value.length} atividade(s)`,
    })
  },
}

const GetRecordArgs = z.object({
  recordType: z.enum(RECORD_TYPES),
  recordId: z.string().min(1),
})

function related<T, U>(items: Result<T[]>, map: (item: T) => U) {
  if (!items.ok) return { error: items.error.message }
  return {
    total: items.value.length,
    items: items.value.slice(0, RELATED_LIMIT).map(map),
  }
}

export const crmGetRecordTool: SteelAiTool<z.output<typeof GetRecordArgs>> = {
  name: 'crm_get_record',
  label: 'Consultando registro',
  module: 'CRM',
  kind: 'READ',
  description:
    'Detalhe de um registro do CRM — lead, oportunidade, pessoa ou empresa — com os itens relacionados (empresa, contato, oportunidades, pessoas, tarefas, notas, propostas e atividades recentes; até 10 de cada, com o total).',
  parameters: {
    type: 'object',
    properties: {
      recordType: { type: 'string', enum: [...RECORD_TYPES] },
      recordId: {
        type: 'string',
        description: 'Id do registro (de uma listagem do CRM ou de ws_search).',
      },
    },
    required: ['recordType', 'recordId'],
    additionalProperties: false,
  },
  parse: zodParser(GetRecordArgs),
  async execute(ctx, args) {
    const [base, owners] = await Promise.all([crmBase(ctx), memberNames(ctx)])
    const { actorId, workspaceId } = ctx
    const id = args.recordId

    if (args.recordType === 'lead') {
      const lead = await CrmLeadService.getById(actorId, workspaceId, id)
      if (!lead.ok) return lead
      const [notes, proposals, person] = await Promise.all([
        notesOf(ctx, 'lead', id),
        CrmProposalService.list(actorId, workspaceId),
        lead.value.convertedPersonId
          ? CrmPersonService.getById(
              actorId,
              workspaceId,
              lead.value.convertedPersonId,
            )
          : Promise.resolve(null),
      ])
      return ok({
        data: {
          type: 'lead',
          record: {
            ...compactLead(lead.value, base, owners),
            emails: lead.value.emails,
            phones: lead.value.phones,
            jobTitle: lead.value.jobTitle,
            city: lead.value.city,
            closedAmount: lead.value.closedAmount,
            closedAt: lead.value.closedAt,
            lostNote: lead.value.lostNote,
            retryAt: lead.value.retryAt,
          },
          convertedPerson:
            person?.ok === true ? compactPerson(person.value, base) : null,
          notes: related(notes, (n) => compactNote(n, base)),
          proposals: related(
            proposals.ok
              ? ok(proposals.value.filter((p) => p.leadId === id))
              : proposals,
            (p) => compactProposal(p, base),
          ),
        },
        summary: `Lead “${lead.value.name}”`,
      })
    }

    if (args.recordType === 'opportunity') {
      const opp = await CrmOpportunityService.getById(actorId, workspaceId, id)
      if (!opp.ok) return opp
      const [pipelines, company, contact, tasks, notes, proposals, activities] =
        await Promise.all([
          loadPipelines(ctx),
          opp.value.companyId
            ? CrmCompanyService.getById(
                actorId,
                workspaceId,
                opp.value.companyId,
              )
            : Promise.resolve(null),
          opp.value.pointOfContactId
            ? CrmPersonService.getById(
                actorId,
                workspaceId,
                opp.value.pointOfContactId,
              )
            : Promise.resolve(null),
          CrmTaskService.list(actorId, workspaceId, { opportunityId: id }),
          notesOf(ctx, 'opportunity', id),
          CrmProposalService.list(actorId, workspaceId),
          activitiesOf(ctx, 'opportunity', id),
        ])
      const stages = stagesOf(pipelines)
      return ok({
        data: {
          type: 'opportunity',
          record: {
            ...compactOpportunity(opp.value, base, stages, owners),
            customFields: opp.value.customFields,
          },
          company:
            company?.ok === true
              ? compactCompany(company.value, base, owners)
              : null,
          pointOfContact:
            contact?.ok === true ? compactPerson(contact.value, base) : null,
          tasks: related(tasks, (t) => compactTask(t, base, owners)),
          notes: related(notes, (n) => compactNote(n, base)),
          proposals: related(
            proposals.ok
              ? ok(proposals.value.filter((p) => p.opportunityId === id))
              : proposals,
            (p) => compactProposal(p, base),
          ),
          activities: related(
            activities.ok ? ok(byNewest(activities.value)) : activities,
            compactActivity,
          ),
        },
        summary: `Oportunidade “${opp.value.name}”`,
      })
    }

    if (args.recordType === 'person') {
      const person = await CrmPersonService.getById(actorId, workspaceId, id)
      if (!person.ok) return person
      const [pipelines, company, opps, tasks, notes, activities] =
        await Promise.all([
          loadPipelines(ctx),
          person.value.companyId
            ? CrmCompanyService.getById(
                actorId,
                workspaceId,
                person.value.companyId,
              )
            : Promise.resolve(null),
          CrmOpportunityService.list(actorId, workspaceId, {}),
          CrmTaskService.list(actorId, workspaceId, { personId: id }),
          notesOf(ctx, 'person', id),
          activitiesOf(ctx, 'person', id),
        ])
      return ok({
        data: {
          type: 'person',
          record: {
            ...compactPerson(person.value, base),
            linkedin: person.value.linkedin,
            customFields: person.value.customFields,
          },
          company:
            company?.ok === true
              ? compactCompany(company.value, base, owners)
              : null,
          opportunities: related(
            opps.ok
              ? ok(opps.value.filter((o) => o.pointOfContactId === id))
              : opps,
            (o) => compactOpportunity(o, base, stagesOf(pipelines), owners),
          ),
          tasks: related(tasks, (t) => compactTask(t, base, owners)),
          notes: related(notes, (n) => compactNote(n, base)),
          activities: related(
            activities.ok ? ok(byNewest(activities.value)) : activities,
            compactActivity,
          ),
        },
        summary: `Pessoa “${person.value.name}”`,
      })
    }

    const company = await CrmCompanyService.getById(actorId, workspaceId, id)
    if (!company.ok) return company
    const [pipelines, people, opps, tasks, notes, activities] =
      await Promise.all([
        loadPipelines(ctx),
        CrmPersonService.list(actorId, workspaceId, { companyId: id }),
        CrmOpportunityService.list(actorId, workspaceId, {}),
        CrmTaskService.list(actorId, workspaceId, { companyId: id }),
        notesOf(ctx, 'company', id),
        activitiesOf(ctx, 'company', id),
      ])
    return ok({
      data: {
        type: 'company',
        record: {
          ...compactCompany(company.value, base, owners),
          linkedin: company.value.linkedin,
          address: company.value.address,
          customFields: company.value.customFields,
        },
        people: related(people, (p) => compactPerson(p, base)),
        opportunities: related(
          opps.ok ? ok(opps.value.filter((o) => o.companyId === id)) : opps,
          (o) => compactOpportunity(o, base, stagesOf(pipelines), owners),
        ),
        tasks: related(tasks, (t) => compactTask(t, base, owners)),
        notes: related(notes, (n) => compactNote(n, base)),
        activities: related(
          activities.ok ? ok(byNewest(activities.value)) : activities,
          compactActivity,
        ),
      },
      summary: `Empresa “${company.value.name}”`,
    })
  },
}

export const CRM_INSIGHT_TOOLS = [
  crmListPipelinesTool,
  crmListProposalsTool,
  crmGetForecastTool,
  crmGetRecordTool,
  crmGetRecordTimelineTool,
]
