import { describe, expect, it } from 'vitest'
import {
  Customer360QuerySchema,
  OpenCustomerWhatsappSchema,
} from '../customer-360.schema'

describe('Customer360QuerySchema', () => {
  it.each([
    { personId: 'p1' },
    { companyId: 'c1' },
    { phone: '(11) 98888-7777' },
    { ticketId: 't1' },
    { conversationId: 'cv1' },
  ])('accepts a single anchor %j', (input) => {
    expect(Customer360QuerySchema.safeParse(input).success).toBe(true)
  })

  it('rejects a query without any anchor', () => {
    const parsed = Customer360QuerySchema.safeParse({})
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain('Informe')
    }
  })

  it('rejects empty and oversized values', () => {
    expect(Customer360QuerySchema.safeParse({ personId: '' }).success).toBe(
      false,
    )
    expect(
      Customer360QuerySchema.safeParse({ phone: '1'.repeat(41) }).success,
    ).toBe(false)
  })
})

describe('OpenCustomerWhatsappSchema', () => {
  it.each([
    { personId: 'p1' },
    { companyId: 'c1' },
    { opportunityId: 'o1', phone: '11988887777' },
  ])('accepts %j', (input) => {
    expect(OpenCustomerWhatsappSchema.safeParse(input).success).toBe(true)
  })

  it('needs a record', () => {
    expect(OpenCustomerWhatsappSchema.safeParse({}).success).toBe(false)
    expect(
      OpenCustomerWhatsappSchema.safeParse({ phone: '11988887777' }).success,
    ).toBe(false)
  })
})
