import type { SiteExperiment } from '@prisma/client'
import {
  experimentResults,
  MIN_TOTAL_CONVERSIONS,
  MIN_VISITORS_PER_VARIANT,
} from '@/src/lib/sites/experiment-stats'
import {
  type ExperimentGoal,
  type ExperimentVariant,
  experimentState,
  type RuntimeExperiment,
} from '@/src/lib/sites/experiments'
import type { SiteExperimentCount } from '@/src/repositories/site-experiment.repository'
import {
  SiteExperimentGoalSchema,
  StoredVariantsSchema,
} from '@/src/schemas/site-experiment.schema'
import type {
  SiteExperimentDTO,
  SiteExperimentResultsDTO,
  SiteExperimentVariantKey,
} from '@/types/site-experiment'

/** Variants stored in the row; an unreadable value is no variant. */
export function experimentVariantsOf(
  experiment: Pick<SiteExperiment, 'variants'>,
): ExperimentVariant[] {
  const parsed = StoredVariantsSchema.safeParse(experiment.variants)
  return parsed.success ? parsed.data : []
}

/** Goal stored in the row; an unreadable value falls back to "any form". */
export function experimentGoalOf(
  experiment: Pick<SiteExperiment, 'goal'>,
): ExperimentGoal {
  const parsed = SiteExperimentGoalSchema.safeParse(experiment.goal)
  return parsed.success ? parsed.data : { type: 'FORM' }
}

/** Fingerprints stored at the start of the run. */
export function experimentFingerprintsOf(
  experiment: Pick<SiteExperiment, 'fingerprints'>,
): Record<string, string> {
  const value = experiment.fingerprints
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

export function toRuntimeExperiment(
  experiment: SiteExperiment,
): RuntimeExperiment {
  return {
    id: experiment.id,
    kind: experiment.kind,
    pageId: experiment.pageId,
    controlNodeId: experiment.controlNodeId,
    variants: experimentVariantsOf(experiment),
    goal: experimentGoalOf(experiment),
    status: experiment.status,
    startsAt: experiment.startsAt?.toISOString() ?? null,
    endsAt: experiment.endsAt?.toISOString() ?? null,
    run: experiment.run,
  }
}

/** Results of the current run from the event counts. */
export function toSiteExperimentResultsDTO(
  experiment: SiteExperiment,
  counts: SiteExperimentCount[],
): SiteExperimentResultsDTO {
  const variants = experimentVariantsOf(experiment)
  const countOf = (key: string, kind: 'EXPOSURE' | 'CONVERSION') =>
    counts.find((row) => row.variantKey === key && row.kind === kind)?.count ??
    0
  const results = experimentResults(
    variants.map((variant) => ({
      key: variant.key,
      visitors: countOf(variant.key, 'EXPOSURE'),
      conversions: countOf(variant.key, 'CONVERSION'),
    })),
  )
  return {
    run: experiment.run,
    variants: results.variants.map((result, index) => ({
      ...result,
      key: result.key as SiteExperimentVariantKey,
      name: variants[index].name,
    })),
    enoughData: results.enoughData,
    winner: results.winner as SiteExperimentVariantKey | null,
    totals: results.totals,
    minVisitorsPerVariant: MIN_VISITORS_PER_VARIANT,
    minConversions: MIN_TOTAL_CONVERSIONS,
  }
}

export function toSiteExperimentDTO(
  experiment: SiteExperiment,
  input: {
    counts: SiteExperimentCount[]
    unpublishedVariants: SiteExperimentVariantKey[]
    now: Date
  },
): SiteExperimentDTO {
  const runtime = toRuntimeExperiment(experiment)
  return {
    id: experiment.id,
    siteId: experiment.siteId,
    pageId: experiment.pageId,
    name: experiment.name,
    kind: experiment.kind,
    status: experiment.status,
    state: experimentState(runtime, input.now),
    controlNodeId: experiment.controlNodeId,
    variants: runtime.variants,
    goal: runtime.goal,
    startsAt: runtime.startsAt,
    endsAt: runtime.endsAt,
    run: experiment.run,
    startedAt: experiment.startedAt?.toISOString() ?? null,
    endedAt: experiment.endedAt?.toISOString() ?? null,
    winnerKey: (experiment.winnerKey as SiteExperimentVariantKey) ?? null,
    createdAt: experiment.createdAt.toISOString(),
    updatedAt: experiment.updatedAt.toISOString(),
    results: toSiteExperimentResultsDTO(experiment, input.counts),
    unpublishedVariants: input.unpublishedVariants,
  }
}
