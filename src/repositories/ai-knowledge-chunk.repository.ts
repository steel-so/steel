import { createId } from '@paralleldrive/cuid2'
import { Prisma } from '@prisma/client'
import type { KnowledgeSourceType } from '@/src/lib/ai/knowledge/sources'
import type {
  KnowledgeChunkHit,
  KnowledgeChunkInput,
  KnowledgeChunkQuery,
  KnowledgeChunkToEmbed,
} from '@/src/lib/ai/knowledge/types'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * `ai_knowledge_chunks` and its pgvector sidecar
 * `ai_vector.ai_knowledge_embeddings` (ADR 0037). `search_vector` is a
 * generated column (Portuguese stemming + unaccent), so only the source
 * fields are written. Every read filters by workspace, by the source types
 * the caller may see and by `audience` inside the SQL: a chunk the user
 * cannot open never leaves the database.
 *
 * The sidecar exists only where pgvector is installed — callers check
 * `vectorEnabled()` before the vector methods.
 */

interface HitRow {
  id: string
  source_type: string
  source_id: string
  chunk_index: number
  title: string
  content: string
  path: string
  source_updated_at: Date
  score: number
}

function toHit(row: HitRow): KnowledgeChunkHit {
  return {
    id: row.id,
    sourceType: row.source_type as KnowledgeSourceType,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    title: row.title,
    content: row.content,
    path: row.path,
    sourceUpdatedAt: row.source_updated_at,
    score: Number(row.score),
  }
}

/** Same rule as the global search (`search_documents.audience`). */
function audienceFilter(q: KnowledgeChunkQuery): Prisma.Sql {
  return Prisma.sql`(
    c.audience = 'PUBLIC'
    OR ${q.isSdAgent}::boolean
    OR (c.audience = 'PARTIES' AND c.user_ids @> ARRAY[${q.userId}]::text[])
  )`
}

export interface KnowledgeSourceChunks {
  sourceId: string
  /** Every chunk of the source, `chunkIndex` 0..n-1 (empty = no text). */
  chunks: KnowledgeChunkInput[]
}

export const AiKnowledgeChunkRepository = {
  /** Database clock (see `SearchDocumentRepository.now`). */
  async now(): Promise<Result<Date>> {
    try {
      const rows = await prisma.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`
      return ok(rows[0].now)
    } catch (error) {
      return err(dbError('Failed to read the database clock', error))
    }
  },

  /**
   * Writes the chunks of each source and drops the ones past its new
   * length, in one transaction. A chunk keeps its id across refreshes, so
   * its embedding survives when the text did not change.
   */
  async replaceSources(
    workspaceId: string,
    sourceType: KnowledgeSourceType,
    sources: readonly KnowledgeSourceChunks[],
  ): Promise<Result<number>> {
    if (sources.length === 0) return ok(0)
    const rows = sources.flatMap((s) =>
      s.chunks.map((c) => ({
        id: createId(),
        workspace_id: workspaceId,
        source_type: sourceType,
        source_id: s.sourceId,
        chunk_index: c.chunkIndex,
        module: c.module,
        audience: c.audience,
        user_ids: c.userIds,
        title: c.title,
        content: c.content,
        path: c.path,
        content_hash: c.contentHash,
        source_updated_at: c.sourceUpdatedAt.toISOString(),
      })),
    )
    const lengths = sources.map((s) => ({
      source_id: s.sourceId,
      n: s.chunks.length,
    }))
    try {
      const operations: Prisma.PrismaPromise<number>[] = []
      if (rows.length > 0) {
        operations.push(prisma.$executeRaw`
          INSERT INTO ai_knowledge_chunks (
            id, workspace_id, source_type, source_id, chunk_index, module,
            audience, user_ids, title, content, path, content_hash,
            source_updated_at, indexed_at
          )
          SELECT
            x.id, x.workspace_id, x.source_type, x.source_id, x.chunk_index,
            x.module, x.audience, x.user_ids, x.title, x.content, x.path,
            x.content_hash, x.source_updated_at, now()
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
            id text, workspace_id text, source_type text, source_id text,
            chunk_index int, module text, audience text, user_ids text[],
            title text, content text, path text, content_hash text,
            source_updated_at timestamptz
          )
          ON CONFLICT (workspace_id, source_type, source_id, chunk_index)
          DO UPDATE SET
            module = EXCLUDED.module,
            audience = EXCLUDED.audience,
            user_ids = EXCLUDED.user_ids,
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            path = EXCLUDED.path,
            content_hash = EXCLUDED.content_hash,
            source_updated_at = EXCLUDED.source_updated_at,
            indexed_at = now()
        `)
      }
      operations.push(prisma.$executeRaw`
        DELETE FROM ai_knowledge_chunks c
        USING jsonb_to_recordset(${JSON.stringify(lengths)}::jsonb)
          AS x(source_id text, n int)
        WHERE c.workspace_id = ${workspaceId}
          AND c.source_type = ${sourceType}
          AND c.source_id = x.source_id
          AND c.chunk_index >= x.n
      `)
      await prisma.$transaction(operations)
      return ok(rows.length)
    } catch (error) {
      return err(dbError('Failed to write knowledge chunks', error))
    }
  },

  /** Drops every chunk of the sources (deleted or no longer indexable). */
  async removeSources(
    workspaceId: string,
    sourceType: KnowledgeSourceType,
    sourceIds: readonly string[],
  ): Promise<Result<number>> {
    if (sourceIds.length === 0) return ok(0)
    try {
      const count = await prisma.$executeRaw`
        DELETE FROM ai_knowledge_chunks
        WHERE workspace_id = ${workspaceId}
          AND source_type = ${sourceType}
          AND source_id = ANY(${[...sourceIds]}::text[])
      `
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to remove knowledge chunks', error))
    }
  },

  /** The whole workspace index (Steel AI switched off). */
  async removeWorkspace(workspaceId: string): Promise<Result<number>> {
    try {
      const count = await prisma.$executeRaw`
        DELETE FROM ai_knowledge_chunks WHERE workspace_id = ${workspaceId}
      `
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to remove the workspace knowledge', error))
    }
  },

  /** Chunks of every workspace whose Steel AI switch is off. */
  async removeAiDisabled(): Promise<Result<number>> {
    try {
      const count = await prisma.$executeRaw`
        DELETE FROM ai_knowledge_chunks c
        USING workspace_ai_settings s
        WHERE s.workspace_id = c.workspace_id AND s.ai_enabled = false
      `
      return ok(count)
    } catch (error) {
      return err(
        dbError('Failed to remove knowledge of AI-off workspaces', error),
      )
    }
  },

  /** Chunks of one type a full reindex did not touch (deleted sources). */
  async removeStale(
    workspaceId: string,
    sourceType: KnowledgeSourceType,
    indexedBefore: Date,
  ): Promise<Result<number>> {
    try {
      const count = await prisma.$executeRaw`
        DELETE FROM ai_knowledge_chunks
        WHERE workspace_id = ${workspaceId}
          AND source_type = ${sourceType}
          AND indexed_at < ${indexedBefore}
      `
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to remove stale knowledge chunks', error))
    }
  },

  async countByWorkspace(workspaceId: string): Promise<Result<number>> {
    try {
      const count = await prisma.aiKnowledgeChunk.count({
        where: { workspaceId },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count knowledge chunks', error))
    }
  },

  /**
   * Full-text half: OR of the query's lexemes (Portuguese stemming,
   * accents folded), ranked by cover density. `websearch_to_tsquery` alone
   * ANDs every word, which misses most questions written in prose.
   */
  async searchText(
    q: KnowledgeChunkQuery & { text: string },
  ): Promise<Result<KnowledgeChunkHit[]>> {
    if (q.types.length === 0 || !q.text.trim()) return ok([])
    try {
      const rows = await prisma.$queryRaw<HitRow[]>`
        WITH q AS (
          SELECT NULLIF(
            replace(
              websearch_to_tsquery('portuguese', f_unaccent(${q.text}))::text,
              ' & ', ' | '
            ),
            ''
          )::tsquery AS tsq
        )
        SELECT c.id, c.source_type, c.source_id, c.chunk_index, c.title,
          c.content, c.path, c.source_updated_at,
          ts_rank_cd(c.search_vector, q.tsq, 32)::float8 AS score
        FROM ai_knowledge_chunks c, q
        WHERE q.tsq IS NOT NULL
          AND c.workspace_id = ${q.workspaceId}
          AND c.source_type = ANY(${q.types}::text[])
          AND ${audienceFilter(q)}
          AND c.search_vector @@ q.tsq
        ORDER BY score DESC, c.id
        LIMIT ${q.limit}
      `
      return ok(rows.map(toHit))
    } catch (error) {
      return err(dbError('Failed to search knowledge chunks', error))
    }
  },

  /** Whether the pgvector sidecar exists in this database. */
  async vectorEnabled(): Promise<Result<boolean>> {
    try {
      const rows = await prisma.$queryRaw<{ enabled: boolean }[]>`
        SELECT to_regclass('ai_vector.ai_knowledge_embeddings') IS NOT NULL
          AS enabled
      `
      return ok(Boolean(rows[0]?.enabled))
    } catch (error) {
      return err(dbError('Failed to check the knowledge vector index', error))
    }
  },

  /**
   * Creates the sidecar if pgvector became available (idempotent SQL
   * function from the migration); returns whether it exists now.
   */
  async enableVector(): Promise<Result<boolean>> {
    try {
      const rows = await prisma.$queryRaw<{ enabled: boolean }[]>`
        SELECT ai_knowledge_enable_vector() AS enabled
      `
      return ok(Boolean(rows[0]?.enabled))
    } catch (error) {
      return err(dbError('Failed to enable the knowledge vector index', error))
    }
  },

  /** Chunks without an embedding for `model`, or embedded from older text. */
  async listToEmbed(
    workspaceId: string,
    model: string,
    take: number,
  ): Promise<Result<KnowledgeChunkToEmbed[]>> {
    try {
      const rows = await prisma.$queryRaw<
        {
          id: string
          workspace_id: string
          title: string
          content: string
          content_hash: string
        }[]
      >`
        SELECT c.id, c.workspace_id, c.title, c.content, c.content_hash
        FROM ai_knowledge_chunks c
        LEFT JOIN ai_vector.ai_knowledge_embeddings e ON e.chunk_id = c.id
        WHERE c.workspace_id = ${workspaceId}
          AND (
            e.chunk_id IS NULL
            OR e.content_hash <> c.content_hash
            OR e.model <> ${model}
          )
        ORDER BY c.id
        LIMIT ${take}
      `
      return ok(
        rows.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          title: r.title,
          content: r.content,
          contentHash: r.content_hash,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list chunks to embed', error))
    }
  },

  /** Upserts embeddings; chunks deleted in the meantime are skipped. */
  async saveEmbeddings(
    model: string,
    rows: ReadonlyArray<{
      chunkId: string
      workspaceId: string
      contentHash: string
      vector: string
    }>,
  ): Promise<Result<number>> {
    if (rows.length === 0) return ok(0)
    const payload = JSON.stringify(
      rows.map((r) => ({
        chunk_id: r.chunkId,
        workspace_id: r.workspaceId,
        content_hash: r.contentHash,
        embedding: r.vector,
      })),
    )
    try {
      const count = await prisma.$executeRaw`
        INSERT INTO ai_vector.ai_knowledge_embeddings (
          chunk_id, workspace_id, model, content_hash, embedding
        )
        SELECT x.chunk_id, x.workspace_id, ${model}, x.content_hash,
          x.embedding::vector
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          chunk_id text, workspace_id text, content_hash text, embedding text
        )
        WHERE EXISTS (
          SELECT 1 FROM ai_knowledge_chunks c WHERE c.id = x.chunk_id
        )
        ON CONFLICT (chunk_id) DO UPDATE SET
          model = EXCLUDED.model,
          content_hash = EXCLUDED.content_hash,
          embedding = EXCLUDED.embedding,
          created_at = now()
      `
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to save knowledge embeddings', error))
    }
  },

  /**
   * Vector half: nearest chunks by cosine distance, only embeddings of the
   * current text and model. HNSW with iterative scan, so the workspace and
   * permission filters do not starve the result (pgvector ≥ 0.8).
   */
  async searchVector(
    q: KnowledgeChunkQuery & { vector: string; model: string },
  ): Promise<Result<KnowledgeChunkHit[]>> {
    if (q.types.length === 0) return ok([])
    try {
      const [, , rows] = await prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('hnsw.ef_search', '100', true)`,
        prisma.$executeRaw`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`,
        prisma.$queryRaw<HitRow[]>`
          SELECT c.id, c.source_type, c.source_id, c.chunk_index, c.title,
            c.content, c.path, c.source_updated_at,
            (1 - (e.embedding <=> ${q.vector}::vector))::float8 AS score
          FROM ai_vector.ai_knowledge_embeddings e
          JOIN ai_knowledge_chunks c
            ON c.id = e.chunk_id AND c.content_hash = e.content_hash
          WHERE e.workspace_id = ${q.workspaceId}
            AND e.model = ${q.model}
            AND c.source_type = ANY(${q.types}::text[])
            AND ${audienceFilter(q)}
          ORDER BY e.embedding <=> ${q.vector}::vector
          LIMIT ${q.limit}
        `,
      ])
      return ok(rows.map(toHit).sort((a, b) => b.score - a.score))
    } catch (error) {
      return err(dbError('Failed to search knowledge embeddings', error))
    }
  },
}
