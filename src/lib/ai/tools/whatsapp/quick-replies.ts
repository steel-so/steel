import { z } from 'zod'
import { whatsappQuickReplyNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { WhatsAppQuickReplyService } from '@/src/services/whatsapp-quick-reply.service'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'
import type { AiToolContext, SteelAiTool } from '../types'
import {
  idSchema,
  limitParameter,
  limitSchema,
  matches,
  offsetParameter,
  offsetSchema,
  paginate,
  truncate,
  ZAP_PAGES,
  zapBasePath,
  zodParser,
} from './shared'

/** Quick replies (canned messages agents insert with `/shortcut`). */

const MODULE = 'COMMUNICATION' as const

function compactQuickReply(reply: WhatsAppQuickReplyDTO) {
  return {
    id: reply.id,
    shortcut: reply.shortcut,
    title: reply.title,
    body: truncate(reply.body, 500),
    hasMedia: Boolean(reply.mediaUrl),
  }
}

function quickReplyTarget(
  reply: Pick<WhatsAppQuickReplyDTO, 'id' | 'title'>,
  base: string,
) {
  return {
    type: 'whatsapp_quick_reply',
    id: reply.id,
    label: reply.title,
    href: `${base}${ZAP_PAGES.quickReplies}`,
  }
}

async function listAll(ctx: AiToolContext) {
  return WhatsAppQuickReplyService.list(ctx.actorId, ctx.workspaceId)
}

async function loadQuickReply(
  ctx: AiToolContext,
  id: string,
): Promise<Result<{ reply: WhatsAppQuickReplyDTO; base: string }>> {
  const list = await listAll(ctx)
  if (!list.ok) return list
  const reply = list.value.find((r) => r.id === id)
  if (!reply) return err(whatsappQuickReplyNotFound())
  const base = await zapBasePath(ctx.workspaceId)
  if (!base.ok) return base
  return ok({ reply, base: base.value })
}

/* ---------------------------------- list ---------------------------------- */

const ListArgs = z.object({
  query: z.string().trim().min(1).max(100).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})
type ListArgs = z.infer<typeof ListArgs>

export const zapQuickRepliesListTool: SteelAiTool<ListArgs> = {
  name: 'zap_quick_replies_list',
  label: 'Consultando mensagens rápidas',
  module: MODULE,
  kind: 'READ',
  description:
    'Lista as mensagens rápidas do WhatsApp (atalho, título e texto). `query` busca em atalho, título e texto.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: limitParameter,
      offset: offsetParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'quick-replies', action: 'VIEW' },
  parse: zodParser(ListArgs),
  async execute(ctx, args) {
    const list = await listAll(ctx)
    if (!list.ok) return list
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    const query = args.query
    const filtered = query
      ? list.value.filter(
          (r) =>
            matches(r.shortcut, query) ||
            matches(r.title, query) ||
            matches(r.body, query),
        )
      : list.value
    const page = paginate(filtered, args.offset, args.limit)
    return ok({
      data: {
        ...page,
        href: `${base.value}${ZAP_PAGES.quickReplies}`,
        items: page.items.map(compactQuickReply),
      },
      summary: `${page.total} mensagem(ns) rápida(s)`,
    })
  },
}

/* --------------------------------- create --------------------------------- */

const CreateArgs = z.object({
  shortcut: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4096),
})
type CreateArgs = z.infer<typeof CreateArgs>

export const zapQuickReplyCreateTool: SteelAiTool<CreateArgs> = {
  name: 'zap_quick_reply_create',
  label: 'Criando mensagem rápida',
  module: MODULE,
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma mensagem rápida do WhatsApp: `shortcut` (atalho, sem a barra), `title` e `body` (texto).',
  parameters: {
    type: 'object',
    properties: {
      shortcut: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['shortcut', 'title', 'body'],
    additionalProperties: false,
  },
  permission: { resource: 'quick-replies', action: 'CREATE' },
  parse: zodParser(CreateArgs),
  async preview(ctx, args) {
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      title: `Criar a mensagem rápida “${args.title}”`,
      summary: `Atalho /${args.shortcut}.`,
      fields: [
        { label: 'Atalho', after: args.shortcut },
        { label: 'Título', after: args.title },
        { label: 'Texto', after: args.body },
      ],
      target: {
        type: 'whatsapp_quick_reply',
        label: args.title,
        href: `${base.value}${ZAP_PAGES.quickReplies}`,
      },
    })
  },
  async execute(ctx, args) {
    const created = await WhatsAppQuickReplyService.create(
      ctx.actorId,
      ctx.workspaceId,
      args,
    )
    if (!created.ok) return created
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: compactQuickReply(created.value),
      summary: `Mensagem rápida “${created.value.title}” criada`,
      target: quickReplyTarget(created.value, base.value),
    })
  },
}

/* --------------------------------- update --------------------------------- */

const UpdateArgs = z
  .object({
    quickReplyId: idSchema,
    shortcut: z.string().trim().min(1).max(50).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(4096).optional(),
  })
  .refine(
    (v) =>
      v.shortcut !== undefined || v.title !== undefined || v.body !== undefined,
    { message: 'Informe ao menos um campo para alterar' },
  )
type UpdateArgs = z.infer<typeof UpdateArgs>

export const zapQuickReplyUpdateTool: SteelAiTool<UpdateArgs> = {
  name: 'zap_quick_reply_update',
  label: 'Atualizando mensagem rápida',
  module: MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera atalho, título e/ou texto de uma mensagem rápida (omitir = sem alteração).',
  parameters: {
    type: 'object',
    properties: {
      quickReplyId: {
        type: 'string',
        description: 'Id da mensagem rápida (de zap_quick_replies_list).',
      },
      shortcut: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['quickReplyId'],
    additionalProperties: false,
  },
  permission: { resource: 'quick-replies', action: 'EDIT' },
  parse: zodParser(UpdateArgs),
  async preview(ctx, args) {
    const loaded = await loadQuickReply(ctx, args.quickReplyId)
    if (!loaded.ok) return loaded
    const { reply, base } = loaded.value
    const fields: { label: string; before: string; after: string }[] = []
    if (args.shortcut !== undefined)
      fields.push({
        label: 'Atalho',
        before: reply.shortcut,
        after: args.shortcut,
      })
    if (args.title !== undefined)
      fields.push({ label: 'Título', before: reply.title, after: args.title })
    if (args.body !== undefined)
      fields.push({ label: 'Texto', before: reply.body, after: args.body })
    return ok({
      title: `Atualizar a mensagem rápida “${reply.title}”`,
      summary: `${fields.length} campo(s) alterado(s).`,
      fields,
      target: quickReplyTarget(reply, base),
    })
  },
  async execute(ctx, args) {
    const { quickReplyId, ...changes } = args
    const updated = await WhatsAppQuickReplyService.update(
      ctx.actorId,
      ctx.workspaceId,
      quickReplyId,
      changes,
    )
    if (!updated.ok) return updated
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: compactQuickReply(updated.value),
      summary: `Mensagem rápida “${updated.value.title}” atualizada`,
      target: quickReplyTarget(updated.value, base.value),
    })
  },
}

/* --------------------------------- delete --------------------------------- */

const DeleteArgs = z.object({ quickReplyId: idSchema })
type DeleteArgs = z.infer<typeof DeleteArgs>

export const zapQuickReplyDeleteTool: SteelAiTool<DeleteArgs> = {
  name: 'zap_quick_reply_delete',
  label: 'Excluindo mensagem rápida',
  module: MODULE,
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Exclui definitivamente uma mensagem rápida do WhatsApp (o atalho deixa de existir para toda a equipe).',
  parameters: {
    type: 'object',
    properties: {
      quickReplyId: {
        type: 'string',
        description: 'Id da mensagem rápida (de zap_quick_replies_list).',
      },
    },
    required: ['quickReplyId'],
    additionalProperties: false,
  },
  permission: { resource: 'quick-replies', action: 'DELETE' },
  parse: zodParser(DeleteArgs),
  async preview(ctx, args) {
    const loaded = await loadQuickReply(ctx, args.quickReplyId)
    if (!loaded.ok) return loaded
    const { reply, base } = loaded.value
    return ok({
      title: `Excluir a mensagem rápida “${reply.title}”`,
      summary: `O atalho /${reply.shortcut} deixa de existir. Não pode ser desfeito.`,
      fields: [
        { label: 'Texto', before: truncate(reply.body, 500), after: null },
      ],
      target: quickReplyTarget(reply, base),
    })
  },
  async execute(ctx, args) {
    const loaded = await loadQuickReply(ctx, args.quickReplyId)
    if (!loaded.ok) return loaded
    const removed = await WhatsAppQuickReplyService.remove(
      ctx.actorId,
      ctx.workspaceId,
      args.quickReplyId,
    )
    if (!removed.ok) return removed
    const { reply, base } = loaded.value
    return ok({
      data: { id: reply.id, deleted: true },
      summary: `Mensagem rápida “${reply.title}” excluída`,
      target: quickReplyTarget(reply, base),
    })
  },
}
