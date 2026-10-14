import type { Value } from 'platejs'
import { logger } from '@/lib/axiom/logger'
import type { WikiPublicPageDTO } from '@/types/wiki-page'
import { storageError, wikiPageNotFound } from '../errors'
import { err, ok, type Result } from '../lib/result'
import { getObjectStream } from '../lib/storage/s3'
import {
  collectWikiMediaKeys,
  rewriteWikiMediaUrl,
  rewriteWikiMediaUrls,
} from '../lib/wiki-public-media'
import { toWikiPublicPageDTO } from '../mappers/wiki-page.mapper'
import {
  type WikiPage,
  WikiPageRepository,
} from '../repositories/wiki-page.repository'
import { WikiSettingsRepository } from '../repositories/wiki-settings.repository'
import { WikiPublicTokenSchema } from '../schemas/wiki-page.schema'
import { WIKI_MEDIA_BUCKET } from './_wiki-media'

export interface WikiPublicMedia {
  body: ReadableStream<Uint8Array>
  contentType: string
  contentLength: number | undefined
}

/**
 * The published page behind a token. Every miss is the same 404 — malformed
 * or revoked token, archived page, wiki switched off — so the link leaks
 * nothing about why it stopped working.
 */
async function findPublished(token: string): Promise<Result<WikiPage>> {
  if (!WikiPublicTokenSchema.safeParse(token).success) {
    return err(wikiPageNotFound())
  }

  const page = await WikiPageRepository.findPublishedByToken(token)
  if (!page.ok) return page

  const enabled = await WikiSettingsRepository.isEnabled(page.value.workspaceId)
  if (!enabled.ok) return enabled
  if (!enabled.value) return err(wikiPageNotFound())

  return page
}

/** Anonymous, read-only access to published wiki pages (`/w/<token>`). */
export const WikiPublicService = {
  async getByToken(token: string): Promise<Result<WikiPublicPageDTO>> {
    const page = await findPublished(token)
    if (!page.ok) return page

    const { workspaceId, content, coverImage } = page.value
    return ok(
      toWikiPublicPageDTO(page.value, {
        content: rewriteWikiMediaUrls(content as Value, workspaceId, token),
        coverImage: rewriteWikiMediaUrl(coverImage, workspaceId, token),
      }),
    )
  },

  /**
   * Streams one media object of a published page. Only keys the page itself
   * references are served, so the token never opens the rest of the
   * workspace's media.
   */
  async getMedia(token: string, key: string): Promise<Result<WikiPublicMedia>> {
    const page = await findPublished(token)
    if (!page.ok) return page

    const keys = collectWikiMediaKeys(
      page.value.content,
      page.value.coverImage,
      page.value.workspaceId,
    )
    if (!keys.has(key)) return err(wikiPageNotFound())

    try {
      const object = await getObjectStream({ bucket: WIKI_MEDIA_BUCKET, key })
      return ok({
        body: object.body,
        contentType: object.contentType ?? 'application/octet-stream',
        contentLength: object.contentLength,
      })
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'NoSuchKey') {
        return err(wikiPageNotFound())
      }
      logger.error('wiki.public_media.read_failed', {
        component: 'WikiPublicService',
        workspaceId: page.value.workspaceId,
        key,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(storageError('Falha ao ler o arquivo'))
    }
  },
}
