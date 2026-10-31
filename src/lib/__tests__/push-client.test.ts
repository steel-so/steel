import { describe, expect, it } from 'vitest'
import {
  pushSupport,
  serializePushSubscription,
  urlBase64ToUint8Array,
} from '../push/client'

describe('push client helpers', () => {
  it('should decode a base64url key into bytes', () => {
    const bytes = urlBase64ToUint8Array('AQID_w')
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255])
  })

  it('should detect support', () => {
    const navigator = { serviceWorker: {} } as unknown as Navigator
    expect(pushSupport({ navigator, PushManager: class {} })).toBe('supported')
    expect(pushSupport({ navigator })).toBe('unsupported')
    expect(
      pushSupport({ navigator: {} as Navigator, PushManager: class {} }),
    ).toBe('unsupported')
  })

  it('should serialize a complete subscription only', () => {
    const complete = {
      toJSON: () => ({ endpoint: 'https://p', keys: { p256dh: 'a', auth: 'b' } }),
    }
    expect(serializePushSubscription(complete)).toEqual({
      endpoint: 'https://p',
      keys: { p256dh: 'a', auth: 'b' },
    })
    expect(serializePushSubscription({ toJSON: () => ({}) })).toBeNull()
    expect(
      serializePushSubscription({
        toJSON: () => ({ endpoint: 'https://p', keys: { p256dh: 'a' } }),
      }),
    ).toBeNull()
  })
})
