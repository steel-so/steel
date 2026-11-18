import { describe, expect, it } from 'vitest'
import { serverEnvSchema } from '@/lib/env/_server'

// Smallest server env the schema accepts (same fakes as env-scale.test.ts).
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

describe('server env schema — platform Z-API validation instance', () => {
  it('boots without any of the ZAPI_VALIDATION_* vars (feature inert)', () => {
    const parsed = serverEnvSchema.safeParse(BASE_ENV)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.ZAPI_VALIDATION_INSTANCE_ID).toBeUndefined()
    expect(parsed.data?.ZAPI_VALIDATION_TOKEN).toBeUndefined()
    expect(parsed.data?.ZAPI_VALIDATION_CLIENT_TOKEN).toBeUndefined()
  })

  it('treats blank values as unset', () => {
    const parsed = serverEnvSchema.safeParse({
      ...BASE_ENV,
      ZAPI_VALIDATION_INSTANCE_ID: '',
      ZAPI_VALIDATION_TOKEN: '',
      ZAPI_VALIDATION_CLIENT_TOKEN: '',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.ZAPI_VALIDATION_TOKEN).toBeUndefined()
  })

  it('accepts a full configuration', () => {
    const parsed = serverEnvSchema.safeParse({
      ...BASE_ENV,
      ZAPI_VALIDATION_INSTANCE_ID: 'inst',
      ZAPI_VALIDATION_TOKEN: 'tok',
      ZAPI_VALIDATION_CLIENT_TOKEN: 'client',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.ZAPI_VALIDATION_INSTANCE_ID).toBe('inst')
    expect(parsed.data?.ZAPI_VALIDATION_CLIENT_TOKEN).toBe('client')
  })
})
