import { z } from 'zod'
import { ok } from '@/src/lib/result'
import { formatWaId } from '@/src/lib/whatsapp/phone'
import { WhatsAppConnectionService } from '@/src/services/whatsapp-connection.service'
import { WhatsAppGroupService } from '@/src/services/whatsapp-group.service'
import { WhatsAppTemplateService } from '@/src/services/whatsapp-template.service'
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

/** Read-only catalog tools: groups, message templates and connections. */

const MODULE = 'COMMUNICATION' as const

/* --------------------------------- groups --------------------------------- */

const GroupsArgs = z.object({
  query: z.string().trim().min(1).max(100).optional(),
  archived: z.boolean().default(false),
  limit: limitSchema,
  offset: offsetSchema,
})
type GroupsArgs = z.infer<typeof GroupsArgs>

export const zapGroupsListTool: SteelAiTool<GroupsArgs> = {
  name: 'zap_groups_list',
  label: 'Consultando grupos do WhatsApp',
  module: MODULE,
  kind: 'READ',
  description:
    'Lista os grupos do WhatsApp (só existem em conexões Z-API): nome, descrição, participantes e última mensagem. `query` filtra pelo nome; `archived` mostra os arquivados.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      archived: { type: 'boolean' },
      limit: limitParameter,
      offset: offsetParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'groups', action: 'VIEW' },
  parse: zodParser(GroupsArgs),
  async execute(ctx, args) {
    const groups = await WhatsAppGroupService.list(
      ctx.actorId,
      ctx.workspaceId,
      { archived: args.archived },
    )
    if (!groups.ok) return groups
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    const query = args.query
    const filtered = query
      ? groups.value.filter((g) => matches(g.name, query))
      : groups.value
    const page = paginate(filtered, args.offset, args.limit)
    return ok({
      data: {
        ...page,
        href: `${base.value}${ZAP_PAGES.groups}`,
        items: page.items.map((g) => ({
          id: g.id,
          name: g.name,
          description: truncate(g.description, 300),
          connectionId: g.connectionId,
          participantCount: g.participants.length,
          admins: g.participants
            .filter((p) => p.role !== 'MEMBER')
            .slice(0, 10)
            .map((p) => p.name ?? formatWaId(p.waId)),
          lastMessageAt: g.lastMessageAt,
          lastMessagePreview: truncate(g.lastMessagePreview, 200),
        })),
      },
      summary: `${page.total} grupo(s) encontrado(s)`,
    })
  },
}

/* -------------------------------- templates ------------------------------- */

const TEMPLATE_STATUSES = ['APPROVED', 'PENDING', 'REJECTED'] as const

const TemplatesArgs = z.object({
  status: z.enum(TEMPLATE_STATUSES).optional(),
  connectionId: idSchema.optional(),
  query: z.string().trim().min(1).max(100).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})
type TemplatesArgs = z.infer<typeof TemplatesArgs>

/** Text of the template BODY component, if any (Meta component shape). */
function templateBody(components: unknown[]): string | null {
  for (const component of components) {
    if (
      component &&
      typeof component === 'object' &&
      (component as { type?: unknown }).type === 'BODY' &&
      typeof (component as { text?: unknown }).text === 'string'
    ) {
      return (component as { text: string }).text
    }
  }
  return null
}

export const zapTemplatesListTool: SteelAiTool<TemplatesArgs> = {
  name: 'zap_templates_list',
  label: 'Consultando modelos de mensagem',
  module: MODULE,
  kind: 'READ',
  description:
    'Lista os modelos de mensagem (templates da Meta) com status de aprovação (APPROVED, PENDING, REJECTED), idioma, categoria e texto. Só modelo APROVADO pode ser enviado fora da janela de 24 h. Filtros: `status`, `connectionId`, `query` (nome).',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...TEMPLATE_STATUSES] },
      connectionId: {
        type: 'string',
        description: 'Id da conexão (de zap_connections_status).',
      },
      query: { type: 'string' },
      limit: limitParameter,
      offset: offsetParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'message-templates', action: 'VIEW' },
  parse: zodParser(TemplatesArgs),
  async execute(ctx, args) {
    const templates = await WhatsAppTemplateService.list(
      ctx.actorId,
      ctx.workspaceId,
    )
    if (!templates.ok) return templates
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    const query = args.query
    const filtered = templates.value.filter(
      (t) =>
        (!args.status || t.status === args.status) &&
        (!args.connectionId || t.connectionId === args.connectionId) &&
        (!query || matches(t.name, query)),
    )
    const page = paginate(filtered, args.offset, args.limit)
    const approved = filtered.filter((t) => t.status === 'APPROVED').length
    return ok({
      data: {
        ...page,
        href: `${base.value}${ZAP_PAGES.templates}`,
        items: page.items.map((t) => ({
          id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          connectionId: t.connectionId,
          body: truncate(templateBody(t.components), 500),
        })),
      },
      summary: `${page.total} modelo(s), ${approved} aprovado(s)`,
    })
  },
}

/* ------------------------------- connections ------------------------------ */

const ConnectionsArgs = z.object({}).strict()

const CONNECTION_STATUS_LABELS = {
  CONNECTING: 'Conectando',
  CONNECTED: 'Conectada',
  DISCONNECTED: 'Desconectada',
  ERROR: 'Com erro',
} as const

export const zapConnectionsStatusTool: SteelAiTool<
  z.infer<typeof ConnectionsArgs>
> = {
  name: 'zap_connections_status',
  label: 'Verificando conexões do WhatsApp',
  module: MODULE,
  kind: 'READ',
  description:
    'Status das conexões (números) de WhatsApp do workspace: provedor (META = API oficial, com janela de 24 h; ZAPI), número, status e o último erro.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  parse: zodParser(ConnectionsArgs),
  async execute(ctx) {
    const connections = await WhatsAppConnectionService.list(
      ctx.actorId,
      ctx.workspaceId,
    )
    if (!connections.ok) return connections
    const base = await zapBasePath(ctx.workspaceId)
    if (!base.ok) return base
    const connected = connections.value.filter(
      (c) => c.status === 'CONNECTED',
    ).length
    return ok({
      data: {
        href: `${base.value}${ZAP_PAGES.settings}`,
        items: connections.value.map((c) => ({
          id: c.id,
          label: c.label,
          provider: c.provider,
          phoneNumber: c.phoneNumber,
          status: c.status,
          statusLabel: CONNECTION_STATUS_LABELS[c.status],
          error: truncate(c.statusError, 300),
        })),
      },
      summary: `${connected} de ${connections.value.length} conexão(ões) conectada(s)`,
    })
  },
}
