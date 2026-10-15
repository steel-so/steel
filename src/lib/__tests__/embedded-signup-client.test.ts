import { describe, expect, it } from 'vitest'
import { parseEmbeddedSignupMessage } from '../whatsapp/embedded-signup-client'

const origin = 'https://www.facebook.com'
const msg = (data: unknown, o = origin) =>
  parseEmbeddedSignupMessage({ origin: o, data })

describe('parseEmbeddedSignupMessage', () => {
  it('parses FINISH from an object or a JSON string', () => {
    const data = {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { phone_number_id: '1', waba_id: '2' },
    }
    const expected = { kind: 'finish', phoneNumberId: '1', wabaId: '2' }
    expect(msg(data)).toEqual(expected)
    expect(msg(JSON.stringify(data), 'https://web.facebook.com')).toEqual(
      expected,
    )
  })
  it('handles FINISH without ids, CANCEL and ERROR', () => {
    expect(
      msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: {} })?.kind,
    ).toBe('error')
    expect(msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' })).toEqual({
      kind: 'cancel',
    })
    expect(
      msg({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'ERROR',
        data: { error_message: 'boom' },
      }),
    ).toEqual({ kind: 'error', message: 'boom' })
    expect(msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR' })?.kind).toBe(
      'error',
    )
  })
  it('ignores foreign origins, other types and junk', () => {
    expect(
      msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' }, 'https://evil.com'),
    ).toBeNull()
    expect(msg({ type: 'OTHER' })).toBeNull()
    expect(msg('not json')).toBeNull()
    expect(msg(null)).toBeNull()
    expect(msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'X' })).toBeNull()
  })
})
