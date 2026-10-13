import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { pabxNotConfigured } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/env/server', () => ({
  PABX_ENDPOINT_TEMPLATE: 'http://{host}:4561/steel_call_endpoint.php',
}))
vi.mock('../pabx/device-directory', () => ({ findPabxDevice: vi.fn() }))

import { placePabxCall, toPabxDestination } from '../pabx/click-to-call'
import { findPabxDevice } from '../pabx/device-directory'

const mockedFindDevice = vi.mocked(findPabxDevice)
const fetchMock = vi.fn()

const input = {
  deviceId: '123',
  extension: '200',
  destination: '5511999999999',
  callbackUrl: 'https://steel.test/api/pabx/calls/webhook',
  callbackToken: 'callback-token-123456',
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('toPabxDestination', () => {
  it('drops the Brazilian country code from mobile and landline numbers', () => {
    expect(toPabxDestination('5511999999999')).toBe('11999999999')
    expect(toPabxDestination('551133334444')).toBe('1133334444')
  })

  it('keeps numbers without the country code and strips formatting', () => {
    expect(toPabxDestination('(11) 99999-9999')).toBe('11999999999')
    expect(toPabxDestination('+1 415 555 0100')).toBe('14155550100')
  })
})

describe('placePabxCall', () => {
  beforeEach(() => {
    mockedFindDevice.mockResolvedValue(
      ok({ id: '123', host: '172.20.28.248', token: 'device-token' }),
    )
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts a direct call to the device's own PABX with the callback", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(202, { ok: true, job: 'steel_api_123_abc' }),
    )

    const result = await placePabxCall(input)

    expect(expectOk(result)).toEqual({
      destination: '11999999999',
      job: 'steel_api_123_abc',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://172.20.28.248:4561/steel_call_endpoint.php')
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      iddevice: '123',
      ramal: '200',
      destino: '11999999999',
      tipo: '1',
      token: 'device-token',
      callback_url: 'https://steel.test/api/pabx/calls/webhook',
      callback_token: 'callback-token-123456',
    })
  })

  it('returns a null job when the PABX does not send one', async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { ok: true }))

    expect(expectOk(await placePabxCall(input)).job).toBeNull()
  })

  it('fails with PABX_DEVICE_NOT_FOUND for an unknown or inactive device', async () => {
    mockedFindDevice.mockResolvedValue(ok(null))

    expectErr(await placePabxCall(input), 'PABX_DEVICE_NOT_FOUND')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates the device lookup failure', async () => {
    mockedFindDevice.mockResolvedValue(err(pabxNotConfigured()))

    expectErr(await placePabxCall(input), 'PABX_NOT_CONFIGURED')
  })

  it('surfaces the dialer message when it refuses the call', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        ok: false,
        mensagem: 'Token ou dispositivo inválido.',
      }),
    )

    const error = expectErr(await placePabxCall(input), 'PABX_CALL_FAILED')
    expect(error.message).toContain('Token ou dispositivo inválido.')
  })

  it('fails when the dialer answers without ok=true', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))

    const error = expectErr(await placePabxCall(input), 'PABX_CALL_FAILED')
    expect(error.message).toBe('Não foi possível iniciar a ligação')
  })

  it('fails when the dialer is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connect ETIMEDOUT'))

    const error = expectErr(await placePabxCall(input), 'PABX_CALL_FAILED')
    expect(error.message).toContain('não respondeu')
  })

  it('reports non-Error rejections too', async () => {
    fetchMock.mockRejectedValue('boom')

    expectErr(await placePabxCall(input), 'PABX_CALL_FAILED')
  })
})
