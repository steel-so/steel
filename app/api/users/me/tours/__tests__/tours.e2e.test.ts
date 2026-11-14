import { describe, expect, it } from 'vitest'
import { createAuthenticatedUser } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const TOURS_URL = `${BASE_URL}/api/users/me/tours`
const jsonHeaders = { 'Content-Type': 'application/json', Origin: BASE_URL }

function put(cookie: string, body: unknown) {
  return fetch(TOURS_URL, {
    method: 'PUT',
    headers: { ...jsonHeaders, Cookie: cookie },
    body: JSON.stringify(body),
  })
}

describe('GET /api/users/me/tours (e2e)', () => {
  it('should return 401 without authentication', async () => {
    const res = await fetch(TOURS_URL, { headers: { Origin: BASE_URL } })

    expect(res.status).toBe(401)
  })

  it('should return an empty list for a new user', async () => {
    const { cookie } = await createAuthenticatedUser()

    const res = await fetch(TOURS_URL, {
      headers: { Cookie: cookie, Origin: BASE_URL },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
  })
})

describe('PUT /api/users/me/tours (e2e)', () => {
  it('should return 401 without authentication', async () => {
    const res = await fetch(TOURS_URL, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({
        key: 'platform.home',
        version: 1,
        status: 'COMPLETED',
      }),
    })

    expect(res.status).toBe(401)
  })

  it('should record the tour and list it only for that user', async () => {
    const { cookie } = await createAuthenticatedUser()
    const other = await createAuthenticatedUser()

    const res = await put(cookie, {
      key: 'platform.home',
      version: 1,
      status: 'SKIPPED',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.key).toBe('platform.home')
    expect(body.data.status).toBe('SKIPPED')

    const mine = await fetch(TOURS_URL, {
      headers: { Cookie: cookie, Origin: BASE_URL },
    })
    expect((await mine.json()).data).toHaveLength(1)

    const theirs = await fetch(TOURS_URL, {
      headers: { Cookie: other.cookie, Origin: BASE_URL },
    })
    expect((await theirs.json()).data).toEqual([])
  })

  it('should replace the record when the same tour is marked again', async () => {
    const { cookie } = await createAuthenticatedUser()
    await put(cookie, { key: 'platform.home', version: 1, status: 'SKIPPED' })

    const res = await put(cookie, {
      key: 'platform.home',
      version: 2,
      status: 'COMPLETED',
    })

    expect(res.status).toBe(200)
    const list = await fetch(TOURS_URL, {
      headers: { Cookie: cookie, Origin: BASE_URL },
    })
    const body = await list.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].version).toBe(2)
    expect(body.data[0].status).toBe('COMPLETED')
  })

  it('should return 422 for a tour that does not exist', async () => {
    const { cookie } = await createAuthenticatedUser()

    const res = await put(cookie, {
      key: 'crm.does-not-exist',
      version: 1,
      status: 'COMPLETED',
    })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('should return 422 for an invalid status', async () => {
    const { cookie } = await createAuthenticatedUser()

    const res = await put(cookie, {
      key: 'platform.home',
      version: 1,
      status: 'OPEN',
    })

    expect(res.status).toBe(422)
  })
})
