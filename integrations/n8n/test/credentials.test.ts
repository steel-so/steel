import { describe, expect, it } from 'vitest'
import { SteelApi } from '../credentials/SteelApi.credentials'

describe('SteelApi credential', () => {
  const credential = new SteelApi()

  it('asks for the Steel URL and a masked token', () => {
    const byName = Object.fromEntries(
      credential.properties.map((property) => [property.name, property]),
    )
    expect(byName.baseUrl?.required).toBe(true)
    expect(byName.token?.typeOptions).toEqual({ password: true })
    expect(byName.token?.required).toBe(true)
  })

  it('authenticates with a Bearer header built from the token', () => {
    expect(credential.authenticate).toEqual({
      type: 'generic',
      properties: {
        headers: { Authorization: '=Bearer {{$credentials.token}}' },
      },
    })
  })

  it('tests the credential against GET /api/v1/me', () => {
    expect(credential.test.request).toEqual({
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/me',
    })
    expect(credential.name).toBe('steelApi')
  })
})
