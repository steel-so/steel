import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { pabxNotConfigured } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/env/server', () => ({
  PABX_WEBPHONE_ENDPOINT_TEMPLATE:
    'http://{host}:4561/steel_webphone_endpoint.php',
}))
vi.mock('../pabx/device-directory', () => ({ findPabxDevice: vi.fn() }))

import { findPabxDevice } from '../pabx/device-directory'
import { provisionWebphone } from '../pabx/webphone'

const mockedFindDevice = vi.mocked(findPabxDevice)
const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const provisioned = {
  ok: true,
  ramal: '1122S',
  secret: 'sip-secret',
  domain: '177.136.201.206',
  wss: 'wss://sbc.stratustelecom.com.br:8089/ws',
}

describe('provisionWebphone', () => {
  beforeEach(() => {
    mockedFindDevice.mockResolvedValue(
      ok({ id: '0', host: '172.20.28.248', token: 'device-token' }),
    )
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("asks the device's own PABX with the device token and maps the answer", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, provisioned))

    const credentials = expectOk(await provisionWebphone('0', '1122S'))

    expect(credentials).toEqual({
      extension: '1122S',
      password: 'sip-secret',
      domain: '177.136.201.206',
      wssUrl: 'wss://sbc.stratustelecom.com.br:8089/ws',
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://172.20.28.248:4561/steel_webphone_endpoint.php')
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      iddevice: '0',
      ramal: '1122S',
      token: 'device-token',
    })
  })

  it('fails with PABX_DEVICE_NOT_FOUND for an unknown or inactive device', async () => {
    mockedFindDevice.mockResolvedValue(ok(null))

    expectErr(await provisionWebphone('999', '1122S'), 'PABX_DEVICE_NOT_FOUND')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates the device lookup failure', async () => {
    mockedFindDevice.mockResolvedValue(err(pabxNotConfigured()))

    expectErr(await provisionWebphone('0', '1122S'), 'PABX_NOT_CONFIGURED')
  })

  it('surfaces the PABX message when it refuses the extension', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        ok: false,
        mensagem: 'Este ramal não está habilitado para WebRTC.',
      }),
    )

    const error = expectErr(
      await provisionWebphone('0', '1122S'),
      'PABX_CALL_FAILED',
    )
    expect(error.message).toContain('não está habilitado para WebRTC')
  })

  it.each([
    ['without a secret', { ...provisioned, secret: '' }],
    ['without a domain', { ...provisioned, domain: '' }],
    ['without a WSS address', { ...provisioned, wss: '' }],
  ])('rejects an answer %s', async (_label, body) => {
    fetchMock.mockResolvedValue(jsonResponse(200, body))

    const error = expectErr(
      await provisionWebphone('0', '1122S'),
      'PABX_CALL_FAILED',
    )
    expect(error.message).toBe('Não foi possível preparar o telefone web.')
  })

  it('fails when the answer is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }))

    expectErr(await provisionWebphone('0', '1122S'), 'PABX_CALL_FAILED')
  })

  it('fails when the PABX is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connect ETIMEDOUT'))

    const error = expectErr(
      await provisionWebphone('0', '1122S'),
      'PABX_CALL_FAILED',
    )
    expect(error.message).toContain('não respondeu')
  })

  it('reports non-Error rejections too', async () => {
    fetchMock.mockRejectedValue('boom')

    expectErr(await provisionWebphone('0', '1122S'), 'PABX_CALL_FAILED')
  })
})
