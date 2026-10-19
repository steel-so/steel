import { describe, expect, it } from 'vitest'
import {
  advertisePublicRevocation,
  patchAuthServerMetadataResponse,
} from '@/src/lib/mcp/auth-server-metadata'

const METHODS = 'revocation_endpoint_auth_methods_supported'

describe('advertisePublicRevocation', () => {
  it('puts none first and keeps the secret-based methods', () => {
    expect(
      advertisePublicRevocation({
        issuer: 'https://steel.test/api/auth',
        [METHODS]: ['client_secret_basic', 'client_secret_post'],
      }),
    ).toEqual({
      issuer: 'https://steel.test/api/auth',
      [METHODS]: ['none', 'client_secret_basic', 'client_secret_post'],
    })
  })

  it('leaves a document that already advertises none as it is', () => {
    const metadata = { [METHODS]: ['none'] }
    expect(advertisePublicRevocation(metadata)).toBe(metadata)
  })

  it('adds the list when the document has none or a malformed one', () => {
    expect(advertisePublicRevocation({})).toEqual({ [METHODS]: ['none'] })
    expect(advertisePublicRevocation({ [METHODS]: 'x' })).toEqual({
      [METHODS]: ['none'],
    })
    expect(advertisePublicRevocation({ [METHODS]: [1, 'a'] })).toEqual({
      [METHODS]: ['none', 'a'],
    })
  })
})

describe('patchAuthServerMetadataResponse', () => {
  it('rewrites the JSON body and keeps status and headers', async () => {
    const original = new Response(
      JSON.stringify({ [METHODS]: ['client_secret_basic'] }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=15',
          'access-control-allow-origin': '*',
          'content-length': '999',
        },
      },
    )
    const patched = await patchAuthServerMetadataResponse(original, {
      'access-control-allow-methods': 'GET, OPTIONS',
    })
    expect(patched.status).toBe(200)
    expect(patched.headers.get('cache-control')).toBe('public, max-age=15')
    expect(patched.headers.get('access-control-allow-origin')).toBe('*')
    expect(patched.headers.get('content-length')).toBeNull()
    expect(patched.headers.get('access-control-allow-methods')).toBe(
      'GET, OPTIONS',
    )
    expect(await patched.json()).toEqual({
      [METHODS]: ['none', 'client_secret_basic'],
    })
  })

  it('passes errors, empty bodies and non-objects through', async () => {
    const failed = new Response('{}', { status: 404 })
    expect(await patchAuthServerMetadataResponse(failed)).toBe(failed)
    const head = new Response(null, { status: 200 })
    expect(await patchAuthServerMetadataResponse(head)).toBe(head)
    const list = new Response('[1]', { status: 200 })
    expect(await patchAuthServerMetadataResponse(list)).toBe(list)
    const nul = new Response('null', { status: 200 })
    expect(await patchAuthServerMetadataResponse(nul)).toBe(nul)
  })
})
