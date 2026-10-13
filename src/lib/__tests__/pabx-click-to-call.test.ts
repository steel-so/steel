import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const env = vi.hoisted(() => ({
  PABX_CALL_URL: 'http://pabx.test/steel_call_endpoint.php' as
    | string
    | undefined,
  PABX_CALL_TOKEN: 'device-token' as string | undefined,
  PABX_CALL_AUDIO: 'apresentacao.wav',
}))

vi.mock('@/lib/env/server', () => env)

import { placePabxCall, toPabxDestination } from '../pabx/click-to-call'

const fetchMock = vi.fn()

const input = {
  deviceId: '123',
  extension: '200',
  destination: '5511999999999',
  mode: 'DIRECT' as const,
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
    env.PABX_CALL_URL = 'http://pabx.test/steel_call_endpoint.php'
    env.PABX_CALL_TOKEN = 'device-token'
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the form expected by the dialer and returns the destination', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    const result = await placePabxCall(input)

    expect(expectOk(result)).toEqual({ destination: '11999999999' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://pabx.test/steel_call_endpoint.php')
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      iddevice: '123',
      ramal: '200',
      destino: '11999999999',
      tipo: '1',
      audio: 'apresentacao.wav',
      token: 'device-token',
    })
  })

  it('sends tipo=2 for a call that starts with the recording', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    await placePabxCall({ ...input, mode: 'RECORDING' })

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(body.get('tipo')).toBe('2')
  })

  it('fails with PABX_NOT_CONFIGURED without URL or token', async () => {
    env.PABX_CALL_TOKEN = undefined

    expectErr(await placePabxCall(input), 'PABX_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the dialer message when it refuses the call', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, { ok: false, mensagem: 'Parâmetros inválidos.' }),
    )

    const error = expectErr(await placePabxCall(input), 'PABX_CALL_FAILED')
    expect(error.message).toContain('Parâmetros inválidos.')
  })

  it('fails when the dialer answers 200 without ok=true', async () => {
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
