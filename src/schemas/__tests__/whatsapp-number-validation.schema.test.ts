import { describe, expect, it } from 'vitest'
import { StartWhatsAppNumberValidationSchema } from '../whatsapp-number-validation.schema'

describe('StartWhatsAppNumberValidationSchema', () => {
  it.each([
    [{ scope: 'CONTACTS', contactIds: ['c1'] }],
    [{ scope: 'CONTACTS', all: true, force: true }],
    [{ scope: 'BROADCAST', broadcastId: 'b1', connectionId: 'cn1' }],
    [{ scope: 'AI_CAMPAIGN', campaignId: 'camp1' }],
  ])('accepts %j', (input) => {
    expect(StartWhatsAppNumberValidationSchema.safeParse(input).success).toBe(
      true,
    )
  })

  it.each([
    [{ scope: 'CONTACTS' }, 'contactIds'],
    [{ scope: 'BROADCAST' }, 'broadcastId'],
    [{ scope: 'AI_CAMPAIGN' }, 'campaignId'],
  ])('requires the source of %j', (input, path) => {
    const result = StartWhatsAppNumberValidationSchema.safeParse(input)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual([path])
  })

  it('rejects an unknown scope, an empty selection and an oversized one', () => {
    expect(
      StartWhatsAppNumberValidationSchema.safeParse({ scope: 'IMPORT' })
        .success,
    ).toBe(false)
    expect(
      StartWhatsAppNumberValidationSchema.safeParse({
        scope: 'CONTACTS',
        contactIds: [],
      }).success,
    ).toBe(false)
    expect(
      StartWhatsAppNumberValidationSchema.safeParse({
        scope: 'CONTACTS',
        contactIds: Array.from({ length: 20_001 }, (_, i) => `c${i}`),
      }).success,
    ).toBe(false)
  })
})
