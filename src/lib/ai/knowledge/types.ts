import type { ModuleKind } from '@prisma/client'
import type { SearchAudience } from '@/src/lib/search/search-entities'
import type { KnowledgeSourceType } from './sources'

/** One source record, as the indexer reads it (before chunking). */
export interface KnowledgeDocument {
  workspaceId: string
  sourceType: KnowledgeSourceType
  sourceId: string
  module: ModuleKind | null
  audience: SearchAudience
  /** Ticket requester/participants — `PARTIES` access. */
  userIds: string[]
  title: string
  /** Plain text to chunk (the title is stored apart, weight A). */
  text: string
  /** App path relative to the workspace (`/wiki/<id>`). */
  path: string
  updatedAt: Date
}

/** One row of `ai_knowledge_chunks`, as the repository writes it. */
export interface KnowledgeChunkInput {
  workspaceId: string
  sourceType: KnowledgeSourceType
  sourceId: string
  chunkIndex: number
  module: ModuleKind | null
  audience: SearchAudience
  userIds: string[]
  title: string
  content: string
  path: string
  contentHash: string
  sourceUpdatedAt: Date
}

/** A matched chunk; `score` is ts_rank or cosine similarity. */
export interface KnowledgeChunkHit {
  id: string
  sourceType: KnowledgeSourceType
  sourceId: string
  chunkIndex: number
  title: string
  content: string
  path: string
  sourceUpdatedAt: Date
  score: number
}

export interface KnowledgeChunkQuery {
  workspaceId: string
  userId: string
  /** Source types the user may see; empty = nothing. */
  types: KnowledgeSourceType[]
  /** ServiceDesk agent: sees `AGENTS`/`PARTIES` chunks. */
  isSdAgent: boolean
  limit: number
}

/** Chunk whose embedding is missing or stale. */
export interface KnowledgeChunkToEmbed {
  id: string
  workspaceId: string
  title: string
  content: string
  contentHash: string
}
