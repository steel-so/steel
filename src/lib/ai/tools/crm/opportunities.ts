import { z } from 'zod'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import type { CrmOpportunityDTO } from '@/types/crm-opportunity'
import type { AiToolContext, SteelAiTool } from '../types'
import {
  afterFields,
  changeFields,
  companyName,
  crmBase,
  formatDate,
  formatMoney,
  indexStages,
  loadPipelines,
  matchesQuery,
  memberNames,
  nothingToChange,
  ownerParameter,
  type PipelineWithStages,
  pageParameters,
  pageSchema,
  paginate,
  personName,
  recordHref,
  resolveCompany,
  resolveMember,
  resolvePerson,
  resolvePipeline,
  resolveStage,
  type StageRef,
  zodParser,
} from './shared'

const STATUS_LABELS = { OPEN: 'Em aberto', WON: 'Ganha', LOST: 'Perdida' }

export function compactOpportunity(
  opp: CrmOpportunityDTO,
  base: string | null,
  stages: Map<string, StageRef>,
  owners: Map<string, string>,
) {
  const ref = stages.get(opp.stageId)
  return {
    id: opp.id,
    name: opp.name,
    amount: opp.amount,
    probability: opp.probability ?? ref?.stage.probability ?? null,
    closeDate: opp.closeDate,
    pipelineId: opp.pipelineId,
    pipeline: ref?.pipeline.name ?? null,
    stageId: opp.stageId,
    stage: ref?.stage.name ?? null,
    status: ref?.stage.category ?? null,
    companyId: opp.companyId,
    pointOfContactId: opp.pointOfContactId,
    ownerId: opp.ownerId,
    ownerName: opp.ownerId ? (owners.get(opp.ownerId) ?? null) : null,
    source: opp.source,
    href: recordHref(base, 'opportunity', opp.id),
  }
}

function opportunityTarget(
  opp: { id: string; name: string },
  base: string | null,
) {
  return {
    type: 'crm_opportunity',
    id: opp.id,
    label: opp.name,
    href: recordHref(base, 'opportunity', opp.id),
  }
}

function stageLabel(ref: StageRef | undefined): string | null {
  return ref ? `${ref.stage.name} (${ref.pipeline.name})` : null
}

/** Stage index for names; empty when pipelines can't be read (no permission). */
async function stageIndexOrEmpty(ctx: AiToolContext) {
  const pipelines = await loadPipelines(ctx)
  return pipelines.ok ? indexStages(pipelines.value) : new Map()
}

/* ---------------------------------- list ---------------------------------- */

const ListArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  pipeline: z.string().trim().min(1).optional(),
  stage: z.string().trim().min(1).optional(),
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  owner: z.string().trim().min(1).optional(),
  companyId: z.string().min(1).optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  closeDateFrom: z.coerce.date().optional(),
  closeDateTo: z.coerce.date().optional(),
  ...pageSchema,
})

export const crmListOpportunitiesTool: SteelAiTool<z.output<typeof ListArgs>> =
  {
    name: 'crm_list_opportunities',
    label: 'Consultando oportunidades',
    module: 'CRM',
    kind: 'READ',
    description:
      'Lista as oportunidades (negócios) do funil com filtros e paginação: pipeline/etapa (nome ou id), status (OPEN em aberto, WON ganha, LOST perdida — vem da categoria da etapa), responsável, empresa, faixa de valor e de data de fechamento. Devolve também a soma dos valores filtrados.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Trecho do nome.' },
        pipeline: { type: 'string', description: 'Nome ou id do pipeline.' },
        stage: { type: 'string', description: 'Nome ou id da etapa.' },
        status: { type: 'string', enum: ['OPEN', 'WON', 'LOST'] },
        owner: ownerParameter,
        companyId: { type: 'string', description: 'Só as da empresa (id).' },
        minAmount: { type: 'number' },
        maxAmount: { type: 'number' },
        closeDateFrom: { type: 'string', description: 'AAAA-MM-DD.' },
        closeDateTo: { type: 'string', description: 'AAAA-MM-DD.' },
        ...pageParameters,
      },
      additionalProperties: false,
    },
    permission: { resource: 'opportunities', action: 'VIEW' },
    parse: zodParser(ListArgs),
    async execute(ctx, args) {
      const needsCatalog = Boolean(args.pipeline || args.stage || args.status)
      const pipelines = await loadPipelines(ctx)
      if (!pipelines.ok && needsCatalog) return pipelines
      const catalog: PipelineWithStages[] = pipelines.ok ? pipelines.value : []
      const stages = indexStages(catalog)

      const filters: { pipelineId?: string; stageId?: string } = {}
      if (args.stage) {
        const ref = resolveStage(catalog, {
          stage: args.stage,
          pipeline: args.pipeline,
        })
        if (!ref.ok) return ref
        filters.stageId = ref.value.stage.id
        filters.pipelineId = ref.value.pipeline.id
      } else if (args.pipeline) {
        const pipeline = resolvePipeline(catalog, args.pipeline)
        if (!pipeline.ok) return pipeline
        filters.pipelineId = pipeline.value.id
      }

      let ownerId: string | undefined
      if (args.owner) {
        const owner = await resolveMember(ctx, args.owner)
        if (!owner.ok) return owner
        ownerId = owner.value.id
      }

      const opps = await CrmOpportunityService.list(
        ctx.actorId,
        ctx.workspaceId,
        filters,
      )
      if (!opps.ok) return opps

      const from = args.closeDateFrom?.getTime()
      const to = args.closeDateTo?.getTime()
      const filtered = opps.value.filter((o) => {
        const close = o.closeDate ? new Date(o.closeDate).getTime() : null
        const amount = o.amount ?? 0
        return (
          matchesQuery(args.query, [o.name]) &&
          (!args.status ||
            stages.get(o.stageId)?.stage.category === args.status) &&
          (!ownerId || o.ownerId === ownerId) &&
          (!args.companyId || o.companyId === args.companyId) &&
          (args.minAmount === undefined || amount >= args.minAmount) &&
          (args.maxAmount === undefined || amount <= args.maxAmount) &&
          (from === undefined || (close !== null && close >= from)) &&
          (to === undefined || (close !== null && close <= to))
        )
      })

      const [base, owners] = await Promise.all([crmBase(ctx), memberNames(ctx)])
      const page = paginate(filtered, args, (o) =>
        compactOpportunity(o, base, stages, owners),
      )
      const totalAmount = filtered.reduce((sum, o) => sum + (o.amount ?? 0), 0)
      return ok({
        data: { ...page, totalAmount },
        summary: `${page.total} oportunidade(s) encontrada(s), somando ${formatMoney(totalAmount)}`,
      })
    },
  }

/* ------------------------------- references ------------------------------- */

interface OpportunityRefsInput {
  pipeline?: string
  stage?: string
  company?: string | null
  pointOfContact?: string | null
  owner?: string
}

interface OpportunityRefs {
  stage?: StageRef
  /** undefined = untouched; null = cleared. */
  company?: { id: string; name: string } | null
  pointOfContact?: { id: string; name: string } | null
  owner?: { id: string; name: string }
}

/** Resolves every name the model passed into ids (ambiguity = error). */
async function resolveRefs(
  ctx: AiToolContext,
  input: OpportunityRefsInput,
): Promise<Result<OpportunityRefs>> {
  const refs: OpportunityRefs = {}
  if (input.stage || input.pipeline) {
    const pipelines = await loadPipelines(ctx)
    if (!pipelines.ok) return pipelines
    if (input.stage) {
      const ref = resolveStage(pipelines.value, {
        stage: input.stage,
        pipeline: input.pipeline,
      })
      if (!ref.ok) return ref
      refs.stage = ref.value
    } else {
      const pipeline = resolvePipeline(
        pipelines.value,
        input.pipeline as string,
      )
      if (!pipeline.ok) return pipeline
      const first =
        pipeline.value.stages.find((s) => s.category === 'OPEN') ??
        pipeline.value.stages[0]
      if (first) refs.stage = { pipeline: pipeline.value, stage: first }
    }
  }
  if (input.company === null) refs.company = null
  else if (input.company) {
    const company = await resolveCompany(ctx, input.company)
    if (!company.ok) return company
    refs.company = { id: company.value.id, name: company.value.name }
  }
  if (input.pointOfContact === null) refs.pointOfContact = null
  else if (input.pointOfContact) {
    const person = await resolvePerson(ctx, input.pointOfContact)
    if (!person.ok) return person
    refs.pointOfContact = { id: person.value.id, name: person.value.name }
  }
  if (input.owner) {
    const owner = await resolveMember(ctx, input.owner)
    if (!owner.ok) return owner
    refs.owner = {
      id: owner.value.id,
      name: owner.value.name || owner.value.email,
    }
  }
  return ok(refs)
}

function idOf(
  ref: { id: string } | null | undefined,
): string | null | undefined {
  return ref === undefined ? undefined : (ref?.id ?? null)
}

function nameOf(
  ref: { name: string } | null | undefined,
): string | null | undefined {
  return ref === undefined ? undefined : (ref?.name ?? null)
}

const refParameters = {
  company: {
    type: 'string',
    description: 'Empresa: nome, domínio, CNPJ ou id.',
  },
  pointOfContact: {
    type: 'string',
    description: 'Pessoa de contato: nome, e-mail ou id.',
  },
}

/* --------------------------------- create --------------------------------- */

const CreateArgs = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  amount: z.coerce.number().min(0).optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  closeDate: z.coerce.date().optional(),
  pipeline: z.string().trim().min(1).optional(),
  stage: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  pointOfContact: z.string().trim().min(1).optional(),
  owner: z.string().trim().min(1).optional(),
  source: z.string().max(100).optional(),
})

export const crmCreateOpportunityTool: SteelAiTool<
  z.output<typeof CreateArgs>
> = {
  name: 'crm_create_opportunity',
  label: 'Criando oportunidade',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma oportunidade (negócio). Sem pipeline/etapa, entra no pipeline padrão na primeira etapa em aberto. Empresa, contato, responsável, pipeline e etapa aceitam nome ou id; se o nome for ambíguo, a ferramenta devolve as opções.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      amount: { type: 'number', description: 'Valor (R$).' },
      probability: { type: 'integer', minimum: 0, maximum: 100 },
      closeDate: {
        type: 'string',
        description: 'Previsão de fechamento (AAAA-MM-DD).',
      },
      pipeline: { type: 'string', description: 'Nome ou id do pipeline.' },
      stage: { type: 'string', description: 'Nome ou id da etapa.' },
      ...refParameters,
      owner: ownerParameter,
      source: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  permission: { resource: 'opportunities', action: 'CREATE' },
  parse: zodParser(CreateArgs),
  async preview(ctx, args) {
    const refs = await resolveRefs(ctx, args)
    if (!refs.ok) return refs
    return ok({
      title: `Criar a oportunidade “${args.name}”`,
      summary: refs.value.stage
        ? `Entra em ${stageLabel(refs.value.stage)}.`
        : 'Entra no pipeline padrão, na primeira etapa em aberto.',
      fields: afterFields([
        ['Nome', args.name],
        ['Valor', formatMoney(args.amount)],
        [
          'Probabilidade',
          args.probability === undefined ? null : `${args.probability}%`,
        ],
        ['Previsão de fechamento', args.closeDate],
        ['Etapa', stageLabel(refs.value.stage)],
        ['Empresa', nameOf(refs.value.company)],
        ['Contato', nameOf(refs.value.pointOfContact)],
        ['Responsável', refs.value.owner?.name],
        ['Origem', args.source],
      ]),
      target: { type: 'crm_opportunity', label: args.name },
    })
  },
  async execute(ctx, args) {
    const refs = await resolveRefs(ctx, args)
    if (!refs.ok) return refs
    const opp = await CrmOpportunityService.create(
      ctx.actorId,
      ctx.workspaceId,
      {
        name: args.name,
        amount: args.amount,
        probability: args.probability,
        closeDate: args.closeDate,
        pipelineId: refs.value.stage?.pipeline.id,
        stageId: refs.value.stage?.stage.id,
        companyId: idOf(refs.value.company) ?? undefined,
        pointOfContactId: idOf(refs.value.pointOfContact) ?? undefined,
        ownerId: refs.value.owner?.id,
        source: args.source,
      },
    )
    if (!opp.ok) return opp
    const [base, stages] = await Promise.all([
      crmBase(ctx),
      stageIndexOrEmpty(ctx),
    ])
    return ok({
      data: compactOpportunity(opp.value, base, stages, new Map()),
      summary: `Oportunidade “${opp.value.name}” criada`,
      target: opportunityTarget(opp.value, base),
    })
  },
}

/* --------------------------------- update --------------------------------- */

const UpdateArgs = z
  .object({
    opportunityId: z.string().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    amount: z.coerce.number().min(0).nullable().optional(),
    probability: z.coerce.number().int().min(0).max(100).nullable().optional(),
    closeDate: z.coerce.date().nullable().optional(),
    company: z.string().trim().min(1).nullable().optional(),
    pointOfContact: z.string().trim().min(1).nullable().optional(),
    source: z.string().max(100).nullable().optional(),
  })
  .refine((a) => Object.keys(a).some((k) => k !== 'opportunityId'), {
    message: 'Informe ao menos um campo para alterar',
  })

export const crmUpdateOpportunityTool: SteelAiTool<
  z.output<typeof UpdateArgs>
> = {
  name: 'crm_update_opportunity',
  label: 'Atualizando oportunidade',
  module: 'CRM',
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera dados de uma oportunidade (nome, valor, probabilidade, previsão de fechamento, empresa, contato, origem). Envie só o que muda; null limpa o campo. Para mudar de etapa use crm_move_opportunity_stage; para responsável, crm_assign_owner.',
  parameters: {
    type: 'object',
    properties: {
      opportunityId: {
        type: 'string',
        description:
          'Id da oportunidade (de crm_list_opportunities ou ws_search).',
      },
      name: { type: 'string' },
      amount: { type: ['number', 'null'] },
      probability: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
      closeDate: { type: ['string', 'null'], description: 'AAAA-MM-DD.' },
      company: { ...refParameters.company, type: ['string', 'null'] },
      pointOfContact: {
        ...refParameters.pointOfContact,
        type: ['string', 'null'],
      },
      source: { type: ['string', 'null'] },
    },
    required: ['opportunityId'],
    additionalProperties: false,
  },
  permission: { resource: 'opportunities', action: 'EDIT' },
  parse: zodParser(UpdateArgs),
  async preview(ctx, args) {
    const opp = await CrmOpportunityService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.opportunityId,
    )
    if (!opp.ok) return opp
    const refs = await resolveRefs(ctx, args)
    if (!refs.ok) return refs
    const before = opp.value
    const fields = changeFields([
      ['Nome', before.name, args.name],
      [
        'Valor',
        formatMoney(before.amount),
        args.amount === undefined ? undefined : formatMoney(args.amount),
      ],
      [
        'Probabilidade',
        before.probability === null ? null : `${before.probability}%`,
        args.probability === undefined
          ? undefined
          : args.probability === null
            ? null
            : `${args.probability}%`,
      ],
      ['Previsão de fechamento', formatDate(before.closeDate), args.closeDate],
      [
        'Empresa',
        refs.value.company === undefined
          ? null
          : await companyName(ctx, before.companyId),
        nameOf(refs.value.company),
      ],
      [
        'Contato',
        refs.value.pointOfContact === undefined
          ? null
          : await personName(ctx, before.pointOfContactId),
        nameOf(refs.value.pointOfContact),
      ],
      ['Origem', before.source, args.source],
    ])
    if (fields.length === 0) return err(nothingToChange())
    const base = await crmBase(ctx)
    return ok({
      title: `Atualizar a oportunidade “${before.name}”`,
      summary: `${fields.length} campo(s) alterado(s).`,
      fields,
      target: opportunityTarget(before, base),
    })
  },
  async execute(ctx, args) {
    const refs = await resolveRefs(ctx, args)
    if (!refs.ok) return refs
    const opp = await CrmOpportunityService.update(
      ctx.actorId,
      ctx.workspaceId,
      args.opportunityId,
      {
        name: args.name,
        amount: args.amount,
        probability: args.probability,
        closeDate: args.closeDate,
        companyId: idOf(refs.value.company),
        pointOfContactId: idOf(refs.value.pointOfContact),
        source: args.source,
      },
    )
    if (!opp.ok) return opp
    const [base, stages] = await Promise.all([
      crmBase(ctx),
      stageIndexOrEmpty(ctx),
    ])
    return ok({
      data: compactOpportunity(opp.value, base, stages, new Map()),
      summary: `Oportunidade “${opp.value.name}” atualizada`,
      target: opportunityTarget(opp.value, base),
    })
  },
}

/* ---------------------------------- move ---------------------------------- */

const MoveArgs = z.object({
  opportunityId: z.string().min(1),
  stage: z.string().trim().min(1),
  pipeline: z.string().trim().min(1).optional(),
})

export const crmMoveOpportunityStageTool: SteelAiTool<
  z.output<typeof MoveArgs>
> = {
  name: 'crm_move_opportunity_stage',
  label: 'Movendo oportunidade de etapa',
  module: 'CRM',
  kind: 'ACTION',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Move uma oportunidade para outra etapa (nome ou id). Sem `pipeline`, procura a etapa no pipeline atual da oportunidade; informe `pipeline` para movê-la para outro funil. Mover para uma etapa de categoria WON/LOST é como ganhar/perder o negócio; para uma etapa OPEN, reabre.',
  parameters: {
    type: 'object',
    properties: {
      opportunityId: {
        type: 'string',
        description:
          'Id da oportunidade (de crm_list_opportunities ou ws_search).',
      },
      stage: { type: 'string', description: 'Nome ou id da etapa de destino.' },
      pipeline: {
        type: 'string',
        description: 'Nome ou id do pipeline de destino (padrão: o atual).',
      },
    },
    required: ['opportunityId', 'stage'],
    additionalProperties: false,
  },
  permission: { resource: 'opportunities', action: 'EDIT' },
  parse: zodParser(MoveArgs),
  async preview(ctx, args) {
    const resolved = await resolveMove(ctx, args)
    if (!resolved.ok) return resolved
    const { opp, from, to } = resolved.value
    const base = await crmBase(ctx)
    return ok({
      title: `Mover “${opp.name}” para “${to.stage.name}”`,
      summary:
        to.stage.category === 'OPEN'
          ? 'A oportunidade segue em aberto.'
          : `A oportunidade fica como ${STATUS_LABELS[to.stage.category].toLowerCase()}.`,
      fields: changeFields([
        ['Etapa', stageLabel(from), stageLabel(to)],
        [
          'Status',
          from ? STATUS_LABELS[from.stage.category] : null,
          STATUS_LABELS[to.stage.category],
        ],
      ]),
      target: opportunityTarget(opp, base),
    })
  },
  async execute(ctx, args) {
    const resolved = await resolveMove(ctx, args)
    if (!resolved.ok) return resolved
    const { to } = resolved.value
    const opp = await CrmOpportunityService.update(
      ctx.actorId,
      ctx.workspaceId,
      args.opportunityId,
      { pipelineId: to.pipeline.id, stageId: to.stage.id },
    )
    if (!opp.ok) return opp
    const base = await crmBase(ctx)
    return ok({
      data: compactOpportunity(
        opp.value,
        base,
        indexStages(resolved.value.pipelines),
        new Map(),
      ),
      summary: `“${opp.value.name}” movida para “${to.stage.name}”`,
      target: opportunityTarget(opp.value, base),
    })
  },
}

async function resolveMove(
  ctx: AiToolContext,
  args: z.output<typeof MoveArgs>,
) {
  const opp = await CrmOpportunityService.getById(
    ctx.actorId,
    ctx.workspaceId,
    args.opportunityId,
  )
  if (!opp.ok) return opp
  const pipelines = await loadPipelines(ctx)
  if (!pipelines.ok) return pipelines
  const to = resolveStage(pipelines.value, {
    stage: args.stage,
    pipeline: args.pipeline ?? opp.value.pipelineId,
  })
  if (!to.ok) return to
  return ok({
    opp: opp.value,
    pipelines: pipelines.value,
    from: indexStages(pipelines.value).get(opp.value.stageId),
    to: to.value,
  })
}

/* --------------------------------- delete --------------------------------- */

const IdArgs = z.object({ opportunityId: z.string().min(1) })

export const crmDeleteOpportunityTool: SteelAiTool<z.output<typeof IdArgs>> = {
  name: 'crm_delete_opportunity',
  label: 'Excluindo oportunidade',
  module: 'CRM',
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Exclui uma oportunidade do CRM: ela some do funil, das listas e da previsão de receita. Não há ferramenta para desfazer; para negócio perdido, prefira mover para uma etapa LOST com crm_move_opportunity_stage.',
  parameters: {
    type: 'object',
    properties: {
      opportunityId: {
        type: 'string',
        description:
          'Id da oportunidade (de crm_list_opportunities ou ws_search).',
      },
    },
    required: ['opportunityId'],
    additionalProperties: false,
  },
  permission: { resource: 'opportunities', action: 'DELETE' },
  parse: zodParser(IdArgs),
  async preview(ctx, args) {
    const opp = await CrmOpportunityService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.opportunityId,
    )
    if (!opp.ok) return opp
    const base = await crmBase(ctx)
    return ok({
      title: `Excluir a oportunidade “${opp.value.name}”`,
      summary: 'A oportunidade sai do funil e das listas do CRM.',
      fields: afterFields([
        ['Valor', formatMoney(opp.value.amount)],
        ['Previsão de fechamento', formatDate(opp.value.closeDate)],
      ]),
      target: opportunityTarget(opp.value, base),
    })
  },
  async execute(ctx, args) {
    const opp = await CrmOpportunityService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.opportunityId,
    )
    if (!opp.ok) return opp
    const removed = await CrmOpportunityService.remove(
      ctx.actorId,
      ctx.workspaceId,
      args.opportunityId,
    )
    if (!removed.ok) return removed
    return ok({
      data: { id: args.opportunityId, deleted: true },
      summary: `Oportunidade “${opp.value.name}” excluída`,
      target: {
        type: 'crm_opportunity',
        id: args.opportunityId,
        label: opp.value.name,
      },
    })
  },
}

export const CRM_OPPORTUNITY_TOOLS = [
  crmListOpportunitiesTool,
  crmCreateOpportunityTool,
  crmUpdateOpportunityTool,
  crmMoveOpportunityStageTool,
  crmDeleteOpportunityTool,
]
