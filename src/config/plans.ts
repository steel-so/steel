import {
  PlanCatalogSchema,
  type PlanLimits,
  type PlanTier,
} from '../schemas/plan.schema'

const TIERS = ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'] as const

// 'null' means unlimited. `seats` is enforced by
// InvitationService.assertSeatAvailable and `newsletterEmailsPerMonth` by the
// newsletter send (ADR 0054); see docs/plans-review.md.
const LIMITS: Record<PlanTier, PlanLimits> = {
  FREE: { seats: 12, newsletterEmailsPerMonth: 3_000 },
  PRO: { seats: 12, newsletterEmailsPerMonth: 30_000 },
  BUSINESS: { seats: null, newsletterEmailsPerMonth: 150_000 },
  ENTERPRISE: { seats: null, newsletterEmailsPerMonth: null },
}

// Validated at module load - a missing/missplled key throws immediately
export const PLAN_CATALOG = PlanCatalogSchema.parse(
  Object.fromEntries(TIERS.map((tier) => [tier, { limits: LIMITS[tier] }])),
)
