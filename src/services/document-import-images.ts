import { logger } from '@/lib/axiom/logger'
import {
  describeImages,
  extractPdfImages,
  type PdfImage,
} from '@/src/lib/document-ai/images'
import { deleteObject } from '@/src/lib/storage/s3'
import {
  CRM_EMAIL_IMAGE_BUCKET,
  persistCrmEmailImage,
} from './media/crm-email-media.service'

/**
 * Pictures of an imported PDF: found in the file, stored in the workspace's
 * image library (the bucket every document and e-mail picture lives in, so
 * the public link and the PDF can load them) and handed to the model as a
 * list with their places. Best effort throughout: a PDF without pictures,
 * or whose pictures cannot be read or stored, imports as before.
 */

const COMPONENT = 'DocumentImportImages'

export interface StoredImportImages {
  /** `img-1` → stored URL. */
  urls: Record<string, string>
  /** What the model reads next to the file ('' without pictures). */
  description: string
}

export const NO_IMPORT_IMAGES: StoredImportImages = {
  urls: {},
  description: '',
}

export async function storeImportImages(input: {
  workspaceId: string
  importId: string
  buffer: Buffer
  pageCount: number | null
}): Promise<StoredImportImages> {
  let images: PdfImage[]
  try {
    images = await extractPdfImages(input.buffer)
  } catch (cause) {
    logger.warn('documents.import.images_extract_failed', {
      component: COMPONENT,
      importId: input.importId,
      message: cause instanceof Error ? cause.message : String(cause),
    })
    return NO_IMPORT_IMAGES
  }
  if (images.length === 0) return NO_IMPORT_IMAGES

  const urls: Record<string, string> = {}
  const stored: PdfImage[] = []
  for (const image of images) {
    const result = await persistCrmEmailImage({
      workspaceId: input.workspaceId,
      contentType: image.mime,
      byteSize: image.bytes.length,
      readBody: async () => image.bytes,
    })
    if (!result.ok) continue
    urls[image.id] = result.value.url
    stored.push(image)
  }
  const pages = Math.max(
    input.pageCount ?? 0,
    ...stored.flatMap((image) => image.placements.map((p) => p.page)),
  )
  logger.info('documents.import.images_stored', {
    component: COMPONENT,
    importId: input.importId,
    found: images.length,
    stored: stored.length,
  })
  return { urls, description: describeImages(stored, pages) }
}

/** Object key of a URL stored in the image library. */
function libraryKey(url: string): string | null {
  const marker = `/${CRM_EMAIL_IMAGE_BUCKET}/`
  const at = url.indexOf(marker)
  return at === -1 ? null : url.slice(at + marker.length)
}

/** URLs of `urls` that the document does not use (searched in its JSON). */
export function unusedImageUrls(urls: string[], used: unknown): string[] {
  const haystack = JSON.stringify(used)
  return urls.filter((url) => !haystack.includes(url))
}

/** Deletes pictures from the library; never throws. */
export async function dropImportImages(urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      const key = libraryKey(url)
      if (!key) return
      try {
        await deleteObject({ bucket: CRM_EMAIL_IMAGE_BUCKET, key })
      } catch (cause) {
        logger.warn('documents.import.image_delete_failed', {
          component: COMPONENT,
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }),
  )
}
