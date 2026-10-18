import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DB_POOL_MAX,
  resolvePoolMax,
  resolveRuntimeDatabaseUrl,
} from '@/src/lib/db-pool'

describe('resolvePoolMax', () => {
  it('parses the env string or keeps a number', () => {
    expect(resolvePoolMax('20')).toBe(20)
    expect(resolvePoolMax(7)).toBe(7)
  })

  it('falls back to the default for missing or invalid values', () => {
    for (const raw of [undefined, '', '0', '-3', '2.5', 'many']) {
      expect(resolvePoolMax(raw)).toBe(DEFAULT_DB_POOL_MAX)
    }
  })
})

describe('resolveRuntimeDatabaseUrl', () => {
  const direct = 'postgresql://u:p@steel-db:5432/steel'
  const pooled = 'postgresql://u:p@steel-pgbouncer:5432/steel'

  it('prefers the pooled URL when configured', () => {
    expect(resolveRuntimeDatabaseUrl(direct, pooled)).toBe(pooled)
  })

  it('goes straight to Postgres otherwise', () => {
    expect(resolveRuntimeDatabaseUrl(direct, undefined)).toBe(direct)
    expect(resolveRuntimeDatabaseUrl(direct, '')).toBe(direct)
  })
})
