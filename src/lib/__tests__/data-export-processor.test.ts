import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  userFindUniqueMock,
  sessionFindManyMock,
  accountFindManyMock,
  consentFindManyMock,
  axiomQueryMock,
  ensureBucketMock,
  putObjectMock,
  getPresignedDownloadUrlMock,
  sendExportEmailMock,
  auditMutationMock,
  listMembershipsMock,
  notifyExportReadyMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  sessionFindManyMock: vi.fn(),
  accountFindManyMock: vi.fn(),
  consentFindManyMock: vi.fn(),
  axiomQueryMock: vi.fn(),
  ensureBucketMock: vi.fn(),
  putObjectMock: vi.fn(),
  getPresignedDownloadUrlMock: vi.fn(),
  sendExportEmailMock: vi.fn(),
  auditMutationMock: vi.fn(),
  listMembershipsMock: vi.fn(),
  notifyExportReadyMock: vi.fn(),
}))

vi.mock('@/src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    session: { findMany: sessionFindManyMock },
    account: { findMany: accountFindManyMock },
    consentEvent: { findMany: consentFindManyMock },
  },
}))
vi.mock('@/lib/axiom/axiom', () => ({
  default: { query: axiomQueryMock },
}))
vi.mock('@/lib/axiom/audit', () => ({
  auditMutation: auditMutationMock,
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const envMock = vi.hoisted(() => ({
  NEXT_PUBLIC_AXIOM_DATASET: 'steel-app-test' as string | undefined,
}))
vi.mock('@/lib/env/env', () => envMock)
vi.mock('@/src/lib/storage/s3', () => ({
  ensureBucket: ensureBucketMock,
  putObject: putObjectMock,
  getPresignedDownloadUrl: getPresignedDownloadUrlMock,
}))
vi.mock('@/src/repositories/membership.repository', () => ({
  MembershipRepository: { listByUser: listMembershipsMock },
}))
vi.mock('@/src/services/platform-notifications', () => ({
  notifyDataExportReady: notifyExportReadyMock,
}))
vi.mock('@/src/lib/mail/user/send-export-data', () => ({
  sendExportDataEmail: sendExportEmailMock,
}))

import {
  EXPORT_BUCKET,
  processDataExport,
  SIGNED_URL_TTL_SECONDS,
} from '@/src/lib/queue/processors/data-export'

function fakeJob(
  name: string,
  data: unknown,
  id: string | undefined = 'job-1',
): Job {
  return { id, name, data } as unknown as Job
}

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date('2026-05-19T12:00:00Z')
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    image: null,
    twoFactorEnabled: false,
    deletionScheduledAt: null,
    acceptedTermsAt: now,
    acceptedPrivacyAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('processDataExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionFindManyMock.mockResolvedValue([])
    accountFindManyMock.mockResolvedValue([])
    consentFindManyMock.mockResolvedValue([])
    axiomQueryMock.mockResolvedValue({ matches: [] })
    ensureBucketMock.mockResolvedValue(undefined)
    putObjectMock.mockResolvedValue(undefined)
    getPresignedDownloadUrlMock.mockResolvedValue(
      'https://minio.local/user-exports/user-1/job-1.json?sig=abc',
    )
    sendExportEmailMock.mockResolvedValue({ id: 'email-1' })
    listMembershipsMock.mockResolvedValue({
      ok: true,
      value: [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-2' }],
    })
    notifyExportReadyMock.mockResolvedValue(2)
  })

  it('notifies the requester in-app in every workspace they belong to', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())

    await processDataExport(fakeJob('export-user-data', { userId: 'user-1' }))

    expect(notifyExportReadyMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceIds: ['ws-1', 'ws-2'],
      exportId: 'job-1',
    })
  })

  it('still finishes when the memberships lookup fails', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())
    listMembershipsMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    const result = await processDataExport(
      fakeJob('export-user-data', { userId: 'user-1' }),
    )

    expect(result.exported).toBe(true)
    expect(notifyExportReadyMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceIds: [] }),
    )
  })

  it('uploads JSON, signs URL, sends email and audits export_completed', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())

    const result = await processDataExport(
      fakeJob('export-user-data', { userId: 'user-1' }),
    )

    expect(result.exported).toBe(true)
    expect(typeof result.fileSize).toBe('number')

    expect(ensureBucketMock).toHaveBeenCalledWith(EXPORT_BUCKET)
    expect(putObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: EXPORT_BUCKET,
        key: 'user-1/job-1.json',
        contentType: 'application/json',
      }),
    )

    const uploadCall = putObjectMock.mock.calls[0][0]
    const uploaded = JSON.parse(uploadCall.body)
    expect(uploaded.schemaVersion).toBe('1')
    expect(uploaded.profile.id).toBe('user-1')
    // Defense-in-depth: no token fields should appear anywhere
    expect(uploadCall.body).not.toContain('"accessToken"')
    expect(uploadCall.body).not.toContain('"refreshToken"')
    expect(uploadCall.body).not.toContain('"token"')
    expect(uploadCall.body).not.toContain('"password"')

    expect(getPresignedDownloadUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: EXPORT_BUCKET,
        key: 'user-1/job-1.json',
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      }),
    )

    expect(sendExportEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@example.com',
        username: 'Test User',
        downloadUrl: expect.stringContaining('user-1/job-1.json'),
      }),
    )

    expect(auditMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'user',
        action: 'export_completed',
        actorId: 'user-1',
      }),
    )
  })

  it('strips session token and account tokens from the export', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())
    sessionFindManyMock.mockResolvedValue([
      {
        id: 'sess-1',
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla',
        expiresAt: new Date('2026-06-01T00:00:00Z'),
        createdAt: new Date('2026-05-19T00:00:00Z'),
        updatedAt: new Date('2026-05-19T00:00:00Z'),
      },
    ])
    accountFindManyMock.mockResolvedValue([
      {
        id: 'acc-1',
        providerId: 'github',
        accountId: 'gh-12345',
        scope: 'read:user',
        accessTokenExpiresAt: new Date('2026-06-01T00:00:00Z'),
        refreshTokenExpiresAt: null,
        createdAt: new Date('2026-05-19T00:00:00Z'),
        updatedAt: new Date('2026-05-19T00:00:00Z'),
      },
    ])

    await processDataExport(fakeJob('export-user-data', { userId: 'user-1' }))

    expect(sessionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ token: expect.anything() }),
      }),
    )
    expect(accountFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          accessToken: expect.anything(),
        }),
      }),
    )

    const uploadCall = putObjectMock.mock.calls[0][0]
    const uploaded = JSON.parse(uploadCall.body)
    expect(uploaded.sessions[0]).not.toHaveProperty('token')
    expect(uploaded.accounts[0]).not.toHaveProperty('accessToken')
    expect(uploaded.accounts[0]).not.toHaveProperty('refreshToken')
    expect(uploaded.accounts[0]).not.toHaveProperty('idToken')
    expect(uploaded.accounts[0]).not.toHaveProperty('password')
  })

  it('skips export when user no longer exists', async () => {
    userFindUniqueMock.mockResolvedValue(null)

    const result = await processDataExport(
      fakeJob('export-user-data', { userId: 'ghost' }),
    )

    expect(result.exported).toBe(false)
    expect(result.reason).toBe('user_missing')
    expect(putObjectMock).not.toHaveBeenCalled()
    expect(sendExportEmailMock).not.toHaveBeenCalled()
    expect(auditMutationMock).not.toHaveBeenCalled()
  })

  it('continues with empty auditLog when Axiom query fails', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())
    axiomQueryMock.mockRejectedValueOnce(new Error('axiom down'))

    const result = await processDataExport(
      fakeJob('export-user-data', { userId: 'user-1' }),
    )

    expect(result.exported).toBe(true)
    const uploadCall = putObjectMock.mock.calls[0][0]
    const uploaded = JSON.parse(uploadCall.body)
    expect(uploaded.auditLog).toEqual([])
  })

  it('skips the Axiom query when no dataset is configured', async () => {
    envMock.NEXT_PUBLIC_AXIOM_DATASET = undefined
    try {
      userFindUniqueMock.mockResolvedValue(buildUser())

      const result = await processDataExport(
        fakeJob('export-user-data', { userId: 'user-1' }),
      )

      expect(result.exported).toBe(true)
      expect(axiomQueryMock).not.toHaveBeenCalled()
      const uploaded = JSON.parse(putObjectMock.mock.calls[0][0].body)
      expect(uploaded.auditLog).toEqual([])
    } finally {
      envMock.NEXT_PUBLIC_AXIOM_DATASET = 'steel-app-test'
    }
  })

  it('does not fail the job when email send throws', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())
    sendExportEmailMock.mockRejectedValueOnce(new Error('resend boom'))

    const result = await processDataExport(
      fakeJob('export-user-data', { userId: 'user-1' }),
    )

    expect(result.exported).toBe(true)
    expect(auditMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'export_completed' }),
    )
  })

  it('throws on unknown job name', async () => {
    await expect(
      processDataExport(fakeJob('unknown', { userId: 'user-1' })),
    ).rejects.toThrow(/Unknown data-export job/)
  })

  it('rejects when upload to storage fails', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())
    putObjectMock.mockRejectedValueOnce(new Error('s3 down'))

    await expect(
      processDataExport(fakeJob('export-user-data', { userId: 'user-1' })),
    ).rejects.toThrow(/s3 down/)
    expect(sendExportEmailMock).not.toHaveBeenCalled()
    expect(auditMutationMock).not.toHaveBeenCalled()
  })

  it('exports audit entries, refresh-token expiry, consents and the scheduled deletion date', async () => {
    const scheduled = new Date('2026-07-01T00:00:00Z')
    userFindUniqueMock.mockResolvedValue(
      buildUser({ deletionScheduledAt: scheduled }),
    )
    accountFindManyMock.mockResolvedValue([
      {
        id: 'acc-1',
        providerId: 'google',
        accountId: 'g-1',
        scope: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: new Date('2026-08-01T00:00:00Z'),
        createdAt: new Date('2026-05-19T00:00:00Z'),
        updatedAt: new Date('2026-05-19T00:00:00Z'),
      },
    ])
    consentFindManyMock.mockResolvedValue([
      {
        id: 'c-1',
        document: 'TERMS',
        version: '2026-05',
        action: 'GRANTED',
        ipAddress: null,
        userAgent: null,
        createdAt: new Date('2026-05-19T00:00:00Z'),
      },
    ])
    axiomQueryMock.mockResolvedValue({
      matches: [
        {
          _time: '2026-05-20T10:00:00.000Z',
          data: { auditType: 'auth', event: 'sign_in', outcome: 'success' },
        },
      ],
    })

    await processDataExport(fakeJob('export-user-data', { userId: 'user-1' }))

    expect(axiomQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("['fields.actorId'] == 'user-1'"),
      { format: 'legacy' },
    )
    const uploaded = JSON.parse(putObjectMock.mock.calls[0][0].body)
    expect(uploaded.profile.deletionScheduledAt).toBe(scheduled.toISOString())
    expect(uploaded.accounts[0]).toMatchObject({
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: '2026-08-01T00:00:00.000Z',
    })
    expect(uploaded.consents[0]).toMatchObject({
      document: 'TERMS',
      action: 'GRANTED',
    })
    expect(uploaded.auditLog).toEqual([
      {
        timestamp: '2026-05-20T10:00:00.000Z',
        auditType: 'auth',
        event: 'sign_in',
        outcome: 'success',
      },
    ])
  })

  it('treats an Axiom response without matches as an empty audit log', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())
    axiomQueryMock.mockResolvedValue({})

    await processDataExport(fakeJob('export-user-data', { userId: 'user-1' }))

    const uploaded = JSON.parse(putObjectMock.mock.calls[0][0].body)
    expect(uploaded.auditLog).toEqual([])
  })

  it('tolerates non-Error failures from Axiom and the mailer', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())
    axiomQueryMock.mockRejectedValueOnce('axiom 429')
    sendExportEmailMock.mockRejectedValueOnce('resend 500')

    const result = await processDataExport(
      fakeJob('export-user-data', { userId: 'user-1' }),
    )

    expect(result.exported).toBe(true)
  })

  it('uses the user id as the file name when the job has no id', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())

    await processDataExport({
      name: 'export-user-data',
      data: { userId: 'user-1' },
    } as unknown as Job)

    expect(putObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'user-1/user-1.json' }),
    )
  })

  it('formats the e-mailed file size in B, KB and MB', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())
    const entries = (count: number, pad: number) => ({
      matches: Array.from({ length: count }, () => ({
        _time: '2026-05-20T10:00:00.000Z',
        data: { reason: 'x'.repeat(pad) },
      })),
    })

    axiomQueryMock.mockResolvedValueOnce(entries(3, 1_000))
    await processDataExport(fakeJob('export-user-data', { userId: 'user-1' }))
    expect(sendExportEmailMock.mock.calls[0][0].fileSize).toMatch(
      /^\d+\.\d KB$/,
    )

    axiomQueryMock.mockResolvedValueOnce(entries(3, 400_000))
    await processDataExport(fakeJob('export-user-data', { userId: 'user-1' }))
    expect(sendExportEmailMock.mock.calls[1][0].fileSize).toMatch(
      /^\d+\.\d MB$/,
    )
  })

  it('reports tiny exports in bytes', async () => {
    userFindUniqueMock.mockResolvedValue(buildUser())

    const result = await processDataExport(
      fakeJob('export-user-data', { userId: 'user-1' }),
    )

    expect(result.fileSize).toBeLessThan(1024)
    expect(sendExportEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ fileSize: `${result.fileSize} B` }),
    )
  })

  it('exports null consent timestamps for users who never accepted the terms', async () => {
    userFindUniqueMock.mockResolvedValue(
      buildUser({ acceptedTermsAt: null, acceptedPrivacyAt: null }),
    )

    await processDataExport(fakeJob('export-user-data', { userId: 'user-1' }))

    const uploaded = JSON.parse(putObjectMock.mock.calls[0][0].body)
    expect(uploaded.profile.acceptedTermsAt).toBeNull()
    expect(uploaded.profile.acceptedPrivacyAt).toBeNull()
  })

  it('reports an unknown id for unknown jobs without an id', async () => {
    await expect(
      processDataExport({ name: 'nope', data: {} } as unknown as Job),
    ).rejects.toThrow('Unknown data-export job: nope (id=unknown)')
  })
})
