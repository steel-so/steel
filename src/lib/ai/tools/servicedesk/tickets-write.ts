import { z } from 'zod'
import {
  sdPhaseRequirementsUnmet,
  sdPhaseTransitionNotAllowed,
  validationError,
} from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type CreateSdTicketDTO,
  CreateSdTicketSchema,
  type UpdateSdTicketDTO,
  UpdateSdTicketSchema,
} from '@/src/schemas/sd-ticket.schema'
import { CreateSdTicketMessageSchema } from '@/src/schemas/sd-ticket-message.schema'
import { SdConfigService } from '@/src/services/sd-config.service'
import { SdTicketService } from '@/src/services/sd-ticket.service'
import { SdTicketMessageService } from '@/src/services/sd-ticket-message.service'
import type {
  SdAgentDTO,
  SdConfigBootstrapDTO,
  SdPhaseDTO,
} from '@/types/sd-config'
import type { SdTicketDTO } from '@/types/sd-ticket'
import type { AiToolPreviewDTO } from '@/types/steel-ai'
import type { AiToolContext, AiToolOutput, SteelAiTool } from '../types'
import { lookupConfigItem, lookupContact, lookupCustomer } from './lookups'
import {
  clip,
  compactTicket,
  flattenDepartments,
  htmlText,
  loadSdConfig,
  normalizeName,
  PRACTICE_LABELS,
  phasesOf,
  practiceParameter,
  practiceSchema,
  refSchema,
  resolveNamed,
  resolveUser,
  SD_MODULE,
  sdBasePath,
  sdHref,
  textToSdHtml,
  ticketRefParameter,
  zodParser,
} from './shared'
import {
  changeLine,
  customFieldLines,
  type LoadedTicket,
  loadOpenTicket,
  loadTicket,
  type PreviewField,
  resolveClassification,
  ticketTarget,
} from './ticket-fields'

/* --------------------------------- shared -------------------------------- */

const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(30)
const customFieldsSchema = z.record(z.string().max(64), z.unknown())
const descriptionSchema = z.string().trim().min(1).max(20_000)

const classificationParameters = {
  impact: { type: 'string', description: 'Nome ou id do impacto.' },
  urgency: { type: 'string', description: 'Nome ou id da urgência.' },
  priority: {
    type: 'string',
    description:
      'Nome ou id da prioridade. Omita para a matriz impacto × urgência decidir.',
  },
  severity: { type: 'string', description: 'Nome ou id da severidade.' },
  category: { type: 'string', description: 'Categoria do catálogo.' },
  subcategory: { type: 'string', description: 'Subcategoria do catálogo.' },
  service: {
    type: 'string',
    description:
      'Serviço do catálogo (nome, caminho "Categoria > Subcategoria > Serviço" ou id). Categoria e subcategoria são deduzidas.',
  },
}

async function loadMembers(
  ctx: AiToolContext,
  includeRequesters: boolean,
): Promise<Result<SdAgentDTO[]>> {
  return SdConfigService.agents(ctx.actorId, ctx.workspaceId, {
    includeRequesters,
  })
}

function invalid(issues: unknown): Result<never> {
  return err(validationError('Dados inválidos para o chamado', issues))
}

/* -------------------------------- create --------------------------------- */

const CreateArgs = z.object({
  practice: practiceSchema,
  title: z.string().trim().min(1).max(200),
  description: descriptionSchema.optional(),
  impact: refSchema.optional(),
  urgency: refSchema.optional(),
  priority: refSchema.optional(),
  severity: refSchema.optional(),
  category: refSchema.optional(),
  subcategory: refSchema.optional(),
  service: refSchema.optional(),
  requester: refSchema.optional(),
  contact: refSchema.optional(),
  customer: refSchema.optional(),
  company: refSchema.optional(),
  department: refSchema.optional(),
  assignee: refSchema.optional(),
  configItem: refSchema.optional(),
  tags: tagsSchema.optional(),
  customFields: customFieldsSchema.optional(),
})
type CreateArgs = z.infer<typeof CreateArgs>

interface Plan<T> {
  input: T
  fields: PreviewField[]
}

export async function planCreateTicket(
  ctx: AiToolContext,
  args: CreateArgs,
): Promise<Result<Plan<CreateSdTicketDTO>>> {
  const config = await loadSdConfig(ctx)
  if (!config.ok) return config
  const classification = resolveClassification(
    config.value,
    args.practice,
    args,
  )
  if (!classification.ok) return classification
  const { ids, labels } = classification.value
  const input: Record<string, unknown> = {
    type: args.practice,
    title: args.title,
    description: args.description ? textToSdHtml(args.description) : undefined,
    tags: args.tags,
    customFields: args.customFields,
    ...ids,
  }
  const names: Record<string, string | null> = {}

  if (args.department) {
    const department = resolveNamed(
      flattenDepartments(config.value),
      args.department,
      'o departamento',
    )
    if (!department.ok) return department
    input.departmentId = department.value.id
    names.department = department.value.name
  }
  if (args.requester || args.assignee) {
    const members = await loadMembers(ctx, true)
    if (!members.ok) return members
    if (args.requester) {
      const user = resolveUser(
        ctx,
        members.value,
        args.requester,
        'o solicitante',
      )
      if (!user.ok) return user
      input.requesterId = user.value.id
      names.requester = `${user.value.name} <${user.value.email}>`
    }
    if (args.assignee) {
      const agents = members.value.filter((m) => m.isAgent)
      const user = resolveUser(ctx, agents, args.assignee, 'o responsável')
      if (!user.ok) return user
      input.assigneeId = user.value.id
      names.assignee = user.value.name
    }
  }
  const directory = [
    ['contact', 'contactId', () => lookupContact(ctx, args.contact as string)],
    [
      'customer',
      'customerId',
      () => lookupCustomer(ctx, args.customer as string, 'CLIENT'),
    ],
    [
      'company',
      'companyId',
      () => lookupCustomer(ctx, args.company as string, 'COMPANY'),
    ],
    [
      'configItem',
      'configItemId',
      () => lookupConfigItem(ctx, args.configItem as string),
    ],
  ] as const
  for (const [key, idKey, lookup] of directory) {
    if (!args[key]) continue
    const found = await lookup()
    if (!found.ok) return found
    input[idKey] = found.value.id
    names[key] = found.value.name
  }

  const custom = customFieldLines(config.value, args.customFields)
  if (!custom.ok) return custom

  const parsed = CreateSdTicketSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error.issues)

  const lines: [string, string | null | undefined][] = [
    ['Prática', PRACTICE_LABELS[args.practice]],
    ['Título', args.title],
    ['Descrição', clip(args.description, 300)],
    ['Catálogo', labels.catalog],
    ['Impacto', labels.impact],
    ['Urgência', labels.urgency],
    ['Prioridade', labels.priority],
    ['Severidade', labels.severity],
    ['Solicitante', names.requester],
    ['Contato', names.contact],
    ['Cliente', names.customer],
    ['Empresa', names.company],
    [
      'Departamento',
      names.department ?? 'Roteamento automático (catálogo ou padrão)',
    ],
    ['Responsável', names.assignee],
    ['Item de configuração', names.configItem],
    ['Tags', args.tags?.join(', ')],
  ]
  const fields: PreviewField[] = lines
    .filter(([, after]) => after)
    .map(([label, after]) => ({ label, after: after as string }))
  return ok({ input: parsed.data, fields: [...fields, ...custom.value] })
}

export const sdCreateTicketTool: SteelAiTool<CreateArgs> = {
  name: 'sd_create_ticket',
  label: 'Abrindo chamado',
  module: SD_MODULE,
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Abre um chamado no ServiceDesk. Obrigatórios: `practice` e `title`. Opcional: descrição (texto), serviço do catálogo (categoria/subcategoria são deduzidas), impacto e urgência (a prioridade sai da matriz; informe `priority` só para fixar), solicitante (usuário), contato, cliente/empresa, departamento (senão roteamento automático), responsável, item de configuração, tags e campos customizados (`customFields` pela chave do campo). Nomes são resolvidos para ids; nomes ambíguos voltam erro com os candidatos.',
  parameters: {
    type: 'object',
    properties: {
      practice: practiceParameter,
      title: { type: 'string', maxLength: 200 },
      description: {
        type: 'string',
        description:
          'Descrição em texto (parágrafos separados por linha em branco).',
      },
      ...classificationParameters,
      requester: {
        type: 'string',
        description: 'Usuário solicitante: "me", nome, e-mail ou id.',
      },
      contact: { type: 'string', description: 'Contato (nome, e-mail ou id).' },
      customer: { type: 'string', description: 'Cliente (nome ou id).' },
      company: { type: 'string', description: 'Empresa (nome ou id).' },
      department: { type: 'string', description: 'Departamento (nome ou id).' },
      assignee: {
        type: 'string',
        description: 'Agente responsável: "me", nome, e-mail ou id.',
      },
      configItem: {
        type: 'string',
        description: 'Item de configuração (nome, código, IP ou id).',
      },
      tags: { type: 'array', items: { type: 'string' } },
      customFields: {
        type: 'object',
        description: 'Valores por chave do campo customizado.',
      },
    },
    required: ['practice', 'title'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'CREATE' },
  parse: zodParser(CreateArgs),
  async preview(ctx, args) {
    const plan = await planCreateTicket(ctx, args)
    if (!plan.ok) return plan
    return ok({
      title: `Abrir ${PRACTICE_LABELS[args.practice].toLowerCase()} “${args.title}”`,
      summary:
        'Cria o chamado com SLA, roteamento e automações de abertura do ServiceDesk.',
      fields: plan.value.fields,
    })
  },
  async execute(ctx, args) {
    const plan = await planCreateTicket(ctx, args)
    if (!plan.ok) return plan
    const created = await SdTicketService.create(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.input,
    )
    if (!created.ok) return created
    return ticketOutput(
      ctx,
      created.value,
      `Chamado ${created.value.code} aberto`,
    )
  },
}

async function ticketOutput(
  ctx: AiToolContext,
  ticket: SdTicketDTO,
  summary: string,
): Promise<Result<AiToolOutput>> {
  const base = await sdBasePath(ctx)
  if (!base.ok) return base
  const href = sdHref.ticket(base.value, ticket.number)
  return ok({
    data: compactTicket(ticket, base.value),
    summary,
    target: { type: 'sd_ticket', id: ticket.id, label: ticket.code, href },
  })
}

function preview(
  loaded: LoadedTicket,
  title: string,
  summary: string,
  fields: PreviewField[],
): AiToolPreviewDTO {
  return {
    title: `${title} — ${loaded.ticket.code}`,
    summary,
    fields,
    target: ticketTarget(loaded),
  }
}

/* -------------------------------- update --------------------------------- */

const UPDATE_KEYS = [
  'title',
  'description',
  'impact',
  'urgency',
  'priority',
  'severity',
  'category',
  'subcategory',
  'service',
  'tags',
  'customFields',
] as const

const UpdateArgs = z
  .object({
    ticket: refSchema,
    title: z.string().trim().min(1).max(200).optional(),
    description: descriptionSchema.optional(),
    impact: refSchema.optional(),
    urgency: refSchema.optional(),
    priority: refSchema.optional(),
    severity: refSchema.optional(),
    category: refSchema.optional(),
    subcategory: refSchema.optional(),
    service: refSchema.optional(),
    tags: tagsSchema.optional(),
    customFields: customFieldsSchema.optional(),
  })
  .refine((a) => UPDATE_KEYS.some((k) => a[k] !== undefined), {
    message: 'Informe ao menos um campo para alterar',
  })
type UpdateArgs = z.infer<typeof UpdateArgs>

export async function planUpdateTicket(
  ctx: AiToolContext,
  args: UpdateArgs,
): Promise<Result<Plan<UpdateSdTicketDTO> & { loaded: LoadedTicket }>> {
  const loaded = await loadTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  const t = loaded.value.ticket
  const config = await loadSdConfig(ctx)
  if (!config.ok) return config
  const classification = resolveClassification(config.value, t.type, args, t)
  if (!classification.ok) return classification
  const { ids, labels } = classification.value
  const custom = customFieldLines(
    config.value,
    args.customFields,
    t.customFields,
  )
  if (!custom.ok) return custom

  const parsed = UpdateSdTicketSchema.safeParse({
    title: args.title,
    description: args.description ? textToSdHtml(args.description) : undefined,
    tags: args.tags,
    customFields: args.customFields,
    ...ids,
  })
  if (!parsed.success) return invalid(parsed.error.issues)

  const catalogBefore = [t.category, t.subcategory, t.service]
    .filter((c) => c !== null)
    .map((c) => c.name)
    .join(' > ')
  const fields = [
    ...changeLine('Título', t.title, args.title ?? t.title),
    ...(args.description
      ? changeLine(
          'Descrição',
          htmlText(t.description, 200),
          clip(args.description, 300),
        )
      : []),
    ...(labels.impact
      ? changeLine('Impacto', t.impact?.name, labels.impact)
      : []),
    ...(labels.urgency
      ? changeLine('Urgência', t.urgency?.name, labels.urgency)
      : []),
    ...(labels.priority
      ? changeLine('Prioridade', t.priority?.name, labels.priority)
      : []),
    ...(labels.severity
      ? changeLine('Severidade', t.severity?.name, labels.severity)
      : []),
    ...(labels.catalog
      ? changeLine('Catálogo', catalogBefore, labels.catalog)
      : []),
    ...(args.tags
      ? changeLine('Tags', t.tags.join(', '), args.tags.join(', '))
      : []),
    ...custom.value,
  ]
  return ok({ input: parsed.data, fields, loaded: loaded.value })
}

export const sdUpdateTicketTool: SteelAiTool<UpdateArgs> = {
  name: 'sd_update_ticket',
  label: 'Atualizando chamado',
  module: SD_MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera campos de um chamado: título, descrição, impacto/urgência (a prioridade é recalculada pela matriz), prioridade, severidade, catálogo (categoria/subcategoria/serviço), tags (substitui a lista) e campos customizados (mescla pela chave). Para responsável/departamento use `sd_assign_ticket`; para fase, `sd_move_ticket_phase`.',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      title: { type: 'string', maxLength: 200 },
      description: {
        type: 'string',
        description: 'Nova descrição em texto (substitui a atual).',
      },
      ...classificationParameters,
      tags: { type: 'array', items: { type: 'string' } },
      customFields: { type: 'object' },
    },
    required: ['ticket'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'EDIT' },
  parse: zodParser(UpdateArgs),
  async preview(ctx, args) {
    const plan = await planUpdateTicket(ctx, args)
    if (!plan.ok) return plan
    return ok(
      preview(
        plan.value.loaded,
        'Atualizar chamado',
        plan.value.loaded.ticket.title,
        plan.value.fields,
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planUpdateTicket(ctx, args)
    if (!plan.ok) return plan
    const updated = await SdTicketService.update(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.loaded.ticket.id,
      plan.value.input,
    )
    if (!updated.ok) return updated
    return ticketOutput(
      ctx,
      updated.value,
      `Chamado ${updated.value.code} atualizado`,
    )
  },
}

/* -------------------------------- assign --------------------------------- */

const NONE = new Set(['none', 'ninguem', 'ninguém', 'unassigned'])

const AssignArgs = z
  .object({
    ticket: refSchema,
    assignee: refSchema.optional(),
    department: refSchema.optional(),
  })
  .refine((a) => a.assignee !== undefined || a.department !== undefined, {
    message: 'Informe o responsável e/ou o departamento',
  })
type AssignArgs = z.infer<typeof AssignArgs>

export async function planAssign(
  ctx: AiToolContext,
  args: AssignArgs,
): Promise<
  Result<{
    loaded: LoadedTicket
    input: { assigneeId?: string | null; departmentId?: string | null }
    fields: PreviewField[]
  }>
> {
  const loaded = await loadTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  const t = loaded.value.ticket
  const input: { assigneeId?: string | null; departmentId?: string | null } = {}
  const fields: PreviewField[] = []

  if (args.department) {
    if (NONE.has(normalizeName(args.department))) {
      input.departmentId = null
    } else {
      const config = await loadSdConfig(ctx)
      if (!config.ok) return config
      const department = resolveNamed(
        flattenDepartments(config.value),
        args.department,
        'o departamento',
      )
      if (!department.ok) return department
      input.departmentId = department.value.id
      fields.push(
        ...changeLine(
          'Departamento',
          t.department?.name,
          department.value.name,
        ),
      )
    }
    if (input.departmentId === null) {
      fields.push(...changeLine('Departamento', t.department?.name, null))
    }
  }
  if (args.assignee) {
    if (NONE.has(normalizeName(args.assignee))) {
      input.assigneeId = null
      fields.push(...changeLine('Responsável', t.assignee?.name, null))
    } else {
      const agents = await loadMembers(ctx, false)
      if (!agents.ok) return agents
      const user = resolveUser(ctx, agents.value, args.assignee, 'o agente')
      if (!user.ok) return user
      input.assigneeId = user.value.id
      fields.push(
        ...changeLine('Responsável', t.assignee?.name, user.value.name),
      )
    }
  }
  if (fields.length === 0) {
    return err(
      validationError(`${t.code} já está com esse responsável/departamento`),
    )
  }
  return ok({ loaded: loaded.value, input, fields })
}

export const sdAssignTicketTool: SteelAiTool<AssignArgs> = {
  name: 'sd_assign_ticket',
  label: 'Atribuindo chamado',
  module: SD_MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Atribui ou reatribui um chamado: `assignee` (agente: "me", nome, e-mail ou id; "none" remove) e/ou `department` (nome ou id; "none" remove). O responsável é notificado pelo ServiceDesk.',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      assignee: { type: 'string' },
      department: { type: 'string' },
    },
    required: ['ticket'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'EDIT' },
  parse: zodParser(AssignArgs),
  async preview(ctx, args) {
    const plan = await planAssign(ctx, args)
    if (!plan.ok) return plan
    return ok(
      preview(
        plan.value.loaded,
        'Atribuir chamado',
        `${plan.value.loaded.ticket.title}. O novo responsável recebe a notificação de atribuição.`,
        plan.value.fields,
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planAssign(ctx, args)
    if (!plan.ok) return plan
    const updated = await SdTicketService.update(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.loaded.ticket.id,
      plan.value.input,
    )
    if (!updated.ok) return updated
    const who = updated.value.assignee?.name ?? updated.value.department?.name
    return ticketOutput(
      ctx,
      updated.value,
      who
        ? `${updated.value.code} atribuído a ${who}`
        : `${updated.value.code} sem responsável`,
    )
  },
}

/* ------------------------------- move phase ------------------------------ */

interface PhasePlan {
  loaded: LoadedTicket
  target: SdPhaseDTO
  solutionClassificationId?: string
  fields: PreviewField[]
}

/**
 * Mirrors the engine's flow check so the preview already says when the
 * configured transitions forbid the move (the engine re-checks on execute).
 */
function checkTransition(
  config: SdConfigBootstrapDTO,
  ticket: SdTicketDTO,
  target: SdPhaseDTO,
): Result<void> {
  const flow = config.phases.find((f) => f.ticketType === ticket.type)
  const transitions = flow?.transitions ?? []
  if (transitions.length === 0) return ok(undefined)
  const rule = transitions.find(
    (t) => t.fromPhaseId === ticket.phaseId && t.toPhaseId === target.id,
  )
  if (!rule) {
    const allowed = transitions
      .filter((t) => t.fromPhaseId === ticket.phaseId)
      .map((t) => flow?.phases.find((p) => p.id === t.toPhaseId)?.name)
      .filter(Boolean)
    return err(
      sdPhaseTransitionNotAllowed(
        `O fluxo não permite ir de "${ticket.phase.name}" para "${target.name}". Fases permitidas: ${allowed.length > 0 ? allowed.join(', ') : 'nenhuma'}`,
      ),
    )
  }
  const { me } = config
  if (
    rule.allowedDepartmentIds.length > 0 &&
    !me.isAdmin &&
    !rule.allowedDepartmentIds.some((id) => me.departmentIds.includes(id))
  ) {
    return err(
      sdPhaseTransitionNotAllowed(
        'Seu departamento não pode mover o chamado para esta fase',
      ),
    )
  }
  return ok(undefined)
}

async function planPhase(
  ctx: AiToolContext,
  ticketRef: string,
  pick: (phases: SdPhaseDTO[], ticket: SdTicketDTO) => Result<SdPhaseDTO>,
  extra: { solution?: string; solutionClassification?: string } = {},
): Promise<Result<PhasePlan>> {
  const loaded = await loadTicket(ctx, ticketRef)
  if (!loaded.ok) return loaded
  const t = loaded.value.ticket
  const config = await loadSdConfig(ctx)
  if (!config.ok) return config
  const phases = phasesOf(config.value, t.type).filter((p) => p.active)
  const target = pick(phases, t)
  if (!target.ok) return target
  if (target.value.id === t.phaseId) {
    return err(validationError(`${t.code} já está na fase "${t.phase.name}"`))
  }
  const allowed = checkTransition(config.value, t, target.value)
  if (!allowed.ok) return allowed

  let solutionClassificationId: string | undefined
  const fields: PreviewField[] = [
    { label: 'Fase', before: t.phase.name, after: target.value.name },
  ]
  if (extra.solutionClassification) {
    const options = config.value.classifications.filter(
      (c) => c.kind === 'SOLUTION' && c.active,
    )
    const found = resolveNamed(
      options,
      extra.solutionClassification,
      'a classificação da solução',
    )
    if (!found.ok) return found
    solutionClassificationId = found.value.id
    fields.push({ label: 'Classificação da solução', after: found.value.name })
  }
  if (extra.solution) {
    fields.push({ label: 'Solução', after: clip(extra.solution, 300) })
  }
  if (
    target.value.category === 'RESOLVED' &&
    config.value.settings.requireSolutionOnResolve &&
    !extra.solution &&
    !t.solution
  ) {
    return err(
      sdPhaseRequirementsUnmet('Informe a solução para resolver o chamado'),
    )
  }
  return ok({
    loaded: loaded.value,
    target: target.value,
    solutionClassificationId,
    fields,
  })
}

function phaseNotes(target: SdPhaseDTO): string {
  const notes = [
    target.requiresApproval ? 'exige aprovação concedida' : null,
    target.pausesSla ? 'pausa o SLA' : null,
    target.requiredFields.length > 0
      ? `exige os campos: ${target.requiredFields.join(', ')}`
      : null,
  ].filter(Boolean)
  return notes.length > 0 ? ` A fase ${notes.join('; ')}.` : ''
}

const MoveArgs = z.object({
  ticket: refSchema,
  phase: refSchema,
  solution: z.string().trim().min(1).max(20_000).optional(),
  solutionClassification: refSchema.optional(),
  comment: z.string().trim().max(2000).optional(),
})
type MoveArgs = z.infer<typeof MoveArgs>

function planMove(ctx: AiToolContext, args: MoveArgs) {
  return planPhase(
    ctx,
    args.ticket,
    (phases) => resolveNamed(phases, args.phase, 'a fase'),
    args,
  )
}

async function runPhaseMove(
  ctx: AiToolContext,
  plan: PhasePlan,
  options: { solution?: string; comment?: string },
): Promise<Result<AiToolOutput>> {
  const moved = await SdTicketService.movePhase(
    ctx.actorId,
    ctx.workspaceId,
    plan.loaded.ticket.id,
    {
      phaseId: plan.target.id,
      solution: options.solution,
      solutionClassificationId: plan.solutionClassificationId,
      comment: options.comment,
    },
  )
  if (!moved.ok) return moved
  return ticketOutput(
    ctx,
    moved.value,
    `${moved.value.code} movido para "${moved.value.phase.name}"`,
  )
}

export const sdMoveTicketPhaseTool: SteelAiTool<MoveArgs> = {
  name: 'sd_move_ticket_phase',
  label: 'Mudando a fase do chamado',
  module: SD_MODULE,
  kind: 'UPDATE',
  annotations: {
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  customerFacing: true,
  description:
    'Move o chamado para outra fase do fluxo da prática (nome ou id da fase). Respeita as transições configuradas — se não for permitido, o erro lista as fases possíveis. Para resolver, informe `solution` (e `solutionClassification` se o workspace exigir). `comment` vai para a rastreabilidade. O solicitante e o contato são avisados da nova fase (portal, e-mail e/ou WhatsApp, conforme as preferências deles); ao resolver, recebem o texto de `solution`.',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      phase: { type: 'string', description: 'Nome ou id da fase de destino.' },
      solution: { type: 'string' },
      solutionClassification: {
        type: 'string',
        description: 'Classificação da solução (nome ou id).',
      },
      comment: { type: 'string' },
    },
    required: ['ticket', 'phase'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'EDIT' },
  parse: zodParser(MoveArgs),
  async preview(ctx, args) {
    const plan = await planMove(ctx, args)
    if (!plan.ok) return plan
    const fields = args.comment
      ? [...plan.value.fields, { label: 'Comentário', after: args.comment }]
      : plan.value.fields
    return ok(
      preview(
        plan.value.loaded,
        `Mover para "${plan.value.target.name}"`,
        `${plan.value.loaded.ticket.title}.${phaseNotes(plan.value.target)}`,
        fields,
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planMove(ctx, args)
    if (!plan.ok) return plan
    return runPhaseMove(ctx, plan.value, args)
  },
}

/* --------------------------------- cancel -------------------------------- */

const CancelArgs = z.object({
  ticket: refSchema,
  reason: z.string().trim().min(1).max(2000),
})
type CancelArgs = z.infer<typeof CancelArgs>

function planCancel(ctx: AiToolContext, args: CancelArgs) {
  return planPhase(ctx, args.ticket, (phases, ticket) => {
    const canceled = phases
      .filter((p) => p.category === 'CANCELED')
      .sort((a, b) => a.position - b.position)[0]
    if (!canceled) {
      return err(
        validationError(
          `O fluxo de ${PRACTICE_LABELS[ticket.type].toLowerCase()} não tem fase de cancelamento`,
        ),
      )
    }
    return ok(canceled)
  })
}

export const sdCancelTicketTool: SteelAiTool<CancelArgs> = {
  name: 'sd_cancel_ticket',
  label: 'Cancelando chamado',
  module: SD_MODULE,
  kind: 'ACTION',
  annotations: {
    idempotentHint: true,
    destructiveHint: true,
    openWorldHint: true,
  },
  customerFacing: true,
  description:
    'Cancela um chamado (move para a fase de cancelamento do fluxo, encerrando-o). O solicitante e o contato são avisados da mudança de fase (conforme as preferências deles). Não há ferramenta para excluir chamados. `reason` é obrigatório e fica na rastreabilidade.',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      reason: { type: 'string', description: 'Motivo do cancelamento.' },
    },
    required: ['ticket', 'reason'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'EDIT' },
  parse: zodParser(CancelArgs),
  async preview(ctx, args) {
    const plan = await planCancel(ctx, args)
    if (!plan.ok) return plan
    return ok(
      preview(
        plan.value.loaded,
        'Cancelar chamado',
        `${plan.value.loaded.ticket.title}. O chamado é encerrado e não aceita mais mensagens; o solicitante vê o cancelamento.`,
        [...plan.value.fields, { label: 'Motivo', after: args.reason }],
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planCancel(ctx, args)
    if (!plan.ok) return plan
    return runPhaseMove(ctx, plan.value, { comment: args.reason })
  },
}

/* ------------------------------ messages --------------------------------- */

const MessageArgs = z.object({
  ticket: refSchema,
  body: z.string().trim().min(1).max(10_000),
})
type MessageArgs = z.infer<typeof MessageArgs>

async function postMessage(
  ctx: AiToolContext,
  args: MessageArgs,
  visibility: 'PUBLIC' | 'INTERNAL',
): Promise<Result<AiToolOutput>> {
  const loaded = await loadOpenTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  const posted = await SdTicketMessageService.create(
    ctx.actorId,
    ctx.workspaceId,
    loaded.value.ticket.id,
    CreateSdTicketMessageSchema.parse({ body: args.body, visibility }),
  )
  if (!posted.ok) return posted
  const t = loaded.value.ticket
  return ok({
    data: {
      messageId: posted.value.id,
      ticket: t.code,
      visibility,
      href: loaded.value.href,
    },
    summary:
      visibility === 'INTERNAL'
        ? `Nota interna registrada em ${t.code}`
        : `Resposta enviada ao solicitante de ${t.code}`,
    target: ticketTarget(loaded.value),
  })
}

const messageParameters = {
  type: 'object',
  properties: {
    ticket: ticketRefParameter,
    body: { type: 'string', maxLength: 10_000, description: 'Texto puro.' },
  },
  required: ['ticket', 'body'],
  additionalProperties: false,
}

export const sdAddInternalNoteTool: SteelAiTool<MessageArgs> = {
  name: 'sd_add_internal_note',
  label: 'Registrando nota interna',
  module: SD_MODULE,
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Adiciona uma nota interna ao histórico do chamado — só agentes veem; o solicitante não é avisado.',
  parameters: messageParameters,
  permission: { resource: 'sd-tickets', action: 'CREATE' },
  parse: zodParser(MessageArgs),
  async preview(ctx, args) {
    const loaded = await loadOpenTicket(ctx, args.ticket)
    if (!loaded.ok) return loaded
    return ok(
      preview(
        loaded.value,
        'Nota interna',
        'Visível só para agentes. O solicitante não recebe nada.',
        [{ label: 'Nota', after: clip(args.body, 1000) }],
      ),
    )
  },
  execute: (ctx, args) => postMessage(ctx, args, 'INTERNAL'),
}

export const sdReplyToRequesterTool: SteelAiTool<MessageArgs> = {
  name: 'sd_reply_to_requester',
  label: 'Respondendo ao solicitante',
  module: SD_MODULE,
  kind: 'ACTION',
  annotations: { destructiveHint: false, openWorldHint: true },
  customerFacing: true,
  description:
    'Envia uma resposta PÚBLICA ao solicitante no histórico do chamado. O cliente é notificado (portal, e-mail e/ou WhatsApp, conforme as preferências; chamados abertos por e-mail recebem a resposta pela caixa do ServiceDesk). Escreva em pt-BR, tom profissional, sem dados internos.',
  parameters: messageParameters,
  permission: { resource: 'sd-tickets', action: 'CREATE' },
  parse: zodParser(MessageArgs),
  async preview(ctx, args) {
    const loaded = await loadOpenTicket(ctx, args.ticket)
    if (!loaded.ok) return loaded
    const t = loaded.value.ticket
    const person = t.requester ?? t.contact
    const to = person
      ? [person.name, person.email].filter(Boolean).join(' — ')
      : 'o solicitante do chamado'
    return ok(
      preview(
        loaded.value,
        'Responder ao solicitante',
        `Mensagem pública: ${to} será notificado (portal, e-mail e/ou WhatsApp). Não dá para desfazer o envio.`,
        [
          { label: 'Para', after: to },
          { label: 'Mensagem', after: clip(args.body, 1000) },
        ],
      ),
    )
  },
  execute: (ctx, args) => postMessage(ctx, args, 'PUBLIC'),
}

export const SD_TICKET_WRITE_TOOLS = [
  sdCreateTicketTool,
  sdUpdateTicketTool,
  sdAssignTicketTool,
  sdMoveTicketPhaseTool,
  sdCancelTicketTool,
  sdAddInternalNoteTool,
  sdReplyToRequesterTool,
]
