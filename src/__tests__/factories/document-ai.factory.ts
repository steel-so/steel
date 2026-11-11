import { createId } from '@paralleldrive/cuid2'
import type { DocumentImport, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

/** AI import of CRM > Documentos (docs-ai slice). */
export function createFakeDocumentImport(
  overrides?: Partial<DocumentImport>,
): DocumentImport {
  return {
    id: createId(),
    workspaceId: createId(),
    documentId: null,
    mode: 'PDF',
    status: 'PENDING',
    kind: 'OTHER',
    fileKey: null,
    fileName: null,
    fileSize: null,
    pageCount: null,
    prompt: null,
    progress: {},
    model: null,
    costUsd: null,
    error: null,
    createdById: createId(),
    createdAt: new Date(),
    finishedAt: null,
    ...overrides,
  }
}

export async function seedDocumentImport(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      DocumentImport,
      'mode' | 'status' | 'kind' | 'fileKey' | 'fileName' | 'prompt'
    >
  > & { progress?: Prisma.InputJsonValue },
) {
  return prisma.documentImport.create({
    data: { workspaceId, createdById, mode: 'PDF', ...overrides },
  })
}
