import { describe, expect, it } from 'vitest'
import {
  CreatePushSubscriptionSchema,
  DeletePushSubscriptionSchema,
} from '../push-subscription.schema'

const valid = {
  endpoint: 'https://push.example.com/send/abc',
  keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
}

describe('push subscription schemas', () => {
  it('should accept a browser subscription', () => {
    expect(CreatePushSubscriptionSchema.safeParse(valid).success).toBe(true)
  })

  it('should reject non-https endpoints and bad keys', () => {
    expect(
      CreatePushSubscriptionSchema.safeParse({
        ...valid,
        endpoint: 'http://push.example.com/x',
      }).success,
    ).toBe(false)
    expect(
      CreatePushSubscriptionSchema.safeParse({
        ...valid,
        keys: { ...valid.keys, auth: 'not base64!' },
      }).success,
    ).toBe(false)
    expect(CreatePushSubscriptionSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(false)
  })

  it('should require a url to unsubscribe', () => {
    expect(
      DeletePushSubscriptionSchema.safeParse({ endpoint: valid.endpoint }).success,
    ).toBe(true)
    expect(DeletePushSubscriptionSchema.safeParse({ endpoint: 'x' }).success).toBe(false)
  })
})
