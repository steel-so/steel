import 'server-only'
import { randomUUID } from 'node:crypto'
import type { WhatsAppConnection } from '@prisma/client'
import { MINIO_ENDPOINT, MINIO_PUBLIC_URL } from '@/lib/env/_server'
import { storageError, validationError } from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { getObjectWithContentType } from '@/src/lib/storage/s3'
import { persistObject } from '@/src/services/media/_media'

const BUCKET = 'whatsapp-media'
const META_GRAPH_VERSION = 'v23.0'

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/mp4': 'm4a',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'text/plain': 'txt',
}

function extensionFor(contentType: string): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType] ?? 'bin'
}

export async function downloadRemoteMediaToStorage(input: {
  workspaceId: string
  url: string
  headers?: Record<string, string>
}): Promise<Result<{ url: string; contentType: string }>> {
  let response: Response
  try {
    response = await fetch(input.url, { headers: input.headers })
  } catch {
    return err(storageError('Falha ao baixar mídia do provedor'))
  }
  if (!response.ok) {
    return err(
      storageError(`Falha ao baixar mídia do provedor (${response.status})`),
    )
  }

  const contentType =
    response.headers.get('content-type') ?? 'application/octet-stream'
  const body = Buffer.from(await response.arrayBuffer())
  const key = `${input.workspaceId}/${randomUUID()}.${extensionFor(contentType)}`

  const stored = await persistObject({
    bucket: BUCKET,
    key,
    body,
    contentType,
    component: 'WhatsAppMedia',
    event: 'whatsapp_media.persist_failed',
  })
  if (!stored.ok) return stored

  return ok({ url: stored.value, contentType })
}

export async function persistOutboundMedia(input: {
  workspaceId: string
  body: Buffer
  contentType: string
}): Promise<Result<{ url: string }>> {
  const key = `${input.workspaceId}/${randomUUID()}.${extensionFor(input.contentType)}`

  const stored = await persistObject({
    bucket: BUCKET,
    key,
    body: input.body,
    contentType: input.contentType,
    component: 'WhatsAppMedia',
    event: 'whatsapp_media.persist_failed',
  })
  if (!stored.ok) return stored

  return ok({ url: stored.value })
}

/**
 * Resolve a URL baixável de uma mídia recebida. Z-API já entrega a URL; a
 * Meta entrega um media id que precisa ser trocado por uma URL temporária
 * (autenticada com o access token da conexão). Lança em falha — quem chama
 * converte em `Result`.
 */
export async function resolveInboundMediaSource(
  connection: Pick<WhatsAppConnection, 'provider' | 'encryptedMetaAccessToken'>,
  rawMediaUrl: string,
): Promise<{ url: string; headers?: Record<string, string> }> {
  if (connection.provider === 'ZAPI') {
    return { url: rawMediaUrl }
  }

  if (!connection.encryptedMetaAccessToken) {
    throw new Error('Conexão Meta sem access token configurado')
  }
  const accessToken = await decryptConnectionSecret(
    connection.encryptedMetaAccessToken,
  )

  const metaResponse = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${rawMediaUrl}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!metaResponse.ok) {
    throw new Error(`Falha ao resolver mídia da Meta (${metaResponse.status})`)
  }
  const body = (await metaResponse.json()) as { url?: string }
  if (!body.url) throw new Error('Meta não retornou URL de mídia')

  return { url: body.url, headers: { Authorization: `Bearer ${accessToken}` } }
}

/**
 * Reads back a file this workspace uploaded through `POST .../whatsapp/media/
 * upload` (the media header of a new template). Only our own bucket and the
 * workspace prefix are accepted — the server never fetches an arbitrary URL.
 */
export async function readWorkspaceMedia(
  workspaceId: string,
  url: string,
): Promise<Result<{ body: Buffer; contentType: string; fileName: string }>> {
  const prefix = `${MINIO_PUBLIC_URL ?? MINIO_ENDPOINT}/${BUCKET}/`
  const key = url.startsWith(prefix) ? url.slice(prefix.length) : ''
  if (!key.startsWith(`${workspaceId}/`) || key.includes('..')) {
    return err(validationError('Envie a mídia do cabeçalho pelo upload do zap'))
  }
  try {
    const object = await getObjectWithContentType({ bucket: BUCKET, key })
    return ok({ ...object, fileName: key.split('/').pop() ?? key })
  } catch {
    return err(storageError('Falha ao ler a mídia do cabeçalho'))
  }
}
