import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getObjectStream: vi.fn() }))
vi.mock('@/src/lib/storage/s3', () => ({
  getObjectStream: mocks.getObjectStream,
}))

import {
  hostOf,
  isAllowedPrintRequest,
} from '@/src/lib/document-export/print-network'
import { parseDocumentSettings } from '@/src/lib/document-export/settings'
import {
  DOCUMENTS_BUCKET,
  documentExportStorageKey,
  documentPdfFileName,
} from '@/src/lib/document-export/storage'
import { streamDocumentPdf } from '@/src/lib/document-export/stream'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'

describe('isAllowedPrintRequest', () => {
  it.each([
    'https://cdn.example.com/logo.png',
    'http://fonts.gstatic.com/s/inter.woff2',
    'https://8.8.8.8/pixel.png',
    'https://172.32.0.1/x.png',
    'https://100.128.0.1/x.png',
    'data:image/png;base64,AAAA',
    'blob:https://app.steel.test/uuid',
    'about:blank',
  ])('should allow %s', (url) => {
    expect(isAllowedPrintRequest(url)).toBe(true)
  })

  it.each([
    'http://localhost:3001/api',
    'http://app.localhost/x',
    'http://printer.local/x',
    'http://metadata.google.internal/computeMetadata',
    'http://steel-minio:9000/documents/a.pdf',
    'http://127.0.0.1/x',
    'http://10.10.100.31/x',
    'http://172.16.0.5/x',
    'http://192.168.0.10/x',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/x',
    'http://0.0.0.0/x',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'file:///etc/passwd',
    'ftp://example.com/a',
    'not a url',
  ])('should block %s', (url) => {
    expect(isAllowedPrintRequest(url)).toBe(false)
  })

  it('should treat four non-numeric labels as a name, not an IP', () => {
    // The URL parser itself rejects out-of-range IPv4 hosts.
    expect(isAllowedPrintRequest('http://999.1.1.1/x')).toBe(false)
    expect(isAllowedPrintRequest('http://cdn.a.b.example/x')).toBe(true)
  })

  it('should allow the trusted hosts even when they look internal', () => {
    const trusted = ['minio']
    expect(isAllowedPrintRequest('http://minio:9000/a.png', trusted)).toBe(true)
  })
})

describe('hostOf', () => {
  it('should return the lower-case host or null', () => {
    expect(hostOf('https://Media.Steel.test/media')).toBe('media.steel.test')
    expect(hostOf(undefined)).toBeNull()
    expect(hostOf('')).toBeNull()
    expect(hostOf('::not-a-url')).toBeNull()
  })
})

describe('document export storage', () => {
  it('should build the key under the workspace and document', () => {
    expect(DOCUMENTS_BUCKET).toBe('documents')
    expect(documentExportStorageKey('ws', 'doc', 'exp')).toBe(
      'ws/doc/exports/exp.pdf',
    )
  })

  it('should slug the title into the file name', () => {
    expect(documentPdfFileName('Proposta Comercial — Ação 2027')).toBe(
      'proposta-comercial-acao-2027.pdf',
    )
    expect(documentPdfFileName('???')).toBe('documento.pdf')
  })
})

describe('parseDocumentSettings', () => {
  it('should apply defaults and fall back on invalid settings', () => {
    expect(parseDocumentSettings(null)).toEqual(DEFAULT_DOCUMENT_SETTINGS)
    expect(parseDocumentSettings({ allowDownload: false })).toEqual({
      ...DEFAULT_DOCUMENT_SETTINGS,
      allowDownload: false,
    })
    expect(parseDocumentSettings({ layout: 'circus' })).toEqual(
      DEFAULT_DOCUMENT_SETTINGS,
    )
  })
})

describe('streamDocumentPdf', () => {
  beforeEach(() => mocks.getObjectStream.mockReset())

  it('should stream the PDF as an attachment', async () => {
    mocks.getObjectStream.mockResolvedValue({
      body: new Blob(['%PDF-1.7']).stream(),
      contentLength: 8,
      contentType: 'application/pdf',
    })
    const res = await streamDocumentPdf({
      bucket: 'documents',
      key: 'ws/doc/exports/exp.pdf',
      fileName: 'proposta.pdf',
      sizeBytes: 8,
    })
    expect(mocks.getObjectStream).toHaveBeenCalledWith({
      bucket: 'documents',
      key: 'ws/doc/exports/exp.pdf',
    })
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="proposta.pdf"',
    )
    expect(res.headers.get('Content-Length')).toBe('8')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.text()).toBe('%PDF-1.7')
  })

  it('should omit the length when the store does not give it', async () => {
    mocks.getObjectStream.mockResolvedValue({
      body: new Blob(['x']).stream(),
      contentLength: undefined,
      contentType: undefined,
    })
    const res = await streamDocumentPdf({
      bucket: 'documents',
      key: 'k',
      fileName: 'a.pdf',
      sizeBytes: null,
    })
    expect(res.headers.get('Content-Length')).toBeNull()
  })
})
