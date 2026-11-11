import type { AiModelPricing } from '@/src/lib/ai/models'
import { priceAiUsage } from '@/src/lib/ai/quota'
import type { AiUsageTokens } from '@/src/lib/ai/types'

/**
 * Cost estimate shown before an AI import: typical tokens of the outline
 * call priced with the workspace's model and the platform margin (ADR
 * 0019), like the site generator. A page read natively costs its text plus
 * the page image; the outline repeats the text of the page. "About", not a
 * cap — a repair turn costs more.
 */

export const DOCUMENT_AI_TYPICAL_USAGE = {
  /** System prompt + schema + instructions of any call. */
  base: { inputTokens: 3_500, outputTokens: 300 },
  /** One page of a file (PDF page image + text, then its outline). */
  page: { inputTokens: 2_000, outputTokens: 900 },
  /** A document written from a request in text. */
  prompt: { inputTokens: 600, outputTokens: 5_000 },
} satisfies Record<string, AiUsageTokens>

/** Rounds up to the fraction the UI shows (US$ 0.001). */
function roundUp(value: number): number {
  return Math.ceil(value * 1000) / 1000
}

export interface DocumentAiEstimate {
  /** Fixed part of any import. */
  baseUsd: number
  /** Each page of a PDF or DOCX. */
  pageUsd: number
  /** A whole document from a prompt (base included). */
  promptUsd: number
}

export function estimateDocumentAi(
  pricing: AiModelPricing,
  margin = 1,
): DocumentAiEstimate {
  const price = (usage: AiUsageTokens) => priceAiUsage(pricing, usage, margin)
  const base = price(DOCUMENT_AI_TYPICAL_USAGE.base)
  return {
    baseUsd: roundUp(base),
    pageUsd: roundUp(price(DOCUMENT_AI_TYPICAL_USAGE.page)),
    promptUsd: roundUp(base + price(DOCUMENT_AI_TYPICAL_USAGE.prompt)),
  }
}

/** Estimated cost of importing a file with `pages` pages. */
export function estimateDocumentImport(
  estimate: Pick<DocumentAiEstimate, 'baseUsd' | 'pageUsd'>,
  pages: number,
): number {
  return roundUp(estimate.baseUsd + estimate.pageUsd * Math.max(1, pages))
}

/**
 * Pages of a file before it is read: a DOCX (or a PDF in the browser) has
 * no page count yet, so ~60 KB per page is assumed, bounded to the limit.
 */
export function guessPages(bytes: number, maxPages: number): number {
  return Math.min(maxPages, Math.max(1, Math.round(bytes / 60_000)))
}
