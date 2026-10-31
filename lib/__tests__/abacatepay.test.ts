import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env/server')>()
  return { ...actual, ABACATE_PAY: 'fake-key' }
})

import { AbacatePayClient } from '@/lib/abacatepay'

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('AbacatePayClient.createSubscription()', () => {
  it('should POST to /subscriptions/create with auth header and JSON body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'bill_1',
            url: 'https://pay/c/1',
            amount: 100,
            status: 'PENDING',
            createdAt: 'now',
            updatedAt: 'now',
          },
          error: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await AbacatePayClient.createSubscription({
      items: [{ id: 'p1', quantity: 1 }],
      methods: ['CARD'],
    })

    expect(result.success).toBe(true)
    expect(result.data.id).toBe('bill_1')

    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('https://api.abacatepay.com/v2/subscriptions/create')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer fake-key')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init?.body).toContain('"id":"p1"')
  })

  it('should throw when response is not ok and surfaces error message', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, data: null, error: 'invalid plan' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(
      AbacatePayClient.createSubscription({
        items: [{ id: 'p1', quantity: 1 }],
      }),
    ).rejects.toThrow('invalid plan')
  })

  it('should throw with status fallback when error field is missing', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      AbacatePayClient.createSubscription({
        items: [{ id: 'p1', quantity: 1 }],
      }),
    ).rejects.toThrow(/502/)
  })
})

describe('AbacatePayClient.cancelSubscription()', () => {
  it('should POST to /subscriptions/cancel with the bill id in the body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'bill_1',
            url: 'https://pay/c/1',
            amount: 100,
            status: 'CANCELLED',
            createdAt: 'now',
            updatedAt: 'now',
          },
          error: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await AbacatePayClient.cancelSubscription('bill_1')

    expect(result.data.status).toBe('CANCELLED')
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('https://api.abacatepay.com/v2/subscriptions/cancel')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer fake-key',
    )
    expect(init?.body).toBe('{"id":"bill_1"}')
  })

  it('should throw loudly when the provider refuses the cancellation', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          data: null,
          error: 'subscription not found',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(
      AbacatePayClient.cancelSubscription('bill_missing'),
    ).rejects.toThrow('subscription not found')
  })

  it('should never resolve silently on a 5xx from the provider', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      AbacatePayClient.cancelSubscription('bill_1'),
    ).rejects.toThrow(/500/)
  })
})

describe('AbacatePayClient.getCoupon()', () => {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  it('should GET the URL-encoded coupon and return its data', async () => {
    const coupon = { id: 'BLACK FRIDAY', discount: 10, discountKind: 'PERCENTAGE' }
    fetchSpy.mockResolvedValue(json({ data: coupon, error: null }, 200))

    const result = await AbacatePayClient.getCoupon('BLACK FRIDAY')

    expect(result).toEqual(coupon)
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe(
      'https://api.abacatepay.com/v2/coupons/get?id=BLACK%20FRIDAY',
    )
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer fake-key',
    )
  })

  it('should return null for an unknown coupon (404)', async () => {
    fetchSpy.mockResolvedValue(new Response('not found', { status: 404 }))

    await expect(AbacatePayClient.getCoupon('NOPE')).resolves.toBeNull()
  })

  it('should surface the provider error message', async () => {
    fetchSpy.mockResolvedValue(json({ error: 'coupon expired' }, 422))

    await expect(AbacatePayClient.getCoupon('OLD')).rejects.toThrow(
      'coupon expired',
    )
  })

  it('should fall back to the status code when no error message is sent', async () => {
    fetchSpy.mockResolvedValue(json({}, 500))

    await expect(AbacatePayClient.getCoupon('X')).rejects.toThrow(
      'AbacatePay coupon fetch failed: 500',
    )
  })
})

describe('AbacatePayTransparent', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  it('POSTs a PIX charge with the shared auth headers', async () => {
    fetchSpy.mockResolvedValue(json({ success: true, data: { id: 'pix_1' }, error: null }))
    const { AbacatePayTransparent } = await import('@/lib/abacatepay')

    const res = await AbacatePayTransparent.create({
      method: 'PIX',
      data: { amount: 100 },
    })

    expect(res.success).toBe(true)
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('https://api.abacatepay.com/v2/transparents/create')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fake-key')
  })

  it('GETs the status with an encoded id', async () => {
    fetchSpy.mockResolvedValue(json({ success: true, data: { id: 'a b' }, error: null }))
    const { AbacatePayTransparent } = await import('@/lib/abacatepay')
    await AbacatePayTransparent.check('a b')
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://api.abacatepay.com/v2/transparents/check?id=a%20b',
    )
  })

  it('never throws: HTTP failures come back as success false', async () => {
    const { AbacatePayTransparent } = await import('@/lib/abacatepay')
    fetchSpy.mockResolvedValueOnce(json({ error: 'bad taxId' }, 400))
    expect(await AbacatePayTransparent.check('x')).toEqual({
      success: false,
      data: null,
      error: 'bad taxId',
    })
    fetchSpy.mockResolvedValueOnce(new Response('oops', { status: 502 }))
    const res = await AbacatePayTransparent.check('x')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/502/)
  })
})
