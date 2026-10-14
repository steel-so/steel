import type { ModuleKind, Role } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { can } from '@/src/lib/permissions'
import { ok, type Result } from '@/src/lib/result'
import type { SearchDocumentHit } from '@/src/lib/search/search-document'
import {
  SEARCH_ENTITIES,
  SEARCH_ENTITY_TYPES,
  type SearchEntityType,
} from '@/src/lib/search/search-entities'
import { parseSearchQuery } from '@/src/lib/search/search-query'
import { rankSearchHits } from '@/src/lib/search/search-ranking'
import { canSeeConversation } from '@/src/lib/whatsapp/conversation-scope'
import { toSearchResultDTO } from '@/src/mappers/search-document.mapper'
import { SearchDocumentRepository } from '@/src/repositories/search-document.repository'
import { SearchSourceRepository } from '@/src/repositories/search-source.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  SEARCH_DEFAULT_LIMIT,
  type SearchQueryInput,
} from '@/src/schemas/search.schema'
import type { SearchResponseDTO } from '@/types/search'
import { assertMember } from './authz'
import { SdAccess } from './sd-access'
import { resolveConversationScope } from './whatsapp-conversation-scope.service'

/**
 * Global search (Ctrl+K). Authorization is decided here, per entity type,
 * before the query runs: membership → module enabled → RBAC `VIEW` of the
 * type's resource; ServiceDesk also splits agents (everything) from
 * requesters (own tickets + portal KB). The repository filters by that
 * allow-list inside the SQL, so a title the user cannot open never leaves
 * the database.
 */

/** ServiceDesk types a requester (non-agent) may ever see. */
const SD_REQUESTER_TYPES = new Set<SearchEntityType>([
  'sd-ticket',
  'sd-kb-article',
])

export interface SearchAccess {
  types: SearchEntityType[]
  isSdAgent: boolean
  slug: string
  /** Workspace role — the Comunicação conversation scope (Equipes). */
  role: Role
}

/** Fetched before the TypeScript blend; enough room for the boosts. */
function candidateLimit(limit: number): number {
  return Math.min(200, Math.max(60, limit * 4))
}

export const SearchService = {
  /** Which entity types `actorId` may search in this workspace. */
  async resolveAccess(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SearchAccess>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const [workspace, modules] = await Promise.all([
      WorkspaceRepository.findById(workspaceId),
      WorkspaceModuleAccessRepository.listByWorkspace(workspaceId),
    ])
    if (!workspace.ok) return workspace
    if (!modules.ok) return modules
    const enabled = new Set<ModuleKind>(
      modules.value.filter((m) => m.enabled).map((m) => m.module),
    )

    let isSdAgent = false
    if (enabled.has('SERVICE_DESK')) {
      const sd = await SdAccess.resolve(actorId, workspaceId)
      if (!sd.ok) return sd
      isSdAgent = sd.value.isAgent
    }

    const { isPrivileged, permissions } = membership.value
    const types = SEARCH_ENTITY_TYPES.filter((type) => {
      const meta = SEARCH_ENTITIES[type]
      if (type === 'whiteboard' && !workspace.value.whiteboardEnabled) {
        return false
      }
      if (meta.module && !enabled.has(meta.module)) return false
      if (
        meta.module === 'SERVICE_DESK' &&
        !isSdAgent &&
        !SD_REQUESTER_TYPES.has(type)
      ) {
        return false
      }
      if (!meta.resource || isPrivileged) return true
      return permissions !== null && can(permissions, meta.resource, 'VIEW')
    })

    return ok({
      types,
      isSdAgent,
      slug: workspace.value.slug,
      role: membership.value.role,
    })
  },

  async search(
    actorId: string,
    workspaceId: string,
    input: Pick<SearchQueryInput, 'q'> & Partial<SearchQueryInput>,
  ): Promise<Result<SearchResponseDTO>> {
    const startedAt = Date.now()
    const limit = input.limit ?? SEARCH_DEFAULT_LIMIT
    const access = await SearchService.resolveAccess(actorId, workspaceId)
    if (!access.ok) return access

    const parsed = parseSearchQuery(input.q)
    const types = input.types
      ? access.value.types.filter((t) => input.types?.includes(t))
      : access.value.types
    // One letter matches half the index; a single digit is a ticket number.
    const tooShort = parsed.text.length < 2 && !/^\d$/.test(parsed.text)
    if (tooShort || types.length === 0) {
      return ok({ query: input.q, results: [], tookMs: Date.now() - startedAt })
    }

    const hits = await SearchDocumentRepository.search({
      workspaceId,
      userId: actorId,
      text: parsed.text,
      codes: parsed.codes,
      tsquery: parsed.tsquery,
      types,
      isSdAgent: access.value.isSdAgent,
      candidateLimit: candidateLimit(limit),
    })
    if (!hits.ok) return hits

    const visible = await SearchService.dropUnviewableTickets(
      actorId,
      workspaceId,
      access.value.isSdAgent,
      hits.value,
    )
    if (!visible.ok) return visible

    const allowed = await SearchService.dropUnviewableConversations(
      actorId,
      workspaceId,
      access.value.role,
      visible.value,
    )
    if (!allowed.ok) return allowed

    const now = new Date()
    const ranked = rankSearchHits(
      allowed.value.map((hit) => ({
        ...hit,
        signals: {
          exact: hit.exact,
          titlePrefix: hit.titlePrefix,
          titlePhrase: hit.titlePhrase,
          textRank: hit.textRank,
          similarity: hit.similarity,
          updatedAt: hit.updatedAt,
          isMine: hit.isMine,
        },
      })),
      now,
      limit,
    )
    const tookMs = Date.now() - startedAt
    // Never log the query text itself (it may be a name, phone or e-mail).
    logger.info('search.query', {
      component: 'SearchService',
      workspaceId,
      queryLength: parsed.text.length,
      types: types.length,
      candidates: hits.value.length,
      results: ranked.length,
      tookMs,
    })
    return ok({
      query: input.q,
      results: ranked.map((hit) => toSearchResultDTO(hit, access.value.slug)),
      tookMs,
    })
  },

  /**
   * Second gate for requesters: re-checks ticket visibility against the
   * live rows (requester, participants, linked contact), so a stale index
   * entry can never show a ticket the requester can no longer open.
   */
  async dropUnviewableTickets(
    actorId: string,
    workspaceId: string,
    isSdAgent: boolean,
    hits: SearchDocumentHit[],
  ): Promise<Result<SearchDocumentHit[]>> {
    const ticketIds = hits
      .filter((h) => h.entityType === 'sd-ticket')
      .map((h) => h.entityId)
    if (isSdAgent || ticketIds.length === 0) return ok(hits)
    const rows = await SearchSourceRepository.sdTickets(workspaceId, {
      ids: ticketIds,
      take: ticketIds.length,
    })
    if (!rows.ok) return rows
    // Same rule as `canViewSdTicket` for a non-agent viewer.
    const allowed = new Set(
      rows.value
        .filter(
          (row) =>
            row.requesterId === actorId ||
            row.participants.some((p) => p.userId === actorId) ||
            row.contact?.userId === actorId,
        )
        .map((row) => row.id),
    )
    return ok(
      hits.filter(
        (h) => h.entityType !== 'sd-ticket' || allowed.has(h.entityId),
      ),
    )
  },
  /**
   * Equipes gate for Comunicação conversations: a scoped viewer only finds
   * the conversations they can open (checked against the live assignee and
   * team, never the index).
   */
  async dropUnviewableConversations(
    actorId: string,
    workspaceId: string,
    role: Role,
    hits: SearchDocumentHit[],
  ): Promise<Result<SearchDocumentHit[]>> {
    const ids = hits
      .filter((h) => h.entityType === 'zap-conversation')
      .map((h) => h.entityId)
    if (ids.length === 0) return ok(hits)

    const scope = await resolveConversationScope(actorId, workspaceId, role)
    if (!scope.ok) return scope
    if (scope.value.mode === 'ALL') return ok(hits)

    const rows = await WhatsAppConversationRepository.listVisibilityTargets(
      workspaceId,
      ids,
    )
    if (!rows.ok) return rows
    const allowed = new Set(
      rows.value
        .filter((row) => canSeeConversation(scope.value, row))
        .map((row) => row.id),
    )
    return ok(
      hits.filter(
        (h) => h.entityType !== 'zap-conversation' || allowed.has(h.entityId),
      ),
    )
  },
}
