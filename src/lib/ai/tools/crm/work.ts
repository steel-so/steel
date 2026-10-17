import { z } from 'zod'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmNoteDTO } from '@/src/mappers/crm-note.mapper'
import { toCrmTaskDTO } from '@/src/mappers/crm-task.mapper'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmTaskRepository } from '@/src/repositories/crm-task.repository'
import { assertModuleMember } from '@/src/services/authz'
import { CrmNoteService } from '@/src/services/crm-note.service'
import { CrmTaskService } from '@/src/services/crm-task.service'
import type { CrmNoteDTO } from '@/types/crm-note'
import type { CrmTaskDTO, CrmTaskStatusDTO } from '@/types/crm-task'
import type { AiToolContext, SteelAiTool } from '../types'
import {
  afterFields,
  changeFields,
  crmBase,
  excerpt,
  formatDate,
  matchesQuery,
  memberNames,
  nothingToChange,
  ownerParameter,
  pageParameters,
  pageSchema,
  paginate,
  recordHref,
  resolveMember,
  zodParser,
} from './shared'

const TASK_STATUS_LABELS: Record<CrmTaskStatusDTO, string> = {
  TODO: 'A fazer',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluída',
}

const TaskStatus = z.enum(['TODO', 'IN_PROGRESS', 'DONE'])

/**
 * Tasks and notes have no `getById` in their services: the preview reads the
 * record through the repository after the same module/RBAC check the service
 * would run (VIEW on the resource), so it never reveals more than a list.
 */
async function findTask(
  ctx: AiToolContext,
  taskId: string,
): Promise<Result<CrmTaskDTO>> {
  const access = await assertModuleMember(ctx.actorId, ctx.workspaceId, 'CRM', {
    resource: 'tasks',
    action: 'VIEW',
  })
  if (!access.ok) return access
  const task = await CrmTaskRepository.findById(taskId, ctx.workspaceId)
  if (!task.ok) return task
  return ok(toCrmTaskDTO(task.value))
}

async function findNote(
  ctx: AiToolContext,
  noteId: string,
): Promise<Result<CrmNoteDTO>> {
  const access = await assertModuleMember(ctx.actorId, ctx.workspaceId, 'CRM', {
    resource: 'notes',
    action: 'VIEW',
  })
  if (!access.ok) return access
  const note = await CrmNoteRepository.findById(noteId, ctx.workspaceId)
  if (!note.ok) return note
  return ok(toCrmNoteDTO(note.value))
}

/* ================================== tasks ================================= */

export function compactTask(
  task: CrmTaskDTO,
  base: string | null,
  owners: Map<string, string>,
  now = new Date(),
) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    statusLabel: TASK_STATUS_LABELS[task.status],
    dueDate: task.dueDate,
    overdue:
      task.status !== 'DONE' &&
      task.dueDate !== null &&
      new Date(task.dueDate).getTime() < now.getTime(),
    assigneeId: task.assigneeId,
    assigneeName: task.assigneeId
      ? (owners.get(task.assigneeId) ?? null)
      : null,
    companyId: task.companyId,
    personId: task.personId,
    opportunityId: task.opportunityId,
    body: excerpt(task.body),
    href: recordHref(base, 'task', task.id),
  }
}

function taskTarget(t: { id: string; title: string }, base: string | null) {
  return {
    type: 'crm_task',
    id: t.id,
    label: t.title,
    href: recordHref(base, 'task', t.id),
  }
}

const DAY_MS = 86_400_000

/** UTC calendar day — the same reading `formatDate` uses. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

const ListTasksArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  assignee: z.string().trim().min(1).optional(),
  status: TaskStatus.optional(),
  due: z.enum(['overdue', 'today', 'next_7_days', 'no_date']).optional(),
  companyId: z.string().min(1).optional(),
  personId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  ...pageSchema,
})

export const crmListTasksTool: SteelAiTool<z.output<typeof ListTasksArgs>> = {
  name: 'crm_list_tasks',
  label: 'Consultando tarefas',
  module: 'CRM',
  kind: 'READ',
  description:
    'Lista as tarefas do CRM com filtros e paginação. Para "minhas tarefas" use assignee "me". `due`: overdue (vencidas e não concluídas), today (vencem hoje), next_7_days (vencem nos próximos 7 dias), no_date (sem prazo). Também filtra por status e por registro vinculado (empresa, pessoa, oportunidade).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Trecho do título ou descrição.' },
      assignee: ownerParameter,
      status: { type: 'string', enum: TaskStatus.options },
      due: {
        type: 'string',
        enum: ['overdue', 'today', 'next_7_days', 'no_date'],
      },
      companyId: {
        type: 'string',
        description: 'Só as vinculadas à empresa (id).',
      },
      personId: {
        type: 'string',
        description: 'Só as vinculadas à pessoa (id).',
      },
      opportunityId: {
        type: 'string',
        description: 'Só as vinculadas à oportunidade (id).',
      },
      ...pageParameters,
    },
    additionalProperties: false,
  },
  permission: { resource: 'tasks', action: 'VIEW' },
  parse: zodParser(ListTasksArgs),
  async execute(ctx, args) {
    let assigneeId: string | undefined
    if (args.assignee) {
      const member = await resolveMember(ctx, args.assignee)
      if (!member.ok) return member
      assigneeId = member.value.id
    }
    const tasks = await CrmTaskService.list(ctx.actorId, ctx.workspaceId, {
      status: args.status,
      companyId: args.companyId,
      personId: args.personId,
      opportunityId: args.opportunityId,
    })
    if (!tasks.ok) return tasks

    const now = new Date()
    const today = dayKey(now)
    const filtered = tasks.value.filter((t) => {
      if (!matchesQuery(args.query, [t.title, t.body])) return false
      if (assigneeId && t.assigneeId !== assigneeId) return false
      if (!args.due) return true
      if (args.due === 'no_date') return t.dueDate === null
      if (t.dueDate === null) return false
      const due = new Date(t.dueDate)
      if (args.due === 'today') return dayKey(due) === today
      if (args.due === 'overdue') {
        return t.status !== 'DONE' && due.getTime() < now.getTime()
      }
      return (
        due.getTime() >= now.getTime() &&
        due.getTime() <= now.getTime() + 7 * DAY_MS
      )
    })
    filtered.sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return a.dueDate.localeCompare(b.dueDate)
    })

    const [base, owners] = await Promise.all([crmBase(ctx), memberNames(ctx)])
    const page = paginate(filtered, args, (t) =>
      compactTask(t, base, owners, now),
    )
    return ok({ data: page, summary: `${page.total} tarefa(s) encontrada(s)` })
  },
}

const linkProperties = {
  companyId: { type: 'string', description: 'Empresa vinculada (id).' },
  personId: { type: 'string', description: 'Pessoa vinculada (id).' },
  opportunityId: {
    type: 'string',
    description: 'Oportunidade vinculada (id).',
  },
}

const CreateTaskArgs = z.object({
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  body: z.string().max(5000).optional(),
  status: TaskStatus.default('TODO'),
  dueDate: z.coerce.date().optional(),
  assignee: z.string().trim().min(1).optional(),
  companyId: z.string().min(1).optional(),
  personId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
})

async function resolveAssignee(
  ctx: AiToolContext,
  input: string | null | undefined,
): Promise<Result<{ id: string; name: string } | null | undefined>> {
  if (input === undefined || input === null) return ok(input)
  const member = await resolveMember(ctx, input)
  if (!member.ok) return member
  return ok({
    id: member.value.id,
    name: member.value.name || member.value.email,
  })
}

export const crmCreateTaskTool: SteelAiTool<z.output<typeof CreateTaskArgs>> = {
  name: 'crm_create_task',
  label: 'Criando tarefa',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma tarefa no CRM, com prazo, responsável ("me", nome ou e-mail) e vínculo opcional a empresa, pessoa ou oportunidade (ids).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string', description: 'Descrição.' },
      status: { type: 'string', enum: TaskStatus.options },
      dueDate: { type: 'string', description: 'Prazo (AAAA-MM-DD).' },
      assignee: ownerParameter,
      ...linkProperties,
    },
    required: ['title'],
    additionalProperties: false,
  },
  permission: { resource: 'tasks', action: 'CREATE' },
  parse: zodParser(CreateTaskArgs),
  async preview(ctx, args) {
    const assignee = await resolveAssignee(ctx, args.assignee)
    if (!assignee.ok) return assignee
    return ok({
      title: `Criar a tarefa “${args.title}”`,
      summary: 'Uma nova tarefa entra no CRM.',
      fields: afterFields([
        ['Título', args.title],
        ['Descrição', excerpt(args.body)],
        ['Status', TASK_STATUS_LABELS[args.status]],
        ['Prazo', args.dueDate],
        ['Responsável', assignee.value?.name],
        ['Empresa (id)', args.companyId],
        ['Pessoa (id)', args.personId],
        ['Oportunidade (id)', args.opportunityId],
      ]),
      target: { type: 'crm_task', label: args.title },
    })
  },
  async execute(ctx, args) {
    const assignee = await resolveAssignee(ctx, args.assignee)
    if (!assignee.ok) return assignee
    const { assignee: _assignee, ...dto } = args
    const task = await CrmTaskService.create(ctx.actorId, ctx.workspaceId, {
      ...dto,
      assigneeId: assignee.value?.id,
    })
    if (!task.ok) return task
    const base = await crmBase(ctx)
    return ok({
      data: compactTask(task.value, base, new Map()),
      summary: `Tarefa “${task.value.title}” criada`,
      target: taskTarget(task.value, base),
    })
  },
}

const UpdateTaskArgs = z
  .object({
    taskId: z.string().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(5000).nullable().optional(),
    status: TaskStatus.optional(),
    dueDate: z.coerce.date().nullable().optional(),
    companyId: z.string().min(1).nullable().optional(),
    personId: z.string().min(1).nullable().optional(),
    opportunityId: z.string().min(1).nullable().optional(),
  })
  .refine((a) => Object.keys(a).some((k) => k !== 'taskId'), {
    message: 'Informe ao menos um campo para alterar',
  })

export const crmUpdateTaskTool: SteelAiTool<z.output<typeof UpdateTaskArgs>> = {
  name: 'crm_update_task',
  label: 'Atualizando tarefa',
  module: 'CRM',
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera uma tarefa: título, descrição, status (DONE conclui), prazo e vínculos. Envie só o que muda; null limpa. Para o responsável use crm_assign_owner.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Id da tarefa (de crm_list_tasks).',
      },
      title: { type: 'string' },
      body: { type: ['string', 'null'] },
      status: { type: 'string', enum: TaskStatus.options },
      dueDate: { type: ['string', 'null'], description: 'AAAA-MM-DD.' },
      companyId: {
        type: ['string', 'null'],
        description: 'Empresa vinculada (id); null desvincula.',
      },
      personId: {
        type: ['string', 'null'],
        description: 'Pessoa vinculada (id); null desvincula.',
      },
      opportunityId: {
        type: ['string', 'null'],
        description: 'Oportunidade vinculada (id); null desvincula.',
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  permission: { resource: 'tasks', action: 'EDIT' },
  parse: zodParser(UpdateTaskArgs),
  async preview(ctx, args) {
    const task = await findTask(ctx, args.taskId)
    if (!task.ok) return task
    const before = task.value
    const fields = changeFields([
      ['Título', before.title, args.title],
      [
        'Descrição',
        excerpt(before.body),
        args.body === undefined ? undefined : excerpt(args.body),
      ],
      [
        'Status',
        TASK_STATUS_LABELS[before.status],
        args.status && TASK_STATUS_LABELS[args.status],
      ],
      ['Prazo', formatDate(before.dueDate), args.dueDate],
      ['Empresa (id)', before.companyId, args.companyId],
      ['Pessoa (id)', before.personId, args.personId],
      ['Oportunidade (id)', before.opportunityId, args.opportunityId],
    ])
    if (fields.length === 0) return err(nothingToChange())
    const base = await crmBase(ctx)
    return ok({
      title:
        args.status === 'DONE'
          ? `Concluir a tarefa “${before.title}”`
          : `Atualizar a tarefa “${before.title}”`,
      summary: `${fields.length} campo(s) alterado(s).`,
      fields,
      target: taskTarget(before, base),
    })
  },
  async execute(ctx, args) {
    const { taskId, ...dto } = args
    const task = await CrmTaskService.update(
      ctx.actorId,
      ctx.workspaceId,
      taskId,
      dto,
    )
    if (!task.ok) return task
    const base = await crmBase(ctx)
    return ok({
      data: compactTask(task.value, base, new Map()),
      summary: `Tarefa “${task.value.title}” atualizada`,
      target: taskTarget(task.value, base),
    })
  },
}

const TaskIdArgs = z.object({ taskId: z.string().min(1) })

export const crmDeleteTaskTool: SteelAiTool<z.output<typeof TaskIdArgs>> = {
  name: 'crm_delete_task',
  label: 'Excluindo tarefa',
  module: 'CRM',
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Exclui uma tarefa do CRM. Não há ferramenta para desfazer; se a tarefa foi feita, prefira crm_update_task com status DONE.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Id da tarefa (de crm_list_tasks).',
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  permission: { resource: 'tasks', action: 'DELETE' },
  parse: zodParser(TaskIdArgs),
  async preview(ctx, args) {
    const task = await findTask(ctx, args.taskId)
    if (!task.ok) return task
    const base = await crmBase(ctx)
    return ok({
      title: `Excluir a tarefa “${task.value.title}”`,
      summary: 'A tarefa sai das listas do CRM.',
      fields: afterFields([
        ['Status', TASK_STATUS_LABELS[task.value.status]],
        ['Prazo', formatDate(task.value.dueDate)],
      ]),
      target: taskTarget(task.value, base),
    })
  },
  async execute(ctx, args) {
    const task = await findTask(ctx, args.taskId)
    if (!task.ok) return task
    const removed = await CrmTaskService.remove(
      ctx.actorId,
      ctx.workspaceId,
      args.taskId,
    )
    if (!removed.ok) return removed
    return ok({
      data: { id: args.taskId, deleted: true },
      summary: `Tarefa “${task.value.title}” excluída`,
      target: { type: 'crm_task', id: args.taskId, label: task.value.title },
    })
  },
}

/* ================================== notes ================================= */

export function compactNote(note: CrmNoteDTO, base: string | null) {
  return {
    id: note.id,
    title: note.title,
    body: excerpt(note.body, 500),
    companyId: note.companyId,
    personId: note.personId,
    opportunityId: note.opportunityId,
    leadId: note.leadId,
    createdAt: note.createdAt,
    href: recordHref(base, 'note', note.id),
  }
}

function noteLabel(note: { title: string | null; body: string | null }) {
  return note.title || excerpt(note.body, 60) || 'Nota sem título'
}

function noteTarget(note: CrmNoteDTO, base: string | null) {
  return {
    type: 'crm_note',
    id: note.id,
    label: noteLabel(note),
    href: recordHref(base, 'note', note.id),
  }
}

const CreateNoteArgs = z
  .object({
    title: z.string().trim().max(200).optional(),
    body: z.string().max(20000).optional(),
    companyId: z.string().min(1).optional(),
    personId: z.string().min(1).optional(),
    opportunityId: z.string().min(1).optional(),
  })
  .refine((a) => Boolean(a.title || a.body), {
    message: 'Informe o título ou o texto da nota',
  })

export const crmCreateNoteTool: SteelAiTool<z.output<typeof CreateNoteArgs>> = {
  name: 'crm_create_note',
  label: 'Criando nota',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma nota no CRM, normalmente vinculada a uma empresa, pessoa ou oportunidade (ids).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string', description: 'Texto da nota.' },
      ...linkProperties,
    },
    additionalProperties: false,
  },
  permission: { resource: 'notes', action: 'CREATE' },
  parse: zodParser(CreateNoteArgs),
  async preview(_ctx, args) {
    return ok({
      title: `Criar a nota “${noteLabel({ title: args.title ?? null, body: args.body ?? null })}”`,
      summary: 'Uma nova nota entra no CRM.',
      fields: afterFields([
        ['Título', args.title],
        ['Texto', excerpt(args.body, 500)],
        ['Empresa (id)', args.companyId],
        ['Pessoa (id)', args.personId],
        ['Oportunidade (id)', args.opportunityId],
      ]),
      target: { type: 'crm_note', label: args.title || 'Nota' },
    })
  },
  async execute(ctx, args) {
    const note = await CrmNoteService.create(ctx.actorId, ctx.workspaceId, args)
    if (!note.ok) return note
    const base = await crmBase(ctx)
    return ok({
      data: compactNote(note.value, base),
      summary: `Nota “${noteLabel(note.value)}” criada`,
      target: noteTarget(note.value, base),
    })
  },
}

const UpdateNoteArgs = z
  .object({
    noteId: z.string().min(1),
    title: z.string().max(200).nullable().optional(),
    body: z.string().max(20000).nullable().optional(),
    companyId: z.string().min(1).nullable().optional(),
    personId: z.string().min(1).nullable().optional(),
    opportunityId: z.string().min(1).nullable().optional(),
  })
  .refine((a) => Object.keys(a).some((k) => k !== 'noteId'), {
    message: 'Informe ao menos um campo para alterar',
  })

export const crmUpdateNoteTool: SteelAiTool<z.output<typeof UpdateNoteArgs>> = {
  name: 'crm_update_note',
  label: 'Atualizando nota',
  module: 'CRM',
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera uma nota (título, texto, vínculos). O texto enviado substitui o atual inteiro; null limpa.',
  parameters: {
    type: 'object',
    properties: {
      noteId: {
        type: 'string',
        description:
          'Id da nota (de crm_get_record ou crm_get_record_timeline).',
      },
      title: { type: ['string', 'null'] },
      body: { type: ['string', 'null'] },
      companyId: {
        type: ['string', 'null'],
        description: 'Empresa vinculada (id); null desvincula.',
      },
      personId: {
        type: ['string', 'null'],
        description: 'Pessoa vinculada (id); null desvincula.',
      },
      opportunityId: {
        type: ['string', 'null'],
        description: 'Oportunidade vinculada (id); null desvincula.',
      },
    },
    required: ['noteId'],
    additionalProperties: false,
  },
  permission: { resource: 'notes', action: 'EDIT' },
  parse: zodParser(UpdateNoteArgs),
  async preview(ctx, args) {
    const note = await findNote(ctx, args.noteId)
    if (!note.ok) return note
    const before = note.value
    const fields = changeFields([
      ['Título', before.title, args.title],
      [
        'Texto',
        excerpt(before.body, 500),
        args.body === undefined ? undefined : excerpt(args.body, 500),
      ],
      ['Empresa (id)', before.companyId, args.companyId],
      ['Pessoa (id)', before.personId, args.personId],
      ['Oportunidade (id)', before.opportunityId, args.opportunityId],
    ])
    if (fields.length === 0) return err(nothingToChange())
    const base = await crmBase(ctx)
    return ok({
      title: `Atualizar a nota “${noteLabel(before)}”`,
      summary: `${fields.length} campo(s) alterado(s).`,
      fields,
      target: noteTarget(before, base),
    })
  },
  async execute(ctx, args) {
    const { noteId, ...dto } = args
    const note = await CrmNoteService.update(
      ctx.actorId,
      ctx.workspaceId,
      noteId,
      dto,
    )
    if (!note.ok) return note
    const base = await crmBase(ctx)
    return ok({
      data: compactNote(note.value, base),
      summary: `Nota “${noteLabel(note.value)}” atualizada`,
      target: noteTarget(note.value, base),
    })
  },
}

const NoteIdArgs = z.object({ noteId: z.string().min(1) })

export const crmDeleteNoteTool: SteelAiTool<z.output<typeof NoteIdArgs>> = {
  name: 'crm_delete_note',
  label: 'Excluindo nota',
  module: 'CRM',
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description: 'Exclui uma nota do CRM. Não há ferramenta para desfazer.',
  parameters: {
    type: 'object',
    properties: {
      noteId: {
        type: 'string',
        description:
          'Id da nota (de crm_get_record ou crm_get_record_timeline).',
      },
    },
    required: ['noteId'],
    additionalProperties: false,
  },
  permission: { resource: 'notes', action: 'DELETE' },
  parse: zodParser(NoteIdArgs),
  async preview(ctx, args) {
    const note = await findNote(ctx, args.noteId)
    if (!note.ok) return note
    const base = await crmBase(ctx)
    return ok({
      title: `Excluir a nota “${noteLabel(note.value)}”`,
      summary: 'A nota sai das listas do CRM.',
      fields: afterFields([['Texto', excerpt(note.value.body, 500)]]),
      target: noteTarget(note.value, base),
    })
  },
  async execute(ctx, args) {
    const note = await findNote(ctx, args.noteId)
    if (!note.ok) return note
    const removed = await CrmNoteService.remove(
      ctx.actorId,
      ctx.workspaceId,
      args.noteId,
    )
    if (!removed.ok) return removed
    return ok({
      data: { id: args.noteId, deleted: true },
      summary: `Nota “${noteLabel(note.value)}” excluída`,
      target: {
        type: 'crm_note',
        id: args.noteId,
        label: noteLabel(note.value),
      },
    })
  },
}

export const CRM_WORK_TOOLS = [
  crmListTasksTool,
  crmCreateTaskTool,
  crmUpdateTaskTool,
  crmDeleteTaskTool,
  crmCreateNoteTool,
  crmUpdateNoteTool,
  crmDeleteNoteTool,
]
