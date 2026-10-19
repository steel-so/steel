import { z } from 'zod'
import { KNOWLEDGE_SOURCE_TYPES } from '@/src/lib/ai/knowledge/sources'
import { dto } from '../common'

/** DTOs da busca de conhecimento do Steel AI (`types/ai-knowledge.d.ts`). */

export const AiKnowledgeResultDTO = dto(
  'AiKnowledgeResult',
  z
    .object({
      sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES).meta({ example: 'wiki-page' }),
      sourceLabel: z.string().meta({ example: 'Página da Wiki' }),
      sourceId: z.string(),
      title: z.string().meta({ example: 'Como trocar a senha do Wi-Fi' }),
      snippet: z.string(),
      href: z.string().meta({ example: '/agro/wiki/clx1wiki0000ab7d3k1e5xyz' }),
      updatedAt: z.iso.datetime(),
      score: z.number(),
      matchedBy: z.array(z.enum(['text', 'vector'])),
    })
    .meta({
      description:
        'Fonte encontrada (o melhor trecho dela). `href` já vem prefixado com o slug do workspace e serve de link da citação.',
    }),
)

export const AiKnowledgeSearchResponseDTO = dto(
  'AiKnowledgeSearchResponse',
  z.object({
    query: z.string(),
    mode: z.enum(['hybrid', 'text']).meta({
      description:
        '`hybrid` = texto + similaridade semântica; `text` = só texto (sem provedor de embeddings, sem pgvector, cota de IA esgotada ou falha do provedor).',
    }),
    results: z.array(AiKnowledgeResultDTO),
    tookMs: z.number().int(),
  }),
)
