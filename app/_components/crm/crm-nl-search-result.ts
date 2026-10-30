import type {
  CrmNlCompanySearchResultDTO,
  CrmNlLeadSearchResultDTO,
  CrmNlPersonSearchResultDTO,
  CrmNlSearchResultDTO,
} from '@/types/crm-nl-search'

/** Records the natural-language search covers (C10). */
export type CrmNlSearchEntityKey =
  | 'opportunities'
  | 'leads'
  | 'people'
  | 'companies'

export type CrmNlAnyResult =
  | CrmNlSearchResultDTO
  | CrmNlLeadSearchResultDTO
  | CrmNlPersonSearchResultDTO
  | CrmNlCompanySearchResultDTO

/** The matched records (opportunities keep their own key for compatibility). */
function matchedRows(result: CrmNlAnyResult): { id: string }[] {
  return 'opportunities' in result ? result.opportunities : result.items
}

export function nlResultIds(result: CrmNlAnyResult): string[] {
  return matchedRows(result).map((row) => row.id)
}

/**
 * Narrows the loaded rows to the matched ones. When the question asked for an
 * order ("maiores primeiro") the rows follow the server's order; otherwise
 * the table keeps its own.
 */
export function applyNlResult<T extends { id: string }>(
  items: T[],
  result: CrmNlAnyResult | null,
): T[] {
  if (!result) return items
  const ids = nlResultIds(result)
  if (!result.filter.sort) {
    const matched = new Set(ids)
    return items.filter((item) => matched.has(item.id))
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}
