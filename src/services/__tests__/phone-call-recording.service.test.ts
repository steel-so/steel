import { createHash } from 'node:crypto'
import type { WhatsAppPhoneCall } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakePhoneCallWithNames,
  createFakeWhatsAppPhoneCall,
} from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  ensureBucket: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  deleteObjects: vi.fn(),
  listObjects: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/storage/s3', () => ({
  ensureBucket: mocks.ensureBucket,
  putObject: mocks.putObject,
  deleteObject: mocks.deleteObject,
  deleteObjects: mocks.deleteObjects,
  listObjects: mocks.listObjects,
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getPhoneCallAiQueue: () => ({ add: mocks.queueAdd }),
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-phone-call.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { PABX_RECORDING_MAX_BYTES } from '@/src/schemas/whatsapp-phone-call.schema'
import {
  ORPHAN_GRACE_MS,
  PhoneCallRecordingService,
  RECORDING_PURGE_PAGE,
} from '../phone-call-recording.service'

const callRepo = vi.mocked(WhatsAppPhoneCallRepository)
const settingsRepo = vi.mocked(WhatsAppSettingsRepository)
const membershipRepo = vi.mocked(MembershipRepository)

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345'
const NOW = new Date('2026-10-18T12:00:00.000Z')
const DB = databaseError('db down')

const WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2,
])

function upload(bytes: Uint8Array = WAV, size = bytes.byteLength) {
  return {
    size,
    arrayBuffer: vi.fn(async () => bytes.slice().buffer as ArrayBuffer),
  }
}

function recordedCall(overrides: Partial<WhatsAppPhoneCall> = {}) {
  return createFakeWhatsAppPhoneCall({
    id: 'call1',
    workspaceId: 'ws1',
    conversationId: 'conv1',
    status: 'COMPLETED',
    recordingRequested: true,
    recordingNotice: 'Avise o contato',
    createdAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  })
}

function echoUpdates(base: WhatsAppPhoneCall) {
  callRepo.update.mockImplementation(async (_id, data) =>
    ok({ ...base, ...(data as Partial<WhatsAppPhoneCall>) }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureBucket.mockResolvedValue(undefined)
  mocks.putObject.mockResolvedValue(undefined)
  mocks.deleteObject.mockResolvedValue(undefined)
  mocks.queueAdd.mockResolvedValue({})
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(createFakeWhatsAppSettings({ callRecordingRetentionDays: 30 })),
  )
})

describe('PhoneCallRecordingService.intake()', () => {
  beforeEach(() => {
    const call = recordedCall()
    callRepo.findByCallbackTokenHash.mockResolvedValue(ok(call))
    echoUpdates(call)
  })

  it('stores the recording, freezes its expiry and queues the AI job', async () => {
    const result = expectOk(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
    )

    expect(result).toEqual({ callId: 'call1', aiStatus: 'PENDING' })
    expect(callRepo.findByCallbackTokenHash).toHaveBeenCalledWith(
      createHash('sha256').update(TOKEN).digest('hex'),
    )
    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'phone-call-recordings',
        key: 'ws1/call1.wav',
        contentType: 'audio/wav',
      }),
    )
    expect(callRepo.update).toHaveBeenCalledWith('call1', {
      recordingKey: 'ws1/call1.wav',
      recordingMimeType: 'audio/wav',
      recordingSizeBytes: WAV.byteLength,
      recordedAt: NOW,
      recordingExpiresAt: new Date('2026-11-17T12:00:00.000Z'),
      aiStatus: 'PENDING',
      aiSkipReason: null,
    })
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'process-recording',
      { callId: 'call1' },
      { jobId: 'phone-call-call1' },
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_phone_call_recording',
        action: 'create',
        actorId: null,
        targetId: 'call1',
      }),
    )
    expect(publishWhatsAppEvent).toHaveBeenCalledWith('ws1', {
      type: 'phone-call.updated',
      call: expect.objectContaining({
        hasRecording: true,
        aiStatus: 'PENDING',
      }),
    })
  })

  it('accepts a call still waiting for its final report', async () => {
    const call = recordedCall({ status: 'IN_PROGRESS' })
    callRepo.findByCallbackTokenHash.mockResolvedValue(ok(call))
    echoUpdates(call)

    expectOk(await PhoneCallRecordingService.intake(TOKEN, upload(), NOW))
  })

  it('skips the AI step when transcription is off', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppSettings({ callTranscriptionEnabled: false })),
    )

    const result = expectOk(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
    )

    expect(result.aiStatus).toBe('SKIPPED')
    expect(callRepo.update).toHaveBeenCalledWith(
      'call1',
      expect.objectContaining({
        aiStatus: 'SKIPPED',
        aiSkipReason: 'transcription_disabled',
      }),
    )
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it('keeps the recording when the queue is down', async () => {
    mocks.queueAdd.mockRejectedValue(new Error('redis down'))

    expectOk(await PhoneCallRecordingService.intake(TOKEN, upload(), NOW))
    expect(callRepo.update).toHaveBeenCalled()
  })

  it('rejects an unknown token', async () => {
    callRepo.findByCallbackTokenHash.mockResolvedValue(ok(null))

    expectErr(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
      'PABX_CALLBACK_INVALID',
    )
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it.each([
    ['no recording asked', { recordingRequested: false }],
    [
      'the upload window is over',
      { createdAt: new Date('2026-10-17T11:00:00Z') },
    ],
    ['the call was not answered', { status: 'NO_ANSWER' as const }],
  ])('refuses the upload when %s', async (_label, overrides) => {
    callRepo.findByCallbackTokenHash.mockResolvedValue(
      ok(recordedCall(overrides)),
    )

    expectErr(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
      'PABX_RECORDING_NOT_ACCEPTED',
    )
    expect(mocks.putObject).not.toHaveBeenCalled()
  })

  it('refuses a second recording for the same call', async () => {
    callRepo.findByCallbackTokenHash.mockResolvedValue(
      ok(recordedCall({ recordingKey: 'ws1/call1.wav' })),
    )

    expectErr(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
      'PABX_RECORDING_DUPLICATE',
    )
  })

  it('refuses a file over the limit without reading it', async () => {
    const file = upload(WAV, PABX_RECORDING_MAX_BYTES + 1)

    expectErr(
      await PhoneCallRecordingService.intake(TOKEN, file, NOW),
      'PABX_RECORDING_TOO_LARGE',
    )
    expect(file.arrayBuffer).not.toHaveBeenCalled()
  })

  it('refuses a file that is not audio by its bytes', async () => {
    expectErr(
      await PhoneCallRecordingService.intake(
        TOKEN,
        upload(new TextEncoder().encode('<?php echo 1;')),
        NOW,
      ),
      'PABX_RECORDING_UNSUPPORTED',
    )
  })

  it('fails with STORAGE_ERROR when MinIO refuses the object', async () => {
    mocks.putObject.mockRejectedValue('s3 down')

    expectErr(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
      'STORAGE_ERROR',
    )
    expect(callRepo.update).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    callRepo.findByCallbackTokenHash.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
      'DATABASE_ERROR',
    )

    settingsRepo.findByWorkspace.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
      'DATABASE_ERROR',
    )

    callRepo.update.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallRecordingService.intake(TOKEN, upload(), NOW),
      'DATABASE_ERROR',
    )
  })

  it('uses the default timestamp when none is given', async () => {
    const call = recordedCall({ createdAt: new Date() })
    callRepo.findByCallbackTokenHash.mockResolvedValue(ok(call))
    echoUpdates(call)

    expectOk(await PhoneCallRecordingService.intake(TOKEN, upload()))
  })
})

describe('PhoneCallRecordingService.deleteRecording()', () => {
  function asRole(role: 'MEMBER' | 'ADMIN') {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role })),
    )
  }

  beforeEach(() => {
    asRole('ADMIN')
    callRepo.findWithNames.mockResolvedValue(
      ok(
        createFakePhoneCallWithNames({
          id: 'call1',
          workspaceId: 'ws1',
          recordingKey: 'ws1/call1.wav',
        }),
      ),
    )
    callRepo.clearRecording.mockResolvedValue(
      ok(recordedCall({ recordingKey: null })),
    )
  })

  it('deletes the object, clears the fields and audits it', async () => {
    expectOk(
      await PhoneCallRecordingService.deleteRecording('u1', 'ws1', 'call1'),
    )

    expect(mocks.deleteObject).toHaveBeenCalledWith({
      bucket: 'phone-call-recordings',
      key: 'ws1/call1.wav',
    })
    expect(callRepo.clearRecording).toHaveBeenCalledWith('call1')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', actorId: 'u1' }),
    )
  })

  it('forbids a member who is not an admin', async () => {
    asRole('MEMBER')
    expectErr(
      await PhoneCallRecordingService.deleteRecording('u1', 'ws1', 'call1'),
      'FORBIDDEN',
    )
    expect(mocks.deleteObject).not.toHaveBeenCalled()
  })

  it('answers not found for a call without recording (or of another workspace)', async () => {
    callRepo.findWithNames.mockResolvedValue(ok(null))
    expectErr(
      await PhoneCallRecordingService.deleteRecording('u1', 'ws1', 'call1'),
      'PHONE_CALL_RECORDING_NOT_FOUND',
    )
  })

  it('keeps the fields when the object cannot be deleted', async () => {
    mocks.deleteObject.mockRejectedValue(new Error('s3 down'))
    expectErr(
      await PhoneCallRecordingService.deleteRecording('u1', 'ws1', 'call1'),
      'STORAGE_ERROR',
    )
    expect(callRepo.clearRecording).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    callRepo.findWithNames.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallRecordingService.deleteRecording('u1', 'ws1', 'call1'),
      'DATABASE_ERROR',
    )
    callRepo.clearRecording.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallRecordingService.deleteRecording('u1', 'ws1', 'call1'),
      'DATABASE_ERROR',
    )
  })
})

describe('PhoneCallRecordingService.purgeExpired()', () => {
  beforeEach(() => {
    callRepo.clearRecording.mockResolvedValue(ok(recordedCall()))
  })

  it('deletes every expired recording page by page', async () => {
    const full = Array.from({ length: RECORDING_PURGE_PAGE }, (_, i) => ({
      id: `c${i}`,
      workspaceId: 'ws1',
      recordingKey: `ws1/c${i}.wav`,
    }))
    callRepo.listExpiredRecordings
      .mockResolvedValueOnce(ok(full))
      .mockResolvedValueOnce(
        ok([{ id: 'last', workspaceId: 'ws1', recordingKey: null }]),
      )

    expect(expectOk(await PhoneCallRecordingService.purgeExpired(NOW))).toBe(
      RECORDING_PURGE_PAGE + 1,
    )
    expect(callRepo.listExpiredRecordings).toHaveBeenCalledWith(
      NOW,
      RECORDING_PURGE_PAGE,
    )
    expect(mocks.deleteObject).toHaveBeenCalledTimes(RECORDING_PURGE_PAGE)
  })

  it('stops when a page makes no progress (storage down)', async () => {
    const full = Array.from({ length: RECORDING_PURGE_PAGE }, (_, i) => ({
      id: `c${i}`,
      workspaceId: 'ws1',
      recordingKey: `ws1/c${i}.wav`,
    }))
    callRepo.listExpiredRecordings.mockResolvedValue(ok(full))
    mocks.deleteObject.mockRejectedValue(new Error('s3 down'))

    expect(expectOk(await PhoneCallRecordingService.purgeExpired(NOW))).toBe(0)
    expect(callRepo.listExpiredRecordings).toHaveBeenCalledTimes(1)
    expect(callRepo.clearRecording).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    callRepo.listExpiredRecordings.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallRecordingService.purgeExpired(NOW),
      'DATABASE_ERROR',
    )

    callRepo.listExpiredRecordings.mockResolvedValueOnce(
      ok([{ id: 'c1', workspaceId: 'ws1', recordingKey: 'ws1/c1.wav' }]),
    )
    callRepo.clearRecording.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallRecordingService.purgeExpired(NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('PhoneCallRecordingService.sweepOrphans()', () => {
  const old = new Date(NOW.getTime() - ORPHAN_GRACE_MS - 1)
  const fresh = new Date(NOW.getTime() - 1000)

  it('deletes old objects that no call references', async () => {
    mocks.listObjects.mockResolvedValue([
      { key: 'ws1/kept.wav', size: 1, lastModified: old },
      { key: 'ws1/orphan.wav', size: 1, lastModified: old },
      { key: 'ws1/undated.wav', size: 1 },
      { key: 'ws1/uploading.wav', size: 1, lastModified: fresh },
    ])
    callRepo.findExistingRecordingKeys.mockResolvedValue(
      ok(new Set(['ws1/kept.wav'])),
    )
    mocks.deleteObjects.mockResolvedValue(2)

    expect(expectOk(await PhoneCallRecordingService.sweepOrphans(NOW))).toBe(2)
    expect(callRepo.findExistingRecordingKeys).toHaveBeenCalledWith([
      'ws1/kept.wav',
      'ws1/orphan.wav',
      'ws1/undated.wav',
    ])
    expect(mocks.deleteObjects).toHaveBeenCalledWith('phone-call-recordings', [
      'ws1/orphan.wav',
      'ws1/undated.wav',
    ])
  })

  it('does nothing when there is nothing old', async () => {
    mocks.listObjects.mockResolvedValue([
      { key: 'ws1/uploading.wav', size: 1, lastModified: fresh },
    ])
    expect(expectOk(await PhoneCallRecordingService.sweepOrphans(NOW))).toBe(0)
    expect(callRepo.findExistingRecordingKeys).not.toHaveBeenCalled()
  })

  it('does nothing when every old object has its call', async () => {
    mocks.listObjects.mockResolvedValue([
      { key: 'ws1/kept.wav', size: 1, lastModified: old },
    ])
    callRepo.findExistingRecordingKeys.mockResolvedValue(
      ok(new Set(['ws1/kept.wav'])),
    )
    expect(expectOk(await PhoneCallRecordingService.sweepOrphans(NOW))).toBe(0)
    expect(mocks.deleteObjects).not.toHaveBeenCalled()
  })

  it('fails with STORAGE_ERROR when listing or deleting fails', async () => {
    mocks.listObjects.mockRejectedValueOnce('s3 down')
    expectErr(
      await PhoneCallRecordingService.sweepOrphans(NOW),
      'STORAGE_ERROR',
    )

    mocks.listObjects.mockResolvedValueOnce([
      { key: 'ws1/orphan.wav', size: 1, lastModified: old },
    ])
    callRepo.findExistingRecordingKeys.mockResolvedValueOnce(ok(new Set()))
    mocks.deleteObjects.mockRejectedValueOnce(new Error('s3 down'))
    expectErr(
      await PhoneCallRecordingService.sweepOrphans(NOW),
      'STORAGE_ERROR',
    )
  })

  it('propagates database failures', async () => {
    mocks.listObjects.mockResolvedValue([
      { key: 'ws1/orphan.wav', size: 1, lastModified: old },
    ])
    callRepo.findExistingRecordingKeys.mockResolvedValue(err(DB))
    expectErr(
      await PhoneCallRecordingService.sweepOrphans(NOW),
      'DATABASE_ERROR',
    )
  })
})
