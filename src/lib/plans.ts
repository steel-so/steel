import { PLAN_CATALOG } from '../config/plans'
import type {
  PlanEntitlements,
  PlanLimitKey,
  PlanTier,
} from '../schemas/plan.schema'

export function entitlementsFor(plan: PlanTier): PlanEntitlements {
  return PLAN_CATALOG[plan]
}

// Numeric cap - return 'null' when unlimited
export function limitOf(plan: PlanTier, key: PlanLimitKey): number | null {
  return PLAN_CATALOG[plan].limits[key]
}
