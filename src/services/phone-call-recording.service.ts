import { createHash } from 'node:crypto'
import type { WhatsAppPhoneCall, WhatsAppPhoneCallStatus } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  pabxCallbackInvalid,
  pabxRecordingDuplicate,
  pabxRecordingNotAccepted,
  pabxRecordingTooLarge,
  pabxRecordingUnsupported,
  phoneCallRecordingNotFound,
  storageError,
} from '@/src/errors'
import {
  PHONE_CALL_RECORDINGS_BUCKET,
  recordingObjectKey,
  sniffRecordingFormat,
} from '@/src/lib/pabx/recording'
import { PhoneCallAiJob } from '@/src/lib/queue/jobs'
import { getPhoneCallAiQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  deleteObject,
  deleteObjects,
  ensureBucket,
  listObjects,
  putObject,
} from '@/src/lib/storage/s3'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toWhatsAppPhoneCallDTO } from '@/src/mappers/whatsapp-phone-call.mapper'
import { toWhatsAppSettingsDTO } from '@/src/mappers/whatsapp-settings.mapper'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import {
  PABX_RECORDING_MAX_BYTES,
  PABX_RECORDING_UPLOAD_WINDOW_HOURS,
} from '@/src/schemas/whatsapp-phone-call.schema'
import type { WhatsAppPhoneCallAiStatusDTO } from '@/types/whatsapp-phone-call'
import { assertModulePrivileged } from './authz'

/** Calls that ended without anyone talking: there is nothing to record. */
const UNANSWERED: ReadonlySet<WhatsAppPhoneCallStatus> = new Set([
  'BUSY',
  'NO_ANSWER',
  'CANCELED',
  'EXTENSION_NO_ANSWER',
  'FAILED',
])

const DAY_MS = 24 * 60 * 60 * 1000
/** Expired recordings deleted per page of the retention job. */
export const RECORDING_PURGE_PAGE = 200
/** An object without a call is kept this long (an upload may be mid-way). */
export const ORPHAN_GRACE_MS = DAY_MS

/** The uploaded file, as the route hands it over (a `File` fits). */
export interface RecordingUpload {
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function publishCall(call: WhatsAppPhoneCall): Promise<void> {
  await publishWhatsAppEvent(call.workspaceId, {
    type: 'phone-call.updated',
    call: toWhatsAppPhoneCallDTO(call),
  })
}

/** Why the PABX upload of this call is refused, or `null` to accept it. */
function refusal(call: WhatsAppPhoneCall, now: Date) {
  if (!call.recordingRequested)
    return pabxRecordingNotAccepted('Esta ligação não pediu gravação')
  if (
    now.getTime() - call.createdAt.getTime() >
    PABX_RECORDING_UPLOAD_WINDOW_HOURS * 60 * 60 * 1000
  )
    return pabxRecordingNotAccepted('O prazo para enviar a gravação acabou')
  if (UNANSWERED.has(call.status))
    return pabxRecordingNotAccepted('A ligação não foi atendida')
  if (call.recordingKey) return pabxRecordingDuplicate()
  return null
}

async function deleteStoredObject(key: string): Promise<boolean> {
  try {
    await deleteObject({ bucket: PHONE_CALL_RECORDINGS_BUCKET, key })
    return true
  } catch (cause) {
    logger.error('phone_call.recording_delete_failed', {
      component: 'PhoneCallRecordingService',
      key,
      message: messageOf(cause),
    })
    return false
  }
}

/**
 * Call recordings (ADR 0043): the PABX upload at hangup, the retention of
 * the audio and its deletion. Transcription and summary happen in the
 * `phone-call-ai` queue ({@link PhoneCallAiService}).
 */
export const PhoneCallRecordingService = {
  /**
   * Stores the recording the PABX uploads at the end of a call. The per-call
   * callback token authenticates the upload (same token as the status
   * webhook); the audio type is checked by its bytes.
   */
  async intake(
    token: string,
    file: RecordingUpload,
    now = new Date(),
  ): Promise<
    Result<{ callId: string; aiStatus: WhatsAppPhoneCallAiStatusDTO }>
  > {
    const found = await WhatsAppPhoneCallRepository.findByCallbackTokenHash(
      hashToken(token),
    )
    if (!found.ok) return found
    if (!found.value) return err(pabxCallbackInvalid())
    const call = found.value

    const refused = refusal(call, now)
    if (refused) {
      logger.warn('phone_call.recording_refused', {
        component: 'PhoneCallRecordingService',
        workspaceId: call.workspaceId,
        callId: call.id,
        code: refused.code,
      })
      return err(refused)
    }
    if (file.size > PABX_RECORDING_MAX_BYTES)
      return err(pabxRecordingTooLarge(PABX_RECORDING_MAX_BYTES))

    const bytes = new Uint8Array(await file.arrayBuffer())
    const format = sniffRecordingFormat(bytes)
    if (!format) return err(pabxRecordingUnsupported())

    const row = await WhatsAppSettingsRepository.findByWorkspace(
      call.workspaceId,
    )
    if (!row.ok) return row
    const settings = toWhatsAppSettingsDTO(call.workspaceId, row.value)

    const key = recordingObjectKey(call.workspaceId, call.id, format.ext)
    try {
      await ensureBucket(PHONE_CALL_RECORDINGS_BUCKET)
      await putObject({
        bucket: PHONE_CALL_RECORDINGS_BUCKET,
        key,
        body: Buffer.from(bytes),
        contentType: format.mimeType,
      })
    } catch (cause) {
      logger.error('phone_call.recording_store_failed', {
        component: 'PhoneCallRecordingService',
        workspaceId: call.workspaceId,
        callId: call.id,
        message: messageOf(cause),
      })
      return err(storageError('Falha ao armazenar a gravação'))
    }

    const transcribe = settings.callTranscriptionEnabled
    const updated = await WhatsAppPhoneCallRepository.update(call.id, {
      recordingKey: key,
      recordingMimeType: format.mimeType,
      recordingSizeBytes: bytes.byteLength,
      recordedAt: now,
      recordingExpiresAt: new Date(
        now.getTime() + settings.callRecordingRetentionDays * DAY_MS,
      ),
      aiStatus: transcribe ? 'PENDING' : 'SKIPPED',
      aiSkipReason: transcribe ? null : 'transcription_disabled',
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'whatsapp_phone_call_recording',
      action: 'create',
      actorId: null,
      targetId: call.id,
      meta: {
        workspaceId: call.workspaceId,
        conversationId: call.conversationId,
        sizeBytes: bytes.byteLength,
        mimeType: format.mimeType,
        retentionDays: settings.callRecordingRetentionDays,
      },
    })

    if (transcribe) {
      try {
        await getPhoneCallAiQueue().add(
          PhoneCallAiJob.ProcessRecording,
          { callId: call.id },
          { jobId: `phone-call-${call.id}` },
        )
      } catch (cause) {
        // The recording is safe; the call just stays PENDING.
        logger.error('phone_call.ai_enqueue_failed', {
          component: 'PhoneCallRecordingService',
          workspaceId: call.workspaceId,
          callId: call.id,
          message: messageOf(cause),
        })
      }
    }

    logger.info('phone_call.recording_stored', {
      component: 'PhoneCallRecordingService',
      workspaceId: call.workspaceId,
      callId: call.id,
      sizeBytes: bytes.byteLength,
      mimeType: format.mimeType,
      aiStatus: updated.value.aiStatus,
    })
    await publishCall(updated.value)
    return ok({ callId: call.id, aiStatus: updated.value.aiStatus })
  },

  /**
   * Deletes the audio of one call now (LGPD request). Only the module
   * admins; transcript and summary stay with the call.
   */
  async deleteRecording(
    actorId: string,
    workspaceId: string,
    callId: string,
  ): Promise<Result<void>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const found = await WhatsAppPhoneCallRepository.findWithNames(
      callId,
      workspaceId,
    )
    if (!found.ok) return found
    if (!found.value?.recordingKey) return err(phoneCallRecordingNotFound())

    if (!(await deleteStoredObject(found.value.recordingKey)))
      return err(storageError('Falha ao apagar a gravação'))
    const cleared = await WhatsAppPhoneCallRepository.clearRecording(callId)
    if (!cleared.ok) return cleared

    auditMutation({
      entity: 'whatsapp_phone_call_recording',
      action: 'delete',
      actorId,
      targetId: callId,
      meta: { workspaceId, conversationId: found.value.conversationId },
    })
    await publishCall(cleared.value)
    return ok(undefined)
  },

  /** Retention job: deletes the audio of every recording past its date. */
  async purgeExpired(now: Date): Promise<Result<number>> {
    let deleted = 0
    for (;;) {
      const page = await WhatsAppPhoneCallRepository.listExpiredRecordings(
        now,
        RECORDING_PURGE_PAGE,
      )
      if (!page.ok) return page
      let progressed = 0
      for (const row of page.value) {
        if (row.recordingKey && !(await deleteStoredObject(row.recordingKey)))
          continue
        const cleared = await WhatsAppPhoneCallRepository.clearRecording(row.id)
        if (!cleared.ok) return cleared
        deleted += 1
        progressed += 1
      }
      // A short page is the last one; a page with no progress (storage
      // down) would loop forever, so the next run picks it up.
      if (page.value.length < RECORDING_PURGE_PAGE || progressed === 0) break
    }
    return ok(deleted)
  },

  /**
   * Retention job: deletes objects whose call no longer exists (the call
   * went away in cascade with its conversation, contact or workspace).
   */
  async sweepOrphans(now: Date): Promise<Result<number>> {
    let objects: Awaited<ReturnType<typeof listObjects>>
    try {
      objects = await listObjects(PHONE_CALL_RECORDINGS_BUCKET, '')
    } catch (cause) {
      logger.error('phone_call.recording_sweep_failed', {
        component: 'PhoneCallRecordingService',
        message: messageOf(cause),
      })
      return err(storageError('Falha ao listar as gravações'))
    }
    const candidates = objects.filter(
      (object) =>
        !object.lastModified ||
        now.getTime() - object.lastModified.getTime() > ORPHAN_GRACE_MS,
    )
    if (candidates.length === 0) return ok(0)

    const existing =
      await WhatsAppPhoneCallRepository.findExistingRecordingKeys(
        candidates.map((object) => object.key),
      )
    if (!existing.ok) return existing
    const orphans = candidates
      .map((object) => object.key)
      .filter((key) => !existing.value.has(key))
    if (orphans.length === 0) return ok(0)

    try {
      return ok(await deleteObjects(PHONE_CALL_RECORDINGS_BUCKET, orphans))
    } catch (cause) {
      logger.error('phone_call.recording_sweep_failed', {
        component: 'PhoneCallRecordingService',
        message: messageOf(cause),
      })
      return err(storageError('Falha ao apagar gravações órfãs'))
    }
  },
}
