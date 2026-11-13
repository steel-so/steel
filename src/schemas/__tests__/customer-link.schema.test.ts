import { describe, expect, it } from 'vitest'
import {
  CustomerLinkKindSchema,
  LinkCustomerSchema,
  ResolveCustomerQuerySchema,
} from '../customer-link.schema'

describe('customer link schemas', () => {
  it('accepts the three kinds only', () => {
    expect(CustomerLinkKindSchema.safeParse('sd-customer').success).toBe(true)
    expect(CustomerLinkKindSchema.safeParse('sd-contact').success).toBe(true)
    expect(CustomerLinkKindSchema.safeParse('whatsapp-contact').success).toBe(
      true,
    )
    expect(CustomerLinkKindSchema.safeParse('lead').success).toBe(false)
  })

  it('requires kind, id and targetId to link', () => {
    expect(
      LinkCustomerSchema.safeParse({ kind: 'sd-contact', id: 'a', targetId: 'b' })
        .success,
    ).toBe(true)
    expect(
      LinkCustomerSchema.safeParse({ kind: 'sd-contact', id: 'a' }).success,
    ).toBe(false)
  })

  it('needs at least one identifier to resolve', () => {
    expect(ResolveCustomerQuerySchema.safeParse({}).success).toBe(false)
    for (const key of [
      'companyId',
      'personId',
      'sdCustomerId',
      'cnpj',
      'phone',
    ]) {
      expect(ResolveCustomerQuerySchema.safeParse({ [key]: 'x' }).success).toBe(
        true,
      )
    }
  })
})
