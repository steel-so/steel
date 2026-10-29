import { describe, expect, it } from 'vitest'
import {
  AddSdStatusSubscriberSchema,
  CreateSdStatusPageSchema,
  SdStatusSubscriptionActionSchema,
  SdStatusTokenSchema,
  SubscribeSdStatusPageSchema,
  UpdateSdStatusPageSchema,
} from '../sd-status-page.schema'

describe('sd-status-page schemas', () => {
  it('creates with defaults and a normalized slug', () => {
    const parsed = CreateSdStatusPageSchema.parse({
      name: 'Acme',
      slug: ' Acme-TI ',
    })
    expect(parsed.slug).toBe('acme-ti')
    expect(parsed.published).toBe(true)
    expect(parsed.allowSubscriptions).toBe(true)
    expect(parsed.serviceIds).toEqual([])
  })

  it('rejects bad slugs', () => {
    for (const slug of ['a', '-abc', 'abc-', 'a b c', 'x'.repeat(49)]) {
      expect(
        CreateSdStatusPageSchema.safeParse({ name: 'Acme', slug }).success,
      ).toBe(false)
    }
  })

  it('requires a field to update', () => {
    expect(UpdateSdStatusPageSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSdStatusPageSchema.safeParse({ customerId: null }).success,
    ).toBe(true)
  })

  it('normalizes e-mail and WhatsApp subscribers', () => {
    const email = AddSdStatusSubscriberSchema.parse({
      channel: 'EMAIL',
      address: ' Ana@Acme.COM.br ',
    })
    expect(email.address).toBe('ana@acme.com.br')
    const phone = AddSdStatusSubscriberSchema.parse({
      channel: 'WHATSAPP',
      address: '+55 (11) 99999-0000',
    })
    expect(phone.address).toBe('5511999990000')
    expect(
      AddSdStatusSubscriberSchema.safeParse({
        channel: 'WHATSAPP',
        address: '123',
      }).success,
    ).toBe(false)
    expect(
      AddSdStatusSubscriberSchema.safeParse({
        channel: 'EMAIL',
        address: 'não é e-mail',
      }).success,
    ).toBe(false)
  })

  it('validates the public inputs', () => {
    expect(SubscribeSdStatusPageSchema.safeParse({ email: 'x' }).success).toBe(
      false,
    )
    expect(
      SdStatusSubscriptionActionSchema.safeParse({ action: 'DELETE' }).success,
    ).toBe(false)
    expect(SdStatusTokenSchema.safeParse('short').success).toBe(false)
    expect(SdStatusTokenSchema.safeParse('a'.repeat(32)).success).toBe(true)
  })
})
