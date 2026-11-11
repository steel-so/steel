import type { ModuleKind } from '@prisma/client'
import type { PermissionResource } from '@/src/lib/permissions'

/**
 * Catalog of the entities the global search (Ctrl+K) indexes. Each entry
 * says which module must be enabled, which RBAC resource grants VIEW, how
 * the palette labels its group and in which order the groups appear.
 *
 * `audience` on an indexed document (see `search_documents.audience`):
 * - `PUBLIC`  — anyone who passes the module + resource checks;
 * - `AGENTS`  — ServiceDesk agents only (directory, internal KB);
 * - `PARTIES` — agents, or a requester listed in `user_ids` (tickets).
 */

export const SEARCH_ENTITY_TYPES = [
  'sd-ticket',
  'sd-kb-article',
  'sd-customer',
  'sd-contact',
  'sd-config-item',
  'crm-lead',
  'crm-opportunity',
  'crm-person',
  'crm-company',
  'crm-task',
  'crm-proposal',
  'crm-document',
  'zap-conversation',
  'zap-contact',
  'member',
  'whiteboard',
] as const

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number]

export type SearchModule = ModuleKind

export const SEARCH_AUDIENCES = ['PUBLIC', 'AGENTS', 'PARTIES'] as const
export type SearchAudience = (typeof SEARCH_AUDIENCES)[number]

export interface SearchEntityMeta {
  /** Module that must be enabled; `null` = platform (workspace members). */
  module: ModuleKind | null
  /** RBAC resource whose VIEW is required; `null` = membership is enough. */
  resource: PermissionResource | null
  /** pt-BR group label in the palette. */
  group: string
  /** pt-BR singular label (a11y, AI tool output). */
  label: string
}

export const SEARCH_ENTITIES: Record<SearchEntityType, SearchEntityMeta> = {
  'sd-ticket': {
    module: 'SERVICE_DESK',
    resource: 'sd-tickets',
    group: 'Chamados',
    label: 'Chamado',
  },
  'sd-kb-article': {
    module: 'SERVICE_DESK',
    resource: 'sd-knowledge',
    group: 'Base de conhecimento',
    label: 'Artigo',
  },
  'sd-customer': {
    module: 'SERVICE_DESK',
    resource: 'sd-customers',
    group: 'Clientes e empresas',
    label: 'Cliente',
  },
  'sd-contact': {
    module: 'SERVICE_DESK',
    resource: 'sd-contacts',
    group: 'Contatos do ServiceDesk',
    label: 'Contato',
  },
  'sd-config-item': {
    module: 'SERVICE_DESK',
    resource: 'sd-config-items',
    group: 'Itens de configuração',
    label: 'Item de configuração',
  },
  'crm-lead': {
    module: 'CRM',
    resource: 'leads',
    group: 'Leads',
    label: 'Lead',
  },
  'crm-opportunity': {
    module: 'CRM',
    resource: 'opportunities',
    group: 'Oportunidades',
    label: 'Oportunidade',
  },
  'crm-person': {
    module: 'CRM',
    resource: 'people',
    group: 'Pessoas',
    label: 'Pessoa',
  },
  'crm-company': {
    module: 'CRM',
    resource: 'companies',
    group: 'Empresas',
    label: 'Empresa',
  },
  'crm-task': {
    module: 'CRM',
    resource: 'tasks',
    group: 'Tarefas',
    label: 'Tarefa',
  },
  'crm-proposal': {
    module: 'CRM',
    resource: 'documents',
    group: 'Propostas',
    label: 'Proposta',
  },
  'crm-document': {
    module: 'CRM',
    resource: 'documents',
    group: 'Documentos',
    label: 'Documento',
  },
  'zap-conversation': {
    module: 'COMMUNICATION',
    resource: 'conversations',
    group: 'Conversas',
    label: 'Conversa',
  },
  'zap-contact': {
    module: 'COMMUNICATION',
    resource: 'contacts',
    group: 'Contatos do WhatsApp',
    label: 'Contato',
  },
  member: {
    module: null,
    resource: null,
    group: 'Membros',
    label: 'Membro',
  },
  // Gated by the workspace switch (Ajustes › Quadro-branco), not a module.
  whiteboard: {
    module: null,
    resource: null,
    group: 'Quadros-brancos',
    label: 'Quadro-branco',
  },
}

export function isSearchEntityType(value: string): value is SearchEntityType {
  return (SEARCH_ENTITY_TYPES as readonly string[]).includes(value)
}
