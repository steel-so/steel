import type { AiModelPricing } from '@/src/lib/ai/models'
import { priceAiUsage } from '@/src/lib/ai/quota'
import type { AiUsageTokens } from '@/src/lib/ai/types'

/**
 * Cost estimate shown before each AI action: typical token counts of one
 * call (measured on real generations, rounded up) priced with the
 * workspace's model and the platform margin — the same rule the usage
 * ledger applies afterwards (ADR 0019). A repair turn costs more; the
 * estimate is "about", not a cap.
 */

export const SITE_AI_TYPICAL_USAGE = {
  plan: { inputTokens: 2_200, outputTokens: 700 },
  page: { inputTokens: 3_200, outputTokens: 2_000 },
  /** Two calls: pick the section, then write it. */
  section: { inputTokens: 3_400, outputTokens: 1_300 },
  rewrite: { inputTokens: 3_500, outputTokens: 2_400 },
  images: { inputTokens: 2_600, outputTokens: 900 },
} satisfies Record<string, AiUsageTokens>

/** Rounds up to the cent fraction the UI shows (US$ 0.001). */
function roundUp(value: number): number {
  return Math.ceil(value * 1000) / 1000
}

export function estimateSiteAi(pricing: AiModelPricing, margin = 1) {
  const price = (usage: AiUsageTokens) =>
    roundUp(priceAiUsage(pricing, usage, margin))
  return {
    planUsd: price(SITE_AI_TYPICAL_USAGE.plan),
    pageUsd: price(SITE_AI_TYPICAL_USAGE.page),
    sectionUsd: price(SITE_AI_TYPICAL_USAGE.section),
    rewriteUsd: price(SITE_AI_TYPICAL_USAGE.rewrite),
    imagesUsd: price(SITE_AI_TYPICAL_USAGE.images),
  }
}

/** Estimated cost of generating a site with `pageCount` pages. */
export function estimateSiteGeneration(
  estimate: { planUsd: number; pageUsd: number },
  pageCount: number,
): number {
  return roundUp(estimate.planUsd + estimate.pageUsd * Math.max(1, pageCount))
}
