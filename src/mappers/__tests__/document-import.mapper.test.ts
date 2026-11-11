import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { createFakeDocumentImport } from '@/src/__tests__/factories/document-ai.factory'
import { toDocumentImportDTO } from '../document-import.mapper'

describe('toDocumentImportDTO()', () => {
  it('should map a finished import', () => {
    const row = createFakeDocumentImport({
      id: 'imp1',
      mode: 'DOCX',
      status: 'READY',
      kind: 'CONTRACT',
      fileName: 'contrato.docx',
      fileKey: 'ws/imports/imp1/contrato.docx',
      progress: { step: 'done', message: 'Pronto', pct: 100 },
      documentId: 'doc1',
      costUsd: new Prisma.Decimal('0.042317'),
      createdAt: new Date('2026-11-11T13:00:00.000Z'),
      finishedAt: new Date('2026-11-11T13:01:30.000Z'),
    })

    expect(toDocumentImportDTO(row)).toEqual({
      id: 'imp1',
      mode: 'DOCX',
      status: 'READY',
      kind: 'CONTRACT',
      fileName: 'contrato.docx',
      progress: { step: 'done', message: 'Pronto', pct: 100 },
      documentId: 'doc1',
      error: null,
      costUsd: 0.042317,
      createdAt: '2026-11-11T13:00:00.000Z',
      finishedAt: '2026-11-11T13:01:30.000Z',
    })
  })

  it('should map a pending import and ignore malformed progress', () => {
    const dto = toDocumentImportDTO(
      createFakeDocumentImport({ progress: ['not', 'an', 'object'] }),
    )

    expect(dto.progress).toEqual({})
    expect(dto.costUsd).toBeNull()
    expect(dto.finishedAt).toBeNull()
    expect(dto).not.toHaveProperty('fileKey')
  })

  it('should keep only the known progress fields', () => {
    const dto = toDocumentImportDTO(
      createFakeDocumentImport({
        progress: { step: 'reading', pct: '10', extra: true },
      }),
    )

    expect(dto.progress).toEqual({ step: 'reading' })
  })
})
