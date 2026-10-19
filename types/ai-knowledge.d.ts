import type { KnowledgeSourceType } from '@/src/lib/ai/knowledge/sources'

export type AiKnowledgeSourceTypeDTO = KnowledgeSourceType

/** One source found by the knowledge search (best chunk of the source). */
export interface AiKnowledgeResultDTO {
  sourceType: AiKnowledgeSourceTypeDTO
  /** pt-BR label of the source type ("Página da Wiki"). */
  sourceLabel: string
  sourceId: string
  title: string
  /** Excerpt of the matching chunk (≤ 320 chars). */
  snippet: string
  /** App path, already prefixed with the workspace slug — the citation link. */
  href: string
  updatedAt: string
  /** Reciprocal rank fusion score (higher = better). */
  score: number
  /** Which retrieval found it. */
  matchedBy: Array<'text' | 'vector'>
}

export interface AiKnowledgeSearchResponseDTO {
  query: string
  /** `text` when no embedding was available for the query (ADR 0037). */
  mode: 'hybrid' | 'text'
  results: AiKnowledgeResultDTO[]
  tookMs: number
}

/** A source cited by a Steel AI answer (`steel_search` result). */
export interface AiCitationDTO {
  sourceType: AiKnowledgeSourceTypeDTO
  label: string
  title: string
  href: string
}
