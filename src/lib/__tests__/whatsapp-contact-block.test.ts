import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (value: string) => `dec:${value}`),
}))

import { logger } from '@/lib/axiom/logger'
import {
  BLOCK_PENDING_META_MESSAGE,
  blockWaIdVariants,
  createMetaBlockClient,
  createZapiBlockClient,
  normalizeBlockWaId,
  resolveBlockClient,
} from '../whatsapp/contact-block'

const META = { phoneNumberId: 'pn1', wabaId: 'waba1', accessToken: 'tok' }
const ZAPI = { instanceId: 'inst1', token: 'tk', clientToken: 'ct' }

const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return {
    url,
    method: init.method ?? 'GET',
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeBlockWaId / blockWaIdVariants', () => {
  it('keeps the digits of a phone typed in any format', () => {
    expect(normalizeBlockWaId('+55 (11) 98888-7777')).toBe('5511988887777')
    expect(normalizeBlockWaId(' 5511988887777 ')).toBe('5511988887777')
  })

  it('keeps a BSUID or a group id as is', () => {
    expect(normalizeBlockWaId('BR.123abc')).toBe('BR.123abc')
    expect(normalizeBlockWaId('120363-group')).toBe('120363-group')
    expect(normalizeBlockWaId('')).toBe('')
  })

  it('matches a Brazilian mobile with and without the ninth digit', () => {
    expect(blockWaIdVariants('5511988887777')).toEqual([
      '5511988887777',
      '551188887777',
    ])
    expect(blockWaIdVariants('551188887777')).toEqual([
      '551188887777',
      '5511988887777',
    ])
  })

  it('leaves landlines, other countries and BSUIDs alone', () => {
    expect(blockWaIdVariants('551130000000')).toEqual(['551130000000'])
    expect(blockWaIdVariants('5511330000000')).toEqual(['5511330000000'])
    expect(blockWaIdVariants('14155550000')).toEqual(['14155550000'])
    expect(blockWaIdVariants('BR.123')).toEqual(['BR.123'])
  })
})

describe('createMetaBlockClient', () => {
  const client = createMetaBlockClient(META)

  it('blocks a phone through the Block Users API', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        messaging_product: 'whatsapp',
        block_users: {
          added_users: [{ input: '5511988887777', wa_id: '5511988887777' }],
        },
      }),
    )
    expect(await client.block('5511988887777')).toEqual({
      status: 'APPLIED',
      error: null,
    })
    const call = lastCall()
    expect(call.url).toBe('https://graph.facebook.com/v26.0/pn1/block_users')
    expect(call.method).toBe('POST')
    expect(call.headers.Authorization).toBe('Bearer tok')
    expect(call.body).toEqual({
      messaging_product: 'whatsapp',
      block_users: [{ user: '5511988887777' }],
    })
  })

  it('blocks a username-only contact by its BSUID', async () => {
    fetchMock.mockResolvedValue(json(200, {}))
    expect((await client.block('BR.123')).status).toBe('APPLIED')
    expect(lastCall().body.block_users).toEqual([{ user_id: 'BR.123' }])
  })

  it('keeps the block PENDING on 131047 (outside the 24 h window)', async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        messaging_product: 'whatsapp',
        block_users: {
          failed_users: [
            {
              input: '5511988887777',
              errors: [
                {
                  message: 'Re-engagement message',
                  code: 131047,
                  error_data: { details: 'more than 24 hours' },
                },
              ],
            },
          ],
        },
        error: { code: 139100, message: 'Failed to block some users' },
      }),
    )
    expect(await client.block('5511988887777')).toEqual({
      status: 'PENDING',
      error: BLOCK_PENDING_META_MESSAGE,
    })
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      'whatsapp.contact_block.meta_failed',
      expect.objectContaining({ status: 400, user: '5511****' }),
    )
  })

  it('reads 131047 from a plain error too', async () => {
    fetchMock.mockResolvedValue(
      json(400, { error: { code: 131047, message: 'Re-engagement' } }),
    )
    expect((await client.block('5511988887777')).status).toBe('PENDING')
  })

  it('reports a partial failure with another code as FAILED', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        block_users: {
          failed_users: [{ input: 'x', errors: [{ code: 139101 }] }],
        },
      }),
    )
    expect(await client.block('5511988887777')).toEqual({
      status: 'FAILED',
      error:
        'A lista de bloqueio deste número na Meta está cheia (limite de 64.000 contatos).',
    })
  })

  it('words unknown Meta errors with their details', async () => {
    fetchMock.mockResolvedValueOnce(
      json(500, { error: { code: 1, error_data: { details: 'Oops' } } }),
    )
    expect((await client.block('5511988887777')).error).toBe(
      'A Meta recusou o bloqueio: Oops',
    )
    fetchMock.mockResolvedValueOnce(json(500, { error: { message: 'Down' } }))
    expect((await client.block('5511988887777')).error).toBe(
      'A Meta recusou o bloqueio: Down',
    )
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 502 }))
    expect((await client.block('5511988887777')).error).toBe(
      'A Meta recusou o bloqueio.',
    )
  })

  it('turns a network failure into FAILED', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    expect(await client.block('5511988887777')).toEqual({
      status: 'FAILED',
      error: 'Não foi possível falar com a Meta: timeout',
    })
    fetchMock.mockRejectedValueOnce('boom')
    expect((await client.block('5511988887777')).error).toBe(
      'Não foi possível falar com a Meta: boom',
    )
  })

  it('unblocks with DELETE and reports refusals', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { block_users: { removed_users: [{ input: '1' }] } }),
    )
    expect(await client.unblock('5511988887777')).toEqual({
      ok: true,
      error: null,
    })
    expect(lastCall().method).toBe('DELETE')

    fetchMock.mockResolvedValueOnce(
      json(200, {
        block_users: {
          failed_users: [{ input: '1', errors: [{ message: 'not blocked' }] }],
        },
      }),
    )
    expect(await client.unblock('5511988887777')).toEqual({
      ok: false,
      error: 'A Meta recusou o desbloqueio: not blocked',
    })

    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 100 } }))
    expect((await client.unblock('5511988887777')).error).toBe(
      'A Meta não reconheceu o número deste contato.',
    )

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await client.unblock('5511988887777')).toEqual({
      ok: false,
      error: 'Não foi possível falar com a Meta: offline',
    })
  })

  it('lists every blocked user across pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          data: [
            { messaging_product: 'whatsapp', wa_id: '5511988887777' },
            { messaging_product: 'whatsapp', user_id: 'BR.9' },
            { messaging_product: 'whatsapp' },
          ],
          paging: { cursors: { before: 'a', after: 'c1' } },
        }),
      )
      .mockResolvedValueOnce(
        json(200, {
          data: [{ wa_id: '+1 415 555 0000' }],
          paging: { cursors: { after: 'c1' } },
        }),
      )
    expect(await client.list()).toEqual({
      supported: true,
      waIds: ['5511988887777', 'BR.9', '14155550000'],
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://graph.facebook.com/v26.0/pn1/block_users?limit=1000',
    )
    expect(fetchMock.mock.calls[1][0]).toContain('after=c1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops on an empty page or a missing cursor', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [] }))
    expect(await client.list()).toEqual({ supported: true, waIds: [] })
    fetchMock.mockResolvedValueOnce(json(200, { data: [{ wa_id: '1' }] }))
    expect((await client.list()).waIds).toEqual(['1'])
    fetchMock.mockResolvedValueOnce(json(200, null))
    expect((await client.list()).waIds).toEqual([])
  })

  it('throws a pt-BR message when the list fails', async () => {
    fetchMock.mockResolvedValueOnce(
      json(403, { error: { message: 'No permission' } }),
    )
    await expect(client.list()).rejects.toThrow(
      'A Meta recusou a lista de bloqueados: No permission',
    )
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(client.list()).rejects.toThrow(
      'A Meta recusou a lista de bloqueados (500)',
    )
  })
})

describe('createZapiBlockClient', () => {
  const client = createZapiBlockClient(ZAPI)

  it('blocks on the device with modify-blocked and the Client-Token', async () => {
    fetchMock.mockResolvedValue(json(200, { value: true }))
    expect(await client.block('5511988887777')).toEqual({
      status: 'APPLIED',
      error: null,
    })
    const call = lastCall()
    expect(call.url).toBe(
      'https://api.z-api.io/instances/inst1/token/tk/contacts/modify-blocked',
    )
    expect(call.method).toBe('POST')
    expect(call.headers['Client-Token']).toBe('ct')
    expect(call.body).toEqual({ phone: '5511988887777', action: 'block' })
  })

  it('unblocks with action unblock', async () => {
    fetchMock.mockResolvedValue(json(200, { value: true }))
    expect(await client.unblock('5511988887777')).toEqual({
      ok: true,
      error: null,
    })
    expect(lastCall().body.action).toBe('unblock')
  })

  it('sends no Client-Token when the connection has none', async () => {
    fetchMock.mockResolvedValue(json(200, { value: true }))
    await createZapiBlockClient({ instanceId: 'i', token: 't' }).block('5511')
    expect(lastCall().headers['Client-Token']).toBeUndefined()
  })

  it('reports value:false, HTTP errors and network failures', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { value: false }))
    expect((await client.block('5511988887777')).error).toContain(
      'não conseguiu bloquear',
    )
    fetchMock.mockResolvedValueOnce(json(200, { value: false }))
    expect((await client.unblock('5511988887777')).error).toContain(
      'não conseguiu desbloquear',
    )
    fetchMock.mockResolvedValueOnce(json(400, { error: 'Instance offline' }))
    expect(await client.block('5511988887777')).toEqual({
      status: 'FAILED',
      error: 'A Z-API recusou a chamada (400): Instance offline',
    })
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      'whatsapp.contact_block.zapi_failed',
      expect.objectContaining({ action: 'block', user: '5511****' }),
    )
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    expect((await client.block('5511988887777')).error).toBe(
      'Falha na requisição Z-API (500)',
    )
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    expect((await client.block('5511988887777')).error).toBe(
      'Não foi possível falar com a Z-API: ECONNRESET',
    )
  })

  it('cannot block a contact without a phone', async () => {
    expect(await client.block('BR.123')).toEqual({
      status: 'FAILED',
      error: 'A Z-API só bloqueia contatos com número de telefone.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('has no block list to read', async () => {
    expect(await client.list()).toEqual({ supported: false, waIds: [] })
  })
})

describe('resolveBlockClient', () => {
  it('builds a Z-API client with the decrypted tokens', async () => {
    fetchMock.mockResolvedValue(json(200, { value: true }))
    const client = await resolveBlockClient(
      createFakeWhatsAppConnection({
        provider: 'ZAPI',
        zapiInstanceId: 'inst9',
        encryptedZapiToken: 'tok',
        encryptedZapiClientToken: 'ct',
      }),
    )
    await client?.block('5511988887777')
    expect(lastCall().url).toContain('/instances/inst9/token/dec:tok/')
    expect(lastCall().headers['Client-Token']).toBe('dec:ct')
  })

  it('builds a Meta client with the decrypted access token', async () => {
    fetchMock.mockResolvedValue(json(200, {}))
    const client = await resolveBlockClient(
      createFakeWhatsAppConnection({
        provider: 'META',
        metaPhoneNumberId: 'pn9',
        metaWabaId: 'w',
        encryptedMetaAccessToken: 'at',
      }),
    )
    await client?.block('5511988887777')
    expect(lastCall().url).toContain('/pn9/block_users')
    expect(lastCall().headers.Authorization).toBe('Bearer dec:at')
  })

  it('returns null without credentials and for the site chat', async () => {
    expect(
      await resolveBlockClient(
        createFakeWhatsAppConnection({
          provider: 'ZAPI',
          zapiInstanceId: null,
        }),
      ),
    ).toBeNull()
    expect(
      await resolveBlockClient(
        createFakeWhatsAppConnection({
          provider: 'META',
          metaPhoneNumberId: null,
        }),
      ),
    ).toBeNull()
    expect(
      await resolveBlockClient(
        createFakeWhatsAppConnection({ provider: 'WIDGET' }),
      ),
    ).toBeNull()
  })

  it('omits the Z-API Client-Token when the connection has none', async () => {
    fetchMock.mockResolvedValue(json(200, { value: true }))
    const client = await resolveBlockClient(
      createFakeWhatsAppConnection({
        provider: 'ZAPI',
        encryptedZapiClientToken: null,
      }),
    )
    await client?.block('5511988887777')
    expect(lastCall().headers['Client-Token']).toBeUndefined()
  })
})
