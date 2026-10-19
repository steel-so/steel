import { describe, expect, it } from 'vitest'
import { serverEnvSchema } from '@/lib/env/_server'

// Smallest server env the schema accepts (same fakes as env-billing.test.ts).
const BASE_ENV = {
  POSTGRES_USER: 'steel',
  POSTGRES_PASSWORD: 'not-a-real-password',
  POSTGRES_DB: 'steel',
  DATABASE_URL: 'postgresql://steel:secret@localhost:5433/steel',
  REDIS_URL: 'rediss://localhost:6380',
  REDIS_PASSWORD: 'not-a-real-password',
  MINIO_ENDPOINT: 'http://localhost:9002',
  MINIO_USER: 'minio',
  MINIO_PASSWORD: 'not-a-real-password',
  BETTER_AUTH_SECRET: 'ba_not-a-real-secret',
  BETTER_AUTH_URL: 'http://localhost:3001',
  GOOGLE_CLIENT_ID: '1234567890.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-not-a-real-secret',
  GITHUB_CLIENT_ID: 'Iv1.fakeclient',
  GITHUB_CLIENT_SECRET: 'a'.repeat(40),
  RESEND_API_KEY: 're_fake',
  HUGEICONS_TOKEN: 'ABCDEF12-ABCDEF12-ABCDEF12-ABCDEF12',
  STATUS_COLLECTOR_SECRET: 's'.repeat(32),
  CONNECTION_SECRETS: `1:${'c'.repeat(32)}`,
}

function issuesFor(env: Record<string, unknown>) {
  const parsed = serverEnvSchema.safeParse({ ...BASE_ENV, ...env })
  if (parsed.success) return []
  return parsed.error.issues.map((issue) => issue.path.join('.'))
}

/** Base64 of `bytes` zero bytes, like `openssl rand -base64 <bytes>`. */
const key = (bytes: number) => btoa('\0'.repeat(bytes))

describe('server env schema — app replicas', () => {
  it('boots without any of the replica settings', () => {
    const parsed = serverEnvSchema.safeParse(BASE_ENV)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.DATABASE_URL_POOLED).toBeUndefined()
    expect(parsed.data?.DB_POOL_MAX).toBeUndefined()
  })

  it('treats blank values as unset', () => {
    expect(
      issuesFor({
        DATABASE_URL_POOLED: '',
        DB_POOL_MAX: '',
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: '',
        NEXT_CACHE_TAGS_TIMEOUT_MS: '',
      }),
    ).toEqual([])
  })

  it('accepts a pooled Postgres URL, a pool size and a timeout', () => {
    expect(
      issuesFor({
        DATABASE_URL_POOLED: 'postgresql://steel:secret@steel-pgbouncer:5432/steel',
        DB_POOL_MAX: '20',
        NEXT_CACHE_TAGS_TIMEOUT_MS: '200',
      }),
    ).toEqual([])
  })

  it('rejects malformed values', () => {
    expect(
      issuesFor({
        DATABASE_URL_POOLED: 'mysql://steel@db/steel',
        DB_POOL_MAX: '0',
        NEXT_CACHE_TAGS_TIMEOUT_MS: 'fast',
      }),
    ).toEqual([
      'DATABASE_URL_POOLED',
      'DB_POOL_MAX',
      'NEXT_CACHE_TAGS_TIMEOUT_MS',
    ])
  })

  it.each([16, 24, 32])('accepts a %i-byte Server Actions key', (bytes) => {
    expect(issuesFor({ NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: key(bytes) })).toEqual(
      [],
    )
  })

  it.each([
    ['a wrong AES length', key(20)],
    ['non-base64 text', 'not base64!'],
    ['broken padding', 'QUJD=A=='],
  ])('rejects a Server Actions key with %s', (_label, value) => {
    expect(issuesFor({ NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: value })).toEqual([
      'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
    ])
  })
})
