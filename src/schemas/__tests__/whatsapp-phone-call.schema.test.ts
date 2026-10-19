import { describe, expect, it } from 'vitest'
import {
  PabxCallWebhookSchema,
  PabxRecordingUploadSchema,
} from '@/src/schemas/whatsapp-phone-call.schema'

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345'

describe('PabxCallWebhookSchema', () => {
  it('parses a hangup report from the dialplan form', () => {
    expect(
      PabxCallWebhookSchema.parse({
        token: TOKEN,
        event: 'HANGUP',
        job: 'steel_api_123_abc',
        dialstatus: 'ANSWER',
        answeredtime: '42',
      }),
    ).toEqual({
      token: TOKEN,
      event: 'HANGUP',
      job: 'steel_api_123_abc',
      dialstatus: 'ANSWER',
      answeredtime: 42,
    })
  })

  it('treats the empty channel variables as absent', () => {
    expect(
      PabxCallWebhookSchema.parse({
        token: TOKEN,
        event: 'EXTENSION_ANSWERED',
        job: '',
        dialstatus: '',
        answeredtime: '',
      }),
    ).toEqual({ token: TOKEN, event: 'EXTENSION_ANSWERED' })
  })

  it('rejects an unknown event or a short token', () => {
    expect(
      PabxCallWebhookSchema.safeParse({ token: TOKEN, event: 'RINGING' })
        .success,
    ).toBe(false)
    expect(
      PabxCallWebhookSchema.safeParse({ token: 'short', event: 'HANGUP' })
        .success,
    ).toBe(false)
  })
})

describe('PabxRecordingUploadSchema', () => {
  it('should require the per-call token', () => {
    expect(
      PabxRecordingUploadSchema.safeParse({ token: 'a'.repeat(32) }).success,
    ).toBe(true)
    for (const token of [undefined, 'short', 'a'.repeat(129)]) {
      expect(PabxRecordingUploadSchema.safeParse({ token }).success).toBe(false)
    }
  })
})
