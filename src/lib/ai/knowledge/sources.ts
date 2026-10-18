import type { ModuleKind } from '@prisma/client'
import type { PermissionResource } from '@/src/lib/permissions'

/**
 * Sources of the Steel AI knowledge index (ADR 0037). Isomorphic: read by
 * the indexer, the search service, the `steel_search` tool and the chat UI
 * (citation labels).
 *
 * Who may see a source's chunks is decided at query time by
 * `AiKnowledgeSearchService.resolveAccess`, with the same rule as the
 * source's own service: module enabled → RBAC `VIEW` of `resource` →
 * the per-source extra gate (`gate`), then the chunk `audience`.
 */

export const KNOWLEDGE_SOURCE_TYPES = [
  'sd-kb-article',
  'wiki-page',
  'sd-ticket',
  'zap-knowledge-doc',
  'crm-note',
  'crm-proposal',
] as const

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number]

export interface KnowledgeSourceMeta {
  /** Module that must be enabled; `null` = platform (workspace members). */
  module: ModuleKind | null
  /** RBAC resource whose VIEW is required; `null` = no matrix check. */
  resource: PermissionResource | null
  /**
   * Extra gate of the source's service:
   * - `wiki`: Ajustes › Wiki is on (`assertWikiMember`);
   * - `privileged`: OWNER/ADMIN only (`assertModulePrivileged`);
   * - `sd`: ServiceDesk agents see everything, requesters only what the
   *   portal shows them (`SdAccess`, chunk `audience`).
   */
  gate: 'wiki' | 'privileged' | 'sd' | null
  /** pt-BR singular label (citation chip, tool output). */
  label: string
}

export const KNOWLEDGE_SOURCES: Record<
  KnowledgeSourceType,
  KnowledgeSourceMeta
> = {
  'sd-kb-article': {
    module: 'SERVICE_DESK',
    resource: 'sd-knowledge',
    gate: 'sd',
    label: 'Artigo da base de conhecimento',
  },
  'wiki-page': {
    module: null,
    resource: null,
    gate: 'wiki',
    label: 'Página da Wiki',
  },
  'sd-ticket': {
    module: 'SERVICE_DESK',
    resource: 'sd-tickets',
    gate: 'sd',
    label: 'Chamado resolvido',
  },
  'zap-knowledge-doc': {
    module: 'COMMUNICATION',
    resource: null,
    gate: 'privileged',
    label: 'Documento da IA do WhatsApp',
  },
  'crm-note': {
    module: 'CRM',
    resource: 'notes',
    gate: null,
    label: 'Nota do CRM',
  },
  'crm-proposal': {
    module: 'CRM',
    resource: 'documents',
    gate: null,
    label: 'Proposta',
  },
}

export function isKnowledgeSourceType(
  value: string,
): value is KnowledgeSourceType {
  return (KNOWLEDGE_SOURCE_TYPES as readonly string[]).includes(value)
}

export function knowledgeSourceLabel(type: string): string {
  return isKnowledgeSourceType(type) ? KNOWLEDGE_SOURCES[type].label : 'Fonte'
}
