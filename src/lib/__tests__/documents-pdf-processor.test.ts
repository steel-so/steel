import type { Job } from 'bullmq'
import { PDFDocument } from 'pdf-lib'
import type { Browser } from 'playwright-core'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createFakeRenderJob } from '@/src/__tests__/factories/document-pdf.factory'
import { databaseError, storageError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

const mocks = vi.hoisted(() => ({
  repo: {
    findRenderJob: vi.fn(),
    markRunning: vi.fn(),
    markReady: vi.fn(),
    markFailed: vi.fn(),
  },
  forDocument: vi.fn(),
  render: vi.fn(),
  s3: { ensureBucket: vi.fn(), putObject: vi.fn() },
  pruneExpired: vi.fn(),
  launch: vi.fn(),
  env: {
    CHROMIUM_PATH: '/usr/bin/chromium' as string | undefined,
    MINIO_PUBLIC_URL: 'https://media.steel.test' as string | undefined,
    BETTER_AUTH_URL: 'https://app.steel.test',
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/repositories/document-export.repository', () => ({
  DocumentExportRepository: mocks.repo,
}))
vi.mock('@/src/services/document-variables.service', () => ({
  DocumentVariablesService: { forDocument: mocks.forDocument },
}))
vi.mock('@/src/lib/canvas-document/render', () => ({
  renderDocumentHtml: mocks.render,
}))
vi.mock('@/src/lib/storage/s3', () => mocks.s3)
vi.mock('@/src/services/document-export.service', () => ({
  DocumentExportService: { pruneExpired: mocks.pruneExpired },
}))
vi.mock('@/lib/env/server', () => mocks.env)
vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))
vi.mock('playwright-core', () => ({ chromium: { launch: mocks.launch } }))

import { DocumentsPdfJob } from '@/src/lib/queue/jobs'
import {
  EXPORT_FAILED_MESSAGE,
  EXPORT_TIMEOUT_MESSAGE,
  handleDocumentsPdfJob,
  LAUNCH_TIMEOUT_MS,
  PrintTimeoutError,
  printPageOptions,
  processDocumentsPdf,
  RENDER_TIMEOUT_MS,
  renderDocumentExport,
  trustedPrintHosts,
} from '@/src/lib/queue/processors/documents-pdf'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'

const NOW = new Date('2026-11-11T12:00:00.000Z')
const VARIABLES = { 'destinatario.nome': 'Maria Souza' }

let PDF_BYTES: Uint8Array

beforeAll(async () => {
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.addPage()
  PDF_BYTES = await doc.save()
})

type RouteHandler = (route: {
  request: () => { url: () => string }
  continue: () => Promise<void>
  abort: (code: string) => Promise<void>
}) => unknown

function fakeBrowser() {
  const handlers: RouteHandler[] = []
  const page = {
    setDefaultTimeout: vi.fn(),
    route: vi.fn(async (_pattern: string, handler: RouteHandler) => {
      handlers.push(handler)
    }),
    emulateMedia: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    pdf: vi.fn(async () => PDF_BYTES),
  }
  const context = { newPage: vi.fn(async () => page) }
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  }
  return {
    page,
    context,
    browser,
    handlers,
    launch: vi.fn(async () => browser as unknown as Browser),
  }
}

function job(name: string, data: unknown = {}): Job {
  return { id: 'job-1', name, data } as unknown as Job
}

beforeEach(() => {
  mocks.env.CHROMIUM_PATH = '/usr/bin/chromium'
  mocks.env.MINIO_PUBLIC_URL = 'https://media.steel.test'
  mocks.repo.markRunning.mockResolvedValue(ok(true))
  mocks.repo.markReady.mockResolvedValue(ok(undefined))
  mocks.repo.markFailed.mockResolvedValue(ok(undefined))
  mocks.forDocument.mockResolvedValue(ok(VARIABLES))
  mocks.render.mockReturnValue('<!doctype html><html></html>')
  mocks.s3.ensureBucket.mockResolvedValue(undefined)
  mocks.s3.putObject.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('renderDocumentExport', () => {
  it('should print the sent version and store the PDF', async () => {
    const renderJob = createFakeRenderJob({ recipientId: 'rcpt-1' })
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    const chromium = fakeBrowser()
    const now = vi
      .fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValue(new Date(NOW.getTime() + 4000))

    const result = await renderDocumentExport(renderJob.id, {
      launchBrowser: chromium.launch,
      now,
    })

    expect(result).toEqual({
      exportId: renderJob.id,
      status: 'READY',
      pageCount: 2,
      sizeBytes: PDF_BYTES.length,
    })
    expect(mocks.repo.markRunning).toHaveBeenCalledWith(renderJob.id)
    expect(mocks.forDocument).toHaveBeenCalledWith(
      renderJob.documentId,
      'rcpt-1',
    )
    expect(mocks.render).toHaveBeenCalledWith({
      content: renderJob.version?.content,
      theme: {},
      title: 'Proposta comercial',
      context: {
        mode: 'print',
        settings: {
          ...DEFAULT_DOCUMENT_SETTINGS,
          pageSize: 'LETTER',
          orientation: 'landscape',
        },
        variables: VARIABLES,
        validUntil: '2026-11-30T02:59:59.999Z',
        brand: { name: 'Stratus Telecom', logoUrl: null },
        paymentEnabled: false,
      },
    })
    expect(chromium.browser.newContext).toHaveBeenCalledWith({
      javaScriptEnabled: false,
    })
    expect(chromium.page.emulateMedia).toHaveBeenCalledWith({ media: 'print' })
    expect(chromium.page.setContent).toHaveBeenCalledWith(
      '<!doctype html><html></html>',
      { waitUntil: 'networkidle' },
    )
    expect(chromium.page.pdf).toHaveBeenCalledWith({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'Letter',
      landscape: true,
    })
    const key = `${renderJob.workspaceId}/${renderJob.documentId}/exports/${renderJob.id}.pdf`
    expect(mocks.s3.ensureBucket).toHaveBeenCalledWith('documents')
    expect(mocks.s3.putObject).toHaveBeenCalledWith({
      bucket: 'documents',
      key,
      body: expect.any(Buffer),
      contentType: 'application/pdf',
    })
    expect(mocks.repo.markReady).toHaveBeenCalledWith(renderJob.id, {
      storageKey: key,
      sizeBytes: PDF_BYTES.length,
      pageCount: 2,
      finishedAt: new Date(NOW.getTime() + 4000),
      expiresAt: new Date('2026-11-18T12:00:04.000Z'),
    })
    expect(chromium.browser.close).toHaveBeenCalledTimes(1)
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'queue.documents_pdf.ready',
      expect.objectContaining({ durationMs: 4000, pageCount: 2 }),
    )
  })

  it('should let only public and inline requests through', async () => {
    const renderJob = createFakeRenderJob()
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    const chromium = fakeBrowser()
    await renderDocumentExport(renderJob.id, {
      launchBrowser: chromium.launch,
    })

    const [handler] = chromium.handlers
    const visit = async (url: string) => {
      const route = {
        request: () => ({ url: () => url }),
        continue: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      }
      await handler(route)
      return route
    }
    for (const url of [
      'https://cdn.example.com/a.png',
      'https://media.steel.test/x.png',
      'data:image/png;base64,AAAA',
    ]) {
      expect((await visit(url)).continue).toHaveBeenCalled()
    }
    const blocked = await visit('http://steel-minio:9000/documents/x')
    expect(blocked.abort).toHaveBeenCalledWith('blockedbyclient')
    expect(blocked.continue).not.toHaveBeenCalled()
  })

  it('should print the draft with the default page when never sent', async () => {
    const renderJob = createFakeRenderJob({ version: null, versionId: null })
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    const chromium = fakeBrowser()
    await renderDocumentExport(renderJob.id, {
      launchBrowser: chromium.launch,
    })
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        content: renderJob.document.content,
        theme: { primary: '#0f172a' },
      }),
    )
    expect(chromium.page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'A4', landscape: false }),
    )
  })

  it('should launch the configured Chromium by default', async () => {
    const renderJob = createFakeRenderJob({
      document: {
        ...createFakeRenderJob().document,
        validUntil: null,
        theme: ['not', 'a', 'record'],
      },
    })
    mocks.repo.findRenderJob.mockResolvedValue(
      ok({ ...renderJob, version: null }),
    )
    const chromium = fakeBrowser()
    mocks.launch.mockResolvedValue(chromium.browser)

    await renderDocumentExport(renderJob.id)

    expect(mocks.launch).toHaveBeenCalledWith({
      headless: true,
      args: expect.arrayContaining(['--no-sandbox']),
      timeout: LAUNCH_TIMEOUT_MS,
      executablePath: '/usr/bin/chromium',
    })
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: {},
        context: expect.objectContaining({ validUntil: null }),
      }),
    )
  })

  it('should use the Playwright browser when CHROMIUM_PATH is unset', async () => {
    mocks.env.CHROMIUM_PATH = undefined
    const renderJob = createFakeRenderJob()
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    mocks.launch.mockResolvedValue(fakeBrowser().browser)
    await renderDocumentExport(renderJob.id)
    expect(mocks.launch.mock.calls[0][0]).not.toHaveProperty('executablePath')
  })

  it.each([
    ['missing', null],
    ['already running', createFakeRenderJob({ status: 'RUNNING' })],
    ['already ready', createFakeRenderJob({ status: 'READY' })],
  ])('should skip an export %s', async (_label, row) => {
    mocks.repo.findRenderJob.mockResolvedValue(ok(row))
    const chromium = fakeBrowser()
    expect(
      await renderDocumentExport('exp-1', { launchBrowser: chromium.launch }),
    ).toEqual({ exportId: 'exp-1', status: 'skipped' })
    expect(chromium.launch).not.toHaveBeenCalled()
    expect(mocks.repo.markRunning).not.toHaveBeenCalled()
  })

  it('should skip when another run took the export first', async () => {
    mocks.repo.findRenderJob.mockResolvedValue(ok(createFakeRenderJob()))
    mocks.repo.markRunning.mockResolvedValue(ok(false))
    const chromium = fakeBrowser()
    const result = await renderDocumentExport('exp-1', {
      launchBrowser: chromium.launch,
    })
    expect(result.status).toBe('skipped')
    expect(chromium.launch).not.toHaveBeenCalled()
  })

  it('should throw when the export cannot be loaded', async () => {
    mocks.repo.findRenderJob.mockResolvedValue(err(databaseError()))
    await expect(renderDocumentExport('exp-1')).rejects.toThrow(
      'Database error',
    )
    expect(mocks.repo.markFailed).not.toHaveBeenCalled()
  })

  it('should mark FAILED and rethrow when a step fails', async () => {
    const renderJob = createFakeRenderJob()
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    mocks.forDocument.mockResolvedValue(err(databaseError('no variables')))
    await expect(
      renderDocumentExport(renderJob.id, { now: () => NOW }),
    ).rejects.toThrow('no variables')
    expect(mocks.repo.markFailed).toHaveBeenCalledWith(
      renderJob.id,
      EXPORT_FAILED_MESSAGE,
      NOW,
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'queue.documents_pdf.failed',
      expect.objectContaining({ message: 'no variables' }),
    )
  })

  it('should close the browser when printing fails', async () => {
    const renderJob = createFakeRenderJob()
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    const chromium = fakeBrowser()
    chromium.page.pdf.mockRejectedValue('crashed')
    chromium.browser.close.mockRejectedValue(new Error('already gone'))
    await expect(
      renderDocumentExport(renderJob.id, { launchBrowser: chromium.launch }),
    ).rejects.toBe('crashed')
    expect(chromium.browser.close).toHaveBeenCalled()
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'queue.documents_pdf.failed',
      expect.objectContaining({ message: 'crashed' }),
    )
    expect(mocks.s3.putObject).not.toHaveBeenCalled()
  })

  it('should log when even marking FAILED fails', async () => {
    const renderJob = createFakeRenderJob()
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    mocks.s3.putObject.mockRejectedValue(new Error('minio down'))
    mocks.repo.markFailed.mockResolvedValue(err(storageError()))
    await expect(
      renderDocumentExport(renderJob.id, {
        launchBrowser: fakeBrowser().launch,
      }),
    ).rejects.toThrow('minio down')
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'queue.documents_pdf.mark_failed_failed',
      expect.objectContaining({ exportId: renderJob.id }),
    )
  })

  it('should give up on a page that never finishes loading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderJob = createFakeRenderJob()
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    const chromium = fakeBrowser()
    chromium.page.setContent.mockReturnValue(
      new Promise<undefined>(() => undefined),
    )

    const running = renderDocumentExport(renderJob.id, {
      launchBrowser: chromium.launch,
      now: () => NOW,
    })
    const settled = expect(running).rejects.toBeInstanceOf(PrintTimeoutError)
    await vi.waitFor(() => expect(chromium.page.setContent).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(RENDER_TIMEOUT_MS)
    await settled
    expect(chromium.browser.close).toHaveBeenCalled()
    expect(mocks.repo.markFailed).toHaveBeenCalledWith(
      renderJob.id,
      EXPORT_TIMEOUT_MESSAGE,
      NOW,
    )
  })

  it('should give up on a browser that never starts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const renderJob = createFakeRenderJob()
    mocks.repo.findRenderJob.mockResolvedValue(ok(renderJob))
    const launch = vi.fn(() => new Promise<Browser>(() => undefined))

    const running = renderDocumentExport(renderJob.id, {
      launchBrowser: launch,
    })
    const settled = expect(running).rejects.toThrow(
      `PDF launch timed out after ${LAUNCH_TIMEOUT_MS} ms`,
    )
    await vi.waitFor(() => expect(launch).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(LAUNCH_TIMEOUT_MS)
    await settled
  })
})

describe('print helpers', () => {
  it('should trust the media and app hosts', () => {
    expect(trustedPrintHosts()).toEqual(['media.steel.test', 'app.steel.test'])
    mocks.env.MINIO_PUBLIC_URL = undefined
    expect(trustedPrintHosts()).toEqual(['app.steel.test'])
  })

  it('should map the page settings', () => {
    expect(printPageOptions(DEFAULT_DOCUMENT_SETTINGS)).toEqual({
      format: 'A4',
      landscape: false,
    })
    expect(
      printPageOptions({
        ...DEFAULT_DOCUMENT_SETTINGS,
        pageSize: 'LETTER',
        orientation: 'landscape',
      }),
    ).toEqual({ format: 'Letter', landscape: true })
  })
})

describe('handleDocumentsPdfJob', () => {
  it('should render the export of a render job', async () => {
    mocks.repo.findRenderJob.mockResolvedValue(ok(null))
    expect(
      await handleDocumentsPdfJob(
        job(DocumentsPdfJob.Render, { exportId: 'exp-9' }),
      ),
    ).toEqual({ exportId: 'exp-9', status: 'skipped' })
    expect(mocks.repo.findRenderJob).toHaveBeenCalledWith('exp-9')
  })

  it('should prune the expired exports', async () => {
    mocks.pruneExpired.mockResolvedValue(ok({ deleted: 3, files: 2 }))
    expect(
      await processDocumentsPdf(job(DocumentsPdfJob.PruneExpired)),
    ).toEqual({ deleted: 3, files: 2 })
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'queue.documents_pdf.pruned',
      { component: 'Worker', deleted: 3, files: 2 },
    )
  })

  it('should prune with the injected clock and throw on failure', async () => {
    mocks.pruneExpired.mockResolvedValue(err(storageError('minio down')))
    await expect(
      handleDocumentsPdfJob(job(DocumentsPdfJob.PruneExpired), {
        now: () => NOW,
      }),
    ).rejects.toThrow('STORAGE_ERROR (minio down)')
    expect(mocks.pruneExpired).toHaveBeenCalledWith(NOW)
  })

  it('should refuse an unknown job', async () => {
    await expect(handleDocumentsPdfJob(job('nope'))).rejects.toThrow(
      'Unknown documents-pdf job: nope (id=job-1)',
    )
    await expect(
      handleDocumentsPdfJob({ name: 'nope', data: {} } as unknown as Job),
    ).rejects.toThrow('(id=unknown)')
  })
})
