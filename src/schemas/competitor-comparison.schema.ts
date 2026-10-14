import z from 'zod'

/**
 * Comparative pricing on /pricing (Steel vs other products, by module).
 * Comparative advertising must be objective, verifiable and dated (CONAR):
 * every competitor fact carries the public page it came from and the month
 * it was checked, and an unconfirmed feature is "no-info", never "no".
 */

export const COMPARISON_MODULES = ['servicedesk', 'crm', 'comunicacao'] as const
export type ComparisonModule = (typeof COMPARISON_MODULES)[number]

/**
 * - `yes`: stated on the vendor's public site (for Steel: in the product).
 * - `plan`: only on some plans/tiers.
 * - `addon`: sold separately (add-on or another product).
 * - `no-info`: not stated on the vendor's public pages.
 */
export const FeatureSupportSchema = z.enum(['yes', 'plan', 'addon', 'no-info'])
export type FeatureSupport = z.infer<typeof FeatureSupportSchema>

export const CurrencySchema = z.enum(['USD', 'BRL'])
export type Currency = z.infer<typeof CurrencySchema>

/** Amounts are in cents of the original currency (no FX conversion). */
export const ListPriceSchema = z.discriminatedUnion('kind', [
  // Per user/agent per month, annual billing.
  z.object({ kind: z.literal('per-seat'), cents: z.number().int().min(0) }),
  z.object({
    kind: z.literal('per-seat-range'),
    minCents: z.number().int().min(0),
    maxCents: z.number().int().min(0),
  }),
  // A monthly amount for the account, not per seat.
  z.object({ kind: z.literal('flat'), cents: z.number().int().min(0) }),
  z.object({ kind: z.literal('quote') }),
])
export type ListPrice = z.infer<typeof ListPriceSchema>

export const CompetitorPlanSchema = z.object({
  name: z.string().min(1),
  price: ListPriceSchema,
  /** Conditions printed next to the price (minimum seats, setup fee…). */
  note: z.string().min(1).optional(),
})
export type CompetitorPlan = z.infer<typeof CompetitorPlanSchema>

export const CompetitorSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** Vendor domain the official logo is loaded by (Brandfetch Logo Link). */
  domain: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/),
  currency: CurrencySchema,
  plans: z.array(CompetitorPlanSchema).min(1),
  sourceUrl: z.url(),
})
export type Competitor = z.infer<typeof CompetitorSchema>

export const ComparisonFeatureSchema = z.object({
  label: z.string().min(1),
  steel: FeatureSupportSchema,
  /** Keyed by competitor id; every competitor of the block is required. */
  competitors: z.record(z.string(), FeatureSupportSchema),
})
export type ComparisonFeature = z.infer<typeof ComparisonFeatureSchema>

export const ComparisonBlockSchema = z
  .object({
    module: z.enum(COMPARISON_MODULES),
    title: z.string().min(1),
    competitors: z.array(CompetitorSchema).min(1),
    features: z.array(ComparisonFeatureSchema).min(1),
    /** Footnotes under the block (fees not included, how prices vary…). */
    notes: z.array(z.string().min(1)),
  })
  .superRefine((block, ctx) => {
    const ids = block.competitors.map((competitor) => competitor.id)
    for (const feature of block.features) {
      const keys = Object.keys(feature.competitors).sort()
      if (keys.join() !== [...ids].sort().join()) {
        ctx.addIssue({
          code: 'custom',
          message: `Feature "${feature.label}" must rate exactly: ${ids.join(', ')}`,
          path: ['features'],
        })
      }
    }
  })
export type ComparisonBlock = z.infer<typeof ComparisonBlockSchema>

export const ComparisonCatalogSchema = z.object({
  /** Month the competitor pages were checked, `YYYY-MM`. */
  checkedAt: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /**
   * Fixed USD→BRL rate the calculator converts dollar prices with, and the
   * day it was taken (Banco Central PTAX, selling rate). Shown on the page.
   */
  exchangeRate: z.object({
    usdBrl: z.number().positive(),
    date: z.iso.date(),
  }),
  blocks: z
    .array(ComparisonBlockSchema)
    .length(COMPARISON_MODULES.length)
    .refine(
      (blocks) =>
        blocks.map((block) => block.module).join() ===
        COMPARISON_MODULES.join(),
      'One block per module, in order: servicedesk, crm, comunicacao',
    ),
})
export type ComparisonCatalog = z.infer<typeof ComparisonCatalogSchema>
