import { z } from 'zod'
import { dto } from '../../common'

/** DTOs dos testes A/B dos sites (S4) — `types/site-experiment.d.ts`. */

const KEY = z.enum(['A', 'B', 'C'])

const VARIANT = z.object({
  key: KEY,
  name: z.string().meta({ example: 'Variante B' }),
  weight: z.number().int().meta({ example: 50 }),
  nodeId: z.string().optional(),
  pageId: z.string().optional(),
})

const GOAL = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FORM'), formToken: z.string().optional() }),
  z.object({
    type: z.literal('CLICK'),
    nodeId: z.string(),
    label: z.string().optional(),
  }),
  z.object({ type: z.literal('PAGE'), pageId: z.string() }),
])

const RESULT = z.object({
  key: KEY,
  name: z.string(),
  visitors: z.number().int(),
  conversions: z.number().int(),
  rate: z.number().meta({ example: 0.052 }),
  uplift: z.number().nullable().meta({ example: 0.18 }),
  probabilityToBeat: z.number().nullable().meta({ example: 0.93 }),
})

export const SiteExperimentDTOSchema = dto(
  'SiteExperiment',
  z.object({
    id: z.string(),
    siteId: z.string(),
    pageId: z.string(),
    name: z.string().meta({ example: 'Hero com prova social' }),
    kind: z.enum(['SECTION', 'PAGE']),
    status: z.enum(['DRAFT', 'RUNNING', 'PAUSED', 'ENDED']),
    state: z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'ENDED']),
    controlNodeId: z.string().nullable(),
    variants: z.array(VARIANT),
    goal: GOAL,
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    run: z.number().int(),
    startedAt: z.iso.datetime().nullable(),
    endedAt: z.iso.datetime().nullable(),
    winnerKey: KEY.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    results: z.object({
      run: z.number().int(),
      variants: z.array(RESULT),
      enoughData: z.boolean(),
      winner: KEY.nullable(),
      totals: z.object({
        visitors: z.number().int(),
        conversions: z.number().int(),
      }),
      minVisitorsPerVariant: z.number().int(),
      minConversions: z.number().int(),
    }),
    unpublishedVariants: z.array(KEY),
  }),
)

export const SiteExperimentImpactDTOSchema = dto(
  'SiteExperimentImpact',
  z.object({
    experiments: z.array(
      z.object({ id: z.string(), name: z.string(), variants: z.array(KEY) }),
    ),
  }),
)
