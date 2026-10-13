import { describe, expect, it } from 'vitest'
import { PabxCallWebhookSchema } from '@/src/schemas/whatsapp-phone-call.schema'

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
