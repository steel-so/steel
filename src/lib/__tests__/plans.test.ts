import { describe, expect, it } from 'vitest'
import { PlanSchema } from '@/src/schemas/plan.schema'
import { entitlementsFor, limitOf } from '../plans'

describe('plan entitlements', () => {
  it('exposes a complete entitlements object for every tier', () => {
    for (const tier of PlanSchema.options) {
      expect(() => entitlementsFor(tier)).not.toThrow()
    }
  })

  it('caps seats on FREE and PRO and leaves BUSINESS and above unlimited', () => {
    expect(limitOf('FREE', 'seats')).toBe(12)
    expect(limitOf('PRO', 'seats')).toBe(12)
    expect(limitOf('BUSINESS', 'seats')).toBeNull()
    expect(limitOf('ENTERPRISE', 'seats')).toBeNull()
  })
})
