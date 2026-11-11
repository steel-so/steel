import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import type { SearchDocumentInput } from '@/src/lib/search/search-document'
import {
  SEARCH_ENTITY_TYPES,
  type SearchEntityType,
} from '@/src/lib/search/search-entities'
import {
  toCrmCompanySearchDocument,
  toCrmDocumentSearchDocument,
  toCrmLeadSearchDocument,
  toCrmOpportunitySearchDocument,
  toCrmPersonSearchDocument,
  toCrmProposalSearchDocument,
  toCrmTaskSearchDocument,
  toMemberSearchDocument,
  toSdConfigItemSearchDocument,
  toSdContactSearchDocument,
  toSdCustomerSearchDocument,
  toSdKbArticleSearchDocument,
  toSdTicketSearchDocument,
  toWhiteboardSearchDocument,
  toZapContactSearchDocument,
  toZapConversationSearchDocument,
} from '@/src/mappers/search-document.mapper'
import { SearchDocumentRepository } from '@/src/repositories/search-document.repository'
import {
  type SearchSourceOptions,
  SearchSourceRepository,
} from '@/src/repositories/search-source.repository'

/**
 * Keeps `search_documents` in sync with the source tables. `refresh` is
 * what the fire-and-forget hooks call after a write (records the loader no
 * longer returns — soft-deleted or gone — leave the index); `reindex*` is
 * the backfill/nightly path, which also drops documents it did not touch.
 */

type Loader = (
  workspaceId: string,
  opts: SearchSourceOptions,
) => Promise<Result<SearchDocumentInput[]>>

function simple<Row>(
  load: (ws: string, opts: SearchSourceOptions) => Promise<Result<Row[]>>,
  build: (ws: string, row: Row) => SearchDocumentInput,
): Loader {
  return async (ws, opts) => {
    const rows = await load(ws, opts)
    if (!rows.ok) return rows
    return ok(rows.value.map((row) => build(ws, row)))
  }
}

const LOADERS: Record<SearchEntityType, Loader> = {
  'sd-ticket': async (ws, opts) => {
    const prefixes = await SearchSourceRepository.sdTicketPrefixes(ws)
    if (!prefixes.ok) return prefixes
    const rows = await SearchSourceRepository.sdTickets(ws, opts)
    if (!rows.ok) return rows
    return ok(
      rows.value.map((row) =>
        toSdTicketSearchDocument(ws, row, prefixes.value),
      ),
    )
  },
  'sd-kb-article': simple(
    (ws, o) => SearchSourceRepository.sdKbArticles(ws, o),
    toSdKbArticleSearchDocument,
  ),
  'sd-customer': simple(
    (ws, o) => SearchSourceRepository.sdCustomers(ws, o),
    toSdCustomerSearchDocument,
  ),
  'sd-contact': simple(
    (ws, o) => SearchSourceRepository.sdContacts(ws, o),
    toSdContactSearchDocument,
  ),
  'sd-config-item': simple(
    (ws, o) => SearchSourceRepository.sdConfigItems(ws, o),
    toSdConfigItemSearchDocument,
  ),
  'crm-lead': simple(
    (ws, o) => SearchSourceRepository.crmLeads(ws, o),
    toCrmLeadSearchDocument,
  ),
  'crm-opportunity': simple(
    (ws, o) => SearchSourceRepository.crmOpportunities(ws, o),
    toCrmOpportunitySearchDocument,
  ),
  'crm-person': simple(
    (ws, o) => SearchSourceRepository.crmPeople(ws, o),
    toCrmPersonSearchDocument,
  ),
  'crm-company': simple(
    (ws, o) => SearchSourceRepository.crmCompanies(ws, o),
    toCrmCompanySearchDocument,
  ),
  'crm-task': simple(
    (ws, o) => SearchSourceRepository.crmTasks(ws, o),
    toCrmTaskSearchDocument,
  ),
  'crm-proposal': simple(
    (ws, o) => SearchSourceRepository.crmProposals(ws, o),
    toCrmProposalSearchDocument,
  ),
  'crm-document': simple(
    (ws, o) => SearchSourceRepository.crmDocuments(ws, o),
    toCrmDocumentSearchDocument,
  ),
  'zap-conversation': simple(
    (ws, o) => SearchSourceRepository.zapConversations(ws, o),
    toZapConversationSearchDocument,
  ),
  'zap-contact': simple(
    (ws, o) => SearchSourceRepository.zapContacts(ws, o),
    toZapContactSearchDocument,
  ),
  member: simple(
    (ws, o) => SearchSourceRepository.members(ws, o),
    toMemberSearchDocument,
  ),
  whiteboard: simple(
    (ws, o) => SearchSourceRepository.whiteboards(ws, o),
    toWhiteboardSearchDocument,
  ),
}

/** Page size of the backfill (rows per loader call and per upsert). */
export const SEARCH_REINDEX_BATCH = 500
const WORKSPACE_BATCH = 100

export interface SearchReindexStats {
  indexed: number
  removed: number
}

export interface SearchReindexAllStats extends SearchReindexStats {
  workspaces: number
  failed: number
}

export const SearchIndexService = {
  /** Re-reads the records and upserts them; missing ones are removed. */
  async refresh(
    entityType: SearchEntityType,
    workspaceId: string,
    entityIds: readonly string[],
  ): Promise<Result<SearchReindexStats>> {
    const ids = [...new Set(entityIds.filter(Boolean))]
    if (ids.length === 0) return ok({ indexed: 0, removed: 0 })
    const docs = await LOADERS[entityType](workspaceId, {
      ids,
      take: ids.length,
    })
    if (!docs.ok) return docs
    const upserted = await SearchDocumentRepository.upsertMany(docs.value)
    if (!upserted.ok) return upserted
    const found = new Set(docs.value.map((d) => d.entityId))
    const missing = ids.filter((id) => !found.has(id))
    const removed = await SearchDocumentRepository.removeMany(
      workspaceId,
      entityType,
      missing,
    )
    if (!removed.ok) return removed
    return ok({ indexed: docs.value.length, removed: removed.value })
  },

  async remove(
    entityType: SearchEntityType,
    workspaceId: string,
    entityIds: readonly string[],
  ): Promise<Result<number>> {
    return SearchDocumentRepository.removeMany(
      workspaceId,
      entityType,
      entityIds,
    )
  },

  /**
   * Full rebuild of one workspace (all types, or the given ones): pages
   * through every source and then removes what this pass did not touch.
   */
  async reindexWorkspace(
    workspaceId: string,
    types: readonly SearchEntityType[] = SEARCH_ENTITY_TYPES,
  ): Promise<Result<SearchReindexStats>> {
    const startedAt = await SearchDocumentRepository.now()
    if (!startedAt.ok) return startedAt
    let indexed = 0
    let removed = 0
    for (const type of types) {
      let afterId: string | undefined
      for (;;) {
        const docs = await LOADERS[type](workspaceId, {
          afterId,
          take: SEARCH_REINDEX_BATCH,
        })
        if (!docs.ok) return docs
        const upserted = await SearchDocumentRepository.upsertMany(docs.value)
        if (!upserted.ok) return upserted
        indexed += docs.value.length
        if (docs.value.length < SEARCH_REINDEX_BATCH) break
        afterId = docs.value[docs.value.length - 1].entityId
      }
      const stale = await SearchDocumentRepository.removeStale(
        workspaceId,
        type,
        startedAt.value,
      )
      if (!stale.ok) return stale
      removed += stale.value
    }
    return ok({ indexed, removed })
  },

  /** Nightly job: every workspace; one failing workspace does not stop it. */
  async reindexAll(): Promise<Result<SearchReindexAllStats>> {
    const stats: SearchReindexAllStats = {
      workspaces: 0,
      failed: 0,
      indexed: 0,
      removed: 0,
    }
    let afterId: string | undefined
    for (;;) {
      const ids = await SearchSourceRepository.workspaceIds(
        afterId,
        WORKSPACE_BATCH,
      )
      if (!ids.ok) return ids
      for (const workspaceId of ids.value) {
        const result = await SearchIndexService.reindexWorkspace(workspaceId)
        stats.workspaces++
        if (!result.ok) {
          stats.failed++
          logger.error('search.reindex.workspace_failed', {
            component: 'SearchIndexService',
            workspaceId,
            code: result.error.code,
          })
          continue
        }
        stats.indexed += result.value.indexed
        stats.removed += result.value.removed
      }
      if (ids.value.length < WORKSPACE_BATCH) break
      afterId = ids.value[ids.value.length - 1]
    }
    return ok(stats)
  },
}
