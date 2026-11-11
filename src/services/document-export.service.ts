import type { z } from 'zod'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  documentDownloadDisabled,
  documentExportFailed,
  documentExportNotFound,
  documentLinkUnavailable,
  storageError,
} from '@/src/errors/app-error'
import { parseDocumentSettings } from '@/src/lib/document-export/settings'
import {
  DOCUMENTS_BUCKET,
  type DocumentExportFile,
  documentPdfFileName,
} from '@/src/lib/document-export/storage'
import { enqueueDocumentPdfRender } from '@/src/lib/queue/documents-pdf'
import { DocumentExportRetentionMs } from '@/src/lib/queue/retention'
import { err, ok, type Result } from '@/src/lib/result'
import { deleteObjects } from '@/src/lib/storage/s3'
import { toDocumentExportDTO } from '@/src/mappers/document-export.mapper'
import {
  type DocumentExportRow,
  DocumentExportRepository,
} from '@/src/repositories/document-export.repository'
import type { CreateDocumentExportSchema } from '@/src/schemas/document.schema'
import type { DocumentExportDTO } from '@/types/document'
import { assertModuleEnabled, assertModuleMember } from './authz'
import { resolveDocumentToken } from './document-access'

/**
 * PDF export of CRM > Documentos (ADR 0063). The owner side exports the
 * draft or the current version; the public link downloads the current
 * version when the document allows it. The worker (`documents-pdf`) prints
 * the file; this service creates, reuses, authorizes and prunes exports.
 */

export type CreateDocumentExportInput = z.output<
  typeof CreateDocumentExportSchema
>

export type PublicDocumentPdf =
  | { kind: 'pending'; exportId: string; status: 'PENDING' | 'RUNNING' }
  | { kind: 'ready'; exportId: string; file: DocumentExportFile }

/** An export still PENDING/RUNNING after this long is treated as dead. */
export const EXPORT_IN_FLIGHT_MS = 15 * 60 * 1000

const VIEW = { resource: 'documents', action: 'VIEW' } as const

function exportDownloadPath(
  workspaceId: string,
  documentId: string,
  exportId: string,
): string {
  return `/api/workspaces/${workspaceId}/crm/documents/${documentId}/exports/${exportId}/download`
}

function isDownloadable(row: DocumentExportRow, now: Date): boolean {
  return (
    row.status === 'READY' &&
    row.storageKey !== null &&
    row.expiresAt !== null &&
    row.expiresAt > now
  )
}

function toDTO(row: DocumentExportRow, now: Date): DocumentExportDTO {
  return toDocumentExportDTO(
    row,
    isDownloadable(row, now)
      ? exportDownloadPath(row.workspaceId, row.documentId, row.id)
      : null,
  )
}

/** Creates the row and queues the render; a queue failure marks it FAILED. */
async function createAndEnqueue(data: {
  documentId: string
  workspaceId: string
  versionId: string | null
  recipientId: string | null
  requestedById: string | null
}): Promise<Result<DocumentExportRow>> {
  const created = await DocumentExportRepository.create(data)
  if (!created.ok) return created

  try {
    await enqueueDocumentPdfRender(created.value.id)
  } catch (error) {
    logger.error('document_export.enqueue_failed', {
      component: 'DocumentExportService',
      exportId: created.value.id,
      documentId: data.documentId,
      message: error instanceof Error ? error.message : String(error),
    })
    await DocumentExportRepository.markFailed(
      created.value.id,
      documentExportFailed().message,
      new Date(),
    )
    return err(documentExportFailed())
  }
  return created
}

export const DocumentExportService = {
  /** Owner export: the current version, or the draft (`draft` / never sent). */
  async create(
    actorId: string,
    workspaceId: string,
    documentId: string,
    input: CreateDocumentExportInput,
  ): Promise<Result<DocumentExportDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'CRM',
      VIEW,
    )
    if (!membership.ok) return membership

    const document = await DocumentExportRepository.findDocument(
      documentId,
      workspaceId,
    )
    if (!document.ok) return document

    const versionId = input.draft ? null : document.value.currentVersionId
    const now = new Date()
    const inFlightSince = new Date(now.getTime() - EXPORT_IN_FLIGHT_MS)
    // A draft changes on every autosave: only an export newer than the last
    // edit still matches it.
    const editedAt = versionId ? null : document.value.updatedAt
    const reusable = await DocumentExportRepository.findReusable({
      documentId,
      versionId,
      recipientId: null,
      now,
      ...(editedAt && { readySince: editedAt }),
      inFlightSince:
        editedAt && editedAt > inFlightSince ? editedAt : inFlightSince,
    })
    if (!reusable.ok) return reusable
    if (reusable.value) return ok(toDTO(reusable.value, now))

    const created = await createAndEnqueue({
      documentId,
      workspaceId,
      versionId,
      recipientId: null,
      requestedById: actorId,
    })
    if (!created.ok) {
      auditMutation({
        entity: 'document_export',
        action: 'create',
        actorId,
        targetId: documentId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }

    auditMutation({
      entity: 'document_export',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, documentId, draft: versionId === null },
    })
    return ok(toDTO(created.value, now))
  },

  async get(
    actorId: string,
    workspaceId: string,
    documentId: string,
    exportId: string,
  ): Promise<Result<DocumentExportDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'CRM',
      VIEW,
    )
    if (!membership.ok) return membership

    const document = await DocumentExportRepository.findDocument(
      documentId,
      workspaceId,
    )
    if (!document.ok) return document

    const row = await DocumentExportRepository.findById(exportId, {
      documentId,
      workspaceId,
    })
    if (!row.ok) return row
    return ok(toDTO(row.value, new Date()))
  },

  /** Owner download: a READY export inside retention, streamed by the route. */
  async authorizeDownload(
    actorId: string,
    workspaceId: string,
    documentId: string,
    exportId: string,
  ): Promise<Result<DocumentExportFile>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'CRM',
      VIEW,
    )
    if (!membership.ok) return membership

    const document = await DocumentExportRepository.findDocument(
      documentId,
      workspaceId,
    )
    if (!document.ok) return document

    const row = await DocumentExportRepository.findById(exportId, {
      documentId,
      workspaceId,
    })
    if (!row.ok) return row
    if (!isDownloadable(row.value, new Date())) {
      return err(documentExportNotFound())
    }

    auditMutation({
      entity: 'document_export',
      action: 'export',
      actorId,
      targetId: exportId,
      meta: { workspaceId, documentId },
    })
    return ok({
      bucket: DOCUMENTS_BUCKET,
      key: row.value.storageKey as string,
      fileName: documentPdfFileName(document.value.title),
      sizeBytes: row.value.sizeBytes,
    })
  },

  /**
   * Public link (`GET /api/documents/<token>/pdf`): without `exportId`,
   * reuses or queues the export of the current version for this reader;
   * with it, polls that export. A READY export is a download (timeline
   * event `PDF_DOWNLOADED`).
   */
  async requestPublicPdf(
    token: string,
    exportId: string | null,
  ): Promise<Result<PublicDocumentPdf>> {
    const resolved = await resolveDocumentToken(token)
    if (!resolved.ok) return resolved
    const { documentId, workspaceId, recipientId, versionId } = resolved.value
    if (!versionId) return err(documentLinkUnavailable())

    const enabled = await assertModuleEnabled(workspaceId, 'CRM')
    if (!enabled.ok) return enabled

    const target = await DocumentExportRepository.findVersionTarget(
      documentId,
      versionId,
    )
    if (!target.ok) return target
    const { document, version } = target.value
    if (
      !parseDocumentSettings(document.settings).allowDownload ||
      !parseDocumentSettings(version.settings).allowDownload
    ) {
      return err(documentDownloadDisabled())
    }

    const now = new Date()
    let row: DocumentExportRow
    if (exportId) {
      const found = await DocumentExportRepository.findById(exportId, {
        documentId,
        workspaceId,
      })
      if (!found.ok) return found
      // Another reader's export, or one of an older version.
      if (
        found.value.versionId !== versionId ||
        found.value.recipientId !== recipientId
      ) {
        return err(documentExportNotFound())
      }
      row = found.value
    } else {
      const reusable = await DocumentExportRepository.findReusable({
        documentId,
        versionId,
        recipientId,
        now,
        inFlightSince: new Date(now.getTime() - EXPORT_IN_FLIGHT_MS),
      })
      if (!reusable.ok) return reusable
      if (reusable.value) {
        row = reusable.value
      } else {
        const created = await createAndEnqueue({
          documentId,
          workspaceId,
          versionId,
          recipientId,
          requestedById: null,
        })
        if (!created.ok) return created
        row = created.value
      }
    }

    if (row.status === 'FAILED') {
      return err(documentExportFailed(row.error ?? undefined))
    }
    if (row.status === 'PENDING' || row.status === 'RUNNING') {
      return ok({ kind: 'pending', exportId: row.id, status: row.status })
    }
    if (!isDownloadable(row, now)) return err(documentExportNotFound())

    const event = await DocumentExportRepository.recordDownload({
      documentId,
      workspaceId,
      recipientId,
      exportId: row.id,
      versionNumber: version.number,
    })
    if (!event.ok) {
      logger.warn('document_export.download_event_failed', {
        component: 'DocumentExportService',
        exportId: row.id,
        documentId,
      })
    }
    return ok({
      kind: 'ready',
      exportId: row.id,
      file: {
        bucket: DOCUMENTS_BUCKET,
        key: row.storageKey as string,
        fileName: documentPdfFileName(document.title),
        sizeBytes: row.sizeBytes,
      },
    })
  },

  /** Daily retention: deletes expired and dead exports (file + row). */
  async pruneExpired(
    now: Date,
  ): Promise<Result<{ deleted: number; files: number }>> {
    const rows = await DocumentExportRepository.listPrunable(
      now,
      new Date(now.getTime() - DocumentExportRetentionMs),
    )
    if (!rows.ok) return rows

    const keys = rows.value
      .map((row) => row.storageKey)
      .filter((key): key is string => key !== null)
    if (keys.length > 0) {
      try {
        await deleteObjects(DOCUMENTS_BUCKET, keys)
      } catch (error) {
        logger.error('document_export.prune_storage_failed', {
          component: 'DocumentExportService',
          files: keys.length,
          message: error instanceof Error ? error.message : String(error),
        })
        return err(storageError('Failed to delete expired document PDFs'))
      }
    }

    const deleted = await DocumentExportRepository.deleteMany(
      rows.value.map((row) => row.id),
    )
    if (!deleted.ok) return deleted

    auditMutation({
      entity: 'document_export',
      action: 'prune',
      actorId: null,
      meta: { deleted: deleted.value, files: keys.length },
    })
    return ok({ deleted: deleted.value, files: keys.length })
  },
}
