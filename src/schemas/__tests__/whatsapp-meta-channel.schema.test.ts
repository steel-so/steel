import { describe, expect, it } from 'vitest'
import { UpdateMetaChannelSettingsSchema } from '../whatsapp-meta-channel.schema'

describe('UpdateMetaChannelSettingsSchema', () => {
  it('accepts a partial update', () => {
    expect(
      UpdateMetaChannelSettingsSchema.safeParse({ coexistenceEnabled: true })
        .success,
    ).toBe(true)
  })

  it('rejects an empty body and non-boolean values', () => {
    expect(UpdateMetaChannelSettingsSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateMetaChannelSettingsSchema.safeParse({ coexistenceEnabled: 'yes' })
        .success,
    ).toBe(false)
  })
})
