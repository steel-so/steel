import { createId } from '@paralleldrive/cuid2'
import { knowledgeContentHash } from '@/src/lib/ai/knowledge/chunking'
import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from '@/src/lib/ai/knowledge/embeddings'
import type { FusedChunk } from '@/src/lib/ai/knowledge/fusion'
import type {
  KnowledgeChunkHit,
  KnowledgeChunkInput,
  KnowledgeDocument,
} from '@/src/lib/ai/knowledge/types'
import type { AiKnowledgeResultDTO } from '@/types/ai-knowledge'

const T = new Date('2026-10-01T12:00:00.000Z')

export function createFakeKnowledgeDocument(
  overrides: Partial<KnowledgeDocument> = {},
): KnowledgeDocument {
  return {
    workspaceId: 'ws1',
    sourceType: 'wiki-page',
    sourceId: createId(),
    module: null,
    audience: 'PUBLIC',
    userIds: [],
    title: 'Como trocar a senha do Wi-Fi',
    text: 'Abra o painel do roteador e altere a senha da rede.',
    path: '/wiki/page1',
    updatedAt: T,
    ...overrides,
  }
}

export function createFakeKnowledgeChunk(
  overrides: Partial<KnowledgeChunkInput> = {},
): KnowledgeChunkInput {
  const title = overrides.title ?? 'Como trocar a senha do Wi-Fi'
  const content =
    overrides.content ?? 'Abra o painel do roteador e altere a senha da rede.'
  return {
    workspaceId: 'ws1',
    sourceType: 'wiki-page',
    sourceId: 'page1',
    chunkIndex: 0,
    module: null,
    audience: 'PUBLIC',
    userIds: [],
    path: '/wiki/page1',
    sourceUpdatedAt: T,
    ...overrides,
    title,
    content,
    contentHash: overrides.contentHash ?? knowledgeContentHash(title, content),
  }
}

export function createFakeKnowledgeHit(
  overrides: Partial<KnowledgeChunkHit> = {},
): KnowledgeChunkHit {
  return {
    id: createId(),
    sourceType: 'wiki-page',
    sourceId: 'page1',
    chunkIndex: 0,
    title: 'Como trocar a senha do Wi-Fi',
    content: 'Abra o painel do roteador e altere a senha da rede.',
    path: '/wiki/page1',
    sourceUpdatedAt: T,
    score: 0.5,
    ...overrides,
  }
}

export function createFakeFusedChunk(
  overrides: Partial<KnowledgeChunkHit> = {},
  fused: Partial<Omit<FusedChunk<KnowledgeChunkHit>, 'chunk'>> = {},
): FusedChunk<KnowledgeChunkHit> {
  return {
    chunk: createFakeKnowledgeHit(overrides),
    score: 1 / 61,
    ranks: { text: 1 },
    ...fused,
  }
}

export function createFakeKnowledgeResultDTO(
  overrides: Partial<AiKnowledgeResultDTO> = {},
): AiKnowledgeResultDTO {
  return {
    sourceType: 'wiki-page',
    sourceLabel: 'Página da Wiki',
    sourceId: 'page1',
    title: 'Como trocar a senha do Wi-Fi',
    snippet: 'Abra o painel do roteador e altere a senha da rede.',
    href: '/demo/wiki/page1',
    updatedAt: T.toISOString(),
    score: 0.016393,
    matchedBy: ['text'],
    ...overrides,
  }
}

/**
 * Deterministic unit vector pointing mostly at `axis` (cosine similarity
 * between two of them is ~1 for the same axis and ~0 for different ones).
 */
export function fakeEmbedding(axis: number, wobble = 0): number[] {
  const vector = new Array<number>(KNOWLEDGE_EMBEDDING_DIMENSIONS).fill(0)
  vector[axis % KNOWLEDGE_EMBEDDING_DIMENSIONS] = 1
  if (wobble) vector[(axis + 1) % KNOWLEDGE_EMBEDDING_DIMENSIONS] = wobble
  const norm = Math.hypot(...vector)
  return vector.map((v) => v / norm)
}
