import { createId } from '@paralleldrive/cuid2'
import type { Document, DocumentExport, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  DocumentExportRow,
  ExportRenderJob,
} from '@/src/repositories/document-export.repository'

/** documents-pdf: factories of the PDF export (ADR 0063). */

export const FAKE_CANVAS_CONTENT = {
  version: 1,
  root: 'root',
  nodes: { root: { id: 'root', type: 'document', props: {}, children: [] } },
} as const

export function createFakeDocumentExport(
  overrides?: Partial<DocumentExportRow>,
): DocumentExportRow {
  const now = new Date('2026-11-11T12:00:00.000Z')
  return {
    id: createId(),
    documentId: createId(),
    workspaceId: createId(),
    versionId: createId(),
    status: 'PENDING',
    storageKey: null,
    sizeBytes: null,
    pageCount: null,
    error: null,
    requestedById: createId(),
    recipientId: null,
    createdAt: now,
    finishedAt: null,
    expiresAt: null,
    version: { number: 1 },
    ...overrides,
  }
}

export function createFakeReadyDocumentExport(
  overrides?: Partial<DocumentExportRow>,
): DocumentExportRow {
  const base = createFakeDocumentExport(overrides)
  return {
    ...base,
    status: 'READY',
    storageKey: `${base.workspaceId}/${base.documentId}/exports/${base.id}.pdf`,
    sizeBytes: 2048,
    pageCount: 2,
    finishedAt: new Date('2026-11-11T12:00:05.000Z'),
    expiresAt: new Date('2026-11-18T12:00:05.000Z'),
    ...overrides,
  }
}

export function createFakeRenderJob(
  overrides?: Partial<ExportRenderJob>,
): ExportRenderJob {
  const row = createFakeDocumentExport()
  const { version: _version, ...exportRow } = row
  return {
    ...exportRow,
    document: {
      title: 'Proposta comercial',
      content: FAKE_CANVAS_CONTENT as unknown as Prisma.JsonValue,
      theme: { primary: '#0f172a' },
      settings: {},
      validUntil: new Date('2026-11-30T02:59:59.999Z'),
      workspace: { name: 'Stratus Telecom', logoUrl: null },
    },
    version: {
      number: 1,
      content: FAKE_CANVAS_CONTENT as unknown as Prisma.JsonValue,
      theme: {},
      settings: { pageSize: 'LETTER', orientation: 'landscape' },
    },
    ...overrides,
  }
}

export async function seedDocument(
  workspaceId: string,
  ownerId: string,
  overrides?: Partial<
    Pick<
      Document,
      | 'title'
      | 'currentVersionId'
      | 'linkEnabled'
      | 'status'
      | 'deletedAt'
      | 'publicToken'
      | 'validUntil'
    >
  > & { settings?: Prisma.InputJsonValue },
) {
  return prisma.document.create({
    data: {
      workspaceId,
      ownerId,
      createdById: ownerId,
      title: 'Proposta comercial',
      content: FAKE_CANVAS_CONTENT,
      publicToken: `pub-${createId()}`,
      ...overrides,
    },
  })
}

export async function seedDocumentVersion(
  documentId: string,
  workspaceId: string,
  overrides?: { number?: number; settings?: Prisma.InputJsonValue },
) {
  return prisma.documentVersion.create({
    data: {
      documentId,
      workspaceId,
      number: overrides?.number ?? 1,
      content: FAKE_CANVAS_CONTENT,
      settings: overrides?.settings ?? {},
      sha256: createId(),
    },
  })
}

export async function seedDocumentExport(
  documentId: string,
  workspaceId: string,
  overrides?: Partial<
    Pick<
      DocumentExport,
      | 'versionId'
      | 'recipientId'
      | 'status'
      | 'storageKey'
      | 'expiresAt'
      | 'createdAt'
      | 'requestedById'
    >
  >,
) {
  return prisma.documentExport.create({
    data: { documentId, workspaceId, versionId: null, ...overrides },
  })
}
