import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  disconnectZapiInstance,
  getZapiInstancePhone,
  getZapiInstanceStatus,
  restartZapiInstance,
} from '@/src/lib/whatsapp/zapi-client'

const credentials = { instanceId: 'inst', token: 'tok', clientToken: 'ct' }
const fetchMock = vi.fn()

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

const urlOf = (call: number) => fetchMock.mock.calls[call][0] as string

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getZapiInstanceStatus()', () => {
  it('reads GET /status with the Client-Token header', async () => {
    reply({ connected: true, smartphoneConnected: true })
    expect(await getZapiInstanceStatus(credentials)).toEqual({
      connected: true,
      error: null,
    })
    expect(urlOf(0)).toBe(
      'https://api.z-api.io/instances/inst/token/tok/status',
    )
    expect(fetchMock.mock.calls[0][1].headers['Client-Token']).toBe('ct')
  })

  it('keeps the reason while not connected', async () => {
    reply({ connected: false, error: 'You are not connected.' })
    expect(await getZapiInstanceStatus(credentials)).toEqual({
      connected: false,
      error: 'You are not connected.',
    })
  })

  it('treats an unusable body as not connected', async () => {
    reply(null)
    expect(await getZapiInstanceStatus(credentials)).toEqual({
      connected: false,
      error: null,
    })
  })

  it('throws the pt-BR provider reason on a refused call', async () => {
    reply({ error: 'Client-Token is required' }, 401)
    await expect(getZapiInstanceStatus(credentials)).rejects.toThrow(
      'Client-Token',
    )
  })
})

describe('getZapiInstancePhone()', () => {
  it('returns the digits of the paired number', async () => {
    reply({ phone: '+55 11 99999-0000', name: 'Linha' })
    expect(await getZapiInstancePhone(credentials)).toBe('5511999990000')
    expect(urlOf(0)).toBe(
      'https://api.z-api.io/instances/inst/token/tok/device',
    )
  })

  it('is null when Z-API does not say', async () => {
    reply({})
    expect(await getZapiInstancePhone(credentials)).toBeNull()
  })
})

describe('disconnectZapiInstance() and restartZapiInstance()', () => {
  it('call GET /disconnect and GET /restart', async () => {
    reply({ value: true })
    reply({ value: true })
    await disconnectZapiInstance(credentials)
    await restartZapiInstance(credentials)
    expect(urlOf(0)).toBe(
      'https://api.z-api.io/instances/inst/token/tok/disconnect',
    )
    expect(urlOf(1)).toBe(
      'https://api.z-api.io/instances/inst/token/tok/restart',
    )
  })
})
