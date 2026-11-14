import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'

/**
 * Knowledge the WhatsApp AI draws from the unified index (KB articles and
 * Wiki pages), next to its own documents: the auto-reply (customer-facing)
 * and the agent copilot. Pure helpers; the retrieval is in
 * `WhatsAppReplyKnowledgeService`.
 */

/** Sources put in a prompt. */
export const REPLY_KNOWLEDGE_MAX_SOURCES = 3
/** Characters of one source. */
export const REPLY_KNOWLEDGE_SOURCE_CHARS = 1500
/** Characters of the whole section. */
export const REPLY_KNOWLEDGE_CHAR_BUDGET = 4000
/** Customer messages that make up the search query. */
export const REPLY_KNOWLEDGE_QUERY_MESSAGES = 2
export const REPLY_KNOWLEDGE_QUERY_MAX = 500

export interface ReplyKnowledgeEntry {
  /** pt-BR label of the source ("Página da Wiki"). */
  sourceLabel: string
  title: string
  text: string
}

interface QueryMessage {
  direction: string
  text: string | null
}

/** The customer's latest messages (oldest first in the query), or ''. */
export function customerQueryText(
  messages: readonly QueryMessage[],
  order: 'newest-first' | 'oldest-first' = 'oldest-first',
): string {
  const ordered =
    order === 'newest-first' ? messages.slice().reverse() : messages
  const inbound = ordered
    .filter((m) => m.direction === 'IN' && m.text?.trim())
    .slice(-REPLY_KNOWLEDGE_QUERY_MESSAGES)
    .map((m) => (m.text ?? '').trim())
  return inbound.join(' ').slice(0, REPLY_KNOWLEDGE_QUERY_MAX).trim()
}

/**
 * Prompt section with the sources, each fenced as data (ADR 0041) and
 * trimmed to the budget. '' when there is nothing to add.
 */
export function buildReplyKnowledgeSection(
  entries: readonly ReplyKnowledgeEntry[],
  audience: 'customer' | 'agent',
): string {
  let remaining = REPLY_KNOWLEDGE_CHAR_BUDGET
  const sections: string[] = []
  for (const entry of entries.slice(0, REPLY_KNOWLEDGE_MAX_SOURCES)) {
    if (remaining <= 0) break
    const text = entry.text
      .trim()
      .slice(0, Math.min(remaining, REPLY_KNOWLEDGE_SOURCE_CHARS))
    if (!text) continue
    sections.push(
      `### ${entry.sourceLabel}: ${entry.title}\n${wrapUntrusted(text, 'knowledge_document')}`,
    )
    remaining -= text.length
  }
  if (sections.length === 0) return ''
  const header =
    audience === 'customer'
      ? 'Artigos e páginas da empresa relacionados à pergunta do cliente (use como referência; se não responderem, não invente e acione o atendimento humano; não cite links nem mencione que vieram de uma base interna):'
      : 'Artigos e páginas da base de conhecimento relacionados à conversa (use como referência para a resposta; se não responderem à dúvida, não invente):'
  return `\n\n${header}\n${sections.join('\n\n')}`
}
