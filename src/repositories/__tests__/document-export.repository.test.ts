import { describe, expect, it, vi } from 'vitest'
import {
  seedDocument,
  seedDocumentExport,
  seedDocumentVersion,
} from '@/src/__tests__/factories/document-pdf.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { DocumentExportRepository } from '../document-export.repository'

const NOW = new Date('2026-11-11T12:00:00.000Z')
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000)
const daysFromNow = (days: number) =>
  new Date(NOW.getTime() + days * 24 * 60 * 60_000)

async function seedSentDocument() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const document = await seedDocument(workspace.id, user.id)
  const version = await seedDocumentVersion(document.id, workspace.id, {
    number: 3,
    settings: { allowDownload: false },
  })
  await prisma.document.update({
    where: { id: document.id },
    data: { currentVersionId: version.id },
  })
  return { workspace, user, document, version }
}

describe('DocumentExportRepository', () => {
  describe('findDocument()', () => {
    it('should return the document of the workspace', async () => {
      const { workspace, document, version } = await seedSentDocument()
      const found = expectOk(
        await DocumentExportRepository.findDocument(document.id, workspace.id),
      )
      expect(found).toMatchObject({
        id: document.id,
        workspaceId: workspace.id,
        title: 'Proposta comercial',
        currentVersionId: version.id,
      })
    })

    it('should hide documents of another workspace and soft-deleted ones', async () => {
      const { document } = await seedSentDocument()
      const other = await seedWorkspace()
      expectErr(
        await DocumentExportRepository.findDocument(document.id, other.id),
        'DOCUMENT_NOT_FOUND',
      )

      const user = await seedUser()
      const deleted = await seedDocument(other.id, user.id, {
        deletedAt: NOW,
      })
      expectErr(
        await DocumentExportRepository.findDocument(deleted.id, other.id),
        'DOCUMENT_NOT_FOUND',
      )
    })

    it('should return DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.document, 'findFirst').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentExportRepository.findDocument('d', 'w'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findVersionTarget()', () => {
    it('should return the version with its document', async () => {
      const { workspace, document, version } = await seedSentDocument()
      const target = expectOk(
        await DocumentExportRepository.findVersionTarget(
          document.id,
          version.id,
        ),
      )
      expect(target).toEqual({
        document: {
          id: document.id,
          workspaceId: workspace.id,
          title: 'Proposta comercial',
          settings: {},
        },
        version: {
          id: version.id,
          number: 3,
          settings: { allowDownload: false },
        },
      })
    })

    it('should not mix versions of another document', async () => {
      const { version, workspace, user } = await seedSentDocument()
      const other = await seedDocument(workspace.id, user.id)
      expectErr(
        await DocumentExportRepository.findVersionTarget(other.id, version.id),
        'DOCUMENT_VERSION_NOT_FOUND',
      )
    })

    it('should return DOCUMENT_NOT_FOUND for a deleted document', async () => {
      const { document, version } = await seedSentDocument()
      await prisma.document.update({
        where: { id: document.id },
        data: { deletedAt: NOW },
      })
      expectErr(
        await DocumentExportRepository.findVersionTarget(
          document.id,
          version.id,
        ),
        'DOCUMENT_NOT_FOUND',
      )
    })

    it('should return DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.documentVersion, 'findFirst').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentExportRepository.findVersionTarget('d', 'v'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findReusable()', () => {
    it('should prefer a READY export over one in flight', async () => {
      const { workspace, document, version } = await seedSentDocument()
      const ready = await seedDocumentExport(document.id, workspace.id, {
        versionId: version.id,
        status: 'READY',
        storageKey: 'k',
        expiresAt: daysFromNow(3),
        createdAt: minutesAgo(60),
      })
      await seedDocumentExport(document.id, workspace.id, {
        versionId: version.id,
        status: 'PENDING',
        createdAt: minutesAgo(1),
      })

      const found = expectOk(
        await DocumentExportRepository.findReusable({
          documentId: document.id,
          versionId: version.id,
          recipientId: null,
          now: NOW,
          inFlightSince: minutesAgo(15),
        }),
      )
      expect(found?.id).toBe(ready.id)
      expect(found?.version).toEqual({ number: 3 })
    })

    it('should return a recent in-flight export and ignore dead ones', async () => {
      const { workspace, document } = await seedSentDocument()
      await seedDocumentExport(document.id, workspace.id, {
        status: 'RUNNING',
        createdAt: minutesAgo(30),
      })
      const recent = await seedDocumentExport(document.id, workspace.id, {
        status: 'PENDING',
        createdAt: minutesAgo(2),
      })
      const query = {
        documentId: document.id,
        versionId: null,
        recipientId: null,
        now: NOW,
        inFlightSince: minutesAgo(15),
      }
      const found = expectOk(
        await DocumentExportRepository.findReusable(query),
      )
      expect(found?.id).toBe(recent.id)
      expect(found?.version).toBeNull()
    })

    it('should skip expired, failed, edited-draft and other-reader exports', async () => {
      const { workspace, document, version } = await seedSentDocument()
      await seedDocumentExport(document.id, workspace.id, {
        versionId: version.id,
        status: 'READY',
        storageKey: 'expired',
        expiresAt: minutesAgo(1),
      })
      await seedDocumentExport(document.id, workspace.id, {
        versionId: version.id,
        status: 'FAILED',
      })
      await seedDocumentExport(document.id, workspace.id, {
        status: 'READY',
        storageKey: 'old-draft',
        expiresAt: daysFromNow(3),
        createdAt: minutesAgo(10),
      })
      const recipient = await prisma.documentRecipient.create({
        data: {
          documentId: document.id,
          workspaceId: workspace.id,
          name: 'Maria',
          token: 'rcpt-token',
        },
      })
      await seedDocumentExport(document.id, workspace.id, {
        versionId: version.id,
        recipientId: recipient.id,
        status: 'READY',
        storageKey: 'reader',
        expiresAt: daysFromNow(3),
      })

      const versionQuery = {
        documentId: document.id,
        versionId: version.id,
        recipientId: null,
        now: NOW,
        inFlightSince: minutesAgo(15),
      }
      expect(
        expectOk(await DocumentExportRepository.findReusable(versionQuery)),
      ).toBeNull()
      const editedDraft = await DocumentExportRepository.findReusable({
        ...versionQuery,
        versionId: null,
        readySince: minutesAgo(5),
      })
      expect(expectOk(editedDraft)).toBeNull()
      const reader = await DocumentExportRepository.findReusable({
        ...versionQuery,
        recipientId: recipient.id,
      })
      expect(expectOk(reader)?.storageKey).toBe('reader')
    })

    it('should return DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.documentExport, 'findFirst').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentExportRepository.findReusable({
          documentId: 'd',
          versionId: null,
          recipientId: null,
          now: NOW,
          inFlightSince: NOW,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('create() and findById()', () => {
    it('should create a PENDING export and find it inside its scope', async () => {
      const { workspace, document, version, user } = await seedSentDocument()
      const created = expectOk(
        await DocumentExportRepository.create({
          documentId: document.id,
          workspaceId: workspace.id,
          versionId: version.id,
          recipientId: null,
          requestedById: user.id,
        }),
      )
      expect(created).toMatchObject({
        status: 'PENDING',
        requestedById: user.id,
        version: { number: 3 },
      })

      const found = expectOk(
        await DocumentExportRepository.findById(created.id, {
          documentId: document.id,
          workspaceId: workspace.id,
        }),
      )
      expect(found.id).toBe(created.id)

      const other = await seedWorkspace()
      expectErr(
        await DocumentExportRepository.findById(created.id, {
          documentId: document.id,
          workspaceId: other.id,
        }),
        'DOCUMENT_EXPORT_NOT_FOUND',
      )
    })

    it('should return DATABASE_ERROR when create or find fails', async () => {
      vi.spyOn(prisma.documentExport, 'create').mockRejectedValueOnce(
        new Error('boom'),
      )
      vi.spyOn(prisma.documentExport, 'findFirst').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentExportRepository.create({
          documentId: 'd',
          workspaceId: 'w',
          versionId: null,
          recipientId: null,
          requestedById: null,
        }),
        'DATABASE_ERROR',
      )
      expectErr(
        await DocumentExportRepository.findById('e', {
          documentId: 'd',
          workspaceId: 'w',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findRenderJob()', () => {
    it('should load the document, workspace and version to print', async () => {
      const { workspace, document, version } = await seedSentDocument()
      const row = await seedDocumentExport(document.id, workspace.id, {
        versionId: version.id,
      })

      const job = expectOk(await DocumentExportRepository.findRenderJob(row.id))
      expect(job).toMatchObject({
        id: row.id,
        status: 'PENDING',
        document: {
          title: 'Proposta comercial',
          workspace: { name: 'Seed Workspace', logoUrl: null },
        },
        version: { number: 3, settings: { allowDownload: false } },
      })
      expect(
        expectOk(await DocumentExportRepository.findRenderJob('missing')),
      ).toBeNull()
    })

    it('should return DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.documentExport, 'findUnique').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentExportRepository.findRenderJob('e'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('status transitions', () => {
    it('should take a PENDING export once and then mark it READY', async () => {
      const { workspace, document } = await seedSentDocument()
      const row = await seedDocumentExport(document.id, workspace.id)

      const first = await DocumentExportRepository.markRunning(row.id)
      const second = await DocumentExportRepository.markRunning(row.id)
      expect(expectOk(first)).toBe(true)
      expect(expectOk(second)).toBe(false)

      expectOk(
        await DocumentExportRepository.markReady(row.id, {
          storageKey: 'ws/doc/exports/x.pdf',
          sizeBytes: 1234,
          pageCount: 3,
          finishedAt: NOW,
          expiresAt: daysFromNow(7),
        }),
      )
      const ready = await prisma.documentExport.findUniqueOrThrow({
        where: { id: row.id },
      })
      expect(ready).toMatchObject({
        status: 'READY',
        storageKey: 'ws/doc/exports/x.pdf',
        sizeBytes: 1234,
        pageCount: 3,
        error: null,
      })
    })

    it('should mark an export FAILED with the message', async () => {
      const { workspace, document } = await seedSentDocument()
      const row = await seedDocumentExport(document.id, workspace.id)
      expectOk(await DocumentExportRepository.markFailed(row.id, 'Falhou', NOW))
      const failed = await prisma.documentExport.findUniqueOrThrow({
        where: { id: row.id },
      })
      expect(failed).toMatchObject({
        status: 'FAILED',
        error: 'Falhou',
        finishedAt: NOW,
      })
    })

    it('should return DATABASE_ERROR when a transition fails', async () => {
      vi.spyOn(prisma.documentExport, 'updateMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentExportRepository.markRunning('e'),
        'DATABASE_ERROR',
      )
      expectErr(
        await DocumentExportRepository.markReady('missing', {
          storageKey: 'k',
          sizeBytes: 1,
          pageCount: 1,
          finishedAt: NOW,
          expiresAt: NOW,
        }),
        'DATABASE_ERROR',
      )
      expectErr(
        await DocumentExportRepository.markFailed('missing', 'x', NOW),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listPrunable() and deleteMany()', () => {
    it('should list expired and dead exports, then delete them', async () => {
      const { workspace, document } = await seedSentDocument()
      const expired = await seedDocumentExport(document.id, workspace.id, {
        status: 'READY',
        storageKey: 'expired.pdf',
        expiresAt: minutesAgo(1),
      })
      const dead = await seedDocumentExport(document.id, workspace.id, {
        status: 'FAILED',
        createdAt: daysFromNow(-8),
      })
      await seedDocumentExport(document.id, workspace.id, {
        status: 'READY',
        storageKey: 'fresh.pdf',
        expiresAt: daysFromNow(2),
      })
      await seedDocumentExport(document.id, workspace.id, {
        status: 'PENDING',
        createdAt: minutesAgo(5),
      })

      const rows = expectOk(
        await DocumentExportRepository.listPrunable(NOW, daysFromNow(-7)),
      )
      expect(rows).toEqual(
        expect.arrayContaining([
          { id: expired.id, storageKey: 'expired.pdf' },
          { id: dead.id, storageKey: null },
        ]),
      )
      expect(rows).toHaveLength(2)

      const ids = rows.map((r) => r.id)
      expect(expectOk(await DocumentExportRepository.deleteMany(ids))).toBe(2)
      expect(await prisma.documentExport.count()).toBe(2)
    })

    it('should not query for an empty delete', async () => {
      const spy = vi.spyOn(prisma.documentExport, 'deleteMany')
      expect(expectOk(await DocumentExportRepository.deleteMany([]))).toBe(0)
      expect(spy).not.toHaveBeenCalled()
    })

    it('should return DATABASE_ERROR when list or delete fails', async () => {
      vi.spyOn(prisma.documentExport, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      vi.spyOn(prisma.documentExport, 'deleteMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentExportRepository.listPrunable(NOW, NOW),
        'DATABASE_ERROR',
      )
      expectErr(
        await DocumentExportRepository.deleteMany(['e']),
        'DATABASE_ERROR',
      )
    })
  })

  describe('recordDownload()', () => {
    it('should add PDF_DOWNLOADED to the timeline', async () => {
      const { workspace, document } = await seedSentDocument()
      expectOk(
        await DocumentExportRepository.recordDownload({
          documentId: document.id,
          workspaceId: workspace.id,
          recipientId: null,
          exportId: 'exp-1',
          versionNumber: 3,
        }),
      )
      const events = await prisma.documentEvent.findMany({
        where: { documentId: document.id },
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'PDF_DOWNLOADED',
        data: { exportId: 'exp-1', versionNumber: 3 },
      })
    })

    it('should return DATABASE_ERROR when the insert fails', async () => {
      vi.spyOn(prisma.documentEvent, 'create').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await DocumentExportRepository.recordDownload({
          documentId: 'd',
          workspaceId: 'w',
          recipientId: null,
          exportId: 'e',
          versionNumber: null,
        }),
        'DATABASE_ERROR',
      )
    })
  })
})
