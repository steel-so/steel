import { describe, expect, it } from 'vitest'
import {
  IntegrationGrantIdSchema,
  OAuthConsentSchema,
} from '../integration-grant.schema'

const base = { oauthQuery: 'client_id=c&sig=s' }

describe('OAuthConsentSchema', () => {
  it('accepts an approval and dedupes modules and scopes', () => {
    const parsed = OAuthConsentSchema.parse({
      ...base,
      accept: true,
      workspaceId: 'ws1',
      modules: ['CRM', 'CRM', 'SERVICE_DESK'],
      scopes: ['mcp:read', 'mcp:write', 'mcp:read'],
    })
    expect(parsed).toEqual({
      ...base,
      accept: true,
      workspaceId: 'ws1',
      modules: ['CRM', 'SERVICE_DESK'],
      scopes: ['mcp:read', 'mcp:write'],
    })
  })

  it('accepts a refusal with only the query', () => {
    expect(OAuthConsentSchema.parse({ ...base, accept: false })).toEqual({
      ...base,
      accept: false,
    })
  })

  it('requires mcp:read, at least one module and known values', () => {
    const approval = {
      ...base,
      accept: true,
      workspaceId: 'ws1',
      modules: ['CRM'],
      scopes: ['mcp:read'],
    }
    expect(
      OAuthConsentSchema.safeParse({ ...approval, scopes: ['mcp:write'] })
        .success,
    ).toBe(false)
    expect(
      OAuthConsentSchema.safeParse({ ...approval, modules: [] }).success,
    ).toBe(false)
    expect(
      OAuthConsentSchema.safeParse({ ...approval, modules: ['WIKI'] }).success,
    ).toBe(false)
    expect(
      OAuthConsentSchema.safeParse({ ...approval, scopes: ['openid'] }).success,
    ).toBe(false)
    expect(
      OAuthConsentSchema.safeParse({ ...approval, oauthQuery: '' }).success,
    ).toBe(false)
    expect(
      OAuthConsentSchema.safeParse({ ...approval, workspaceId: undefined })
        .success,
    ).toBe(false)
  })
})

describe('IntegrationGrantIdSchema', () => {
  it('bounds the id', () => {
    expect(IntegrationGrantIdSchema.safeParse('g1').success).toBe(true)
    expect(IntegrationGrantIdSchema.safeParse('').success).toBe(false)
    expect(IntegrationGrantIdSchema.safeParse('x'.repeat(65)).success).toBe(
      false,
    )
  })
})
