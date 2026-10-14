import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env/_server', () => ({
  MINIO_ENDPOINT: 'http://minio:9000',
  MINIO_PUBLIC_URL: 'https://app/media',
}))
vi.mock('@/src/lib/storage/s3', () => ({
  getObjectWithContentType: vi.fn(),
}))
vi.mock('@/src/services/media/_media', () => ({ persistObject: vi.fn() }))

import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { getObjectWithContentType } from '@/src/lib/storage/s3'
import { readWorkspaceMedia } from '../whatsapp/media'
import {
  fetchMetaTemplates,
  uploadMetaTemplateMedia,
} from '../whatsapp/meta-templates'

const mockedGet = vi.mocked(getObjectWithContentType)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('fetchMetaTemplates()', () => {
  it('asks for quality and rejection reason', async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ name: 'a' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMetaTemplates({ wabaId: 'w', accessToken: 't' })

    expect(result).toEqual([{ name: 'a' }])
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('fields=')
    expect(url).toContain('quality_score')
    expect(url).toContain('rejected_reason')
  })
})

describe('uploadMetaTemplateMedia()', () => {
  const input = {
    accessToken: 'tok',
    body: Buffer.from('png-bytes'),
    contentType: 'image/png',
    fileName: 'x.png',
  }

  it('resolves the app, opens a session and uploads the bytes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ id: '123' }))
      .mockResolvedValueOnce(json({ id: 'upload:abc' }))
      .mockResolvedValueOnce(json({ h: '4::handle' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await uploadMetaTemplateMedia(input)).toBe('4::handle')

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/app$/)
    const [sessionUrl, sessionInit] = fetchMock.mock.calls[1]
    expect(sessionUrl).toContain('/123/uploads?')
    expect(sessionUrl).toContain('file_length=9')
    expect(sessionUrl).toContain('file_type=image%2Fpng')
    expect(sessionInit.method).toBe('POST')
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[2]
    expect(uploadUrl).toMatch(/\/upload:abc$/)
    expect(uploadInit.headers).toMatchObject({
      Authorization: 'OAuth tok',
      file_offset: '0',
    })
  })

  it('skips the app lookup when the id is configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ id: 'upload:abc' }))
      .mockResolvedValueOnce(json({ h: 'h1' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await uploadMetaTemplateMedia({ ...input, appId: '999' })).toBe('h1')
    expect(fetchMock.mock.calls[0][0]).toContain('/999/uploads?')
  })

  it.each([
    [[json({})], 'A Meta não informou o app do token'],
    [[json({ error: { message: 'Token inválido' } }, 401)], 'Token inválido'],
    [[json({ id: '1' }), json({})], 'A Meta não abriu a sessão'],
    [
      [json({ id: '1' }), json({ id: 'upload:x' }), json({})],
      'A Meta não devolveu o identificador',
    ],
    [
      [json({ id: '1' }), new Response('oops', { status: 500 })],
      'Falha ao iniciar o envio da mídia para a Meta (500)',
    ],
  ])('throws a readable error (%#)', async (responses, message) => {
    const fetchMock = vi.fn()
    for (const response of responses) fetchMock.mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadMetaTemplateMedia(input)).rejects.toThrow(message)
  })
})

describe('readWorkspaceMedia()', () => {
  it('reads an object of the workspace from our bucket', async () => {
    mockedGet.mockResolvedValue({
      body: Buffer.from('x'),
      contentType: 'image/png',
    })

    const result = await readWorkspaceMedia(
      'ws1',
      'https://app/media/whatsapp-media/ws1/abc.png',
    )

    expect(expectOk(result)).toMatchObject({
      contentType: 'image/png',
      fileName: 'abc.png',
    })
    expect(mockedGet).toHaveBeenCalledWith({
      bucket: 'whatsapp-media',
      key: 'ws1/abc.png',
    })
  })

  it.each([
    'https://evil.example/whatsapp-media/ws1/abc.png',
    'https://app/media/whatsapp-media/ws2/abc.png',
    'https://app/media/whatsapp-media/ws1/../ws2/abc.png',
  ])('refuses %s', async (url) => {
    expectErr(await readWorkspaceMedia('ws1', url), 'VALIDATION_ERROR')
    expect(mockedGet).not.toHaveBeenCalled()
  })

  it('maps a storage failure', async () => {
    mockedGet.mockRejectedValue(new Error('NoSuchKey'))
    expectErr(
      await readWorkspaceMedia(
        'ws1',
        'https://app/media/whatsapp-media/ws1/abc.png',
      ),
      'STORAGE_ERROR',
    )
  })
})
