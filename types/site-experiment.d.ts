/** Sites wave S4: A/B tests of published sites. */

export type SiteExperimentVariantKey = 'A' | 'B' | 'C'

export interface SiteExperimentVariantDTO {
  key: SiteExperimentVariantKey
  name: string
  /** Share of the traffic in %. */
  weight: number
  /** SECTION test: node of the variant in the page document. */
  nodeId?: string
  /** PAGE test: page of the variant. */
  pageId?: string
}

export type SiteExperimentGoalDTO =
  | { type: 'FORM'; formToken?: string }
  | { type: 'CLICK'; nodeId: string; label?: string }
  | { type: 'PAGE'; pageId: string }

export type SiteExperimentStatus = 'DRAFT' | 'RUNNING' | 'PAUSED' | 'ENDED'

/** Status as shown (a running test before its start is `SCHEDULED`, after
 * its end `ENDED`). */
export type SiteExperimentState =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'ENDED'

export interface SiteExperimentVariantResultDTO {
  key: SiteExperimentVariantKey
  name: string
  /** Distinct visitors exposed in the current run. */
  visitors: number
  /** Exposed visitors that reached the goal. */
  conversions: number
  /** conversions / visitors (0–1). */
  rate: number
  /** Relative change over the control (`null` for the control). */
  uplift: number | null
  /** Probability of beating the control (0–1; `null` for the control). */
  probabilityToBeat: number | null
}

export interface SiteExperimentResultsDTO {
  run: number
  variants: SiteExperimentVariantResultDTO[]
  /** Enough data to read the probabilities ("ainda sem dados suficientes"
   * otherwise). */
  enoughData: boolean
  winner: SiteExperimentVariantKey | null
  totals: { visitors: number; conversions: number }
  minVisitorsPerVariant: number
  minConversions: number
}

export interface SiteExperimentDTO {
  id: string
  siteId: string
  pageId: string
  name: string
  kind: 'SECTION' | 'PAGE'
  status: SiteExperimentStatus
  state: SiteExperimentState
  controlNodeId: string | null
  variants: SiteExperimentVariantDTO[]
  goal: SiteExperimentGoalDTO
  startsAt: string | null
  endsAt: string | null
  run: number
  startedAt: string | null
  endedAt: string | null
  winnerKey: SiteExperimentVariantKey | null
  createdAt: string
  updatedAt: string
  results: SiteExperimentResultsDTO
  /** Variants missing from the published version (publish to start). */
  unpublishedVariants: SiteExperimentVariantKey[]
}

/** Running tests whose variants the next publish changes (it restarts
 * them). */
export interface SiteExperimentImpactDTO {
  experiments: Array<{
    id: string
    name: string
    variants: SiteExperimentVariantKey[]
  }>
}
