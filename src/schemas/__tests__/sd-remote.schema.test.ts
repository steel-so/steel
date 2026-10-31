import { describe, expect, it } from 'vitest'
import {
  ConnectSdRemoteSchema,
  ListSdRemoteSessionsSchema,
  SdInventoryRemoteIdsSchema,
  UpdateSdRemoteSettingsSchema,
  UpsertSdRemoteEndpointSchema,
} from '../sd-remote.schema'

describe('UpdateSdRemoteSettingsSchema', () => {
  it('accepts a partial update', () => {
    // linkTemplate stays absent so a partial update never clears it.
    expect(UpdateSdRemoteSettingsSchema.parse({ enabled: true })).toEqual({
      enabled: true,
    })
  })

  it('rejects an empty body', () => {
    expect(UpdateSdRemoteSettingsSchema.safeParse({}).success).toBe(false)
  })

  it('validates the link template and turns blank into null', () => {
    const ok = UpdateSdRemoteSettingsSchema.parse({
      provider: 'ANYDESK',
      linkTemplate: 'anydesk:{id}',
    })
    expect(ok.linkTemplate).toBe('anydesk:{id}')
    expect(
      UpdateSdRemoteSettingsSchema.parse({ enabled: false, linkTemplate: '  ' })
        .linkTemplate,
    ).toBeNull()
    expect(
      UpdateSdRemoteSettingsSchema.safeParse({
        linkTemplate: 'javascript:{id}',
      }).success,
    ).toBe(false)
  })
})

describe('UpsertSdRemoteEndpointSchema', () => {
  it('normalizes pasted numeric ids', () => {
    const parsed = UpsertSdRemoteEndpointSchema.parse({
      configItemId: 'ci1',
      provider: 'RUSTDESK',
      remoteId: '123 456 789',
    })
    expect(parsed.remoteId).toBe('123456789')
  })

  it('rejects invalid ids and unknown providers', () => {
    expect(
      UpsertSdRemoteEndpointSchema.safeParse({
        configItemId: 'ci1',
        provider: 'RUSTDESK',
        remoteId: 'a b;c',
      }).success,
    ).toBe(false)
    expect(
      UpsertSdRemoteEndpointSchema.safeParse({
        configItemId: 'ci1',
        provider: 'TEAMVIEWER',
        remoteId: '123456789',
      }).success,
    ).toBe(false)
  })
})

describe('ConnectSdRemoteSchema / ListSdRemoteSessionsSchema', () => {
  it('requires the asset, the ticket is optional', () => {
    expect(ConnectSdRemoteSchema.safeParse({}).success).toBe(false)
    expect(ConnectSdRemoteSchema.parse({ configItemId: 'ci1' })).toEqual({
      configItemId: 'ci1',
    })
  })

  it('defaults and bounds the session limit', () => {
    expect(
      ListSdRemoteSessionsSchema.parse({ configItemId: 'ci1' }).limit,
    ).toBe(20)
    expect(
      ListSdRemoteSessionsSchema.safeParse({ configItemId: 'ci1', limit: 500 })
        .success,
    ).toBe(false)
  })
})

describe('SdInventoryRemoteIdsSchema', () => {
  it('accepts partial ids from the agent', () => {
    expect(
      SdInventoryRemoteIdsSchema.parse({ rustdesk: '123 456 789' }),
    ).toEqual({
      rustdesk: '123456789',
    })
    expect(SdInventoryRemoteIdsSchema.parse({ anydesk: null })).toEqual({
      anydesk: null,
    })
  })
})
