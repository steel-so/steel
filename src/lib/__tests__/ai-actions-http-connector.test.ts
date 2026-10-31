import { describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  buildConnectorRequest,
  callConnector,
  deriveIdempotencyKey,
  guardConnectorUrl,
} from '../ai-actions/http-connector'

vi.mock('@/src/lib/webhooks/url-guard', async (importOriginal) => {
  const real = await importOriginal<typeof import('../webhooks/url-guard')>()
  return {
    ...real,
    checkWebhookUrl: vi.fn(async (raw: string) =>
      raw.includes('private')
        ? { ok: false, reason: 'private_host' }
        : { ok: true, url: new URL(raw) },
    ),
  }
})

const param = (name: string, required = true) => ({
  name,
  description: '',
  required,
})

describe('buildConnectorRequest', () => {
  const lookup = {
    method: 'GET',
    urlTemplate: 'https://api.cliente.com.br/pedidos/{orderId}',
    params: [param('orderId'), param('verbose', false)],
  }

  it('should fill the path with an encoded value', () => {
    const built = expectOk(
      buildConnectorRequest(lookup, { orderId: '12/../3 4' }),
    )
    expect(built.url).toBe('https://api.cliente.com.br/pedidos/12%2F..%2F3%204')
    expect(built.body).toBeNull()
  })

  it('should send the rest as query on GET and DELETE', () => {
    const built = expectOk(
      buildConnectorRequest(lookup, { orderId: '1', verbose: true }),
    )
    expect(built.url).toBe('https://api.cliente.com.br/pedidos/1?verbose=true')
  })

  it('should send the rest as JSON body on writes', () => {
    const built = expectOk(
      buildConnectorRequest(
        {
          method: 'POST',
          urlTemplate: 'https://api.cliente.com.br/senha',
          params: [param('email'), param('notify', false)],
        },
        { email: 'a@b.com', notify: false },
      ),
    )
    expect(built.url).toBe('https://api.cliente.com.br/senha')
    expect(JSON.parse(built.body ?? '')).toEqual({
      email: 'a@b.com',
      notify: false,
    })
  })

  it('should send no body when a write has nothing left', () => {
    const built = expectOk(
      buildConnectorRequest(
        {
          method: 'PUT',
          urlTemplate: 'https://api.cliente.com.br/x/{id}',
          params: [param('id')],
        },
        { id: 7 },
      ),
    )
    expect(built.body).toBeNull()
  })

  it('should refuse unknown and missing arguments', () => {
    expectErr(
      buildConnectorRequest(lookup, { orderId: '1', extra: 'x' }),
      'AI_ACTION_CONNECTOR_INVALID',
    )
    expectErr(buildConnectorRequest(lookup, {}), 'AI_ACTION_CONNECTOR_INVALID')
    expectErr(
      buildConnectorRequest(lookup, { orderId: '' }),
      'AI_ACTION_CONNECTOR_INVALID',
    )
  })
})

describe('deriveIdempotencyKey', () => {
  const base = {
    workspaceId: 'w',
    connectorKey: 'c',
    params: { b: 1, a: 2 },
  }
  it('should be stable regardless of the argument order', () => {
    expect(deriveIdempotencyKey(base)).toBe(
      deriveIdempotencyKey({ ...base, params: { a: 2, b: 1 } }),
    )
  })

  it('should change with the scope, the connector and the arguments', () => {
    const key = deriveIdempotencyKey(base)
    expect(deriveIdempotencyKey({ ...base, scope: 'run1' })).not.toBe(key)
    expect(deriveIdempotencyKey({ ...base, connectorKey: 'd' })).not.toBe(key)
    expect(deriveIdempotencyKey({ ...base, params: { a: 3, b: 1 } })).not.toBe(
      key,
    )
    expect(key).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('guardConnectorUrl / callConnector', () => {
  const request = {
    url: 'https://api.cliente.com.br/x',
    method: 'POST',
    body: '{"a":1}',
  }

  it('should refuse private hosts before any request', async () => {
    expectErr(
      await guardConnectorUrl('https://private.local/x'),
      'WEBHOOK_URL_NOT_ALLOWED',
    )
    const fetchImpl = vi.fn()
    expectErr(
      await callConnector({
        request: { ...request, url: 'https://private.local/x' },
        headers: {},
        idempotencyKey: null,
        fetchImpl,
      }),
      'WEBHOOK_URL_NOT_ALLOWED',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('should send headers, body and the idempotency key without following redirects', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"done":true}', { status: 201 }),
    )
    const result = expectOk(
      await callConnector({
        request,
        headers: { Authorization: 'Bearer t' },
        idempotencyKey: 'key-1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    )
    expect(result).toEqual({ ok: true, status: 201, body: { done: true } })
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect(init.redirect).toBe('manual')
    expect(init.body).toBe('{"a":1}')
    const headers = init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('key-1')
    expect(headers.Authorization).toBe('Bearer t')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('should keep plain text bodies, empty bodies and non-2xx statuses', async () => {
    const run = async (response: Response) =>
      expectOk(
        await callConnector({
          request: { ...request, body: null },
          headers: {},
          idempotencyKey: null,
          fetchImpl: (async () => response) as unknown as typeof fetch,
        }),
      )
    expect((await run(new Response('texto'))).body).toBe('texto')
    expect((await run(new Response(null, { status: 204 }))).body).toBeNull()
    const failed = await run(new Response('{"e":1}', { status: 500 }))
    expect(failed.ok).toBe(false)
    expect(failed.status).toBe(500)
  })

  it('should truncate huge answers', async () => {
    const big = 'x'.repeat(50_000)
    const result = expectOk(
      await callConnector({
        request,
        headers: {},
        idempotencyKey: null,
        fetchImpl: (async () => new Response(big)) as unknown as typeof fetch,
      }),
    )
    expect((result.body as string).length).toBe(8_000)
  })

  it('should map network failures and timeouts', async () => {
    const network = expectErr(
      await callConnector({
        request,
        headers: {},
        idempotencyKey: null,
        fetchImpl: (async () => {
          throw new Error('down')
        }) as unknown as typeof fetch,
      }),
      'AI_ACTION_CONNECTOR_FAILED',
    )
    expect(network.message).toContain('Não foi possível')
    const timeout = expectErr(
      await callConnector({
        request,
        headers: {},
        idempotencyKey: null,
        fetchImpl: (async () => {
          throw new DOMException('t', 'TimeoutError')
        }) as unknown as typeof fetch,
      }),
      'AI_ACTION_CONNECTOR_FAILED',
    )
    expect(timeout.message).toContain('demorou')
  })
})
