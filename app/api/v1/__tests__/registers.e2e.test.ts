import { describe, expect, it } from 'vitest'
import { defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

/**
 * Refusals of the API v1 routes for people, companies, documents, ServiceDesk
 * customers, contacts and knowledge base articles. Without a personal token
 * every one of them answers 401 (the session cookie never counts).
 */

const COLLECTIONS = [
  '/api/v1/crm/people',
  '/api/v1/crm/companies',
  '/api/v1/crm/documents',
  '/api/v1/servicedesk/customers',
  '/api/v1/servicedesk/contacts',
  '/api/v1/servicedesk/kb/articles',
]

const ITEMS = COLLECTIONS.map((path) => `${path}/some-id`)

async function call(path: string, method: string, body?: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...defaultHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('/api/v1 registers without a personal token', () => {
  it.each(COLLECTIONS)('GET %s answers 401', async (path) => {
    const res = await call(path, 'GET')
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
  })

  it.each(COLLECTIONS)('POST %s answers 401', async (path) => {
    const res = await call(path, 'POST', { name: 'x', title: 'x' })
    expect(res.status).toBe(401)
  })

  it.each(ITEMS)('GET, PATCH and DELETE %s answer 401', async (path) => {
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const res = await call(path, method, method === 'PATCH' ? {} : undefined)
      expect(res.status).toBe(401)
    }
  })

  it('POST the knowledge base article status answers 401', async () => {
    const res = await call(
      '/api/v1/servicedesk/kb/articles/some-id/status',
      'POST',
      { status: 'PUBLISHED' },
    )
    expect(res.status).toBe(401)
  })
})
