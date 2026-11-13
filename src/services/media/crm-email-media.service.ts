import { logger } from '@/lib/axiom/logger'
import { MINIO_ENDPOINT, MINIO_PUBLIC_URL } from '@/lib/env/_server'
import { storageError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { listObjects } from '@/src/lib/storage/s3'
import { persistObject, validateImage, workspaceMediaKey } from './_media'

/** Public bucket: images must load in the recipients' mail clients. */
export const CRM_EMAIL_IMAGE_BUCKET = 'crm-email-images'

/** Image of a visual-builder e-mail (JPEG/PNG/WebP, up to 5 MB). */
export async function persistCrmEmailImage(input: {
  workspaceId: string
  contentType: string
  byteSize: number
  readBody: () => Promise<Buffer>
}): Promise<Result<{ url: string }>> {
  const validation = validateImage(input.contentType, input.byteSize)
  if (!validation.ok) return validation

  const body = await input.readBody()
  const stored = await persistObject({
    bucket: CRM_EMAIL_IMAGE_BUCKET,
    key: workspaceMediaKey(input.workspaceId, validation.value),
    body,
    contentType: input.contentType,
    component: 'CrmEmailMediaService',
    event: 'crm_email_media.persist_failed',
  })
  if (!stored.ok) return stored

  return ok({ url: stored.value })
}

/** Newest first, capped: a library is browsed, not exported. */
export const CRM_EMAIL_IMAGE_LIST_LIMIT = 500

export interface CrmEmailImageItem {
  /** File name inside the workspace prefix. */
  id: string
  url: string
  size: number
  uploadedAt: string | null
}

/** Images uploaded to the workspace's visual e-mail/document builders. */
export async function listCrmEmailImages(
  workspaceId: string,
): Promise<Result<CrmEmailImageItem[]>> {
  try {
    const objects = await listObjects(CRM_EMAIL_IMAGE_BUCKET, `${workspaceId}/`)
    const items = objects.map((object) => ({
      id: object.key.slice(object.key.lastIndexOf('/') + 1),
      url: `${MINIO_PUBLIC_URL ?? MINIO_ENDPOINT}/${CRM_EMAIL_IMAGE_BUCKET}/${object.key}`,
      size: object.size,
      uploadedAt: object.lastModified?.toISOString() ?? null,
    }))
    items.sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''))
    return ok(items.slice(0, CRM_EMAIL_IMAGE_LIST_LIMIT))
  } catch (error) {
    logger.error('crm_email_media.list_failed', {
      component: 'CrmEmailMediaService',
      workspaceId,
      message: error instanceof Error ? error.message : String(error),
    })
    return err(storageError('Não foi possível carregar as imagens'))
  }
}
