import { createHash } from 'node:crypto'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  BACKUP_OFFSITE_ACCESS_KEY_ID,
  BACKUP_OFFSITE_BUCKET,
  BACKUP_OFFSITE_ENDPOINT,
  BACKUP_OFFSITE_FORCE_PATH_STYLE,
  BACKUP_OFFSITE_PREFIX,
  BACKUP_OFFSITE_REGION,
  BACKUP_OFFSITE_RETENTION_DAYS,
  BACKUP_OFFSITE_SECRET_ACCESS_KEY,
  BACKUP_OFFSITE_SSE,
} from '@/lib/env/server'

/**
 * Segunda cópia dos backups FULL num storage S3-compatível fora do servidor
 * de produção (o MinIO local fica na mesma máquina que o Postgres — um disco
 * ou servidor perdido levaria as duas coisas juntas).
 *
 * O objeto sobe exatamente como está no MinIO: já cifrado pela aplicação
 * (AES-256-GCM com `CONNECTION_SECRETS`). Por cima, pede SSE-S3 ao provedor
 * (a menos que `BACKUP_OFFSITE_SSE=false`). Os metadados levam o SHA-256 do
 * conteúdo em claro e do cifrado, então o restore offsite é autossuficiente —
 * não depende da tabela `backups`, que some junto com o banco num desastre.
 */

export const DEFAULT_OFFSITE_RETENTION_DAYS = 90
const DEFAULT_PREFIX = 'steel/'

export interface OffsiteConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
  forcePathStyle: boolean
  serverSideEncryption: boolean
  retentionDays: number
}

export function getOffsiteConfig(): OffsiteConfig | null {
  if (
    !BACKUP_OFFSITE_ENDPOINT ||
    !BACKUP_OFFSITE_BUCKET ||
    !BACKUP_OFFSITE_ACCESS_KEY_ID ||
    !BACKUP_OFFSITE_SECRET_ACCESS_KEY
  ) {
    return null
  }

  const rawPrefix = BACKUP_OFFSITE_PREFIX ?? DEFAULT_PREFIX
  const prefix =
    rawPrefix === '' || rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`
  const retention = Number(BACKUP_OFFSITE_RETENTION_DAYS)

  return {
    endpoint: BACKUP_OFFSITE_ENDPOINT,
    region: BACKUP_OFFSITE_REGION ?? 'auto',
    bucket: BACKUP_OFFSITE_BUCKET,
    accessKeyId: BACKUP_OFFSITE_ACCESS_KEY_ID,
    secretAccessKey: BACKUP_OFFSITE_SECRET_ACCESS_KEY,
    prefix,
    forcePathStyle: BACKUP_OFFSITE_FORCE_PATH_STYLE === 'true',
    serverSideEncryption: BACKUP_OFFSITE_SSE !== 'false',
    retentionDays:
      Number.isInteger(retention) && retention > 0
        ? retention
        : DEFAULT_OFFSITE_RETENTION_DAYS,
  }
}

let client: S3Client | null = null
let clientKey: string | null = null

function getClient(config: OffsiteConfig): S3Client {
  const key = `${config.endpoint}|${config.region}|${config.accessKeyId}`
  if (!client || clientKey !== key) {
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
      // Provedores S3-compatíveis (B2, R2, Wasabi...) nem sempre aceitam os
      // checksums CRC32 que o SDK v3 passou a mandar por padrão.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    clientKey = key
  }
  return client
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

async function readBody(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export interface OffsiteUploadInput {
  /** Chave relativa (a mesma do MinIO, ex.: `full/<id>.dump.enc`). */
  key: string
  /** Conteúdo já cifrado pela aplicação, como está no MinIO. */
  body: Buffer
  /** SHA-256 do dump em claro (o `checksum` da tabela `backups`). */
  plainChecksum: string | null
}

export interface OffsiteUploadResult {
  key: string
  sizeBytes: number
  encryptedChecksum: string
}

/** Sobe a cópia e verifica lendo de volta (tamanho + SHA-256). */
export async function uploadAndVerifyOffsite(
  config: OffsiteConfig,
  input: OffsiteUploadInput,
): Promise<OffsiteUploadResult> {
  const s3 = getClient(config)
  const key = `${config.prefix}${input.key}`
  const encryptedChecksum = sha256(input.body)

  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body,
      ContentType: 'application/octet-stream',
      ...(config.serverSideEncryption
        ? { ServerSideEncryption: 'AES256' as const }
        : {}),
      Metadata: {
        'sha256-encrypted': encryptedChecksum,
        ...(input.plainChecksum ? { 'sha256-plain': input.plainChecksum } : {}),
      },
    }),
  )

  const head = await s3.send(
    new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
  )
  if (head.ContentLength !== input.body.length) {
    throw new Error(
      `Offsite verification failed for "${key}": size ${head.ContentLength} != ${input.body.length}`,
    )
  }

  const readBack = await s3.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
  )
  const downloaded = await readBody(readBack.Body)
  const downloadedChecksum = sha256(downloaded)
  if (downloadedChecksum !== encryptedChecksum) {
    throw new Error(
      `Offsite verification failed for "${key}": sha256 ${downloadedChecksum} != ${encryptedChecksum}`,
    )
  }

  return { key, sizeBytes: input.body.length, encryptedChecksum }
}

export interface OffsiteObject {
  body: Buffer
  plainChecksum: string | null
  encryptedChecksum: string | null
}

/** Baixa uma cópia offsite (chave relativa, sem o prefixo). */
export async function getOffsiteObject(
  config: OffsiteConfig,
  relativeKey: string,
): Promise<OffsiteObject> {
  const s3 = getClient(config)
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: `${config.prefix}${relativeKey}`,
    }),
  )
  return {
    body: await readBody(result.Body),
    plainChecksum: result.Metadata?.['sha256-plain'] ?? null,
    encryptedChecksum: result.Metadata?.['sha256-encrypted'] ?? null,
  }
}

export interface OffsiteListing {
  key: string
  sizeBytes: number
  lastModified: Date | null
}

/** Lista as cópias sob o prefixo (chaves relativas), mais recentes primeiro. */
export async function listOffsiteObjects(
  config: OffsiteConfig,
): Promise<OffsiteListing[]> {
  const s3 = getClient(config)
  const items: OffsiteListing[] = []
  let token: string | undefined

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: config.prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of page.Contents ?? []) {
      if (!obj.Key) continue
      items.push({
        key: obj.Key.slice(config.prefix.length),
        sizeBytes: obj.Size ?? 0,
        lastModified: obj.LastModified ?? null,
      })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  return items.sort(
    (a, b) =>
      (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0),
  )
}

/** Apaga cópias mais velhas que `retentionDays`. Devolve quantas apagou. */
export async function pruneOffsiteObjects(
  config: OffsiteConfig,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000
  const expired = (await listOffsiteObjects(config)).filter(
    (item) => item.lastModified && item.lastModified.getTime() < cutoff,
  )
  if (expired.length === 0) return 0

  // Um DeleteObject por chave (não DeleteObjects em lote): o lote exige
  // Content-MD5/checksum que nem todo provedor S3-compatível aceita igual, e
  // o volume aqui é de ~1 objeto por dia.
  const s3 = getClient(config)
  for (const item of expired) {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: `${config.prefix}${item.key}`,
      }),
    )
  }
  return expired.length
}

export interface OffsiteStreamUploadInput {
  /** Relative key (the prefix of `config` is prepended). */
  key: string
  /** Content, streamed: never fully in memory. */
  body: NodeJS.ReadableStream
  sizeBytes: number
  /** SHA-256 (hex) of the content, checked on the read-back. */
  sha256: string
  contentType: string
}

/**
 * Like `uploadAndVerifyOffsite`, for objects too big to buffer (the
 * WhatsApp archive packages, ADR 0052): streams the upload with a known
 * length and verifies by streaming the read-back through SHA-256.
 */
export async function uploadAndVerifyOffsiteStream(
  config: OffsiteConfig,
  input: OffsiteStreamUploadInput,
): Promise<OffsiteUploadResult> {
  const s3 = getClient(config)
  const key = `${config.prefix}${input.key}`

  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body as never,
      ContentLength: input.sizeBytes,
      ContentType: input.contentType,
      ...(config.serverSideEncryption
        ? { ServerSideEncryption: 'AES256' as const }
        : {}),
      Metadata: { 'sha256-plain': input.sha256 },
    }),
  )

  const head = await s3.send(
    new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
  )
  if (head.ContentLength !== input.sizeBytes) {
    throw new Error(
      `Offsite verification failed for "${key}": size ${head.ContentLength} != ${input.sizeBytes}`,
    )
  }

  const readBack = await s3.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
  )
  const hash = createHash('sha256')
  for await (const chunk of readBack.Body as AsyncIterable<Uint8Array>) {
    hash.update(chunk)
  }
  const downloaded = hash.digest('hex')
  if (downloaded !== input.sha256) {
    throw new Error(
      `Offsite verification failed for "${key}": sha256 ${downloaded} != ${input.sha256}`,
    )
  }

  return { key, sizeBytes: input.sizeBytes, encryptedChecksum: input.sha256 }
}

/** Deletes one off-site object by its full key (as returned on upload). */
export async function deleteOffsiteKey(
  config: OffsiteConfig,
  fullKey: string,
): Promise<void> {
  await getClient(config).send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: fullKey }),
  )
}
