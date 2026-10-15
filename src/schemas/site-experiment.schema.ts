import z from 'zod'
import { EXPERIMENT_VARIANT_KEYS } from '@/src/lib/sites/experiments'

/** A site keeps at most this many tests (any status). */
export const MAX_EXPERIMENTS_PER_SITE = 50

const nodeId = z.string().min(1).max(60)
const pageId = z.string().min(1).max(40)
const weight = z.number().int().min(1).max(99)
const isoDate = z.iso.datetime({ offset: true }).nullable()

export const SiteExperimentGoalSchema = z.discriminatedUnion('type', [
  /** A CRM form sent from the site (any form, or the one with this token). */
  z.object({
    type: z.literal('FORM'),
    formToken: z.string().trim().min(1).max(64).optional(),
  }),
  /** A click on a button or link (the node of the published document). */
  z.object({
    type: z.literal('CLICK'),
    nodeId,
    label: z.string().trim().max(120).optional(),
  }),
  /** Reaching a page of the site (thank-you page, pricing…). */
  z.object({ type: z.literal('PAGE'), pageId }),
])

export type SiteExperimentGoalDTO = z.infer<typeof SiteExperimentGoalSchema>

export const SiteExperimentVariantSchema = z.object({
  key: z.enum(EXPERIMENT_VARIANT_KEYS),
  name: z.string().trim().min(1, 'Dê um nome à variante').max(60),
  weight,
  nodeId: nodeId.optional(),
  pageId: pageId.optional(),
})

export type SiteExperimentVariantDTO = z.infer<
  typeof SiteExperimentVariantSchema
>

const sumsTo100 = (weights: number[]) =>
  weights.reduce((sum, value) => sum + value, 0) === 100

const SPLIT_MESSAGE = 'A divisão do tráfego precisa somar 100%'

function checkSchedule(
  value: { startsAt?: string | null; endsAt?: string | null },
  ctx: z.RefinementCtx,
) {
  if (
    value.startsAt &&
    value.endsAt &&
    new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'O fim precisa ser depois do início',
    })
  }
}

export const CreateSiteExperimentSchema = z
  .object({
    name: z.string().trim().min(1, 'Dê um nome ao teste').max(120),
    kind: z.enum(['SECTION', 'PAGE']),
    /** Page the test runs on. */
    pageId,
    /** SECTION: the section under test and its variant copies (B, C),
     * already in the draft (the editor creates them). */
    controlNodeId: nodeId.optional(),
    variantNodeIds: z.array(nodeId).min(1).max(2).optional(),
    /** PAGE: how many copies of the page to create (B, C). */
    variantCount: z.number().int().min(1).max(2).default(1),
    /** Split in % per variant, control first; default: even. */
    weights: z.array(weight).min(2).max(3).optional(),
    goal: SiteExperimentGoalSchema.default({ type: 'FORM' }),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'SECTION') {
      if (!value.controlNodeId) {
        ctx.addIssue({
          code: 'custom',
          path: ['controlNodeId'],
          message: 'Escolha a seção a testar',
        })
      }
      if (!value.variantNodeIds?.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['variantNodeIds'],
          message: 'Crie pelo menos uma variante da seção',
        })
      }
      const ids = [value.controlNodeId, ...(value.variantNodeIds ?? [])]
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['variantNodeIds'],
          message: 'Cada variante precisa ser uma seção diferente',
        })
      }
    }
    const count =
      value.kind === 'SECTION'
        ? 1 + (value.variantNodeIds?.length ?? 0)
        : 1 + value.variantCount
    if (value.weights) {
      if (value.weights.length !== count) {
        ctx.addIssue({
          code: 'custom',
          path: ['weights'],
          message: 'Informe a divisão de cada variante',
        })
      } else if (!sumsTo100(value.weights)) {
        ctx.addIssue({
          code: 'custom',
          path: ['weights'],
          message: SPLIT_MESSAGE,
        })
      }
    }
    if (value.goal.type === 'PAGE' && value.goal.pageId === value.pageId) {
      ctx.addIssue({
        code: 'custom',
        path: ['goal', 'pageId'],
        message: 'A página da meta precisa ser outra, não a testada',
      })
    }
    checkSchedule(value, ctx)
  })

export type CreateSiteExperimentDTO = z.infer<typeof CreateSiteExperimentSchema>

export const UpdateSiteExperimentSchema = z
  .object({
    name: z.string().trim().min(1, 'Dê um nome ao teste').max(120).optional(),
    /** The whole variant list (rename, split, add or drop a section
     * variant). Changing it on a running test needs `restart`. */
    variants: z.array(SiteExperimentVariantSchema).min(2).max(3).optional(),
    goal: SiteExperimentGoalSchema.optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
    /** Confirms restarting a running test (its results start over). */
    restart: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.variants) {
      const keys = value.variants.map((variant) => variant.key)
      if (keys[0] !== 'A' || new Set(keys).size !== keys.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants'],
          message: 'As variantes são A (original), B e C, sem repetir',
        })
      }
      if (!sumsTo100(value.variants.map((variant) => variant.weight))) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants'],
          message: SPLIT_MESSAGE,
        })
      }
    }
    checkSchedule(value, ctx)
  })
  .refine(
    ({ restart: _restart, ...rest }) =>
      Object.values(rest).some((item) => item !== undefined),
    { message: 'Nada para atualizar' },
  )

export type UpdateSiteExperimentDTO = z.infer<typeof UpdateSiteExperimentSchema>

export const SITE_EXPERIMENT_ACTIONS = [
  'start',
  'pause',
  'resume',
  'stop',
  'restart',
] as const

export type SiteExperimentAction = (typeof SITE_EXPERIMENT_ACTIONS)[number]

export const SiteExperimentActionSchema = z.object({
  action: z.enum(SITE_EXPERIMENT_ACTIONS),
})

export type SiteExperimentActionDTO = z.infer<typeof SiteExperimentActionSchema>

export const ApplySiteExperimentWinnerSchema = z.object({
  variantKey: z.enum(EXPERIMENT_VARIANT_KEYS),
})

export type ApplySiteExperimentWinnerDTO = z.infer<
  typeof ApplySiteExperimentWinnerSchema
>

/** Beacon of the public runtime (exposures and conversions). */
export const RecordSiteExperimentEventsSchema = z.object({
  events: z
    .array(
      z.object({
        experimentId: z.string().min(1).max(40),
        kind: z.enum(['EXPOSURE', 'CONVERSION']),
      }),
    )
    .min(1)
    .max(20),
})

export type RecordSiteExperimentEventsDTO = z.infer<
  typeof RecordSiteExperimentEventsSchema
>

/** Variants stored in the row (read back defensively). */
export const StoredVariantsSchema = z.array(SiteExperimentVariantSchema)
