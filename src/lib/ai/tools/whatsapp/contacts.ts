import { z } from 'zod'
import { conflict, whatsappContactNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { toWhatsAppContactDTO } from '@/src/mappers/whatsapp-contact.mapper'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { assertModuleMember } from '@/src/services/authz'
import { WhatsAppContactService } from '@/src/services/whatsapp-contact.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import type { WhatsAppContactDTO } from '@/types/whatsapp-contact'
import type { AiToolContext, SteelAiTool } from '../types'
import {
  conversationHref,
  idSchema,
  limitParameter,
  limitSchema,
  offsetParameter,
  offsetSchema,
  paginate,
  STATUS_LABELS,
  truncate,
  ZAP_PAGES,
  zapBasePath,
  zodParser,
} from './shared'

/** Contact tools (no tags in this domain — only name/description/number). */

const MODULE = 'COMMUNICATION' as const

function label(contact: Pick<WhatsAppContactDTO, 'name' | 'waId'>): string {
  return contact.name
    ? `${contact.name} (+${contact.waId})`
    : `+${contact.waId}`
}

function compactContact(contact: WhatsAppContactDTO) {
  return {
    id: contact.id,
    name: contact.name,
    waId: contact.waId,
    description: truncate(contact.description, 300),
    optedOut: Boolean(contact.broadcastOptedOutAt),
    optedOutAt: contact.broadcastOptedOutAt,
    conversationCount: contact.conversationCount,
    createdAt: contact.createdAt,
  }
}

function contactTarget(contact: WhatsAppContactDTO, base: string) {
  return {
    type: 'whatsapp_contact',
    id: contact.id,
    label: label(contact),
    href: `${base}${ZAP_PAGES.contacts}`,
  }
}

/**
 * The contact service has no single-record read: this does the same
 * authorization (module enabled + `contacts:VIEW`), reads the row by id
 * within the workspace and takes the service's listing (searched by the
 * number) for the conversation count.
 */
async function loadContact(
  ctx: AiToolContext,
  id: string,
): Promise<Result<{ contact: WhatsAppContactDTO; base: string }>> {
  const membership = await assertModuleMember(
    ctx.actorId,
    ctx.workspaceId,
    MODULE,
    { resource: 'contacts', action: 'VIEW' },
  )
  if (!membership.ok) return membership
  const found = await WhatsAppContactRepository.findById(id, ctx.workspaceId)
  if (!found.ok) return found
  if (!found.value) return err(whatsappContactNotFound())
  const listed = await WhatsAppContactService.list(
    ctx.actorId,
    ctx.workspaceId,
    { search: found.value.waId },
  )
  if (!listed.ok) return listed
  const base = await zapBasePath(ctx.workspaceId)
  if (!base.ok) return base
  const contact =
    listed.value.find((c) => c.id === id) ?? toWhatsAppContactDTO(found.value)
  return ok({ contact, base: base.value })
}

/* --------------------------------- search --------------------------------- */

const SearchArgs = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  optedOut: z.boolean().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})
type SearchArgs = z.infer<typeof SearchArgs>

export const zapContactsSearchTool: SteelAiTool<SearchArgs> = {
  name: 'zap_contacts_search',
  label: 'Buscando contatos do WhatsApp',
  module: MODULE,
  kind: 'READ',
  description:
    'Busca contatos do WhatsApp por nome ou número (`query`, opcional), em ordem alfabética. `optedOut` filtra quem pediu para sair das transmissões (LGPD). Pagina com `limit`/`offset`.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Trecho do nome ou do número.' },
      optedOut: { type: 'boolean' },
      limit: limitParameter,
      offset: offsetParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'contacts', action: 'VIEW' },
  parse: zodParser(SearchArgs),
  async execute(ctx, args) {
    const list = await WhatsAppContactService.list(
      ctx.actorId,
      ctx.workspaceId,
      { search: args.query },
    )
    if (!list.ok) return list
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base

    const filtered =
      args.optedOut === undefined
        ? list.value
        : list.value.filter(
            (c) => Boolean(c.broadcastOptedOutAt) === args.optedOut,
          )
    const page = paginate(filtered, args.offset, args.limit)
    return ok({
      data: {
        ...page,
        href: `${base.value}${ZAP_PAGES.contacts}`,
        items: page.items.map(compactContact),
      },
      summary: `${page.total} contato(s) encontrado(s)`,
    })
  },
}

/* ----------------------------------- get ---------------------------------- */

const ContactArgs = z.object({ contactId: idSchema })
type ContactArgs = z.infer<typeof ContactArgs>

const contactParameters = {
  type: 'object',
  properties: {
    contactId: {
      type: 'string',
      description: 'Id do contato (de zap_contacts_search).',
    },
  },
  required: ['contactId'],
  additionalProperties: false,
}

export const zapContactGetTool: SteelAiTool<ContactArgs> = {
  name: 'zap_contact_get',
  label: 'Abrindo contato do WhatsApp',
  module: MODULE,
  kind: 'READ',
  description:
    'Dados de um contato do WhatsApp (nome, número, descrição, opt-out LGPD) e as conversas dele (até 10, mais recentes).',
  parameters: contactParameters,
  permission: { resource: 'contacts', action: 'VIEW' },
  parse: zodParser(ContactArgs),
  async execute(ctx, args) {
    const loaded = await loadContact(ctx, args.contactId)
    if (!loaded.ok) return loaded
    const { contact, base } = loaded.value

    // Conversations need `conversations:VIEW`; without it the contact still shows.
    const conversations = await WhatsAppConversationService.list(
      ctx.actorId,
      ctx.workspaceId,
    )
    const own = conversations.ok
      ? conversations.value
          .filter((c) => c.contactId === contact.id)
          .slice(0, 10)
          .map((c) => ({
            id: c.id,
            status: STATUS_LABELS[c.status],
            lastMessageAt: c.lastMessageAt,
            href: conversationHref(base, c.id),
          }))
      : null

    return ok({
      data: { contact: compactContact(contact), conversations: own },
      summary: `Contato ${label(contact)}`,
      target: contactTarget(contact, base),
    })
  },
}

/* --------------------------------- create --------------------------------- */

const CreateArgs = z.object({
  waId: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ''))
    .pipe(z.string().min(8).max(20)),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(500).optional(),
})
type CreateArgs = z.infer<typeof CreateArgs>

export const zapContactCreateTool: SteelAiTool<CreateArgs> = {
  name: 'zap_contact_create',
  label: 'Criando contato do WhatsApp',
  module: MODULE,
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria um contato do WhatsApp. `waId` = número com DDI e DDD, só dígitos (ex.: 5511999998888). `name` e `description` são opcionais. Não envia nada ao contato.',
  parameters: {
    type: 'object',
    properties: {
      waId: { type: 'string', description: 'Número com DDI e DDD.' },
      name: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['waId'],
    additionalProperties: false,
  },
  permission: { resource: 'contacts', action: 'CREATE' },
  parse: zodParser(CreateArgs),
  async preview(ctx, args) {
    const existing = await WhatsAppContactService.list(
      ctx.actorId,
      ctx.workspaceId,
      { search: args.waId },
    )
    if (!existing.ok) return existing
    const duplicate = existing.value.find((c) => c.waId === args.waId)
    if (duplicate) {
      return err(
        conflict(`Já existe um contato com este número: ${label(duplicate)}`),
      )
    }
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      title: `Criar o contato ${label({ name: args.name ?? null, waId: args.waId })}`,
      summary: 'Nenhuma mensagem é enviada ao contato.',
      fields: [
        { label: 'Número', after: `+${args.waId}` },
        { label: 'Nome', after: args.name ?? null },
        { label: 'Descrição', after: args.description ?? null },
      ],
      target: {
        type: 'whatsapp_contact',
        label: args.name ?? `+${args.waId}`,
        href: `${base.value}${ZAP_PAGES.contacts}`,
      },
    })
  },
  async execute(ctx, args) {
    const created = await WhatsAppContactService.create(
      ctx.actorId,
      ctx.workspaceId,
      args,
    )
    if (!created.ok) return created
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: compactContact(created.value),
      summary: `Contato ${label(created.value)} criado`,
      target: contactTarget(created.value, base.value),
    })
  },
}

/* --------------------------------- update --------------------------------- */

const UpdateArgs = z
  .object({
    contactId: idSchema,
    name: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'Informe ao menos um campo para alterar',
  })
type UpdateArgs = z.infer<typeof UpdateArgs>

const clean = (value: string | null | undefined) =>
  value === undefined ? undefined : value || null

export const zapContactUpdateTool: SteelAiTool<UpdateArgs> = {
  name: 'zap_contact_update',
  label: 'Atualizando contato do WhatsApp',
  module: MODULE,
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera nome e/ou descrição de um contato do WhatsApp. Omitir um campo = sem alteração; `null` ou "" = apagar. O número não pode ser alterado.',
  parameters: {
    type: 'object',
    properties: {
      contactId: {
        type: 'string',
        description: 'Id do contato (de zap_contacts_search).',
      },
      name: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
    },
    required: ['contactId'],
    additionalProperties: false,
  },
  permission: { resource: 'contacts', action: 'EDIT' },
  parse: zodParser(UpdateArgs),
  async preview(ctx, args) {
    const loaded = await loadContact(ctx, args.contactId)
    if (!loaded.ok) return loaded
    const { contact, base } = loaded.value
    const name = clean(args.name)
    const description = clean(args.description)
    return ok({
      title: `Atualizar o contato ${label(contact)}`,
      summary: 'Nenhuma mensagem é enviada ao contato.',
      fields: [
        ...(name !== undefined
          ? [{ label: 'Nome', before: contact.name, after: name }]
          : []),
        ...(description !== undefined
          ? [
              {
                label: 'Descrição',
                before: contact.description,
                after: description,
              },
            ]
          : []),
      ],
      target: contactTarget(contact, base),
    })
  },
  async execute(ctx, args) {
    const updated = await WhatsAppContactService.update(
      ctx.actorId,
      ctx.workspaceId,
      args.contactId,
      { name: clean(args.name), description: clean(args.description) },
    )
    if (!updated.ok) return updated
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: compactContact(updated.value),
      summary: `Contato ${label(updated.value)} atualizado`,
      target: contactTarget(updated.value, base.value),
    })
  },
}

/* --------------------------------- delete --------------------------------- */

export const zapContactDeleteTool: SteelAiTool<ContactArgs> = {
  name: 'zap_contact_delete',
  label: 'Excluindo contato do WhatsApp',
  module: MODULE,
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Exclui um contato do WhatsApp. ATENÇÃO: as conversas e mensagens dele também são apagadas. Não envia nada ao contato.',
  parameters: contactParameters,
  permission: { resource: 'contacts', action: 'DELETE' },
  parse: zodParser(ContactArgs),
  async preview(ctx, args) {
    const loaded = await loadContact(ctx, args.contactId)
    if (!loaded.ok) return loaded
    const { contact, base } = loaded.value
    return ok({
      title: `Excluir o contato ${label(contact)}`,
      summary:
        contact.conversationCount > 0
          ? `Também apaga ${contact.conversationCount} conversa(s) e todas as mensagens dele. Não pode ser desfeito.`
          : 'Não pode ser desfeito.',
      fields: [
        { label: 'Contato', before: label(contact), after: null },
        {
          label: 'Conversas',
          before: String(contact.conversationCount),
          after: null,
        },
      ],
      target: contactTarget(contact, base),
    })
  },
  async execute(ctx, args) {
    const loaded = await loadContact(ctx, args.contactId)
    if (!loaded.ok) return loaded
    const removed = await WhatsAppContactService.remove(
      ctx.actorId,
      ctx.workspaceId,
      args.contactId,
    )
    if (!removed.ok) return removed
    const { contact, base } = loaded.value
    return ok({
      data: { id: contact.id, deleted: true },
      summary: `Contato ${label(contact)} excluído`,
      target: contactTarget(contact, base),
    })
  },
}
