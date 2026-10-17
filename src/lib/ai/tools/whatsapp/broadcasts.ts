import { z } from 'zod'
import {
  whatsappBroadcastNoRecipients,
  whatsappConnectionNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { WhatsAppBroadcastService } from '@/src/services/whatsapp-broadcast.service'
import { WhatsAppConnectionService } from '@/src/services/whatsapp-connection.service'
import { WhatsAppContactService } from '@/src/services/whatsapp-contact.service'
import type { WhatsAppBroadcastListDTO } from '@/types/whatsapp-broadcast'
import type { SteelAiTool } from '../types'
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

/**
 * Broadcasts (transmissões): read lists/delivery stats and create a DRAFT.
 * Starting a broadcast is deliberately not offered — sending to many
 * customers stays a manual step in the UI.
 */

const MODULE = 'COMMUNICATION' as const

const STATUSES = ['DRAFT', 'QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const

function stats(list: WhatsAppBroadcastListDTO) {
  return {
    recipients: list.recipientCount,
    sent: list.sentCount,
    failed: list.failedCount,
    skippedOptOut: list.skippedCount,
    pending: Math.max(
      0,
      list.recipientCount -
        list.sentCount -
        list.failedCount -
        list.skippedCount,
    ),
  }
}

function compactBroadcast(list: WhatsAppBroadcastListDTO) {
  return {
    id: list.id,
    name: list.name,
    status: list.status,
    connectionId: list.connectionId,
    message: truncate(list.messageBody, 300),
    mediaType: list.mediaType,
    scheduledAt: list.scheduledAt,
    createdAt: list.createdAt,
    stats: stats(list),
  }
}

function broadcastTarget(list: { id: string; name: string }, base: string) {
  return {
    type: 'whatsapp_broadcast',
    id: list.id,
    label: list.name,
    href: `${base}${ZAP_PAGES.broadcasts}`,
  }
}

/* ---------------------------------- list ---------------------------------- */

const ListArgs = z.object({
  status: z.enum(STATUSES).optional(),
  query: z.string().trim().min(1).max(100).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})
type ListArgs = z.infer<typeof ListArgs>

export const zapBroadcastsListTool: SteelAiTool<ListArgs> = {
  name: 'zap_broadcasts_list',
  label: 'Consultando transmissões',
  module: MODULE,
  kind: 'READ',
  description:
    'Lista as transmissões (envios em massa) do WhatsApp com estatísticas de entrega: destinatários, enviados, falhas, ignorados por opt-out LGPD e pendentes. Filtros: `status` (DRAFT, QUEUED, RUNNING, DONE, FAILED) e `query` (nome).',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...STATUSES] },
      query: { type: 'string' },
      limit: limitParameter,
      offset: offsetParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'broadcasts', action: 'VIEW' },
  parse: zodParser(ListArgs),
  async execute(ctx, args) {
    const list = await WhatsAppBroadcastService.list(
      ctx.actorId,
      ctx.workspaceId,
    )
    if (!list.ok) return list
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    const query = args.query
    const filtered = list.value.filter(
      (b) =>
        (!args.status || b.status === args.status) &&
        (!query || matches(b.name, query)),
    )
    const page = paginate(filtered, args.offset, args.limit)
    return ok({
      data: {
        ...page,
        href: `${base.value}${ZAP_PAGES.broadcasts}`,
        items: page.items.map(compactBroadcast),
      },
      summary: `${page.total} transmissão(ões) encontrada(s)`,
    })
  },
}

/* ----------------------------------- get ---------------------------------- */

const GetArgs = z.object({ broadcastId: idSchema })
type GetArgs = z.infer<typeof GetArgs>

/** Failed recipients shown to the model (with the provider error). */
const MAX_FAILURES = 20

export const zapBroadcastGetTool: SteelAiTool<GetArgs> = {
  name: 'zap_broadcast_get',
  label: 'Abrindo transmissão',
  module: MODULE,
  kind: 'READ',
  description:
    'Detalhes de uma transmissão do WhatsApp: mensagem, status, estatísticas de entrega e até 20 destinatários com falha (com o erro do provedor).',
  parameters: {
    type: 'object',
    properties: {
      broadcastId: {
        type: 'string',
        description: 'Id da transmissão (de zap_broadcasts_list).',
      },
    },
    required: ['broadcastId'],
    additionalProperties: false,
  },
  permission: { resource: 'broadcasts', action: 'VIEW' },
  parse: zodParser(GetArgs),
  async execute(ctx, args) {
    const detail = await WhatsAppBroadcastService.get(
      ctx.actorId,
      ctx.workspaceId,
      args.broadcastId,
    )
    if (!detail.ok) return detail
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    const failures = detail.value.recipients
      .filter((r) => r.status === 'FAILED')
      .slice(0, MAX_FAILURES)
      .map((r) => ({
        contact: r.contactName ?? `+${r.contactWaId}`,
        error: truncate(r.errorMessage, 200),
      }))
    const s = stats(detail.value)
    return ok({
      data: {
        ...compactBroadcast(detail.value),
        message: truncate(detail.value.messageBody),
        failures,
      },
      summary: `${detail.value.name}: ${s.sent}/${s.recipients} enviada(s), ${s.failed} falha(s)`,
      target: broadcastTarget(detail.value, base.value),
    })
  },
}

/* ------------------------------ create (draft) ---------------------------- */

const CreateArgs = z.object({
  connectionId: idSchema,
  name: z.string().trim().min(1).max(120),
  messageBody: z.string().trim().min(1).max(4096),
  contactIds: z.array(idSchema).min(1).max(1000),
})
type CreateArgs = z.infer<typeof CreateArgs>

export const zapBroadcastCreateDraftTool: SteelAiTool<CreateArgs> = {
  name: 'zap_broadcast_create_draft',
  label: 'Criando rascunho de transmissão',
  module: MODULE,
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma transmissão do WhatsApp como RASCUNHO (texto, sem mídia) para até 1000 contatos (`contactIds`, obtidos com zap_contacts_search) na conexão `connectionId`. Nada é enviado: o disparo é feito por uma pessoa no app do Steel (Comunicação › Transmissões). Contatos descadastrados (LGPD) ficam de fora automaticamente.',
  parameters: {
    type: 'object',
    properties: {
      connectionId: {
        type: 'string',
        description:
          'Id da conexão que vai enviar (de zap_connections_status).',
      },
      name: { type: 'string', description: 'Nome interno da transmissão.' },
      messageBody: { type: 'string', description: 'Texto da mensagem.' },
      contactIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 1000,
      },
    },
    required: ['connectionId', 'name', 'messageBody', 'contactIds'],
    additionalProperties: false,
  },
  permission: { resource: 'broadcasts', action: 'CREATE' },
  parse: zodParser(CreateArgs),
  async preview(ctx, args) {
    const [connections, contacts, base] = await Promise.all([
      WhatsAppConnectionService.list(ctx.actorId, ctx.workspaceId),
      WhatsAppContactService.list(ctx.actorId, ctx.workspaceId, {}),
      zapBasePath(ctx.workspaceId),
    ])
    if (!connections.ok) return connections
    if (!contacts.ok) return contacts
    if (!base.ok) return base

    const connection = connections.value.find((c) => c.id === args.connectionId)
    if (!connection) return err(whatsappConnectionNotFound())

    const byId = new Map(contacts.value.map((c) => [c.id, c]))
    const requested = Array.from(new Set(args.contactIds))
    const found = requested.flatMap((id) => {
      const contact = byId.get(id)
      return contact ? [contact] : []
    })
    const optedOut = found.filter((c) => c.broadcastOptedOutAt).length
    const eligible = found.length - optedOut
    const unknown = requested.length - found.length
    if (eligible === 0) return err(whatsappBroadcastNoRecipients())

    const excluded = [
      optedOut > 0 ? `${optedOut} descadastrado(s) (LGPD)` : null,
      unknown > 0 ? `${unknown} não encontrado(s)` : null,
    ].filter(Boolean)
    return ok({
      title: `Criar o rascunho de transmissão “${args.name}”`,
      summary: `Fica como rascunho: nada é enviado até alguém iniciar o disparo em Transmissões.${excluded.length ? ` Ficam de fora: ${excluded.join(', ')}.` : ''}`,
      fields: [
        {
          label: 'Conexão',
          after: `${connection.label} (${connection.phoneNumber})`,
        },
        { label: 'Destinatários', after: String(eligible) },
        { label: 'Mensagem', after: args.messageBody },
        { label: 'Status', after: 'Rascunho' },
      ],
      target: {
        type: 'whatsapp_broadcast',
        label: args.name,
        href: `${base.value}${ZAP_PAGES.broadcasts}`,
      },
    })
  },
  async execute(ctx, args) {
    const created = await WhatsAppBroadcastService.create(
      ctx.actorId,
      ctx.workspaceId,
      {
        connectionId: args.connectionId,
        name: args.name,
        messageBody: args.messageBody,
        contactIds: args.contactIds,
      },
    )
    if (!created.ok) return created
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    return ok({
      data: compactBroadcast(created.value),
      summary: `Rascunho “${created.value.name}” criado com ${created.value.recipientCount} destinatário(s)`,
      target: broadcastTarget(created.value, base.value),
    })
  },
}
