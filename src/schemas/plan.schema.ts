import z from 'zod'

// Plan tiers - mirrors the Prisma 'Plan' enum (FREE/PRO/BUSINESS/ENTERPRISE).
export const PlanSchema = z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'])
export type PlanTier = z.infer<typeof PlanSchema>

// Numeric caps. 'null' means unlimited. Only what the backend enforces lives
// here (docs/plans-review.md); add a key together with its enforcement.
export const PlanLimitsSchema = z.object({
  seats: z.number().int().positive().nullable(),
})
export type PlanLimits = z.infer<typeof PlanLimitsSchema>
export type PlanLimitKey = keyof PlanLimits

// Full entitlements for a single plan.
export const PlanEntitlementsSchema = z.object({
  limits: PlanLimitsSchema,
})
export type PlanEntitlements = z.infer<typeof PlanEntitlementsSchema>

// Catalog: every tier must define a complete entitlements object
// Zod v4 'record' with an enum key enforces all 4 tiers are present.
export const PlanCatalogSchema = z.record(PlanSchema, PlanEntitlementsSchema)
export type PlanCatalog = z.infer<typeof PlanCatalogSchema>
