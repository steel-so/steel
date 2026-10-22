import {
  PlanCatalogSchema,
  type PlanLimits,
  type PlanTier,
} from '../schemas/plan.schema'

const TIERS = ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'] as const

// 'null' means unlimited. `seats` is the only limit enforced today
// (InvitationService.assertSeatAvailable); see docs/plans-review.md.
const LIMITS: Record<PlanTier, PlanLimits> = {
  FREE: { seats: 12 },
  PRO: { seats: 12 },
  BUSINESS: { seats: null },
  ENTERPRISE: { seats: null },
}

// Validated at module load - a missing/missplled key throws immediately
export const PLAN_CATALOG = PlanCatalogSchema.parse(
  Object.fromEntries(TIERS.map((tier) => [tier, { limits: LIMITS[tier] }])),
)
