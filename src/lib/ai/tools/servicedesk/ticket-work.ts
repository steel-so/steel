import { z } from 'zod'
import { validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import {
  RequestSdTicketApprovalSchema,
  SD_APPROVAL_DEFAULT_DAYS,
  type SdApproverInput,
} from '@/src/schemas/sd-ticket-approval.schema'
import { CreateSdTicketTaskSchema } from '@/src/schemas/sd-ticket-task.schema'
import { SdConfigService } from '@/src/services/sd-config.service'
import { SdKbTicketLinkService } from '@/src/services/sd-kb-ticket-link.service'
import { SdTicketService } from '@/src/services/sd-ticket.service'
import { SdTicketApprovalService } from '@/src/services/sd-ticket-approval.service'
import { SdTicketTaskService } from '@/src/services/sd-ticket-task.service'
import type { SdTicketTaskDTO } from '@/types/sd-ticket-task'
import type { AiToolPreviewDTO } from '@/types/steel-ai'
import type { AiToolContext, SteelAiTool } from '../types'
import { lookupConfigItem, lookupKbArticle } from './lookups'
import {
  agentItems,
  clip,
  matchNamed,
  normalizeName,
  refSchema,
  resolveNamed,
  resolveUser,
  SD_MODULE,
  sdBasePath,
  sdHref,
  ticketRefParameter,
  zodParser,
} from './shared'
import {
  changeLine,
  type LoadedTicket,
  loadOpenTicket,
  loadTicket,
  type PreviewField,
  ticketTarget,
} from './ticket-fields'

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

/* ---------------------------------- tasks -------------------------------- */

const TASK_STATUS_LABELS: Record<SdTicketTaskDTO['status'], string> = {
  TODO: 'A fazer',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluída',
  CANCELED: 'Cancelada',
}

const CreateTaskArgs = z.object({
  ticket: refSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  assignee: refSchema.optional(),
  dueDate: z.coerce.date().optional(),
})
type CreateTaskArgs = z.infer<typeof CreateTaskArgs>

async function planCreateTask(ctx: AiToolContext, args: CreateTaskArgs) {
  const loaded = await loadOpenTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  let assignee: { id: string; name: string } | null = null
  if (args.assignee) {
    const members = await SdConfigService.agents(ctx.actorId, ctx.workspaceId, {
      includeRequesters: false,
    })
    if (!members.ok) return members
    const user = resolveUser(ctx, members.value, args.assignee, 'o agente')
    if (!user.ok) return user
    assignee = user.value
  }
  return ok({ loaded: loaded.value, assignee })
}

export const sdCreateTicketTaskTool: SteelAiTool<CreateTaskArgs> = {
  name: 'sd_create_ticket_task',
  label: 'Criando tarefa do chamado',
  module: SD_MODULE,
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma tarefa no chamado: título, descrição, responsável (agente: "me", nome, e-mail ou id) e prazo (ISO 8601). O responsável é avisado.',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string' },
      assignee: { type: 'string' },
      dueDate: { type: 'string', format: 'date-time' },
    },
    required: ['ticket', 'title'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'CREATE' },
  parse: zodParser(CreateTaskArgs),
  async preview(ctx, args) {
    const plan = await planCreateTask(ctx, args)
    if (!plan.ok) return plan
    const fields: PreviewField[] = [{ label: 'Tarefa', after: args.title }]
    if (args.description) {
      fields.push({ label: 'Descrição', after: clip(args.description, 300) })
    }
    if (plan.value.assignee) {
      fields.push({ label: 'Responsável', after: plan.value.assignee.name })
    }
    if (args.dueDate) {
      fields.push({ label: 'Prazo', after: args.dueDate.toISOString() })
    }
    return ok(
      preview(
        plan.value.loaded,
        'Nova tarefa',
        plan.value.loaded.ticket.title,
        fields,
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planCreateTask(ctx, args)
    if (!plan.ok) return plan
    const created = await SdTicketTaskService.create(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.loaded.ticket.id,
      CreateSdTicketTaskSchema.parse({
        title: args.title,
        description: args.description,
        assigneeId: plan.value.assignee?.id,
        dueDate: args.dueDate,
      }),
    )
    if (!created.ok) return created
    return ok({
      data: { taskId: created.value.id, ticket: plan.value.loaded.ticket.code },
      summary: `Tarefa “${created.value.title}” criada em ${plan.value.loaded.ticket.code}`,
      target: ticketTarget(plan.value.loaded),
    })
  },
}

const TaskRefArgs = z.object({ ticket: refSchema, task: refSchema })
type TaskRefArgs = z.infer<typeof TaskRefArgs>

async function planTask(
  ctx: AiToolContext,
  args: TaskRefArgs,
): Promise<Result<{ loaded: LoadedTicket; task: SdTicketTaskDTO }>> {
  const loaded = await loadOpenTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  const tasks = await SdTicketTaskService.list(
    ctx.actorId,
    ctx.workspaceId,
    loaded.value.ticket.id,
  )
  if (!tasks.ok) return tasks
  const task = resolveNamed(
    tasks.value.items.map((t) => ({ ...t, name: t.title })),
    args.task,
    'a tarefa',
  )
  if (!task.ok) return task
  return ok({ loaded: loaded.value, task: task.value })
}

const taskRefParameters = {
  type: 'object',
  properties: {
    ticket: ticketRefParameter,
    task: { type: 'string', description: 'Id ou título da tarefa.' },
  },
  required: ['ticket', 'task'],
  additionalProperties: false,
}

export const sdCompleteTicketTaskTool: SteelAiTool<TaskRefArgs> = {
  name: 'sd_complete_ticket_task',
  label: 'Concluindo tarefa',
  module: SD_MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description: 'Marca uma tarefa do chamado como concluída (id ou título).',
  parameters: taskRefParameters,
  permission: { resource: 'sd-tickets', action: 'EDIT' },
  parse: zodParser(TaskRefArgs),
  async preview(ctx, args) {
    const plan = await planTask(ctx, args)
    if (!plan.ok) return plan
    const { task } = plan.value
    if (task.status === 'DONE') {
      return err(validationError(`A tarefa “${task.title}” já está concluída`))
    }
    return ok(
      preview(plan.value.loaded, 'Concluir tarefa', task.title, [
        {
          label: 'Situação',
          before: TASK_STATUS_LABELS[task.status],
          after: TASK_STATUS_LABELS.DONE,
        },
      ]),
    )
  },
  async execute(ctx, args) {
    const plan = await planTask(ctx, args)
    if (!plan.ok) return plan
    const updated = await SdTicketTaskService.update(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.loaded.ticket.id,
      plan.value.task.id,
      { status: 'DONE' },
    )
    if (!updated.ok) return updated
    return ok({
      data: { taskId: updated.value.id, status: updated.value.status },
      summary: `Tarefa “${updated.value.title}” concluída`,
      target: ticketTarget(plan.value.loaded),
    })
  },
}

export const sdDeleteTicketTaskTool: SteelAiTool<TaskRefArgs> = {
  name: 'sd_delete_ticket_task',
  label: 'Excluindo tarefa',
  module: SD_MODULE,
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Exclui definitivamente uma tarefa do chamado (id ou título). Prefira concluir quando a tarefa foi feita.',
  parameters: taskRefParameters,
  permission: { resource: 'sd-tickets', action: 'DELETE' },
  parse: zodParser(TaskRefArgs),
  async preview(ctx, args) {
    const plan = await planTask(ctx, args)
    if (!plan.ok) return plan
    const { task } = plan.value
    return ok(
      preview(
        plan.value.loaded,
        `Excluir a tarefa “${task.title}”`,
        'A tarefa some do chamado; a exclusão fica na rastreabilidade e não pode ser desfeita.',
        [
          { label: 'Tarefa', before: task.title, after: null },
          { label: 'Situação', before: TASK_STATUS_LABELS[task.status] },
        ],
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planTask(ctx, args)
    if (!plan.ok) return plan
    const removed = await SdTicketTaskService.remove(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.loaded.ticket.id,
      plan.value.task.id,
    )
    if (!removed.ok) return removed
    return ok({
      data: { taskId: plan.value.task.id, deleted: true },
      summary: `Tarefa “${plan.value.task.title}” excluída`,
      target: ticketTarget(plan.value.loaded),
    })
  },
}

/* -------------------------------- approval ------------------------------- */

const ApprovalArgs = z.object({
  ticket: refSchema,
  approvers: z.array(refSchema).min(1).max(10),
  message: z.string().trim().max(2000).optional(),
  expiresInDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(60)
    .default(SD_APPROVAL_DEFAULT_DAYS),
})
type ApprovalArgs = z.infer<typeof ApprovalArgs>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function planApproval(
  ctx: AiToolContext,
  args: ApprovalArgs,
): Promise<
  Result<{
    loaded: LoadedTicket
    approvers: SdApproverInput[]
    labels: string[]
  }>
> {
  const loaded = await loadOpenTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  const members = await SdConfigService.agents(ctx.actorId, ctx.workspaceId, {
    includeRequesters: true,
  })
  if (!members.ok) return members
  const approvers: SdApproverInput[] = []
  const labels: string[] = []
  for (const input of args.approvers) {
    const user = resolveUser(ctx, members.value, input, 'o aprovador')
    if (user.ok) {
      approvers.push({ userId: user.value.id })
      labels.push(`${user.value.name} <${user.value.email}>`)
      continue
    }
    // Not a member: an external e-mail is fine, anything else is an error
    // (ambiguous names keep their candidate list).
    if (
      EMAIL.test(input) &&
      matchNamed(agentItems(members.value), input).length === 0
    ) {
      approvers.push({ email: input.toLowerCase() })
      labels.push(`${input.toLowerCase()} (externo)`)
      continue
    }
    return user
  }
  const parsed = RequestSdTicketApprovalSchema.safeParse({
    approvers,
    message: args.message,
    expiresInDays: args.expiresInDays,
  })
  if (!parsed.success) {
    return err(validationError('Aprovadores inválidos', parsed.error.issues))
  }
  return ok({ loaded: loaded.value, approvers: parsed.data.approvers, labels })
}

export const sdRequestApprovalTool: SteelAiTool<ApprovalArgs> = {
  name: 'sd_request_approval',
  label: 'Pedindo aprovação',
  module: SD_MODULE,
  kind: 'ACTION',
  annotations: { destructiveHint: false, openWorldHint: true },
  customerFacing: true,
  description:
    'Pede aprovação do chamado por e-mail: cada aprovador (membro do workspace por nome/e-mail/id, ou e-mail externo) recebe um link próprio para aprovar ou reprovar; a primeira resposta decide. `expiresInDays` padrão 7 (1–60).',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      approvers: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description:
          'Aprovadores: nome, e-mail ou id de membro, ou e-mail externo.',
      },
      message: { type: 'string', description: 'Mensagem para os aprovadores.' },
      expiresInDays: { type: 'integer', minimum: 1, maximum: 60 },
    },
    required: ['ticket', 'approvers'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'CREATE' },
  parse: zodParser(ApprovalArgs),
  async preview(ctx, args) {
    const plan = await planApproval(ctx, args)
    if (!plan.ok) return plan
    const fields: PreviewField[] = [
      { label: 'Aprovadores', after: plan.value.labels.join('; ') },
      { label: 'Validade', after: `${args.expiresInDays} dia(s)` },
    ]
    if (args.message) fields.push({ label: 'Mensagem', after: args.message })
    return ok(
      preview(
        plan.value.loaded,
        'Pedir aprovação',
        'Envia um e-mail com link de aprovação para cada aprovador. A primeira resposta decide e cancela os demais pedidos pendentes.',
        fields,
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planApproval(ctx, args)
    if (!plan.ok) return plan
    const requested = await SdTicketApprovalService.request(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.loaded.ticket.id,
      {
        approvers: plan.value.approvers,
        message: args.message ?? null,
        expiresInDays: args.expiresInDays,
      },
    )
    if (!requested.ok) return requested
    const sent = requested.value.filter((a) => a.sentAt).length
    return ok({
      data: {
        approvals: requested.value.map((a) => ({
          id: a.id,
          approver: a.approverName ?? a.approverEmail,
          status: a.status,
          sent: a.sentAt !== null,
          expiresAt: a.expiresAt,
        })),
      },
      summary: `Aprovação pedida a ${requested.value.length} aprovador(es) (${sent} e-mail(s) enviado(s))`,
      target: ticketTarget(plan.value.loaded),
    })
  },
}

/* ------------------------------ link article ----------------------------- */

const LinkArticleArgs = z.object({ ticket: refSchema, article: refSchema })
type LinkArticleArgs = z.infer<typeof LinkArticleArgs>

async function planLinkArticle(ctx: AiToolContext, args: LinkArticleArgs) {
  const loaded = await loadTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  const article = await lookupKbArticle(ctx, args.article)
  if (!article.ok) return article
  const linked = await SdKbTicketLinkService.listForTicket(
    ctx.actorId,
    ctx.workspaceId,
    loaded.value.ticket.id,
  )
  if (!linked.ok) return linked
  if (linked.value.some((l) => l.article.id === article.value.id)) {
    return err(
      validationError(
        `O artigo “${article.value.title}” já está vinculado a ${loaded.value.ticket.code}`,
      ),
    )
  }
  return ok({ loaded: loaded.value, article: article.value })
}

export const sdLinkKbArticleTool: SteelAiTool<LinkArticleArgs> = {
  name: 'sd_link_kb_article',
  label: 'Vinculando artigo da base',
  module: SD_MODULE,
  kind: 'CREATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Vincula um artigo da base de conhecimento ao chamado (aparece nos artigos vinculados; o solicitante não é avisado). `article`: id ou título (busca na base).',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      article: { type: 'string', description: 'Id ou título do artigo.' },
    },
    required: ['ticket', 'article'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'EDIT' },
  parse: zodParser(LinkArticleArgs),
  async preview(ctx, args) {
    const plan = await planLinkArticle(ctx, args)
    if (!plan.ok) return plan
    return ok(
      preview(
        plan.value.loaded,
        'Vincular artigo',
        plan.value.loaded.ticket.title,
        [{ label: 'Artigo', after: plan.value.article.title }],
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planLinkArticle(ctx, args)
    if (!plan.ok) return plan
    const linked = await SdKbTicketLinkService.link(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.loaded.ticket.id,
      plan.value.article.id,
    )
    if (!linked.ok) return linked
    const base = await sdBasePath(ctx)
    if (!base.ok) return base
    return ok({
      data: {
        ticket: plan.value.loaded.ticket.code,
        articleId: plan.value.article.id,
        articleHref: sdHref.article(base.value, plan.value.article.id),
      },
      summary: `Artigo “${plan.value.article.title}” vinculado a ${plan.value.loaded.ticket.code}`,
      target: ticketTarget(plan.value.loaded),
    })
  },
}

/* --------------------------- link config item ---------------------------- */

const LinkCiArgs = z.object({ ticket: refSchema, configItem: refSchema })
type LinkCiArgs = z.infer<typeof LinkCiArgs>

const UNLINK = new Set(['none', 'nenhum'])

async function planLinkCi(ctx: AiToolContext, args: LinkCiArgs) {
  const loaded = await loadTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  const current = loaded.value.ticket.configItem
  if (UNLINK.has(normalizeName(args.configItem))) {
    if (!current) {
      return err(validationError('O chamado não tem item de configuração'))
    }
    return ok({ loaded: loaded.value, item: null })
  }
  const item = await lookupConfigItem(ctx, args.configItem)
  if (!item.ok) return item
  if (current?.id === item.value.id) {
    return err(validationError(`${current.name} já está vinculado ao chamado`))
  }
  return ok({ loaded: loaded.value, item: item.value })
}

export const sdLinkConfigItemTool: SteelAiTool<LinkCiArgs> = {
  name: 'sd_link_config_item',
  label: 'Vinculando item de configuração',
  module: SD_MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: false },
  description:
    'Define o item de configuração (CMDB) do chamado: nome, código, IP ou id; "none" remove o vínculo.',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      configItem: { type: 'string' },
    },
    required: ['ticket', 'configItem'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-tickets', action: 'EDIT' },
  parse: zodParser(LinkCiArgs),
  async preview(ctx, args) {
    const plan = await planLinkCi(ctx, args)
    if (!plan.ok) return plan
    const { loaded, item } = plan.value
    return ok(
      preview(
        loaded,
        item ? 'Vincular item de configuração' : 'Remover item de configuração',
        loaded.ticket.title,
        changeLine(
          'Item de configuração',
          loaded.ticket.configItem?.name,
          item?.name ?? null,
        ),
      ),
    )
  },
  async execute(ctx, args) {
    const plan = await planLinkCi(ctx, args)
    if (!plan.ok) return plan
    const updated = await SdTicketService.update(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.loaded.ticket.id,
      { configItemId: plan.value.item?.id ?? null },
    )
    if (!updated.ok) return updated
    return ok({
      data: {
        ticket: updated.value.code,
        configItem: updated.value.configItem,
      },
      summary: updated.value.configItem
        ? `${updated.value.configItem.name} vinculado a ${updated.value.code}`
        : `Item de configuração removido de ${updated.value.code}`,
      target: ticketTarget(plan.value.loaded),
    })
  },
}

export const SD_TICKET_WORK_TOOLS = [
  sdCreateTicketTaskTool,
  sdCompleteTicketTaskTool,
  sdDeleteTicketTaskTool,
  sdRequestApprovalTool,
  sdLinkKbArticleTool,
  sdLinkConfigItemTool,
]
