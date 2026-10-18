import { describe, expect, it } from 'vitest'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

describe('GET /api/status/live', () => {
  it('answers 200 without a session and is never cached', async () => {
    const res = await fetch(`${BASE_URL}/api/status/live`)

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({
      success: true,
      statusCode: 200,
      data: { status: 'ok' },
    })
  })
})
