import { describe, expect, it } from 'vitest'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const URL_MCP = `${BASE_URL}/api/mcp`
const METADATA =
  /resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource"/

const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' },
  },
})

const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

describe('POST /api/mcp', () => {
  it('should answer 401 with the bearer challenge when no token is sent', async () => {
    const res = await fetch(URL_MCP, {
      method: 'POST',
      headers,
      body: initialize,
    })

    expect(res.status).toBe(401)
    const challenge = res.headers.get('www-authenticate') ?? ''
    expect(challenge).toMatch(/^Bearer /)
    expect(challenge).toMatch(METADATA)
    expect(challenge).not.toContain('invalid_token')
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('should answer 401 with invalid_token for an unknown token', async () => {
    const res = await fetch(URL_MCP, {
      method: 'POST',
      headers: { ...headers, authorization: 'Bearer not-a-real-token' },
      body: initialize,
    })

    expect(res.status).toBe(401)
    const challenge = res.headers.get('www-authenticate') ?? ''
    expect(challenge).toContain('error="invalid_token"')
    expect(challenge).toMatch(METADATA)
  })

  it('should not redirect to sign-in (the proxy lets bearer calls through)', async () => {
    const res = await fetch(URL_MCP, {
      method: 'POST',
      headers,
      body: initialize,
      redirect: 'manual',
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })
})

describe.each(['GET', 'DELETE'])('%s /api/mcp', (method) => {
  it('should answer 405 with Allow: POST', async () => {
    const res = await fetch(URL_MCP, { method, headers })

    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    const body = await res.json()
    expect(body.jsonrpc).toBe('2.0')
  })
})
