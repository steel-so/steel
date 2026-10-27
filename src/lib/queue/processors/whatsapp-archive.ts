import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import type { Job } from 'bullmq'
import { ZipFile } from 'yazl'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { prisma } from '@/src/lib/prisma'
import {
  deleteOffsiteKey,
  getOffsiteConfig,
  type OffsiteConfig,
  uploadAndVerifyOffsiteStream,
} from '@/src/lib/storage/offsite-backup'
import {
  deleteObjects,
  ensureBucket,
  getObjectStream,
  getS3Client,
  listObjectKeys,
} from '@/src/lib/storage/s3'
import {
  ARCHIVE_CHANNEL_FOLDER,
  ARCHIVE_INDEX_FILE,
  type ArchiveAttendant,
  ArchivePathRegistry,
  AttendantFolders,
  archiveDayKey,
  archiveExpiry,
  archiveIndexHeader,
  archiveIndexLine,
  archiveObjectKey,
  atendimentoBaseName,
  attendantLabels,
  attributeAttendants,
  contactSegment,
  resolveArchiveRootFolder,
  WHATSAPP_ARCHIVE_BUCKET,
} from '@/src/lib/whatsapp/archive/layout'
import {
  type AtendimentoPdfInput,
  renderAtendimentoPdf,
} from '@/src/lib/whatsapp/archive/pdf'
import { formatWaId, isWhatsAppPhone } from '@/src/lib/whatsapp/phone'
import {
  type ArchiveConversationRow,
  type ArchiveMessageRow,
  type ArchiveRange,
  WhatsAppArchiveRepository,
} from '@/src/repositories/whatsapp-archive.repository'
import { WhatsAppArchiveService } from '@/src/services/whatsapp-archive.service'
import { WhatsappArchiveJob, type WhatsappArchiveJobPayload } from '../jobs'
import { enqueueWhatsappArchiveOffsiteCopy } from '../whatsapp-archive'

/**
 * `whatsapp-archive` queue (ADR 0052). `build` streams one package:
 * conversations in batches, each conversation's messages page by page,
 * grouped into atendimentos (conversation × São Paulo day); each one
 * becomes a PDF written straight into a zip on a temp file (never the whole
 * package in memory — the server is small), plus `INDICE.csv` with the
 * SHA-256 of every PDF. The zip goes to the `whatsapp-archives` bucket,
 * then a separate job copies it off-site.
 */

export const CONVERSATION_BATCH = 50
export const MESSAGE_PAGE = 500
const ZIP_CONTENT_TYPE = 'application/zip'

export interface WhatsappArchiveDeps {
  renderPdf?: (input: AtendimentoPdfInput) => Promise<Buffer>
  tempRoot?: string
}

export interface Atendimento {
  conversation: ArchiveConversationRow
  dayKey: string
  messages: ArchiveMessageRow[]
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Atendimentos of the range, one conversation at a time, oldest day first. */
export async function* iterateAtendimentos(
  workspaceId: string,
  range: ArchiveRange,
): AsyncGenerator<Atendimento> {
  let afterId: string | null = null
  while (true) {
    const batch: ArchiveConversationRow[] = unwrap(
      await WhatsAppArchiveRepository.listConversationBatch(
        workspaceId,
        range,
        afterId,
        CONVERSATION_BATCH,
      ),
    )
    for (const conversation of batch) {
      let dayKey: string | null = null
      let messages: ArchiveMessageRow[] = []
      let after: { createdAt: Date; id: string } | null = null
      while (true) {
        const page: ArchiveMessageRow[] = unwrap(
          await WhatsAppArchiveRepository.listMessagePage(
            conversation.id,
            range,
            after,
            MESSAGE_PAGE,
          ),
        )
        for (const message of page) {
          const key = archiveDayKey(message.createdAt)
          if (dayKey !== null && key !== dayKey) {
            yield { conversation, dayKey, messages }
            messages = []
          }
          dayKey = key
          messages.push(message)
        }
        if (page.length < MESSAGE_PAGE) break
        const last: ArchiveMessageRow = page[page.length - 1]
        after = { createdAt: last.createdAt, id: last.id }
      }
      if (dayKey !== null && messages.length > 0) {
        yield { conversation, dayKey, messages }
      }
    }
    if (batch.length < CONVERSATION_BATCH) return
    afterId = batch[batch.length - 1].id
  }
}

function attendantName(attendant: ArchiveAttendant): string {
  if (attendant.kind === 'user') return attendant.name || 'Atendente'
  return attendant.kind === 'ai' ? 'IA' : 'Sem atendente'
}

function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts?.attempts ?? 1)
}

/**
 * Adds one PDF and waits until yazl has streamed it out. Entries keep their
 * data closure for the whole archive (`addBuffer` would pin every PDF in
 * memory), so the closure drops its reference on first read; waiting for
 * the read to end keeps at most one PDF in flight.
 */
async function addPdf(
  zip: ZipFile,
  path: string,
  pdf: Buffer,
  mtime: Date,
  failure: Promise<never>,
): Promise<void> {
  let pending: Buffer | null = pdf
  const size = pdf.length
  const consumed = new Promise<void>((resolve, reject) => {
    // PDFs are already compressed: stored, not deflated (less CPU).
    zip.addReadStreamLazy(path, { compress: false, mtime, size }, (cb) => {
      const stream = Readable.from([pending as Buffer])
      pending = null
      stream.once('end', () => resolve())
      stream.once('error', reject)
      cb(null, stream)
    })
  })
  await Promise.race([consumed, failure])
}

export interface BuildResult {
  built: boolean
  reason?: string
  sizeBytes?: number
  fileCount?: number
  atendimentoCount?: number
}

interface PackageStats {
  zipPath: string
  sizeBytes: number
  sha256: string
  fileCount: number
  atendimentoCount: number
}

async function writePackage(params: {
  dir: string
  root: string
  workspace: { id: string; name: string }
  range: ArchiveRange
  now: Date
  renderPdf: (input: AtendimentoPdfInput) => Promise<Buffer>
}): Promise<PackageStats> {
  const { dir, root, workspace, range, now, renderPdf } = params
  const zipPath = join(dir, 'package.zip')
  const indexPath = join(dir, ARCHIVE_INDEX_FILE)
  const base = `${root}/${ARCHIVE_CHANNEL_FOLDER}`

  const zip = new ZipFile()
  const hash = createHash('sha256')
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const written = pipeline(zip.outputStream, hasher, createWriteStream(zipPath))
  // Rejects as soon as the zip or the file fails, so no add waits forever.
  const failure = new Promise<never>((_, reject) => {
    zip.on('error', reject)
    written.catch(reject)
  })
  failure.catch(() => undefined)

  const index = createWriteStream(indexPath)
  // One line per PDF, flushed before the next: bounded memory, like the zip.
  const writeIndex = promisify(index.write.bind(index)) as (
    chunk: string,
  ) => Promise<void>
  await writeIndex(archiveIndexHeader())

  const folders = new AttendantFolders()
  const paths = new ArchivePathRegistry()
  let fileCount = 0
  let atendimentoCount = 0

  for await (const atendimento of iterateAtendimentos(workspace.id, range)) {
    const { conversation, dayKey, messages } = atendimento
    const attributable = messages.map((message) => ({
      direction: message.direction,
      senderUserId: message.senderUserId,
      senderName: message.senderUser?.name ?? null,
      sentByAi: message.sentByAi,
    }))
    const attendants = attributeAttendants(
      attributable,
      conversation.assignedUser,
    )
    const firstAt = messages[0].createdAt
    const pdf = await renderPdf({
      workspaceName: workspace.name,
      connectionLabel: conversation.connection.label,
      connectionPhone: conversation.connection.phoneNumber,
      contactName: conversation.contact.name,
      contactWaId: conversation.contact.waId,
      attendants: attendantLabels(attendants, attributable),
      dayKey,
      protocol: null,
      conversationId: conversation.id,
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        type: message.type,
        text: message.text,
        mediaUrl: message.mediaUrl,
        sentByAi: message.sentByAi,
        senderName: message.senderUser?.name ?? null,
        createdAt: message.createdAt,
        deletedAt: message.deletedAt,
      })),
      generatedAt: now,
    })
    const pdfSha = createHash('sha256').update(pdf).digest('hex')
    const baseName = atendimentoBaseName(
      contactSegment(conversation.contact.name, conversation.contact.waId),
      dayKey,
      firstAt,
    )

    for (const attendant of attendants) {
      const relative = paths.reserve(
        `${dayKey}/${folders.folderFor(attendant)}`,
        baseName,
      )
      await addPdf(zip, `${base}/${relative}`, pdf, firstAt, failure)
      const line = archiveIndexLine({
        file: relative,
        dayKey,
        firstMessageAt: firstAt,
        attendant: attendantName(attendant),
        contact: conversation.contact.name ?? '',
        phone: isWhatsAppPhone(conversation.contact.waId)
          ? formatWaId(conversation.contact.waId)
          : '',
        messageCount: messages.length,
        sha256: pdfSha,
      })
      await writeIndex(line)
      fileCount += 1
    }
    atendimentoCount += 1
  }

  index.end()
  await finished(index)
  zip.addFile(indexPath, `${base}/${ARCHIVE_INDEX_FILE}`, { mtime: now })
  fileCount += 1
  zip.end()
  await Promise.race([written, failure])

  const { size } = await stat(zipPath)
  return {
    zipPath,
    sizeBytes: size,
    sha256: hash.digest('hex'),
    fileCount,
    atendimentoCount,
  }
}

export async function buildWhatsappArchive(
  job: Job,
  now: Date,
  deps: WhatsappArchiveDeps = {},
): Promise<BuildResult> {
  const { archiveId } =
    job.data as WhatsappArchiveJobPayload[typeof WhatsappArchiveJob.Build]
  const found = await WhatsAppArchiveRepository.findById(archiveId)
  if (!found.ok) {
    if (found.error.code === 'WHATSAPP_ARCHIVE_NOT_FOUND') {
      return { built: false, reason: 'not_found' }
    }
    throw new Error(found.error.message)
  }
  const row = found.value
  if (row.status !== 'QUEUED' && row.status !== 'RUNNING') {
    return { built: false, reason: `status_${row.status.toLowerCase()}` }
  }

  const workspaceId = row.workspaceId
  let dir: string | null = null
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, slug: true },
    })
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)
    const settings = unwrap(
      await WhatsAppArchiveRepository.getSettings(workspaceId),
    )
    const root = resolveArchiveRootFolder(
      settings?.rootFolderName,
      workspace.slug,
    )
    unwrap(await WhatsAppArchiveRepository.markRunning(row.id, root, now))

    dir = await mkdtemp(join(deps.tempRoot ?? tmpdir(), 'steel-zap-archive-'))
    const stats = await writePackage({
      dir,
      root,
      workspace,
      range: { start: row.periodStart, end: row.periodEnd },
      now,
      renderPdf: deps.renderPdf ?? renderAtendimentoPdf,
    })

    const key = archiveObjectKey(workspaceId, row.id)
    await ensureBucket(WHATSAPP_ARCHIVE_BUCKET)
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: WHATSAPP_ARCHIVE_BUCKET,
        Key: key,
        Body: createReadStream(stats.zipPath),
        ContentLength: stats.sizeBytes,
        ContentType: ZIP_CONTENT_TYPE,
        Metadata: { sha256: stats.sha256 },
      }),
    )

    unwrap(
      await WhatsAppArchiveRepository.markDone(row.id, {
        objectKey: key,
        sizeBytes: stats.sizeBytes,
        sha256: stats.sha256,
        fileCount: stats.fileCount,
        atendimentoCount: stats.atendimentoCount,
        completedAt: now,
        expiresAt: archiveExpiry(row.kind, now),
      }),
    )

    auditMutation({
      entity: 'whatsapp_archive',
      action: 'create',
      actorId: 'system',
      targetId: row.id,
      meta: {
        workspaceId,
        kind: row.kind,
        sizeBytes: stats.sizeBytes,
        fileCount: stats.fileCount,
        atendimentoCount: stats.atendimentoCount,
        sha256: stats.sha256,
      },
    })
    logger.info('queue.whatsapp_archive.built', {
      component: 'Worker',
      jobId: job.id,
      workspaceId,
      archiveId: row.id,
      kind: row.kind,
      sizeBytes: stats.sizeBytes,
      fileCount: stats.fileCount,
      atendimentoCount: stats.atendimentoCount,
    })

    if (getOffsiteConfig()) {
      await enqueueWhatsappArchiveOffsiteCopy(row.id)
    } else {
      logger.warn('queue.whatsapp_archive.offsite_not_configured', {
        component: 'Worker',
        archiveId: row.id,
        message:
          'BACKUP_OFFSITE_* not configured: the package exists only in the local MinIO',
      })
    }
    return {
      built: true,
      sizeBytes: stats.sizeBytes,
      fileCount: stats.fileCount,
      atendimentoCount: stats.atendimentoCount,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const final = isFinalAttempt(job)
    if (final) await WhatsAppArchiveRepository.markFailed(row.id, message)
    logger.error('queue.whatsapp_archive.failed', {
      component: 'Worker',
      jobId: job.id,
      workspaceId,
      archiveId: row.id,
      attemptsMade: job.attemptsMade,
      final,
      message,
    })
    throw error
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Off-site prefix of the packages: a sibling of the backups' prefix
 * (`steel/` → `steel-whatsapp-archives/`), so the backups' own prune (by
 * age, over its whole prefix) never deletes a 12-month package at 90 days.
 */
export function archiveOffsiteConfig(config: OffsiteConfig): OffsiteConfig {
  const base = config.prefix.replace(/\/+$/, '')
  return {
    ...config,
    prefix: base ? `${base}-whatsapp-archives/` : 'whatsapp-archives/',
  }
}

export interface CopyResult {
  copied: boolean
  reason?: string
  offsiteKey?: string
}

export async function copyWhatsappArchiveOffsite(
  job: Job,
  now: Date,
): Promise<CopyResult> {
  const config = getOffsiteConfig()
  const { archiveId } =
    job.data as WhatsappArchiveJobPayload[typeof WhatsappArchiveJob.CopyToOffsite]
  if (!config) return { copied: false, reason: 'offsite_not_configured' }

  const found = await WhatsAppArchiveRepository.findById(archiveId)
  if (!found.ok) {
    if (found.error.code === 'WHATSAPP_ARCHIVE_NOT_FOUND') {
      return { copied: false, reason: 'not_found' }
    }
    throw new Error(found.error.message)
  }
  const row = found.value
  if (
    row.status !== 'DONE' ||
    !row.objectKey ||
    row.sizeBytes === null ||
    !row.sha256
  ) {
    return { copied: false, reason: 'not_ready' }
  }

  try {
    const object = await getObjectStream({
      bucket: WHATSAPP_ARCHIVE_BUCKET,
      key: row.objectKey,
    })
    const result = await uploadAndVerifyOffsiteStream(
      archiveOffsiteConfig(config),
      {
        key: row.objectKey,
        body: Readable.fromWeb(object.body as never),
        sizeBytes: Number(row.sizeBytes),
        sha256: row.sha256,
        contentType: ZIP_CONTENT_TYPE,
      },
    )
    unwrap(
      await WhatsAppArchiveRepository.markOffsiteCopied(
        row.id,
        result.key,
        now,
      ),
    )
    auditMutation({
      entity: 'whatsapp_archive',
      action: 'update',
      actorId: 'system',
      targetId: row.id,
      meta: { offsiteKey: result.key, sizeBytes: result.sizeBytes },
    })
    logger.info('queue.whatsapp_archive.offsite_completed', {
      component: 'Worker',
      jobId: job.id,
      archiveId: row.id,
      offsiteKey: result.key,
      verified: true,
    })
    return { copied: true, offsiteKey: result.key }
  } catch (error) {
    logger.error('queue.whatsapp_archive.offsite_failed', {
      component: 'Worker',
      jobId: job.id,
      archiveId: row.id,
      attemptsMade: job.attemptsMade,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export interface PruneResult {
  expired: number
  orphans: number
}

/** Deletes packages past retention (MinIO + off-site) and orphan objects. */
export async function pruneWhatsappArchives(now: Date): Promise<PruneResult> {
  const expired = unwrap(await WhatsAppArchiveRepository.listExpired(now))
  const keys = expired
    .map((row) => row.objectKey)
    .filter((key): key is string => key !== null)
  if (keys.length > 0) await deleteObjects(WHATSAPP_ARCHIVE_BUCKET, keys)

  const config = getOffsiteConfig()
  for (const row of expired) {
    if (!row.offsiteKey) continue
    if (!config) {
      logger.warn('queue.whatsapp_archive.offsite_prune_skipped', {
        component: 'Worker',
        archiveId: row.id,
        offsiteKey: row.offsiteKey,
      })
      continue
    }
    await deleteOffsiteKey(config, row.offsiteKey)
  }
  const marked = unwrap(
    await WhatsAppArchiveRepository.markExpired(expired.map((row) => row.id)),
  )

  // Files whose row is gone (workspace deleted) or no longer points at them;
  // a package being built keeps its future key.
  const live = unwrap(await WhatsAppArchiveRepository.listLiveObjects())
  const liveKeys = new Set(
    live.map(
      (row) => row.objectKey ?? archiveObjectKey(row.workspaceId, row.id),
    ),
  )
  const stored = await listObjectKeys(WHATSAPP_ARCHIVE_BUCKET, '')
  const orphans = stored.filter((key) => !liveKeys.has(key))
  if (orphans.length > 0) await deleteObjects(WHATSAPP_ARCHIVE_BUCKET, orphans)

  const result = { expired: marked, orphans: orphans.length }
  logger.info('queue.whatsapp_archive.pruned', {
    component: 'Worker',
    ...result,
  })
  return result
}

export interface ScheduleResult {
  queued: number
  skipped: number
  failed: number
}

async function scheduleAll(
  kind: 'WEEKLY' | 'MONTHLY_FULL',
  now: Date,
): Promise<ScheduleResult> {
  const result = unwrap(await WhatsAppArchiveService.scheduleAll(kind, now))
  logger.info('queue.whatsapp_archive.scheduled', {
    component: 'Worker',
    kind,
    ...result,
  })
  return result
}

/** Inner entry point with the clock injected (tests); BullMQ calls the one below. */
export async function handleWhatsappArchiveJob(
  job: Job,
  now: Date,
  deps: WhatsappArchiveDeps = {},
): Promise<BuildResult | CopyResult | PruneResult | ScheduleResult> {
  switch (job.name) {
    case WhatsappArchiveJob.ScheduleWeekly:
      return scheduleAll('WEEKLY', now)
    case WhatsappArchiveJob.ScheduleMonthly:
      return scheduleAll('MONTHLY_FULL', now)
    case WhatsappArchiveJob.Build:
      return buildWhatsappArchive(job, now, deps)
    case WhatsappArchiveJob.CopyToOffsite:
      return copyWhatsappArchiveOffsite(job, now)
    case WhatsappArchiveJob.PruneExpired:
      return pruneWhatsappArchives(now)
    default:
      throw new Error(
        `Unknown whatsapp-archive job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}

export async function processWhatsappArchive(
  job: Job,
): Promise<BuildResult | CopyResult | PruneResult | ScheduleResult> {
  return handleWhatsappArchiveJob(job, new Date())
}
