import {
  chunkKnowledgeText,
  jsonToKnowledgeText,
  knowledgeContentHash,
} from '@/src/lib/ai/knowledge/chunking'
import type { FusedChunk } from '@/src/lib/ai/knowledge/fusion'
import { snippetAround } from '@/src/lib/ai/knowledge/fusion'
import { KNOWLEDGE_SOURCES } from '@/src/lib/ai/knowledge/sources'
import type {
  KnowledgeChunkHit,
  KnowledgeChunkInput,
  KnowledgeDocument,
} from '@/src/lib/ai/knowledge/types'
import { stripHtml, userIdsOf } from '@/src/lib/search/search-document'
import {
  formatSdTicketCode,
  resolveSdTicketPrefixes,
} from '@/src/lib/servicedesk/ticket-code'
import { plateToPlainText } from '@/src/lib/sites/blog/plate'
import type {
  KnowledgeCrmNoteRow,
  KnowledgeCrmProposalRow,
  KnowledgeKbArticleRow,
  KnowledgeTicketRow,
  KnowledgeWikiPageRow,
  KnowledgeZapDocumentRow,
} from '@/src/repositories/ai-knowledge-source.repository'
import type { AiCitationDTO, AiKnowledgeResultDTO } from '@/types/ai-knowledge'

/**
 * Source rows → `KnowledgeDocument` (what gets chunked), documents →
 * chunk rows, and fused hits → the search DTO. Pure.
 */

/** Text kept per source before chunking (bounds a huge page). */
const SOURCE_TEXT_MAX = 60_000
/** Ticket description kept as context of the solution. */
const TICKET_PROBLEM_MAX = 1_500

function recordPath(base: string, id: string): string {
  return `${base}?record=${encodeURIComponent(id)}`
}

function joinLines(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join('\n')
}

export function toKbArticleKnowledge(
  workspaceId: string,
  row: KnowledgeKbArticleRow,
): KnowledgeDocument {
  return {
    workspaceId,
    sourceType: 'sd-kb-article',
    sourceId: row.id,
    module: 'SERVICE_DESK',
    // Requesters see only what the portal shows (published + PORTAL).
    audience: row.visibility === 'PORTAL' ? 'PUBLIC' : 'AGENTS',
    userIds: [],
    title: row.title,
    text: joinLines([
      row.category?.name ? `Categoria: ${row.category.name}` : null,
      row.plainText,
      row.tags.length ? `Tags: ${row.tags.join(', ')}` : null,
    ]).slice(0, SOURCE_TEXT_MAX),
    path: `/servicedesk/knowledge/${row.id}`,
    updatedAt: row.updatedAt,
  }
}

export function toWikiPageKnowledge(
  workspaceId: string,
  row: KnowledgeWikiPageRow,
): KnowledgeDocument {
  const text =
    plateToPlainText(row.content, SOURCE_TEXT_MAX) ||
    jsonToKnowledgeText(row.content, SOURCE_TEXT_MAX)
  return {
    workspaceId,
    sourceType: 'wiki-page',
    sourceId: row.id,
    module: null,
    audience: 'PUBLIC',
    userIds: [],
    title: row.title.trim() || 'Sem título',
    text,
    path: `/wiki/${row.id}`,
    updatedAt: row.updatedAt,
  }
}

export function toTicketKnowledge(
  workspaceId: string,
  row: KnowledgeTicketRow,
  rawPrefixes: unknown,
): KnowledgeDocument {
  const code = formatSdTicketCode(
    row.type,
    row.number,
    resolveSdTicketPrefixes(rawPrefixes),
  )
  const problem = stripHtml(row.description).slice(0, TICKET_PROBLEM_MAX)
  return {
    workspaceId,
    sourceType: 'sd-ticket',
    sourceId: row.id,
    module: 'SERVICE_DESK',
    audience: 'PARTIES',
    userIds: userIdsOf([
      row.requesterId,
      row.contact?.userId,
      ...row.participants.map((p) => p.userId),
    ]),
    title: `${code} · ${row.title}`,
    text: joinLines([
      problem ? `Problema: ${problem}` : null,
      `Solução: ${stripHtml(row.solution)}`,
    ]).slice(0, SOURCE_TEXT_MAX),
    path: `/servicedesk/tickets/${row.number}`,
    updatedAt: row.updatedAt,
  }
}

export function toZapDocumentKnowledge(
  workspaceId: string,
  row: KnowledgeZapDocumentRow,
): KnowledgeDocument {
  return {
    workspaceId,
    sourceType: 'zap-knowledge-doc',
    sourceId: row.id,
    module: 'COMMUNICATION',
    audience: 'PUBLIC',
    userIds: [],
    title: row.filename,
    text: (row.extractedText ?? '').slice(0, SOURCE_TEXT_MAX),
    path: '/zap/configuracoes',
    updatedAt: row.updatedAt,
  }
}

/** The record a note is attached to (the citation opens it). */
function noteTarget(row: KnowledgeCrmNoteRow): { name: string; path: string } {
  if (row.opportunityId) {
    return {
      name: row.opportunity?.name ?? '',
      path: recordPath('/crm/opportunities', row.opportunityId),
    }
  }
  if (row.leadId) {
    return {
      name: row.lead?.name ?? '',
      path: recordPath('/crm/leads', row.leadId),
    }
  }
  if (row.personId) {
    return {
      name: row.person?.name ?? '',
      path: recordPath('/crm/people', row.personId),
    }
  }
  if (row.companyId) {
    return {
      name: row.company?.name ?? '',
      path: recordPath('/crm/companies', row.companyId),
    }
  }
  return { name: '', path: '/crm' }
}

export function toCrmNoteKnowledge(
  workspaceId: string,
  row: KnowledgeCrmNoteRow,
): KnowledgeDocument {
  const target = noteTarget(row)
  const fallback = target.name ? `Nota sobre ${target.name}` : 'Nota do CRM'
  return {
    workspaceId,
    sourceType: 'crm-note',
    sourceId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    userIds: [],
    title: row.title?.trim() || fallback,
    text: joinLines([
      target.name ? `Registro: ${target.name}` : null,
      stripHtml(row.body),
    ]).slice(0, SOURCE_TEXT_MAX),
    path: target.path,
    updatedAt: row.updatedAt,
  }
}

export function toCrmProposalKnowledge(
  workspaceId: string,
  row: KnowledgeCrmProposalRow,
): KnowledgeDocument {
  const client = row.company?.name ?? row.lead?.name ?? null
  return {
    workspaceId,
    sourceType: 'crm-proposal',
    sourceId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    userIds: [],
    title: row.name,
    text: joinLines([
      client ? `Cliente: ${client}` : null,
      ...row.sections.map((s) => jsonToKnowledgeText(s.content)),
    ]).slice(0, SOURCE_TEXT_MAX),
    path: `/crm/proposals/${row.id}`,
    updatedAt: row.updatedAt,
  }
}

/** Chunks of a document, `chunkIndex` 0..n-1 (none when it has no text). */
export function toKnowledgeChunks(
  doc: KnowledgeDocument,
): KnowledgeChunkInput[] {
  return chunkKnowledgeText(doc.text).map((content, chunkIndex) => ({
    workspaceId: doc.workspaceId,
    sourceType: doc.sourceType,
    sourceId: doc.sourceId,
    chunkIndex,
    module: doc.module,
    audience: doc.audience,
    userIds: doc.userIds,
    title: doc.title,
    content,
    path: doc.path,
    contentHash: knowledgeContentHash(doc.title, content),
    sourceUpdatedAt: doc.updatedAt,
  }))
}

/** What the embedding sees: the title gives every chunk its context. */
export function toEmbeddingInput(chunk: {
  title: string
  content: string
}): string {
  return `${chunk.title}\n\n${chunk.content}`
}

export function toAiKnowledgeResultDTO(
  entry: FusedChunk<KnowledgeChunkHit>,
  slug: string,
  queryWords: readonly string[],
): AiKnowledgeResultDTO {
  const { chunk } = entry
  return {
    sourceType: chunk.sourceType,
    sourceLabel: KNOWLEDGE_SOURCES[chunk.sourceType].label,
    sourceId: chunk.sourceId,
    title: chunk.title,
    snippet: snippetAround(chunk.content, queryWords),
    href: `/${slug}${chunk.path}`,
    updatedAt: chunk.sourceUpdatedAt.toISOString(),
    score: Math.round(entry.score * 1_000_000) / 1_000_000,
    matchedBy: [
      ...(entry.ranks.text !== undefined ? (['text'] as const) : []),
      ...(entry.ranks.vector !== undefined ? (['vector'] as const) : []),
    ],
  }
}

export function toAiCitationDTO(result: AiKnowledgeResultDTO): AiCitationDTO {
  return {
    sourceType: result.sourceType,
    label: result.sourceLabel,
    title: result.title,
    href: result.href,
  }
}
