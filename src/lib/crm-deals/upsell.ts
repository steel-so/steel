export type SurveyKind = 'NPS' | 'CSAT' | 'CES'
export type HealthLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface UpsellSatisfaction {
  kind: SurveyKind
  score: number
  answeredAt: Date
}

export type UpsellTiming = 'GO' | 'WAIT' | 'NEUTRAL'

export interface UpsellTimingResult {
  timing: UpsellTiming
  reason: string
}

/** NPS: 9-10 promoters, 0-6 detractors. CSAT/CES scales are 1-5. */
function isPromoter(s: UpsellSatisfaction): boolean {
  return s.kind === 'NPS' ? s.score >= 9 : s.score >= 4
}

function isDetractor(s: UpsellSatisfaction): boolean {
  return s.kind === 'NPS' ? s.score <= 6 : s.score <= 2
}

/**
 * Is it a good moment to offer more? Uses the latest survey answer (T1) and
 * the customer health (T4): never push an upsell onto a customer at high
 * churn risk or who just gave a low score.
 */
export function upsellTiming(
  satisfaction: UpsellSatisfaction | null,
  healthLevel: HealthLevel | null,
): UpsellTimingResult {
  if (healthLevel === 'HIGH') {
    return {
      timing: 'WAIT',
      reason: 'A saúde do cliente está em risco alto: resolva isso antes de vender mais.',
    }
  }
  if (satisfaction && isDetractor(satisfaction)) {
    return {
      timing: 'WAIT',
      reason: 'A última pesquisa de satisfação teve nota baixa: trate o motivo antes de oferecer algo novo.',
    }
  }
  if (satisfaction && isPromoter(satisfaction) && healthLevel !== 'MEDIUM') {
    return {
      timing: 'GO',
      reason: 'O cliente é promotor na última pesquisa e a saúde está boa: bom momento para ampliar.',
    }
  }
  return {
    timing: 'NEUTRAL',
    reason: satisfaction
      ? 'Sem sinal forte de satisfação ou de risco.'
      : 'Sem pesquisa de satisfação respondida deste cliente.',
  }
}

export interface UpsellCandidate {
  productId: string
  name: string
  /** Peer customers that bought it. */
  buyers: number
  /** Peer customers considered. */
  peers: number
  unitPrice: number | null
}

export interface UpsellSuggestion extends UpsellCandidate {
  /** Share of the peers that bought it (0-100). */
  adoptionPct: number
}

/** Most adopted products first; ties by name for a stable order. */
export function rankUpsell(
  candidates: UpsellCandidate[],
  limit: number,
): UpsellSuggestion[] {
  return candidates
    .filter((candidate) => candidate.buyers > 0 && candidate.peers > 0)
    .map((candidate) => ({
      ...candidate,
      adoptionPct: Math.round((candidate.buyers / candidate.peers) * 100),
    }))
    .sort((a, b) => b.buyers - a.buyers || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, limit)
}

export interface PeerItemRow {
  productId: string
  name: string
  unitPrice: number
  companyId: string
}

/**
 * Peer adoption: among the customers who already bought what this account
 * owns (or among all customers when it owns nothing), how many bought each
 * other product? Pure so the ranking is easy to verify.
 */
export function computePeerAdoption(
  rows: PeerItemRow[],
  ownedProductIds: ReadonlySet<string>,
): UpsellCandidate[] {
  const byCompany = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = byCompany.get(row.companyId) ?? new Set<string>()
    set.add(row.productId)
    byCompany.set(row.companyId, set)
  }
  const peerIds = [...byCompany.entries()]
    .filter(
      ([, products]) =>
        ownedProductIds.size === 0 ||
        [...ownedProductIds].some((id) => products.has(id)),
    )
    .map(([companyId]) => companyId)
  const peers = new Set(peerIds)

  const byProduct = new Map<string, UpsellCandidate>()
  const buyers = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!peers.has(row.companyId) || ownedProductIds.has(row.productId)) continue
    const set = buyers.get(row.productId) ?? new Set<string>()
    set.add(row.companyId)
    buyers.set(row.productId, set)
    byProduct.set(row.productId, {
      productId: row.productId,
      name: row.name,
      buyers: set.size,
      peers: peers.size,
      unitPrice: row.unitPrice,
    })
  }
  return [...byProduct.values()]
}

/** Phone variants a survey may have stored (digits only, with and without 55). */
export function phoneVariants(phones: string[]): string[] {
  const variants = new Set<string>()
  for (const phone of phones) {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 8) continue
    variants.add(digits)
    if (!digits.startsWith('55')) variants.add(`55${digits}`)
  }
  return [...variants]
}
