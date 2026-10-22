import { describe, expect, it } from 'vitest'
import {
  WebphoneCallBeginSchema,
  WebphoneCallReportSchema,
} from '../webphone-call.schema'
import { PabxCallWebhookSchema } from '../whatsapp-phone-call.schema'

describe('WebphoneCallBeginSchema', () => {
  it('accepts a call with only the essentials', () => {
    expect(
      WebphoneCallBeginSchema.parse({
        direction: 'out',
        number: ' 11999998888 ',
      }),
    ).toEqual({ direction: 'out', number: '11999998888' })
  })

  it('accepts the optional name, conversation and PABX id', () => {
    const parsed = WebphoneCallBeginSchema.parse({
      direction: 'in',
      number: '200',
      name: null,
      conversationId: 'conv1',
      pabxUniqueId: '1729590000.42',
    })
    expect(parsed.pabxUniqueId).toBe('1729590000.42')
  })

  it.each([
    { direction: 'sideways', number: '1' },
    { direction: 'in', number: '' },
    { direction: 'in', number: 'x'.repeat(41) },
    { direction: 'in', number: '1', pabxUniqueId: 'x'.repeat(41) },
  ])('rejects %o', (input) => {
    expect(WebphoneCallBeginSchema.safeParse(input).success).toBe(false)
  })
})

describe('WebphoneCallReportSchema', () => {
  it('takes an event with or without an outcome', () => {
    expect(WebphoneCallReportSchema.parse({ event: 'answered' })).toEqual({
      event: 'answered',
    })
    expect(
      WebphoneCallReportSchema.parse({ event: 'ended', outcome: 'busy' }),
    ).toEqual({ event: 'ended', outcome: 'busy' })
  })

  it('rejects unknown events and outcomes', () => {
    expect(WebphoneCallReportSchema.safeParse({ event: 'ring' }).success).toBe(
      false,
    )
    expect(
      WebphoneCallReportSchema.safeParse({ event: 'ended', outcome: 'x' })
        .success,
    ).toBe(false)
  })
})

describe('PabxCallWebhookSchema uniqueid', () => {
  it('is optional and empty counts as absent', () => {
    const base = { token: 'a'.repeat(24), event: 'HANGUP' }
    expect(PabxCallWebhookSchema.parse(base).uniqueid).toBeUndefined()
    expect(
      PabxCallWebhookSchema.parse({ ...base, uniqueid: '' }).uniqueid,
    ).toBeUndefined()
    expect(
      PabxCallWebhookSchema.parse({ ...base, uniqueid: '1729.1' }).uniqueid,
    ).toBe('1729.1')
  })
})
