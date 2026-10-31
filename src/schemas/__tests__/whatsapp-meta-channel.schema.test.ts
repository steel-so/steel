import { describe, expect, it } from 'vitest'
import {
  ConnectMetaChannelSchema,
  ListMetaChannelPagesSchema,
  ReplySocialCommentSchema,
  UpdateMetaChannelSettingsSchema,
} from '../whatsapp-meta-channel.schema'

// Low entropy on purpose: secret scanners flag random-looking literals.
const USER_TOKEN = 'x'.repeat(24)

describe('UpdateMetaChannelSettingsSchema', () => {
  it('accepts a partial update', () => {
    expect(
      UpdateMetaChannelSettingsSchema.safeParse({ instagramEnabled: true })
        .success,
    ).toBe(true)
  })

  it('rejects an empty body and non-boolean values', () => {
    expect(UpdateMetaChannelSettingsSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateMetaChannelSettingsSchema.safeParse({ messengerEnabled: 'yes' })
        .success,
    ).toBe(false)
  })
})

describe('ListMetaChannelPagesSchema', () => {
  it('requires a plausible token', () => {
    expect(
      ListMetaChannelPagesSchema.safeParse({ accessToken: USER_TOKEN })
        .success,
    ).toBe(true)
    expect(
      ListMetaChannelPagesSchema.safeParse({ accessToken: 'short' }).success,
    ).toBe(false)
  })
})

describe('ConnectMetaChannelSchema', () => {
  const base = { accessToken: USER_TOKEN, pageId: '123456' }

  it('accepts one or both channels', () => {
    expect(
      ConnectMetaChannelSchema.safeParse({ ...base, channels: ['MESSENGER'] })
        .success,
    ).toBe(true)
    expect(
      ConnectMetaChannelSchema.safeParse({
        ...base,
        channels: ['MESSENGER', 'INSTAGRAM'],
      }).success,
    ).toBe(true)
  })

  it('rejects no channel, WhatsApp as a channel and a bad page id', () => {
    expect(
      ConnectMetaChannelSchema.safeParse({ ...base, channels: [] }).success,
    ).toBe(false)
    expect(
      ConnectMetaChannelSchema.safeParse({ ...base, channels: ['WHATSAPP'] })
        .success,
    ).toBe(false)
    expect(
      ConnectMetaChannelSchema.safeParse({
        ...base,
        pageId: 'abc',
        channels: ['MESSENGER'],
      }).success,
    ).toBe(false)
  })
})

describe('ReplySocialCommentSchema', () => {
  it('defaults to a public reply and trims the text', () => {
    const parsed = ReplySocialCommentSchema.parse({ text: '  obrigado  ' })
    expect(parsed).toEqual({ text: 'obrigado', mode: 'PUBLIC' })
  })

  it('accepts a private reply and rejects blank or oversized text', () => {
    expect(
      ReplySocialCommentSchema.parse({ text: 'oi', mode: 'PRIVATE' }).mode,
    ).toBe('PRIVATE')
    expect(ReplySocialCommentSchema.safeParse({ text: '   ' }).success).toBe(
      false,
    )
    expect(
      ReplySocialCommentSchema.safeParse({ text: 'x'.repeat(2001) }).success,
    ).toBe(false)
  })
})
