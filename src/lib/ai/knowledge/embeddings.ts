import type OpenAI from 'openai'
import { logger } from '@/lib/axiom/logger'
import { aiKnowledgeEmbeddingFailed } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { getOpenAiClient } from '../index'
import type { AiModelDefinition } from '../models'

/**
 * Embedding provider of the knowledge search (ADR 0037). Anthropic has no
 * embeddings API, so the platform uses OpenAI `text-embedding-3-small` for
 * every workspace, whatever chat provider the workspace picked, with the
 * platform `OPENAI_API_KEY`. The global admin switches it off in Admin ›
 * Steel IA (`PlatformAiSettings.embeddingsEnabled`); without the key or
 * with the switch off the search is text-only.
 *
 * The dimension is fixed by the `vector(1536)` column: changing the model
 * means a new column/table and a full re-embed.
 */

export const KNOWLEDGE_EMBEDDING_MODEL: AiModelDefinition = {
  key: 'openai:text-embedding-3-small',
  provider: 'openai',
  model: 'text-embedding-3-small',
  label: 'OpenAI text-embedding-3-small',
  // Checked on 2026-10-18 (OpenAI pricing, embeddings): US$ 0.02 / 1M input.
  pricing: { inputUsdPer1M: 0.02, outputUsdPer1M: 0 },
}

export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536

/** Inputs per API request (the API accepts up to 2048). */
export const EMBEDDING_BATCH_SIZE = 64

/** ~8k tokens is the model limit; chunks are far below, queries are cut. */
const MAX_INPUT_CHARS = 8_000

export interface EmbeddingBatch {
  vectors: number[][]
  inputTokens: number
}

export type EmbeddingClient = Pick<OpenAI, 'embeddings'>

export function isEmbeddingProviderConfigured(): boolean {
  return getOpenAiClient() !== null
}

/** Text form of a vector for a `::vector` cast in SQL. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`
}

/**
 * Embeds `texts` in batches. All or nothing: a failed batch fails the
 * call (the caller falls back to full-text and retries later).
 */
export async function embedTexts(
  texts: readonly string[],
  client: EmbeddingClient | null = getOpenAiClient(),
): Promise<Result<EmbeddingBatch>> {
  if (texts.length === 0) return ok({ vectors: [], inputTokens: 0 })
  if (!client)
    return err(aiKnowledgeEmbeddingFailed('Embedding provider not configured'))

  const vectors: number[][] = []
  let inputTokens = 0
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts
      .slice(i, i + EMBEDDING_BATCH_SIZE)
      .map((text) => text.slice(0, MAX_INPUT_CHARS) || ' ')
    try {
      const response = await client.embeddings.create({
        model: KNOWLEDGE_EMBEDDING_MODEL.model,
        input: batch,
        dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      })
      const ordered = [...response.data].sort((a, b) => a.index - b.index)
      if (
        ordered.length !== batch.length ||
        ordered.some(
          (d) => d.embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS,
        )
      ) {
        return err(
          aiKnowledgeEmbeddingFailed('Unexpected embedding response shape'),
        )
      }
      vectors.push(...ordered.map((d) => d.embedding))
      inputTokens += response.usage?.prompt_tokens ?? 0
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('ai.knowledge.embedding_failed', {
        component: 'AiKnowledgeEmbeddings',
        batchSize: batch.length,
        message,
      })
      return err(
        aiKnowledgeEmbeddingFailed(`Embedding request failed: ${message}`),
      )
    }
  }
  return ok({ vectors, inputTokens })
}
