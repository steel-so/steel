import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiError,
  apiSuccess,
  getFetchCall,
  mockFetch,
  renderWithProviders,
} from '@/src/__tests__/helpers/component'
import {
  EXPORT_FAILED_MESSAGE,
  EXPORT_READY_MESSAGE,
  EXPORT_SLOW_MESSAGE,
  fileNameFromDisposition,
  requestPublicDocumentPdf,
} from '@/src/hooks/use-document-exports'
import type { DocumentExportDTO } from '@/types/document'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

import { DocumentExportButton } from '../document-export-button'

const EXPORTS = '/api/workspaces/ws-1/crm/documents/doc-1/exports'

function exportDto(overrides: Partial<DocumentExportDTO> = {}) {
  return {
    id: 'exp-1',
    status: 'PENDING',
    versionNumber: 2,
    sizeBytes: null,
    pageCount: null,
    error: null,
    downloadUrl: null,
    createdAt: '2026-11-11T12:00:00.000Z',
    finishedAt: null,
    ...overrides,
  } satisfies DocumentExportDTO
}

const READY = exportDto({
  status: 'READY',
  sizeBytes: 2048,
  pageCount: 2,
  downloadUrl: `${EXPORTS}/exp-1/download`,
  finishedAt: '2026-11-11T12:00:04.000Z',
})

let clicks: { href: string | null; download: string }[] = []

function recordClick(this: HTMLAnchorElement) {
  clicks.push({ href: this.getAttribute('href'), download: this.download })
}

beforeEach(() => {
  clicks = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(recordClick)
})

const findButton = (name: string) =>
  screen.findByRole<HTMLButtonElement>('button', { name })

function renderButton(hasVersion = true) {
  return renderWithProviders(
    <DocumentExportButton
      workspaceId='ws-1'
      documentId='doc-1'
      hasVersion={hasVersion}
    />,
  )
}

describe('DocumentExportButton', () => {
  it('should export the sent version, wait for it and download it', async () => {
    const fetchSpy = mockFetch()
      .mockResolvedValueOnce(apiSuccess(exportDto(), 201))
      .mockResolvedValue(apiSuccess(READY))
    const { user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Exportar PDF' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(EXPORT_READY_MESSAGE),
    )
    expect(getFetchCall(fetchSpy, 0)).toEqual({
      url: EXPORTS,
      method: 'POST',
      body: { draft: false },
    })
    expect(getFetchCall(fetchSpy, 1).url).toBe(`${EXPORTS}/exp-1`)
    expect(clicks).toEqual([{ href: READY.downloadUrl, download: '' }])
    expect((await findButton('Exportar PDF')).disabled).toBe(false)
  })

  it('should show progress while the PDF renders', async () => {
    mockFetch()
      .mockResolvedValueOnce(apiSuccess(exportDto(), 201))
      .mockResolvedValue(apiSuccess(exportDto({ status: 'RUNNING' })))
    const { user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Exportar PDF' }))

    const busy = await findButton('Gerando PDF…')
    expect(busy.disabled).toBe(true)
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(clicks).toEqual([])
  })

  it('should export the draft when the document was never sent', async () => {
    const fetchSpy = mockFetch()
      .mockResolvedValueOnce(apiSuccess(READY, 201))
      .mockResolvedValue(apiSuccess(READY))
    const { user } = renderButton(false)

    const button = await findButton('Exportar PDF')
    expect(button.getAttribute('title')).toBe('Baixar o rascunho em PDF')
    await user.click(button)

    await waitFor(() => expect(clicks).toHaveLength(1))
    expect(getFetchCall(fetchSpy, 0).body).toEqual({ draft: true })
  })

  it('should toast the message of a failed render', async () => {
    const message = 'Demorou demais. Tente de novo.'
    const failed = exportDto({ status: 'FAILED', error: message })
    mockFetch()
      .mockResolvedValueOnce(apiSuccess(exportDto(), 201))
      .mockResolvedValue(apiSuccess(failed))
    const { user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Exportar PDF' }))

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(message))
    expect(clicks).toEqual([])
    expect((await findButton('Exportar PDF')).disabled).toBe(false)
  })

  it('should fall back to a generic message for a READY export without URL', async () => {
    mockFetch()
      .mockResolvedValueOnce(apiSuccess(exportDto(), 201))
      .mockResolvedValue(apiSuccess({ ...READY, downloadUrl: null }))
    const { user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Exportar PDF' }))

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(EXPORT_FAILED_MESSAGE),
    )
  })

  it('should toast the API error when the export cannot start', async () => {
    mockFetch().mockResolvedValueOnce(
      apiError(403, 'Você não tem permissão para este documento', 'FORBIDDEN'),
    )
    const { user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Exportar PDF' }))

    await waitFor(() => expect(notify.error).toHaveBeenCalledTimes(1))
    const [error, fallback] = notify.error.mock.calls[0]
    expect((error as Error).message).toBe(
      'Você não tem permissão para este documento',
    )
    expect(fallback).toBe(EXPORT_FAILED_MESSAGE)
  })

  it('should toast when following the export fails', async () => {
    mockFetch()
      .mockResolvedValueOnce(apiSuccess(exportDto(), 201))
      .mockResolvedValue(apiError(404, 'Exportação não encontrada'))
    const { user } = renderButton()

    await user.click(screen.getByRole('button', { name: 'Exportar PDF' }))

    await waitFor(() => expect(notify.error).toHaveBeenCalledTimes(1))
    expect((notify.error.mock.calls[0][0] as Error).message).toBe(
      'Exportação não encontrada',
    )
  })
})

describe('requestPublicDocumentPdf', () => {
  const noWait = async () => undefined

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:pdf'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  function pdfResponse(disposition?: string) {
    return new Response('%PDF-1.7', {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        ...(disposition && { 'Content-Disposition': disposition }),
      },
    })
  }

  it('should poll while the PDF renders, then download the file', async () => {
    const fetchSpy = mockFetch()
      .mockResolvedValueOnce(
        apiSuccess({ status: 'PENDING', exportId: 'exp 1' }, 202),
      )
      .mockResolvedValueOnce(
        apiSuccess({ status: 'RUNNING', exportId: 'exp 1' }, 202),
      )
      .mockResolvedValueOnce(
        pdfResponse('attachment; filename="proposta-acme.pdf"'),
      )

    const result = await requestPublicDocumentPdf('tok/1', { wait: noWait })

    expect(result).toEqual({ ok: true })
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/documents/tok%2F1/pdf',
      '/api/documents/tok%2F1/pdf?exportId=exp%201',
      '/api/documents/tok%2F1/pdf?exportId=exp%201',
    ])
    expect(clicks).toEqual([
      { href: 'blob:pdf', download: 'proposta-acme.pdf' },
    ])
  })

  it('should name the file "documento.pdf" without a header', async () => {
    mockFetch().mockResolvedValueOnce(pdfResponse())
    expect(await requestPublicDocumentPdf('tok', { wait: noWait })).toEqual({
      ok: true,
    })
    expect(clicks[0]?.download).toBe('documento.pdf')
  })

  it('should return the API message when the download is refused', async () => {
    mockFetch().mockResolvedValueOnce(
      apiError(
        403,
        'O download deste documento está desativado',
        'DOCUMENT_DOWNLOAD_DISABLED',
      ),
    )
    expect(await requestPublicDocumentPdf('tok')).toEqual({
      ok: false,
      message: 'O download deste documento está desativado',
    })
  })

  it('should fall back to a generic message on an unreadable error', async () => {
    mockFetch().mockResolvedValueOnce(new Response('oops', { status: 500 }))
    expect(await requestPublicDocumentPdf('tok')).toEqual({
      ok: false,
      message: EXPORT_FAILED_MESSAGE,
    })
  })

  it('should give up after the timeout', async () => {
    mockFetch().mockResolvedValue(
      apiSuccess({ status: 'PENDING', exportId: 'exp-1' }, 202),
    )
    expect(
      await requestPublicDocumentPdf('tok', { timeoutMs: -1, wait: noWait }),
    ).toEqual({ ok: false, message: EXPORT_SLOW_MESSAGE })
  })

  it('should report a network failure', async () => {
    mockFetch().mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const result = await requestPublicDocumentPdf('tok')
    expect(result.ok).toBe(false)
  })
})

describe('fileNameFromDisposition', () => {
  it('should read the file name of the header', () => {
    expect(fileNameFromDisposition('attachment; filename="a b.pdf"')).toBe(
      'a b.pdf',
    )
    expect(fileNameFromDisposition('attachment; filename=c.pdf')).toBe('c.pdf')
    expect(fileNameFromDisposition('attachment')).toBeNull()
    expect(fileNameFromDisposition(null)).toBeNull()
  })
})
