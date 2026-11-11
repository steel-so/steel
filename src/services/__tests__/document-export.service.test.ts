import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeDocumentExport,
  createFakeReadyDocumentExport,
} from '@/src/__tests__/factories/document-pdf.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  documentExportNotFound,
  documentLinkUnavailable,
  documentNotFound,
  forbidden,
  moduleDisabled,
} from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  repo: {
    findDocument: vi.fn(),
    findVersionTarget: vi.fn(),
    findReusable: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    markFailed: vi.fn(),
    recordDownload: vi.fn(),
    listPrunable: vi.fn(),
    deleteMany: vi.fn(),
  },
  assertModuleMember: vi.fn(),
  assertModuleEnabled: vi.fn(),
  resolveDocumentToken: vi.fn(),
  enqueue: vi.fn(),
  deleteObjects: vi.fn(),
  audit: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/repositories/document-export.repository', () => ({
  DocumentExportRepository: mocks.repo,
}))
vi.mock('@/src/services/authz', () => ({
  assertModuleMember: mocks.assertModuleMember,
  assertModuleEnabled: mocks.assertModuleEnabled,
}))
vi.mock('@/src/lib/document-export/backend-adapter', () => ({
  resolveDocumentToken: mocks.resolveDocumentToken,
}))
vi.mock('@/src/lib/queue/documents-pdf', () => ({
  enqueueDocumentPdfRender: mocks.enqueue,
}))
vi.mock('@/src/lib/storage/s3', () => ({
  deleteObjects: mocks.deleteObjects,
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: mocks.audit }))
vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))

import {
  DocumentExportService,
  EXPORT_IN_FLIGHT_MS,
} from '../document-export.service'

const NOW = new Date('2026-11-11T12:00:00.000Z')
const WS = 'ws-1'
const DOC = 'doc-1'
const VERSION = 'ver-1'

const document = (overrides: Record<string, unknown> = {}) => ({
  id: DOC,
  workspaceId: WS,
  title: 'Proposta Comercial — Acme',
  currentVersionId: VERSION,
  settings: {},
  updatedAt: new Date('2026-11-10T09:00:00.000Z'),
  ...overrides,
})

const target = (
  documentSettings: Record<string, unknown> = {},
  versionSettings: Record<string, unknown> = {},
) => ({
  document: {
    id: DOC,
    workspaceId: WS,
    title: 'Proposta Comercial — Acme',
    settings: documentSettings,
  },
  version: { id: VERSION, number: 2, settings: versionSettings },
})

const pending = (overrides = {}) =>
  createFakeDocumentExport({
    id: 'exp-1',
    documentId: DOC,
    workspaceId: WS,
    versionId: VERSION,
    ...overrides,
  })

const ready = (overrides = {}) =>
  createFakeReadyDocumentExport({
    id: 'exp-1',
    documentId: DOC,
    workspaceId: WS,
    versionId: VERSION,
    ...overrides,
  })

const DOWNLOAD_URL = `/api/workspaces/${WS}/crm/documents/${DOC}/exports/exp-1/download`

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mocks.assertModuleMember.mockResolvedValue(ok({ role: 'MEMBER' }))
  mocks.assertModuleEnabled.mockResolvedValue(ok(true))
  mocks.repo.findDocument.mockResolvedValue(ok(document()))
  mocks.repo.findReusable.mockResolvedValue(ok(null))
  mocks.repo.create.mockResolvedValue(ok(pending()))
  mocks.repo.markFailed.mockResolvedValue(ok(undefined))
  mocks.repo.recordDownload.mockResolvedValue(ok(undefined))
  mocks.enqueue.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('DocumentExportService.create', () => {
  it('should check the documents VIEW permission', async () => {
    mocks.assertModuleMember.mockResolvedValue(err(forbidden()))
    expectErr(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
      'FORBIDDEN',
    )
    expect(mocks.assertModuleMember).toHaveBeenCalledWith('u1', WS, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    expect(mocks.repo.findDocument).not.toHaveBeenCalled()
  })

  it('should propagate a missing document', async () => {
    mocks.repo.findDocument.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('should reuse a READY export of the current version', async () => {
    mocks.repo.findReusable.mockResolvedValue(ok(ready()))
    const dto = expectOk(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
    )
    expect(dto).toMatchObject({ id: 'exp-1', status: 'READY' })
    expect(dto.downloadUrl).toBe(DOWNLOAD_URL)
    expect(mocks.repo.findReusable).toHaveBeenCalledWith({
      documentId: DOC,
      versionId: VERSION,
      recipientId: null,
      now: NOW,
      inFlightSince: new Date(NOW.getTime() - EXPORT_IN_FLIGHT_MS),
    })
    expect(mocks.repo.create).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('should create and queue an export of the version', async () => {
    const dto = expectOk(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
    )
    expect(dto).toMatchObject({
      id: 'exp-1',
      status: 'PENDING',
      downloadUrl: null,
    })
    expect(mocks.repo.create).toHaveBeenCalledWith({
      documentId: DOC,
      workspaceId: WS,
      versionId: VERSION,
      recipientId: null,
      requestedById: 'u1',
    })
    expect(mocks.enqueue).toHaveBeenCalledWith('exp-1')
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'document_export',
        action: 'create',
        targetId: 'exp-1',
        meta: { workspaceId: WS, documentId: DOC, draft: false },
      }),
    )
  })

  it('should only reuse draft exports made after the last edit', async () => {
    const editedAt = new Date(NOW.getTime() - 60_000)
    mocks.repo.findDocument.mockResolvedValue(
      ok(document({ updatedAt: editedAt })),
    )
    expectOk(await DocumentExportService.create('u1', WS, DOC, { draft: true }))
    expect(mocks.repo.findReusable).toHaveBeenCalledWith({
      documentId: DOC,
      versionId: null,
      recipientId: null,
      now: NOW,
      readySince: editedAt,
      inFlightSince: editedAt,
    })
    expect(mocks.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: null }),
    )
  })

  it('should export the draft of a document never sent', async () => {
    const editedAt = new Date('2026-11-01T00:00:00.000Z')
    mocks.repo.findDocument.mockResolvedValue(
      ok(document({ currentVersionId: null, updatedAt: editedAt })),
    )
    expectOk(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
    )
    expect(mocks.repo.findReusable).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: null,
        readySince: editedAt,
        inFlightSince: new Date(NOW.getTime() - EXPORT_IN_FLIGHT_MS),
      }),
    )
  })

  it('should propagate a lookup failure', async () => {
    mocks.repo.findReusable.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
      'DATABASE_ERROR',
    )
  })

  it('should audit a failed insert', async () => {
    mocks.repo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
      'DATABASE_ERROR',
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'DATABASE_ERROR',
      }),
    )
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('should mark the export FAILED when the queue is down', async () => {
    mocks.enqueue.mockRejectedValue(new Error('redis down'))
    expectErr(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
      'DOCUMENT_EXPORT_FAILED',
    )
    expect(mocks.repo.markFailed).toHaveBeenCalledWith(
      'exp-1',
      'Não foi possível gerar o PDF. Tente de novo em instantes.',
      NOW,
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'document_export.enqueue_failed',
      expect.objectContaining({ message: 'redis down' }),
    )
  })

  it('should log a non-Error queue failure too', async () => {
    mocks.enqueue.mockRejectedValue('nope')
    expectErr(
      await DocumentExportService.create('u1', WS, DOC, { draft: false }),
      'DOCUMENT_EXPORT_FAILED',
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'document_export.enqueue_failed',
      expect.objectContaining({ message: 'nope' }),
    )
  })
})

describe('DocumentExportService.get', () => {
  it('should deny without permission', async () => {
    mocks.assertModuleMember.mockResolvedValue(err(moduleDisabled()))
    expectErr(
      await DocumentExportService.get('u1', WS, DOC, 'exp-1'),
      'MODULE_DISABLED',
    )
  })

  it('should propagate a missing document or export', async () => {
    mocks.repo.findDocument.mockResolvedValueOnce(err(documentNotFound()))
    expectErr(
      await DocumentExportService.get('u1', WS, DOC, 'exp-1'),
      'DOCUMENT_NOT_FOUND',
    )
    mocks.repo.findById.mockResolvedValueOnce(err(documentExportNotFound()))
    expectErr(
      await DocumentExportService.get('u1', WS, DOC, 'exp-1'),
      'DOCUMENT_EXPORT_NOT_FOUND',
    )
  })

  it('should give a download URL only inside retention', async () => {
    mocks.repo.findById.mockResolvedValueOnce(ok(ready()))
    const current = expectOk(
      await DocumentExportService.get('u1', WS, DOC, 'exp-1'),
    )
    expect(current.downloadUrl).toBe(DOWNLOAD_URL)
    expect(mocks.repo.findById).toHaveBeenCalledWith('exp-1', {
      documentId: DOC,
      workspaceId: WS,
    })

    mocks.repo.findById.mockResolvedValueOnce(
      ok(ready({ expiresAt: new Date(NOW.getTime() - 1) })),
    )
    const expired = expectOk(
      await DocumentExportService.get('u1', WS, DOC, 'exp-1'),
    )
    expect(expired.downloadUrl).toBeNull()
  })
})

describe('DocumentExportService.authorizeDownload', () => {
  it('should deny without permission or document', async () => {
    mocks.assertModuleMember.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await DocumentExportService.authorizeDownload('u1', WS, DOC, 'exp-1'),
      'FORBIDDEN',
    )
    mocks.repo.findDocument.mockResolvedValueOnce(err(documentNotFound()))
    expectErr(
      await DocumentExportService.authorizeDownload('u1', WS, DOC, 'exp-1'),
      'DOCUMENT_NOT_FOUND',
    )
    mocks.repo.findById.mockResolvedValueOnce(err(documentExportNotFound()))
    expectErr(
      await DocumentExportService.authorizeDownload('u1', WS, DOC, 'exp-1'),
      'DOCUMENT_EXPORT_NOT_FOUND',
    )
  })

  it.each([
    ['in progress', pending({ status: 'RUNNING' })],
    ['expired', ready({ expiresAt: new Date(NOW.getTime() - 1) })],
    ['without a file', ready({ storageKey: null })],
    ['without expiry', ready({ expiresAt: null })],
  ])('should refuse an export %s', async (_label, row) => {
    mocks.repo.findById.mockResolvedValue(ok(row))
    expectErr(
      await DocumentExportService.authorizeDownload('u1', WS, DOC, 'exp-1'),
      'DOCUMENT_EXPORT_NOT_FOUND',
    )
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('should return the file with a slug of the title, audited', async () => {
    const row = ready()
    mocks.repo.findById.mockResolvedValue(ok(row))
    const file = expectOk(
      await DocumentExportService.authorizeDownload('u1', WS, DOC, 'exp-1'),
    )
    expect(file).toEqual({
      bucket: 'documents',
      key: row.storageKey,
      fileName: 'proposta-comercial-acme.pdf',
      sizeBytes: 2048,
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'document_export',
        action: 'export',
        actorId: 'u1',
        targetId: 'exp-1',
      }),
    )
  })
})

describe('DocumentExportService.requestPublicPdf', () => {
  const resolved = (overrides = {}) =>
    ok({
      documentId: DOC,
      workspaceId: WS,
      recipientId: 'rcpt-1',
      versionId: VERSION,
      ...overrides,
    })

  beforeEach(() => {
    mocks.resolveDocumentToken.mockResolvedValue(resolved())
    mocks.repo.findVersionTarget.mockResolvedValue(ok(target()))
    mocks.repo.create.mockResolvedValue(ok(pending({ recipientId: 'rcpt-1' })))
  })

  it('should propagate an unavailable link', async () => {
    mocks.resolveDocumentToken.mockResolvedValue(
      err(documentLinkUnavailable()),
    )
    expectErr(
      await DocumentExportService.requestPublicPdf('tok', null),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
  })

  it('should refuse a link without a sent version', async () => {
    mocks.resolveDocumentToken.mockResolvedValue(resolved({ versionId: null }))
    expectErr(
      await DocumentExportService.requestPublicPdf('tok', null),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
  })

  it('should refuse when the CRM module is off', async () => {
    mocks.assertModuleEnabled.mockResolvedValue(err(moduleDisabled()))
    expectErr(
      await DocumentExportService.requestPublicPdf('tok', null),
      'MODULE_DISABLED',
    )
    expect(mocks.assertModuleEnabled).toHaveBeenCalledWith(WS, 'CRM')
  })

  it('should propagate a missing version', async () => {
    mocks.repo.findVersionTarget.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentExportService.requestPublicPdf('tok', null),
      'DATABASE_ERROR',
    )
  })

  it.each([
    ['the document', target({ allowDownload: false })],
    ['the sent version', target({}, { allowDownload: false })],
  ])('should refuse when %s disables downloads', async (_label, value) => {
    mocks.repo.findVersionTarget.mockResolvedValue(ok(value))
    expectErr(
      await DocumentExportService.requestPublicPdf('tok', null),
      'DOCUMENT_DOWNLOAD_DISABLED',
    )
    expect(mocks.repo.findReusable).not.toHaveBeenCalled()
  })

  it('should queue a new export for this reader', async () => {
    const result = expectOk(
      await DocumentExportService.requestPublicPdf('tok', null),
    )
    expect(result).toEqual({
      kind: 'pending',
      exportId: 'exp-1',
      status: 'PENDING',
    })
    expect(mocks.repo.findReusable).toHaveBeenCalledWith({
      documentId: DOC,
      versionId: VERSION,
      recipientId: 'rcpt-1',
      now: NOW,
      inFlightSince: new Date(NOW.getTime() - EXPORT_IN_FLIGHT_MS),
    })
    expect(mocks.repo.create).toHaveBeenCalledWith({
      documentId: DOC,
      workspaceId: WS,
      versionId: VERSION,
      recipientId: 'rcpt-1',
      requestedById: null,
    })
    expect(mocks.enqueue).toHaveBeenCalledWith('exp-1')
  })

  it('should propagate reuse, insert and queue failures', async () => {
    mocks.repo.findReusable.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await DocumentExportService.requestPublicPdf('tok', null),
      'DATABASE_ERROR',
    )
    mocks.repo.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await DocumentExportService.requestPublicPdf('tok', null),
      'DATABASE_ERROR',
    )
    mocks.enqueue.mockRejectedValueOnce(new Error('redis down'))
    expectErr(
      await DocumentExportService.requestPublicPdf('tok', null),
      'DOCUMENT_EXPORT_FAILED',
    )
  })

  it('should hand a reusable READY export as a download', async () => {
    const row = ready({ recipientId: 'rcpt-1' })
    mocks.repo.findReusable.mockResolvedValue(ok(row))
    const result = expectOk(
      await DocumentExportService.requestPublicPdf('tok', null),
    )
    expect(result).toEqual({
      kind: 'ready',
      exportId: 'exp-1',
      file: {
        bucket: 'documents',
        key: row.storageKey,
        fileName: 'proposta-comercial-acme.pdf',
        sizeBytes: 2048,
      },
    })
    expect(mocks.repo.recordDownload).toHaveBeenCalledWith({
      documentId: DOC,
      workspaceId: WS,
      recipientId: 'rcpt-1',
      exportId: 'exp-1',
      versionNumber: 2,
    })
    expect(mocks.repo.create).not.toHaveBeenCalled()
  })

  it('should still download when the timeline event fails', async () => {
    mocks.repo.findReusable.mockResolvedValue(
      ok(ready({ recipientId: 'rcpt-1' })),
    )
    mocks.repo.recordDownload.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await DocumentExportService.requestPublicPdf('tok', null)).kind,
    ).toBe('ready')
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'document_export.download_event_failed',
      expect.objectContaining({ exportId: 'exp-1' }),
    )
  })

  describe('polling with exportId', () => {
    it('should propagate a missing export', async () => {
      mocks.repo.findById.mockResolvedValue(err(documentExportNotFound()))
      expectErr(
        await DocumentExportService.requestPublicPdf('tok', 'exp-1'),
        'DOCUMENT_EXPORT_NOT_FOUND',
      )
    })

    it.each([
      ['an older version', { versionId: 'ver-0', recipientId: 'rcpt-1' }],
      ['another reader', { recipientId: 'rcpt-2' }],
    ])('should refuse the export of %s', async (_label, overrides) => {
      mocks.repo.findById.mockResolvedValue(ok(ready(overrides)))
      expectErr(
        await DocumentExportService.requestPublicPdf('tok', 'exp-1'),
        'DOCUMENT_EXPORT_NOT_FOUND',
      )
    })

    it('should answer pending while the export runs', async () => {
      mocks.repo.findById.mockResolvedValue(
        ok(pending({ status: 'RUNNING', recipientId: 'rcpt-1' })),
      )
      expect(
        expectOk(await DocumentExportService.requestPublicPdf('tok', 'exp-1')),
      ).toEqual({ kind: 'pending', exportId: 'exp-1', status: 'RUNNING' })
    })

    it('should surface a failed render', async () => {
      mocks.repo.findById.mockResolvedValueOnce(
        ok(
          pending({
            status: 'FAILED',
            recipientId: 'rcpt-1',
            error: 'Demorou demais.',
          }),
        ),
      )
      const failed = expectErr(
        await DocumentExportService.requestPublicPdf('tok', 'exp-1'),
        'DOCUMENT_EXPORT_FAILED',
      )
      expect(failed.message).toBe('Demorou demais.')

      mocks.repo.findById.mockResolvedValueOnce(
        ok(pending({ status: 'FAILED', recipientId: 'rcpt-1', error: null })),
      )
      const generic = expectErr(
        await DocumentExportService.requestPublicPdf('tok', 'exp-1'),
        'DOCUMENT_EXPORT_FAILED',
      )
      expect(generic.message).toBe(
        'Não foi possível gerar o PDF. Tente de novo em instantes.',
      )
    })

    it('should refuse a READY export past retention', async () => {
      mocks.repo.findById.mockResolvedValue(
        ok(
          ready({
            recipientId: 'rcpt-1',
            expiresAt: new Date(NOW.getTime() - 1),
          }),
        ),
      )
      expectErr(
        await DocumentExportService.requestPublicPdf('tok', 'exp-1'),
        'DOCUMENT_EXPORT_NOT_FOUND',
      )
      expect(mocks.repo.recordDownload).not.toHaveBeenCalled()
    })
  })
})

describe('DocumentExportService.pruneExpired', () => {
  it('should propagate a listing failure', async () => {
    mocks.repo.listPrunable.mockResolvedValue(err(databaseError()))
    expectErr(await DocumentExportService.pruneExpired(NOW), 'DATABASE_ERROR')
  })

  it('should delete the files, then the rows, and audit it', async () => {
    mocks.repo.listPrunable.mockResolvedValue(
      ok([
        { id: 'a', storageKey: 'ws/doc/exports/a.pdf' },
        { id: 'b', storageKey: null },
      ]),
    )
    mocks.repo.deleteMany.mockResolvedValue(ok(2))
    expect(expectOk(await DocumentExportService.pruneExpired(NOW))).toEqual({
      deleted: 2,
      files: 1,
    })
    expect(mocks.repo.listPrunable).toHaveBeenCalledWith(
      NOW,
      new Date('2026-11-04T12:00:00.000Z'),
    )
    expect(mocks.deleteObjects).toHaveBeenCalledWith('documents', [
      'ws/doc/exports/a.pdf',
    ])
    expect(mocks.repo.deleteMany).toHaveBeenCalledWith(['a', 'b'])
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'document_export',
        action: 'prune',
        actorId: null,
        meta: { deleted: 2, files: 1 },
      }),
    )
  })

  it('should skip the storage when no row has a file', async () => {
    mocks.repo.listPrunable.mockResolvedValue(ok([]))
    mocks.repo.deleteMany.mockResolvedValue(ok(0))
    expectOk(await DocumentExportService.pruneExpired(NOW))
    expect(mocks.deleteObjects).not.toHaveBeenCalled()
  })

  it('should keep the rows when the files could not be deleted', async () => {
    mocks.repo.listPrunable.mockResolvedValue(
      ok([{ id: 'a', storageKey: 'k' }]),
    )
    mocks.deleteObjects.mockRejectedValueOnce(new Error('minio down'))
    expectErr(await DocumentExportService.pruneExpired(NOW), 'STORAGE_ERROR')
    mocks.deleteObjects.mockRejectedValueOnce('minio down')
    expectErr(await DocumentExportService.pruneExpired(NOW), 'STORAGE_ERROR')
    expect(mocks.repo.deleteMany).not.toHaveBeenCalled()
  })

  it('should propagate a delete failure', async () => {
    mocks.repo.listPrunable.mockResolvedValue(
      ok([{ id: 'a', storageKey: null }]),
    )
    mocks.repo.deleteMany.mockResolvedValue(err(databaseError()))
    expectErr(await DocumentExportService.pruneExpired(NOW), 'DATABASE_ERROR')
  })
})
