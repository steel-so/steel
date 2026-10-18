import { describe, expect, it } from 'vitest'
import {
  ApiTokenIdSchema,
  CreateApiTokenSchema,
  DeviceAuthorizationStartSchema,
  DeviceAuthorizeSchema,
  DeviceTokenPollSchema,
  UserCodeSchema,
} from '../api-token.schema'

const VALID = {
  name: '  Deploy  ',
  workspaceId: 'ws-1',
  scopes: ['api:read', 'api:write', 'api:read'],
  modules: ['CRM', 'CRM', 'SERVICE_DESK'],
}

describe('CreateApiTokenSchema', () => {
  it('trims the name, dedupes scopes and modules and defaults to 90 days', () => {
    const parsed = CreateApiTokenSchema.parse(VALID)
    expect(parsed).toEqual({
      name: 'Deploy',
      workspaceId: 'ws-1',
      scopes: ['api:read', 'api:write'],
      modules: ['CRM', 'SERVICE_DESK'],
      expiresInDays: 90,
    })
  })

  it('accepts a validity up to 365 days', () => {
    expect(
      CreateApiTokenSchema.parse({ ...VALID, expiresInDays: 365 })
        .expiresInDays,
    ).toBe(365)
  })

  it.each([
    ['empty name', { name: '   ' }],
    ['long name', { name: 'x'.repeat(101) }],
    ['no modules', { modules: [] }],
    ['unknown module', { modules: ['BILLING'] }],
    ['write without read', { scopes: ['api:write'] }],
    ['unknown scope', { scopes: ['api:read', 'mcp:read'] }],
    ['zero days', { expiresInDays: 0 }],
    ['over a year', { expiresInDays: 366 }],
    ['fractional days', { expiresInDays: 1.5 }],
    ['no workspace', { workspaceId: '' }],
  ])('rejects %s', (_label, patch) => {
    expect(CreateApiTokenSchema.safeParse({ ...VALID, ...patch }).success).toBe(
      false,
    )
  })
})

describe('UserCodeSchema', () => {
  it.each(['bcdf-gh23', 'BCDF GH23', ' BCDFGH23 '])('normalizes %j', (raw) => {
    expect(UserCodeSchema.parse(raw)).toBe('BCDFGH23')
  })

  it.each(['BCDF-GH2', 'BCDF-GH234', ''])('rejects %j', (raw) => {
    expect(UserCodeSchema.safeParse(raw).success).toBe(false)
  })
})

describe('DeviceAuthorizationStartSchema', () => {
  it('accepts an empty body and an optional device name', () => {
    expect(DeviceAuthorizationStartSchema.parse(undefined)).toEqual({})
    expect(DeviceAuthorizationStartSchema.parse({})).toEqual({})
    expect(
      DeviceAuthorizationStartSchema.parse({ deviceName: ' notebook ' }),
    ).toEqual({ deviceName: 'notebook' })
    expect(
      DeviceAuthorizationStartSchema.parse({ clientName: 'steel-cli/1.0.0' }),
    ).toEqual({ clientName: 'steel-cli/1.0.0' })
  })

  it('rejects a long device name', () => {
    expect(
      DeviceAuthorizationStartSchema.safeParse({ deviceName: 'x'.repeat(101) })
        .success,
    ).toBe(false)
  })
})

describe('DeviceTokenPollSchema', () => {
  it('requires a device code of sane length', () => {
    expect(
      DeviceTokenPollSchema.safeParse({ deviceCode: 'x'.repeat(43) }).success,
    ).toBe(true)
    expect(
      DeviceTokenPollSchema.safeParse({ deviceCode: 'short' }).success,
    ).toBe(false)
    expect(DeviceTokenPollSchema.safeParse({}).success).toBe(false)
  })
})

describe('DeviceAuthorizeSchema', () => {
  it('parses an approval with defaults', () => {
    expect(
      DeviceAuthorizeSchema.parse({
        accept: true,
        userCode: 'bcdf-gh23',
        workspaceId: 'ws-1',
        modules: ['CRM'],
        scopes: ['api:read'],
      }),
    ).toEqual({
      accept: true,
      userCode: 'BCDFGH23',
      workspaceId: 'ws-1',
      modules: ['CRM'],
      scopes: ['api:read'],
      expiresInDays: 90,
    })
  })

  it('parses a refusal with only the code', () => {
    expect(
      DeviceAuthorizeSchema.parse({ accept: false, userCode: 'BCDFGH23' }),
    ).toEqual({ accept: false, userCode: 'BCDFGH23' })
  })

  it('rejects an approval without modules', () => {
    expect(
      DeviceAuthorizeSchema.safeParse({
        accept: true,
        userCode: 'BCDFGH23',
        workspaceId: 'ws-1',
        modules: [],
        scopes: ['api:read'],
      }).success,
    ).toBe(false)
  })
})

describe('ApiTokenIdSchema', () => {
  it('bounds the id', () => {
    expect(ApiTokenIdSchema.safeParse('tok-1').success).toBe(true)
    expect(ApiTokenIdSchema.safeParse('').success).toBe(false)
    expect(ApiTokenIdSchema.safeParse('x'.repeat(65)).success).toBe(false)
  })
})
