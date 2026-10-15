import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { MINIO_ENDPOINT, MINIO_PUBLIC_URL } from '@/lib/env/_server'
import { storageError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { deleteObject, listObjects } from '@/src/lib/storage/s3'
import type { SiteMediaItemDTO } from '@/types/site-studio'
import { persistObject, validateImage, workspaceMediaKey } from './media/_media'
import { assertSitesPermission } from './site-access'

/**
 * Media library of the site editor ("Mídia"): images uploaded for the
 * workspace's sites, plus the old landing-page images so migrated sites can
 * reuse them. Files live in public buckets under `<workspaceId>/`; the URL
 * stored in the page documents is the only pointer, so the listing comes
 * straight from the bucket.
 */

export const SITE_MEDIA_BUCKET = 'site-media'
const LANDING_IMAGE_BUCKET = 'crm-landing-page-images'
/** Newest first, capped: a library is browsed, not exported. */
export const SITE_MEDIA_LIST_LIMIT = 500

function publicUrl(bucket: string, key: string): string {
  return `${MINIO_PUBLIC_URL ?? MINIO_ENDPOINT}/${bucket}/${key}`
}

function fileName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

export const SiteMediaService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SiteMediaItemDTO[]>> {
    const membership = await assertSitesPermission(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const prefix = `${workspaceId}/`
    try {
      const [site, landing] = await Promise.all([
        listObjects(SITE_MEDIA_BUCKET, prefix),
        listObjects(LANDING_IMAGE_BUCKET, prefix),
      ])
      const items: SiteMediaItemDTO[] = [
        ...site.map((object) => ({ object, source: 'site' as const })),
        ...landing.map((object) => ({ object, source: 'landing' as const })),
      ].map(({ object, source }) => ({
        id: fileName(object.key),
        url: publicUrl(
          source === 'site' ? SITE_MEDIA_BUCKET : LANDING_IMAGE_BUCKET,
          object.key,
        ),
        size: object.size,
        source,
        uploadedAt: object.lastModified?.toISOString() ?? null,
      }))
      items.sort((a, b) =>
        (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''),
      )
      return ok(items.slice(0, SITE_MEDIA_LIST_LIMIT))
    } catch (error) {
      logger.error('site_media.list_failed', {
        component: 'SiteMediaService',
        workspaceId,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(storageError('Não foi possível carregar as imagens'))
    }
  },

  async upload(
    actorId: string,
    workspaceId: string,
    input: {
      contentType: string
      byteSize: number
      readBody: () => Promise<Buffer>
    },
  ): Promise<Result<SiteMediaItemDTO>> {
    const membership = await assertSitesPermission(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const ext = validateImage(input.contentType, input.byteSize)
    if (!ext.ok) return ext

    const body = await input.readBody()
    const key = workspaceMediaKey(workspaceId, ext.value)
    const stored = await persistObject({
      bucket: SITE_MEDIA_BUCKET,
      key,
      body,
      contentType: input.contentType,
      component: 'SiteMediaService',
      event: 'site_media.persist_failed',
    })
    if (!stored.ok) return stored

    auditMutation({
      entity: 'site_media',
      action: 'upload',
      actorId,
      targetId: fileName(key),
      meta: { workspaceId, bytes: body.length },
    })
    return ok({
      id: fileName(key),
      url: stored.value,
      size: body.length,
      source: 'site',
      uploadedAt: new Date().toISOString(),
    })
  },

  /** Deletes an uploaded image. Pages that still use it show a broken
   * image, which the UI warns about before confirming. */
  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<void>> {
    const membership = await assertSitesPermission(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const key = `${workspaceId}/${id}`
    try {
      await deleteObject({ bucket: SITE_MEDIA_BUCKET, key })
    } catch (error) {
      logger.error('site_media.delete_failed', {
        component: 'SiteMediaService',
        key,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(storageError('Não foi possível excluir a imagem'))
    }
    auditMutation({
      entity: 'site_media',
      action: 'delete',
      actorId,
      targetId: id,
      meta: { workspaceId },
    })
    return ok(undefined)
  },
}
