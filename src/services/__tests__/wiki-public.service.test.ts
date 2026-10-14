import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWikiPage } from '@/src/__tests__/factories/wiki-page.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/wiki-page.repository')
vi.mock('@/src/repositories/wiki-settings.repository', () => ({
  WikiSettingsRepository: { isEnabled: vi.fn() },
}))
vi.mock('@/src/lib/storage/s3', () => ({ getObjectStream: vi.fn() }))

import { logger } from '@/lib/axiom/logger'
import { getObjectStream } from '@/src/lib/storage/s3'
import { WikiPageRepository } from '@/src/repositories/wiki-page.repository'
import { WikiSettingsRepository } from '@/src/repositories/wiki-settings.repository'
import { WikiPublicService } from '../wiki-public.service'

const pages = vi.mocked(WikiPageRepository)
const settings = vi.mocked(WikiSettingsRepository)
const stream = vi.mocked(getObjectStream)

const TOKEN = 'a'.repeat(32)
const WS = 'ws1'
const IMG = `http://localhost:9002/wiki-media/${WS}/img.png?X-Amz-Signature=s`

function published() {
  return createFakeWikiPage({
    workspaceId: WS,
    title: 'Manual',
    publicToken: TOKEN,
    publishedAt: new Date('2026-10-14T12:00:00.000Z'),
    coverImage: `http://m/wiki-media/${WS}/cover.jpg`,
    content: [
      { type: 'p', children: [{ text: 'Olá' }] },
      { type: 'img', url: IMG, children: [{ text: '' }] },
    ],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  pages.findPublishedByToken.mockResolvedValue(ok(published()))
  settings.isEnabled.mockResolvedValue(ok(true))
})

describe('WikiPublicService.getByToken()', () => {
  it('returns the page with media pointing at the public proxy', async () => {
    const dto = expectOk(await WikiPublicService.getByToken(TOKEN))

    expect(dto.title).toBe('Manual')
    expect((dto.content[1] as unknown as { url: string }).url).toBe(
      `/api/wiki/public/${TOKEN}/media?key=ws1%2Fimg.png`,
    )
    expect(dto.coverImage).toBe(
      `/api/wiki/public/${TOKEN}/media?key=ws1%2Fcover.jpg`,
    )
    expect(dto).not.toHaveProperty('workspaceId')
  })

  it('404s a malformed token without touching the database', async () => {
    expectErr(await WikiPublicService.getByToken('nope'), 'WIKI_PAGE_NOT_FOUND')
    expect(pages.findPublishedByToken).not.toHaveBeenCalled()
  })

  it('404s a revoked or unknown token', async () => {
    pages.findPublishedByToken.mockResolvedValue(
      err({ code: 'WIKI_PAGE_NOT_FOUND', message: 'x' }),
    )

    expectErr(await WikiPublicService.getByToken(TOKEN), 'WIKI_PAGE_NOT_FOUND')
  })

  it('404s when the wiki is switched off', async () => {
    settings.isEnabled.mockResolvedValue(ok(false))

    expectErr(await WikiPublicService.getByToken(TOKEN), 'WIKI_PAGE_NOT_FOUND')
  })

  it('propagates the settings lookup error', async () => {
    settings.isEnabled.mockResolvedValue(err(databaseError()))

    expectErr(await WikiPublicService.getByToken(TOKEN), 'DATABASE_ERROR')
  })
})

describe('WikiPublicService.getMedia()', () => {
  it('streams a key the page references', async () => {
    const body = new ReadableStream<Uint8Array>()
    stream.mockResolvedValue({
      body,
      contentLength: 3,
      contentType: 'image/png',
    })

    const media = expectOk(
      await WikiPublicService.getMedia(TOKEN, `${WS}/img.png`),
    )

    expect(media).toEqual({ body, contentLength: 3, contentType: 'image/png' })
    expect(stream).toHaveBeenCalledWith({
      bucket: 'wiki-media',
      key: `${WS}/img.png`,
    })
  })

  it('serves the cover and defaults the content type', async () => {
    stream.mockResolvedValue({
      body: new ReadableStream<Uint8Array>(),
      contentLength: undefined,
      contentType: undefined,
    })

    const media = expectOk(
      await WikiPublicService.getMedia(TOKEN, `${WS}/cover.jpg`),
    )

    expect(media.contentType).toBe('application/octet-stream')
  })

  it('refuses keys the page does not reference', async () => {
    expectErr(
      await WikiPublicService.getMedia(TOKEN, `${WS}/other.png`),
      'WIKI_PAGE_NOT_FOUND',
    )
    expect(stream).not.toHaveBeenCalled()
  })

  it('refuses media of a revoked link', async () => {
    pages.findPublishedByToken.mockResolvedValue(
      err({ code: 'WIKI_PAGE_NOT_FOUND', message: 'x' }),
    )

    expectErr(
      await WikiPublicService.getMedia(TOKEN, `${WS}/img.png`),
      'WIKI_PAGE_NOT_FOUND',
    )
  })

  it('404s a missing object', async () => {
    stream.mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'NoSuchKey' }),
    )

    expectErr(
      await WikiPublicService.getMedia(TOKEN, `${WS}/img.png`),
      'WIKI_PAGE_NOT_FOUND',
    )
  })

  it('maps other storage failures to STORAGE_ERROR', async () => {
    const error = vi.spyOn(logger, 'error')
    stream.mockRejectedValueOnce(new Error('minio down'))

    expectErr(
      await WikiPublicService.getMedia(TOKEN, `${WS}/img.png`),
      'STORAGE_ERROR',
    )
    expect(error).toHaveBeenCalledWith(
      'wiki.public_media.read_failed',
      expect.objectContaining({ message: 'minio down' }),
    )

    stream.mockRejectedValueOnce('weird')
    expectErr(
      await WikiPublicService.getMedia(TOKEN, `${WS}/img.png`),
      'STORAGE_ERROR',
    )
    expect(error).toHaveBeenLastCalledWith(
      'wiki.public_media.read_failed',
      expect.objectContaining({ message: 'weird' }),
    )
  })
})
