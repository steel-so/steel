import { z } from 'zod'
import { validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type ListSdTicketsDTO,
  ListSdTicketsSchema,
  SD_PHASE_CATEGORIES,
} from '@/src/schemas/sd-ticket.schema'
import { SdConfigService } from '@/src/services/sd-config.service'
import { SdDashboardSourceService } from '@/src/services/sd-dashboard-source.service'
import { SdKbTicketLinkService } from '@/src/services/sd-kb-ticket-link.service'
import { SdTicketService } from '@/src/services/sd-ticket.service'
import { SdTicketApprovalService } from '@/src/services/sd-ticket-approval.service'
import { SdTicketEventService } from '@/src/services/sd-ticket-event.service'
import { SdTicketMessageService } from '@/src/services/sd-ticket-message.service'
import { SdTicketTaskService } from '@/src/services/sd-ticket-task.service'
import type { SdAgentDTO, SdConfigBootstrapDTO } from '@/types/sd-config'
import type { SdTicketDashboardRow } from '@/types/sd-dashboard'
import type { AiToolContext, SteelAiTool } from '../types'
import { lookupCustomer } from './lookups'
import {
  clip,
  compactTicket,
  flattenDepartments,
  htmlText,
  limitParameter,
  limitSchema,
  loadSdConfig,
  looksLikeId,
  matchNamed,
  PRACTICE_LABELS,
  pageParameter,
  pageSchema,
  practiceParameter,
  practiceSchema,
  refSchema,
  resolveNamed,
  resolveUser,
  SD_MODULE,
  sdBasePath,
  sdHref,
  ticketRefParameter,
  zodParser,
} from './shared'

/* ------------------------------ search tickets --------------------------- */

const SORTS = ['createdAt', 'updatedAt', 'priority', 'resolutionDueAt'] as const

const SearchArgs = z.object({
  query: refSchema.optional(),
  practice: practiceSchema.optional(),
  phase: refSchema.optional(),
  phaseCategory: z.enum(SD_PHASE_CATEGORIES).optional(),
  priority: refSchema.optional(),
  assignee: refSchema.optional(),
  department: refSchema.optional(),
  requester: refSchema.optional(),
  customer: refSchema.optional(),
  company: refSchema.optional(),
  sla: z.enum(['at_risk', 'breached']).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  includeClosed: z.boolean().default(false),
  sort: z.enum(SORTS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: limitSchema,
  page: pageSchema,
})
export type SearchTicketsArgs = z.infer<typeof SearchArgs>

/** Model filters → `ListSdTicketsDTO` (names resolved to ids). */
export async function buildTicketQuery(
  ctx: AiToolContext,
  args: SearchTicketsArgs,
): Promise<Result<ListSdTicketsDTO>> {
  const needsConfig = args.phase || args.priority || args.department
  let config: SdConfigBootstrapDTO | null = null
  if (needsConfig) {
    const loaded = await loadSdConfig(ctx)
    if (!loaded.ok) return loaded
    config = loaded.value
  }

  const query: Record<string, unknown> = {
    q: args.query,
    type: args.practice,
    phaseCategories: args.phaseCategory ? [args.phaseCategory] : undefined,
    sla: args.sla,
    createdFrom: args.createdFrom,
    createdTo: args.createdTo,
    includeClosed:
      args.includeClosed ||
      ['RESOLVED', 'CLOSED', 'CANCELED'].includes(args.phaseCategory ?? ''),
    sort: args.sort,
    order: args.order,
    page: args.page,
    pageSize: args.limit,
  }

  if (config && args.phase) {
    // Each practice has its own flow, so "Em andamento" may be several
    // phases — the filter takes all of them.
    const phases = config.phases
      .filter((f) => !args.practice || f.ticketType === args.practice)
      .flatMap((f) => f.phases)
    const matches = matchNamed(phases, args.phase)
    if (matches.length === 0) {
      return err(validationError(`Não encontrei a fase "${args.phase}"`))
    }
    query.phaseIds = matches.map((p) => p.id)
  }
  if (config && args.priority) {
    const priority = resolveNamed(
      config.priorities,
      args.priority,
      'a prioridade',
    )
    if (!priority.ok) return priority
    query.priorityIds = [priority.value.id]
  }
  if (config && args.department) {
    const department = resolveNamed(
      flattenDepartments(config),
      args.department,
      'o departamento',
    )
    if (!department.ok) return department
    query.departmentIds = [department.value.id]
  }

  const people = await resolvePeople(ctx, args)
  if (!people.ok) return people
  Object.assign(query, people.value)

  if (args.customer) {
    const customer = await lookupCustomer(ctx, args.customer, 'CLIENT')
    if (!customer.ok) return customer
    query.customerId = customer.value.id
  }
  if (args.company) {
    const company = await lookupCustomer(ctx, args.company, 'COMPANY')
    if (!company.ok) return company
    query.companyId = company.value.id
  }

  const parsed = ListSdTicketsSchema.safeParse(query)
  if (!parsed.success) {
    return err(validationError('Filtros inválidos', parsed.error.issues))
  }
  return ok(parsed.data)
}

const SPECIAL_USERS = new Set(['me', 'unassigned'])

async function resolvePeople(
  ctx: AiToolContext,
  args: Pick<SearchTicketsArgs, 'assignee' | 'requester'>,
): Promise<Result<{ assigneeIds?: string[]; requesterId?: string }>> {
  const out: { assigneeIds?: string[]; requesterId?: string } = {}
  let members: SdAgentDTO[] | null = null

  for (const key of ['assignee', 'requester'] as const) {
    const value = args[key]
    if (!value) continue
    let id: string
    if (SPECIAL_USERS.has(value.toLowerCase())) {
      id = value.toLowerCase()
    } else if (looksLikeId(value)) {
      id = value
    } else {
      if (!members) {
        const loaded = await SdConfigService.agents(
          ctx.actorId,
          ctx.workspaceId,
          { includeRequesters: true },
        )
        if (!loaded.ok) return loaded
        members = loaded.value
      }
      const user = resolveUser(ctx, members, value, 'o usuário')
      if (!user.ok) return user
      id = user.value.id
    }
    if (key === 'assignee') out.assigneeIds = [id]
    else if (id !== 'unassigned') out.requesterId = id
  }
  return ok(out)
}

const searchParameters = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Texto no título/descrição ou o código do chamado.',
    },
    practice: practiceParameter,
    phase: {
      type: 'string',
      description: 'Nome (ou id) da fase, ex.: "Em andamento".',
    },
    phaseCategory: {
      type: 'string',
      enum: [...SD_PHASE_CATEGORIES],
      description:
        'Categoria da fase. RESOLVED/CLOSED/CANCELED incluem encerrados automaticamente.',
    },
    priority: { type: 'string', description: 'Nome ou id da prioridade.' },
    assignee: {
      type: 'string',
      description:
        'Responsável: "me" (eu), "unassigned" (sem responsável), nome, e-mail ou id.',
    },
    department: { type: 'string', description: 'Nome ou id do departamento.' },
    requester: {
      type: 'string',
      description: 'Solicitante: "me", nome, e-mail ou id do usuário.',
    },
    customer: { type: 'string', description: 'Nome ou id do cliente.' },
    company: { type: 'string', description: 'Nome ou id da empresa.' },
    sla: {
      type: 'string',
      enum: ['at_risk', 'breached'],
      description: 'SLA em risco ou violado.',
    },
    createdFrom: {
      type: 'string',
      format: 'date-time',
      description: 'Criados a partir de (ISO 8601).',
    },
    createdTo: {
      type: 'string',
      format: 'date-time',
      description: 'Criados até (ISO 8601).',
    },
    includeClosed: {
      type: 'boolean',
      description: 'Inclui resolvidos/fechados/cancelados (padrão false).',
    },
    sort: { type: 'string', enum: [...SORTS] },
    order: { type: 'string', enum: ['asc', 'desc'] },
    limit: limitParameter,
    page: pageParameter,
  },
  additionalProperties: false,
}

export const sdSearchTicketsTool: SteelAiTool<SearchTicketsArgs> = {
  name: 'sd_search_tickets',
  label: 'Consultando chamados',
  module: SD_MODULE,
  kind: 'READ',
  description:
    'Busca chamados do ServiceDesk com filtros (texto/código, prática, fase, prioridade, responsável incluindo "me", departamento, solicitante, cliente/empresa, SLA em risco/violado, período de criação). Por padrão só abertos. Retorna campos resumidos com `href` para a tela do chamado; use `sd_get_ticket` para detalhes.',
  parameters: searchParameters,
  permission: { resource: 'sd-tickets', action: 'VIEW' },
  parse: zodParser(SearchArgs),
  async execute(ctx, args) {
    const query = await buildTicketQuery(ctx, args)
    if (!query.ok) return query
    const [page, base] = await Promise.all([
      SdTicketService.list(ctx.actorId, ctx.workspaceId, query.value),
      sdBasePath(ctx),
    ])
    if (!page.ok) return page
    if (!base.ok) return base
    const items = page.value.items.map((t) => compactTicket(t, base.value))
    return ok({
      data: {
        total: page.value.total,
        page: args.page,
        hasMore: args.page * args.limit < page.value.total,
        items,
      },
      summary: `${page.value.total} chamado(s) encontrado(s)`,
    })
  },
}

/* --------------------------------- my queue ------------------------------ */

const QueueArgs = z.object({
  scope: z.enum(['mine', 'unassigned_in_my_departments']).default('mine'),
  limit: limitSchema,
})

export const sdMyQueueTool: SteelAiTool<z.infer<typeof QueueArgs>> = {
  name: 'sd_my_queue',
  label: 'Consultando sua fila',
  module: SD_MODULE,
  kind: 'READ',
  description:
    'Fila do usuário autenticado (agente do ServiceDesk): chamados abertos atribuídos a ele (scope "mine", padrão) ou sem responsável nos departamentos dele ("unassigned_in_my_departments"), ordenados pelo prazo de resolução mais próximo.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['mine', 'unassigned_in_my_departments'],
      },
      limit: limitParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'VIEW' },
  parse: zodParser(QueueArgs),
  async execute(ctx, args) {
    const filters: Record<string, unknown> = {
      sort: 'resolutionDueAt',
      order: 'asc',
      pageSize: args.limit,
    }
    if (args.scope === 'mine') {
      filters.assigneeIds = ['me']
    } else {
      const me = await SdConfigService.me(ctx.actorId, ctx.workspaceId)
      if (!me.ok) return me
      if (me.value.departmentIds.length === 0) {
        return ok({
          data: { total: 0, items: [] },
          summary: 'Você não faz parte de nenhum departamento',
        })
      }
      filters.assigneeIds = ['unassigned']
      filters.departmentIds = me.value.departmentIds
    }
    const query = ListSdTicketsSchema.parse(filters)
    const [page, base] = await Promise.all([
      SdTicketService.list(ctx.actorId, ctx.workspaceId, query),
      sdBasePath(ctx),
    ])
    if (!page.ok) return page
    if (!base.ok) return base
    return ok({
      data: {
        total: page.value.total,
        items: page.value.items.map((t) => compactTicket(t, base.value)),
      },
      summary: `${page.value.total} chamado(s) na fila`,
    })
  },
}

/* --------------------------------- get ticket ---------------------------- */

const GetArgs = z.object({ ticket: refSchema })

const HISTORY_SIZE = 10

/** Optional section: `null` when the caller may not see it (requester). */
function section<T, R>(
  result: { ok: true; value: T } | { ok: false },
  map: (value: T) => R,
): R | null {
  return result.ok ? map(result.value) : null
}

export const sdGetTicketTool: SteelAiTool<z.infer<typeof GetArgs>> = {
  name: 'sd_get_ticket',
  label: 'Abrindo o chamado',
  module: SD_MODULE,
  kind: 'READ',
  description:
    'Detalhes de um chamado: campos, SLA, risco, as últimas mensagens do histórico, a rastreabilidade recente, tarefas, aprovações e artigos da base vinculados. Aceita código (INC-000123), número ou id.',
  parameters: {
    type: 'object',
    properties: { ticket: ticketRefParameter },
    required: ['ticket'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'VIEW' },
  parse: zodParser(GetArgs),
  async execute(ctx, args) {
    const found = await SdTicketService.get(
      ctx.actorId,
      ctx.workspaceId,
      args.ticket,
    )
    if (!found.ok) return found
    const t = found.value
    const base = await sdBasePath(ctx)
    if (!base.ok) return base

    const [messages, events, tasks, approvals, articles] = await Promise.all([
      SdTicketMessageService.list(ctx.actorId, ctx.workspaceId, t.id, {
        limit: HISTORY_SIZE,
      }),
      SdTicketEventService.list(ctx.actorId, ctx.workspaceId, t.id, {
        limit: HISTORY_SIZE,
      }),
      SdTicketTaskService.list(ctx.actorId, ctx.workspaceId, t.id),
      SdTicketApprovalService.list(ctx.actorId, ctx.workspaceId, t.id),
      SdKbTicketLinkService.listForTicket(ctx.actorId, ctx.workspaceId, t.id),
    ])

    const href = sdHref.ticket(base.value, t.number)
    return ok({
      data: {
        ...compactTicket(t, base.value),
        description: htmlText(t.description, 2000),
        channel: t.channel,
        impact: t.impact?.name ?? null,
        urgency: t.urgency?.name ?? null,
        severity: t.severity?.name ?? null,
        catalog: [t.category, t.subcategory, t.service]
          .filter((c) => c !== null)
          .map((c) => c.name)
          .join(' > '),
        requesterEmail: t.requester?.email ?? t.contact?.email ?? null,
        company: t.company?.name ?? null,
        configItem: t.configItem
          ? { id: t.configItem.id, name: t.configItem.name }
          : null,
        tags: t.tags,
        customFields: t.customFields,
        solution: clip(t.solution, 1000),
        slaDetail: t.sla,
        risk: t.risk
          ? {
              level: t.risk.level,
              score: t.risk.score,
              reasons: t.risk.factors.map((f) => f.detail),
            }
          : null,
        escalationLevel: t.escalationLevel,
        parent: t.parent?.code ?? null,
        childrenCount: t.childrenCount,
        resolvedAt: t.resolvedAt,
        closedAt: t.closedAt,
        recentMessages: section(messages, (page) =>
          page.items.map((m) => ({
            at: m.createdAt,
            author: m.author?.name ?? m.contact?.name ?? m.authorKind,
            visibility: m.visibility,
            channel: m.channel,
            body: clip(m.body, 500),
          })),
        ),
        recentEvents: section(events, (page) =>
          page.items.map((e) => ({
            at: e.createdAt,
            actor: e.actor?.name ?? e.actorKind,
            action: e.action,
            field: e.field,
          })),
        ),
        tasks: section(tasks, (list) => ({
          progress: list.progress,
          items: list.items.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            assignee: task.assignee?.name ?? null,
            dueDate: task.dueDate,
            overdue: task.overdue,
          })),
        })),
        approvals: section(approvals, (list) =>
          list.map((a) => ({
            id: a.id,
            approver: a.approverName ?? a.approverEmail,
            status: a.status,
            respondedAt: a.respondedAt,
            comment: clip(a.comment, 300),
          })),
        ),
        knowledge: section(articles, (list) =>
          list.map((l) => ({
            id: l.article.id,
            title: l.article.title,
            resolvedTicket: l.resolvedTicket,
            href: sdHref.article(base.value, l.article.id),
          })),
        ),
        href,
      },
      summary: `${t.code} — ${t.title} (${t.phase.name})`,
      target: { type: 'sd_ticket', id: t.id, label: t.code, href },
    })
  },
}

/* ------------------------------- SLA at risk ----------------------------- */

const SlaArgs = z.object({ limit: limitSchema })

export const sdSlaAtRiskTool: SteelAiTool<z.infer<typeof SlaArgs>> = {
  name: 'sd_sla_at_risk',
  label: 'Consultando SLA em risco',
  module: SD_MODULE,
  kind: 'READ',
  description:
    'Resumo de SLA dos chamados abertos: contagens (minha fila, sem responsável, em risco, violados, criados hoje) e as listas dos chamados em risco e violados, do prazo mais próximo para o mais distante.',
  parameters: {
    type: 'object',
    properties: { limit: limitParameter },
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'VIEW' },
  parse: zodParser(SlaArgs),
  async execute(ctx, args) {
    const list = (sla: 'at_risk' | 'breached') =>
      SdTicketService.list(
        ctx.actorId,
        ctx.workspaceId,
        ListSdTicketsSchema.parse({
          sla,
          sort: 'resolutionDueAt',
          order: 'asc',
          pageSize: args.limit,
        }),
      )
    const [summary, atRisk, breached, base] = await Promise.all([
      SdTicketService.summary(ctx.actorId, ctx.workspaceId),
      list('at_risk'),
      list('breached'),
      sdBasePath(ctx),
    ])
    if (!summary.ok) return summary
    if (!atRisk.ok) return atRisk
    if (!breached.ok) return breached
    if (!base.ok) return base
    const s = summary.value
    return ok({
      data: {
        counts: {
          atRisk: s.atRisk,
          breached: s.breached,
          myOpen: s.myOpen,
          unassigned: s.unassigned,
          createdToday: s.createdToday,
        },
        atRisk: atRisk.value.items.map((t) => compactTicket(t, base.value)),
        breached: breached.value.items.map((t) => compactTicket(t, base.value)),
      },
      summary: `${s.atRisk} em risco, ${s.breached} violado(s)`,
    })
  },
}

/* ------------------------------ dashboard counts ------------------------- */

const DAY_MS = 86_400_000

const CountsArgs = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    practice: practiceSchema.optional(),
    department: refSchema.optional(),
  })
  .refine((a) => !a.from || !a.to || a.from <= a.to, {
    message: 'O início do período deve ser antes do fim',
    path: ['from'],
  })

function countBy(
  rows: SdTicketDashboardRow[],
  key: (row: SdTicketDashboardRow) => string | null,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const k = key(row) ?? '(vazio)'
    out[k] = (out[k] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

export const sdTicketCountsTool: SteelAiTool<z.infer<typeof CountsArgs>> = {
  name: 'sd_ticket_counts',
  label: 'Calculando indicadores',
  module: SD_MODULE,
  kind: 'READ',
  description:
    'Indicadores no estilo dashboard: chamados abertos por fase, prioridade, departamento e prática, e criados × resolvidos num período (`from`/`to`, padrão últimos 30 dias). Filtros opcionais: prática e departamento.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      practice: practiceParameter,
      department: { type: 'string', description: 'Nome do departamento.' },
    },
    additionalProperties: false,
  },
  permission: { resource: 'sd-dashboards', action: 'VIEW' },
  parse: zodParser(CountsArgs),
  async execute(ctx, args) {
    const rows = await SdDashboardSourceService.rows(
      ctx.actorId,
      ctx.workspaceId,
      'sd-tickets',
    )
    if (!rows.ok) return rows
    let tickets = rows.value as SdTicketDashboardRow[]
    if (args.practice) {
      const label = PRACTICE_LABELS[args.practice]
      tickets = tickets.filter((r) => r.type === label)
    }
    if (args.department) {
      const names = [...new Set(tickets.map((r) => r.department))]
        .filter((n): n is string => n !== null)
        .map((name) => ({ id: name, name }))
      const department = resolveNamed(names, args.department, 'o departamento')
      if (!department.ok) return department
      tickets = tickets.filter((r) => r.department === department.value.name)
    }

    const to = args.to ?? new Date()
    const from = args.from ?? new Date(to.getTime() - 30 * DAY_MS)
    const inPeriod = (iso: string | null) => {
      if (!iso) return false
      const at = new Date(iso).getTime()
      return at >= from.getTime() && at <= to.getTime()
    }
    const open = tickets.filter((r) => r.isOpen)
    const created = tickets.filter((r) => inPeriod(r.createdAt)).length
    const resolved = tickets.filter((r) => inPeriod(r.resolvedAt)).length

    return ok({
      data: {
        open: {
          total: open.length,
          unassigned: open.filter((r) => r.isUnassigned).length,
          slaAtRisk: open.filter((r) => r.slaAtRisk).length,
          slaBreached: open.filter((r) => r.slaBreached).length,
          byPhase: countBy(open, (r) => r.phase),
          byPriority: countBy(open, (r) => r.priority),
          byDepartment: countBy(open, (r) => r.department),
          byPractice: countBy(open, (r) => r.type),
        },
        period: {
          from: from.toISOString(),
          to: to.toISOString(),
          created,
          resolved,
        },
      },
      summary: `${open.length} aberto(s); ${created} criado(s) e ${resolved} resolvido(s) no período`,
    })
  },
}

export const SD_TICKET_READ_TOOLS = [
  sdSearchTicketsTool,
  sdGetTicketTool,
  sdMyQueueTool,
  sdSlaAtRiskTool,
  sdTicketCountsTool,
]
