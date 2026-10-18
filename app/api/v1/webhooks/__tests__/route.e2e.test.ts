import { describe, expect, it } from 'vitest'
import {
  authenticatedOwner,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/**
 * API v1 webhooks: personal token only (ADR 0035). The session cookie never
 * authenticates here. Scope/module refusals with a real `stl_pat_` token are
 * covered once the api-tokens slice lands (`resolveApiSession`).
 */

const ROUTES: [string, string][] = [
  ['GET', '/api/v1/webhooks/events'],
  ['GET', '/api/v1/webhooks/endpoints'],
  ['POST', '/api/v1/webhooks/endpoints'],
  ['GET', '/api/v1/webhooks/deliveries'],
  ['GET', '/api/v1/webhooks/listen'],
  ['POST', '/api/v1/webhooks/trigger'],
]

describe('/api/v1/webhooks', () => {
  it.each(ROUTES)('%s %s answers 401 without a token', async (method, path) => {
    const res =
      method === 'GET' ? await getJson(path) : await postJson(path, {})
    expect(res.status).toBe(401)
  })

  it('does not accept the session cookie', async () => {
    const { user } = await authenticatedOwner()
    const res = await getJson('/api/v1/webhooks/endpoints', user.cookie)
    expect(res.status).toBe(401)
  })

  it('refuses an invalid bearer token', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/webhooks/events`, {
      headers: { Authorization: 'Bearer stl_pat_not-a-real-token' },
    })
    expect(res.status).toBe(401)
  })
})
