import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkZapiPhoneExists,
  checkZapiPhonesBatch,
  ZAPI_PHONE_CHECK_BATCH_SIZE,
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

function batchBody(call: number): { phones: string[] } {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string)
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkZapiPhoneExists()', () => {
  it('calls GET /phone-exists/{phone} and parses the array body', async () => {
    reply([{ exists: true, phone: '5511999998888', lid: '123@lid' }])

    const result = await checkZapiPhoneExists(
      credentials,
      '+55 (11) 99999-8888',
    )

    expect(result).toEqual({
      phone: '5511999998888',
      exists: true,
      outputPhone: '5511999998888',
      lid: '123@lid',
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.z-api.io/instances/inst/token/tok/phone-exists/5511999998888',
    )
    expect(fetchMock.mock.calls[0][1].headers['Client-Token']).toBe('ct')
  })

  it('drops the lid when the number has no WhatsApp', async () => {
    reply([{ exists: false, phone: '5511999998888', lid: 'x@lid' }])
    expect(await checkZapiPhoneExists(credentials, '5511999998888')).toEqual({
      phone: '5511999998888',
      exists: false,
      outputPhone: '5511999998888',
      lid: null,
    })
  })

  it('accepts a bare object body', async () => {
    reply({ exists: true })
    const result = await checkZapiPhoneExists(credentials, '5511999998888')
    expect(result).toMatchObject({ exists: true, outputPhone: null })
  })

  it('returns null for a malformed body', async () => {
    reply([{ nope: true }])
    expect(await checkZapiPhoneExists(credentials, '5511999998888')).toBeNull()
  })

  it('returns null without calling Z-API for an invalid number', async () => {
    expect(await checkZapiPhoneExists(credentials, '123')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on a 4xx answer with a pt-BR message', async () => {
    reply({ error: 'Instance not found' }, 400)
    await expect(
      checkZapiPhoneExists(credentials, '5511999998888'),
    ).rejects.toThrow('Z-API')
  })
})

describe('checkZapiPhonesBatch()', () => {
  const fast = { pauseMs: 0, retryDelayMs: 0 }

  it('posts the normalized, de-duplicated numbers and maps the answers', async () => {
    reply([
      {
        exists: true,
        inputPhone: '5511999998888',
        outputPhone: '5511999998888',
        lid: '1@lid',
      },
      {
        exists: false,
        inputPhone: '5521977776666',
        outputPhone: '5521977776666',
        lid: null,
      },
    ])

    const result = await checkZapiPhonesBatch(
      credentials,
      ['+55 11 99999-8888', '5511999998888', '5521977776666', 'abc'],
      fast,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/phone-exists-batch')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(batchBody(0)).toEqual({
      phones: ['5511999998888', '5521977776666'],
    })
    expect(result.invalid).toEqual(['abc'])
    expect(result.failed).toEqual([])
    expect(result.results.map((r) => [r.phone, r.exists, r.lid])).toEqual([
      ['5511999998888', true, '1@lid'],
      ['5521977776666', false, null],
    ])
  })

  it('splits into chunks of the configured size and reports each chunk', async () => {
    const phones = Array.from({ length: 5 }, (_, i) => `551199999000${i}`)
    reply(phones.slice(0, 2).map((p) => ({ exists: true, inputPhone: p })))
    reply(phones.slice(2, 4).map((p) => ({ exists: true, inputPhone: p })))
    reply(phones.slice(4).map((p) => ({ exists: false, inputPhone: p })))
    const onChunk = vi.fn()

    const result = await checkZapiPhonesBatch(credentials, phones, {
      ...fast,
      batchSize: 2,
      onChunk,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onChunk).toHaveBeenCalledTimes(3)
    expect(result.results).toHaveLength(5)
    expect(batchBody(2).phones).toEqual([phones[4]])
  })

  it('uses a conservative default chunk size', () => {
    expect(ZAPI_PHONE_CHECK_BATCH_SIZE).toBeLessThanOrEqual(1000)
  })

  it('retries a failed chunk once and succeeds', async () => {
    reply({ error: 'boom' }, 500)
    reply([{ exists: true, inputPhone: '5511999998888' }])

    const result = await checkZapiPhonesBatch(
      credentials,
      ['5511999998888'],
      fast,
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.results).toHaveLength(1)
    expect(result.failed).toEqual([])
  })

  it('keeps going when one chunk fails twice (partial failure)', async () => {
    reply({ error: 'boom' }, 500)
    reply({ error: 'boom' }, 500)
    reply([{ exists: true, inputPhone: '5511999990002' }])

    const result = await checkZapiPhonesBatch(
      credentials,
      ['5511999990001', '5511999990002'],
      { ...fast, batchSize: 1 },
    )

    expect(result.failed).toEqual(['5511999990001'])
    expect(result.results.map((r) => r.phone)).toEqual(['5511999990002'])
  })

  it('treats numbers missing from the answer as failed', async () => {
    reply([{ exists: true, inputPhone: '5511999990001' }, { garbage: 1 }])

    const result = await checkZapiPhonesBatch(
      credentials,
      ['5511999990001', '5511999990002'],
      fast,
    )

    expect(result.failed).toEqual(['5511999990002'])
  })

  it('falls back to the position when the answer does not echo inputPhone', async () => {
    reply([{ exists: true }, { exists: false }])

    const result = await checkZapiPhonesBatch(
      credentials,
      ['5511999990001', '5511999990002'],
      fast,
    )

    expect(result.results.map((r) => [r.phone, r.exists])).toEqual([
      ['5511999990001', true],
      ['5511999990002', false],
    ])
  })

  it('fails the whole chunk when the body is not an array', async () => {
    reply({ unexpected: true })
    reply({ unexpected: true })

    const result = await checkZapiPhonesBatch(
      credentials,
      ['5511999990001'],
      fast,
    )

    expect(result.results).toEqual([])
    expect(result.failed).toEqual(['5511999990001'])
  })

  it('does not call Z-API when every number is invalid', async () => {
    const result = await checkZapiPhonesBatch(credentials, ['1', 'x'], fast)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ results: [], failed: [], invalid: ['1', 'x'] })
  })

  it('waits between chunks', async () => {
    vi.useFakeTimers()
    try {
      reply([{ exists: true, inputPhone: '5511999990001' }])
      reply([{ exists: true, inputPhone: '5511999990002' }])
      const promise = checkZapiPhonesBatch(
        credentials,
        ['5511999990001', '5511999990002'],
        { batchSize: 1, pauseMs: 500, retryDelayMs: 0 },
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(500)
      const result = await promise
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.results).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
