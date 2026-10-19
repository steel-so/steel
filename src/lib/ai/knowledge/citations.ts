import type { AiCitationDTO } from '@/types/ai-knowledge'
import { isKnowledgeSourceType } from './sources'

/**
 * Citations of a `steel_search` result, in a dependency-free module so the
 * conversation mapper and the chat service can read them back from a TOOL
 * row without importing the tool registry.
 */

export const STEEL_SEARCH_TOOL_NAME = 'steel_search'

/** At most this many citations under one answer. */
export const MAX_CITATIONS = 8

/** Citations carried by a `steel_search` result `data`, or `[]`. */
export function readCitations(data: unknown): AiCitationDTO[] {
  if (!data || typeof data !== 'object') return []
  const results = (data as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  const out: AiCitationDTO[] = []
  for (const item of results) {
    if (!item || typeof item !== 'object') continue
    const { sourceType, source, title, href } = item as Record<string, unknown>
    if (
      typeof sourceType !== 'string' ||
      !isKnowledgeSourceType(sourceType) ||
      typeof source !== 'string' ||
      typeof title !== 'string' ||
      typeof href !== 'string' ||
      // Only in-app links: a citation never points outside the Steel.
      !href.startsWith('/') ||
      href.startsWith('//')
    ) {
      continue
    }
    out.push({ sourceType, label: source, title, href })
    if (out.length >= MAX_CITATIONS) break
  }
  return out
}
