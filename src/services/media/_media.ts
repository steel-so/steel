import { randomUUID } from 'node:crypto'
import { logger } from '@/lib/axiom/logger'
import { MINIO_ENDPOINT, MINIO_PUBLIC_URL } from '@/lib/env/_server'
import { storageError, validationError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { ensurePublicBucket, putObject } from '@/src/lib/storage/s3'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Validates MIME type + size, returning the file extension on success
export function validateImage(
  contentType: string,
  byteSize: number,
): Result<string> {
  const ext = ALLOWED_TYPES[contentType]
  if (!ext)
    return err(validationError('Formato não suportado. Use JPEG, PNG ou WebP'))
  if (byteSize > MAX_BYTES)
    return err(validationError('Arquivo muito grande. Máximo 5 MB'))

  return ok(ext)
}

/**
 * Chave de mídia de CRM prefixada pelo workspace. O nome do arquivo é
 * aleatório (a URL pública é o único ponteiro, guardado no conteúdo da
 * proposta/site), então o prefixo é a única forma de saber a quem o
 * objeto pertence — é o que permite incluí-lo no backup do workspace e
 * apagá-lo na exclusão. Objetos gravados antes desta mudança ficaram na raiz
 * do bucket; veja `collectWorkspaceFileRefs` em
 * `src/lib/storage/workspace-files.ts` para como eles são reencontrados.
 */
export function workspaceMediaKey(workspaceId: string, ext: string): string {
  return `${workspaceId}/${randomUUID()}.${ext}`
}

interface PersistInput {
  bucket: string
  key: string
  body: Buffer
  contentType: string
  // Payload component for the failure log, e.g. `UserMediaService`
  component: string
  // Log event on failure, e.g. `user_media.persist_failed`
  event: string
}

// Uploads to a public bucket and return the public URL.
export async function persistObject({
  bucket,
  key,
  body,
  contentType,
  component,
  event,
}: PersistInput): Promise<Result<string>> {
  try {
    await ensurePublicBucket(bucket)
    await putObject({ bucket, key, body, contentType })
    return ok(`${MINIO_PUBLIC_URL ?? MINIO_ENDPOINT}/${bucket}/${key}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(event, { component, bucket, key, message })

    return err(storageError('Falha ao armazena o arquivo'))
  }
}
