import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  API_TOKEN_PREFIX,
  apiTokenExpiry,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
  sortApiModules,
  toApiScopes,
} from '@/src/lib/api/token'

describe('generateApiToken', () => {
  it('creates a stl_pat_ token with 43 random characters', () => {
    const { token, tokenHash, prefix } = generateApiToken()
    expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true)
    expect(token).toHaveLength(API_TOKEN_PREFIX.length + 43)
    expect(isApiTokenFormat(token)).toBe(true)
    expect(prefix).toBe(
      token.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + 8),
    )
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
  })

  it('never repeats a value', () => {
    const values = new Set(
      Array.from({ length: 50 }, () => generateApiToken().token),
    )
    expect(values.size).toBe(50)
  })
})

describe('hashApiToken', () => {
  it('is the hex SHA-256 of the whole value', () => {
    expect(hashApiToken('stl_pat_x')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashApiToken('a')).not.toBe(hashApiToken('b'))
  })
})

describe('isApiTokenFormat', () => {
  it.each([
    ['stl_at_abc', false],
    [`stl_pat_${'a'.repeat(31)}`, false],
    [`stl_pat_${'a'.repeat(32)}`, true],
    [`stl_pat_${'a'.repeat(129)}`, false],
    [`stl_pat_${'a'.repeat(40)}!`, false],
    ['crm_live_abc', false],
  ])('%s → %s', (value, expected) => {
    expect(isApiTokenFormat(value)).toBe(expected)
  })
})

describe('apiTokenExpiry', () => {
  it('adds whole days', () => {
    const now = new Date('2026-10-17T12:00:00Z')
    expect(apiTokenExpiry(now, 90).toISOString()).toBe(
      '2027-01-15T12:00:00.000Z',
    )
  })
})

describe('sortApiModules / toApiScopes', () => {
  it('orders and dedupes modules', () => {
    expect(
      sortApiModules(['COMMUNICATION', 'CRM', 'CRM', 'SERVICE_DESK']),
    ).toEqual(['SERVICE_DESK', 'CRM', 'COMMUNICATION'])
  })

  it('keeps only API scopes in canonical order', () => {
    expect(toApiScopes(['api:write', 'mcp:read', 'api:read'])).toEqual([
      'api:read',
      'api:write',
    ])
  })
})
