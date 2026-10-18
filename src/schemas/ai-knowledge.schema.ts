import { z } from 'zod'
import { KNOWLEDGE_SOURCE_TYPES } from '@/src/lib/ai/knowledge/sources'

export const AI_KNOWLEDGE_DEFAULT_LIMIT = 8
export const AI_KNOWLEDGE_MAX_LIMIT = 20
export const AI_KNOWLEDGE_QUERY_MAX = 500

const queryText = z
  .string()
  .trim()
  .min(2, 'Informe o que buscar (2 caracteres ou mais)')
  .max(AI_KNOWLEDGE_QUERY_MAX)

const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(AI_KNOWLEDGE_MAX_LIMIT)
  .default(AI_KNOWLEDGE_DEFAULT_LIMIT)

/**
 * `GET /api/workspaces/{id}/ai/knowledge/search?q=&sources=&limit=`.
 * `sources` is a comma-separated subset of the source types; an unknown
 * value is a validation error, so a typo never silently widens the search.
 */
export const AiKnowledgeSearchQuerySchema = z.object({
  q: queryText,
  sources: z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.enum(KNOWLEDGE_SOURCE_TYPES)).min(1).optional()),
  limit,
})

/** Arguments of the `steel_search` tool (same bounds, `sources` as array). */
export const SteelSearchToolArgsSchema = z
  .object({
    query: queryText,
    sources: z.array(z.enum(KNOWLEDGE_SOURCE_TYPES)).min(1).optional(),
    limit,
  })
  .strict()

export type AiKnowledgeSearchInput = {
  q: string
  sources?: (typeof KNOWLEDGE_SOURCE_TYPES)[number][]
  limit?: number
}
