import { describe, expect, it } from 'vitest'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const ORIGIN = 'https://cliente.example.com'

describe('site chat widget (public)', () => {
  it('should serve the script cross-origin from a stable path', async () => {
    const res = await fetch(`${BASE_URL}/steel-widget.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(await res.text()).toContain('SteelChat')
  })

  it('should refuse a config request without a key', async () => {
    const res = await fetch(`${BASE_URL}/api/widget/config`, {
      headers: { Origin: ORIGIN },
    })
    expect(res.status).toBe(422)
  })

  it('should answer 404 for an unknown key and send no CORS headers', async () => {
    const res = await fetch(`${BASE_URL}/api/widget/config?key=stw_unknown`, {
      headers: { Origin: ORIGIN },
    })
    expect(res.status).toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    const body = await res.json()
    expect(body.error.code).toBe('WIDGET_NOT_AVAILABLE')
  })

  it('should refuse a preflight for an unknown key', async () => {
    const res = await fetch(`${BASE_URL}/api/widget/messages?key=stw_unknown`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
      },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('should not read messages for an unknown key', async () => {
    const res = await fetch(`${BASE_URL}/api/widget/messages?key=stw_unknown`, {
      headers: { Origin: ORIGIN },
    })
    expect(res.status).toBe(404)
  })

  it('should refuse a message for an unknown key', async () => {
    const res = await fetch(`${BASE_URL}/api/widget/messages?key=stw_unknown`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'oi' }),
    })
    expect(res.status).toBe(404)
  })
})
