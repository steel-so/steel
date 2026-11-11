import { describe, expect, it } from 'vitest'
import {
  createFakeDocumentExport,
  createFakeReadyDocumentExport,
} from '@/src/__tests__/factories/document-pdf.factory'
import { toDocumentExportDTO } from '../document-export.mapper'

describe('toDocumentExportDTO', () => {
  it('should map a READY export with its version and download URL', () => {
    const row = createFakeReadyDocumentExport({ version: { number: 4 } })
    expect(toDocumentExportDTO(row, '/download')).toEqual({
      id: row.id,
      status: 'READY',
      versionNumber: 4,
      sizeBytes: 2048,
      pageCount: 2,
      error: null,
      downloadUrl: '/download',
      createdAt: '2026-11-11T12:00:00.000Z',
      finishedAt: '2026-11-11T12:00:05.000Z',
    })
  })

  it('should map a draft export still in progress', () => {
    const row = createFakeDocumentExport({ versionId: null, version: null })
    expect(toDocumentExportDTO(row, null)).toMatchObject({
      status: 'PENDING',
      versionNumber: null,
      downloadUrl: null,
      finishedAt: null,
    })
  })
})
