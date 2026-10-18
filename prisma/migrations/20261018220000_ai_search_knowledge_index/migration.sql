-- Steel AI knowledge search (ADR 0037): chunk table with Portuguese
-- full-text search, plus an optional pgvector sidecar for the semantic half.

-- AlterEnum
ALTER TYPE "AiUsageFeature" ADD VALUE 'KNOWLEDGE_SEARCH';

-- AlterTable
ALTER TABLE "platform_ai_settings" ADD COLUMN "embeddings_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ai_knowledge_chunks" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "module" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'PUBLIC',
    "user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "indexed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- A = title, B = chunk text. f_unaccent comes from the global search
    -- migration (20261007135544_search_global_index).
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('portuguese'::regconfig, f_unaccent(coalesce("title", ''))), 'A') ||
        setweight(to_tsvector('portuguese'::regconfig, f_unaccent(coalesce("content", ''))), 'B')
    ) STORED,

    CONSTRAINT "ai_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_chunks_workspace_id_source_type_source_id_chun_key" ON "ai_knowledge_chunks"("workspace_id", "source_type", "source_id", "chunk_index");

-- CreateIndex
CREATE INDEX "ai_knowledge_chunks_search_vector_idx" ON "ai_knowledge_chunks" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "ai_knowledge_chunks_workspace_id_source_type_indexed_at_idx" ON "ai_knowledge_chunks"("workspace_id", "source_type", "indexed_at");

-- AddForeignKey
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Semantic half (pgvector). It lives in its own schema, outside what Prisma
-- introspects, so a database with pgvector and one without have the same
-- Prisma schema and `migrate dev` never proposes to drop or add it. The
-- function is idempotent and returns whether the sidecar exists: the
-- migration calls it now, and the nightly `ai-index` reindex (or
-- `pnpm ai:index`) calls it again, so a server that gets pgvector later
-- (docs/runbooks/postgres-pgvector.md) gains the sidecar without a new
-- migration. Without pgvector the search runs on full-text only.
DROP SCHEMA IF EXISTS ai_vector CASCADE;

CREATE OR REPLACE FUNCTION ai_knowledge_enable_vector() RETURNS boolean
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF to_regclass('ai_vector.ai_knowledge_embeddings') IS NOT NULL THEN
    RETURN true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RETURN false;
  END IF;
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
  EXECUTE 'CREATE SCHEMA IF NOT EXISTS ai_vector';
  -- 1536 = text-embedding-3-small (src/lib/ai/knowledge/embeddings.ts).
  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS ai_vector.ai_knowledge_embeddings (
      chunk_id TEXT PRIMARY KEY
        REFERENCES public.ai_knowledge_chunks(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      model TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding vector(1536) NOT NULL,
      created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  $ddl$;
  EXECUTE 'CREATE INDEX IF NOT EXISTS ai_knowledge_embeddings_hnsw_idx ON ai_vector.ai_knowledge_embeddings USING hnsw (embedding vector_cosine_ops)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS ai_knowledge_embeddings_workspace_idx ON ai_vector.ai_knowledge_embeddings (workspace_id)';
  RETURN true;
END
$$;

SELECT ai_knowledge_enable_vector();
