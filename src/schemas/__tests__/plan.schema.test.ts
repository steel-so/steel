import { describe, expect, it } from 'vitest'
import {
  PlanCatalogSchema,
  PlanEntitlementsSchema,
  PlanSchema,
} from '../plan.schema'

const entitlements = { limits: { seats: 12 } }

describe('PlanSchema', () => {
  it('accepts the four tiers', () => {
    for (const tier of ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE']) {
      expect(PlanSchema.safeParse(tier).success).toBe(true)
    }
  })

  it('rejects the legacy BASIC tier', () => {
    expect(PlanSchema.safeParse('BASIC').success).toBe(false)
  })
})

describe('PlanEntitlementsSchema', () => {
  it('accepts a complete entitlements object', () => {
    expect(PlanEntitlementsSchema.safeParse(entitlements).success).toBe(true)
  })

  it('treats a null seat limit as valid (unlimited)', () => {
    const unlimited = { limits: { seats: null } }
    expect(PlanEntitlementsSchema.safeParse(unlimited).success).toBe(true)
  })

  it('rejects a non-positive seat limit', () => {
    expect(
      PlanEntitlementsSchema.safeParse({ limits: { seats: 0 } }).success,
    ).toBe(false)
  })
})

describe('PlanCatalogSchema', () => {
  it('requires every tier to be present', () => {
    const partial = { FREE: entitlements, PRO: entitlements }
    expect(PlanCatalogSchema.safeParse(partial).success).toBe(false)
  })
})
