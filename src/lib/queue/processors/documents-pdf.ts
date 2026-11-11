import type { Job } from 'bullmq'
import { PDFDocument } from 'pdf-lib'
import type { Browser } from 'playwright-core'
import { logger } from '@/lib/axiom/logger'
import {
  BETTER_AUTH_URL,
  CHROMIUM_PATH,
  MINIO_PUBLIC_URL,
} from '@/lib/env/server'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { renderDocumentHtml } from '@/src/lib/canvas-document/render'
import { DocumentVariablesService } from '@/src/lib/document-export/backend-adapter'
import {
  hostOf,
  isAllowedPrintRequest,
} from '@/src/lib/document-export/print-network'
import { parseDocumentSettings } from '@/src/lib/document-export/settings'
import {
  DOCUMENTS_BUCKET,
  documentExportStorageKey,
  PDF_CONTENT_TYPE,
} from '@/src/lib/document-export/storage'
import { ensureBucket, putObject } from '@/src/lib/storage/s3'
import { DocumentExportRepository } from '@/src/repositories/document-export.repository'
import type { DocumentSettingsDTO } from '@/src/schemas/document.schema'
import { DocumentExportService } from '@/src/services/document-export.service'
import { DocumentsPdfJob, type DocumentsPdfJobPayload } from '../jobs'
import { DocumentExportRetentionMs } from '../retention'

/**
 * `documents-pdf` queue (ADR 0063). `render` prints one export: the same
 * HTML as the public link in `print` mode, opened by a headless Chromium
 * (one browser per job, always closed) with JavaScript off and every request
 * filtered (`isAllowedPrintRequest`), then saved to MinIO. `prune-expired`
 * deletes exports past retention.
 */

export const LAUNCH_TIMEOUT_MS = 30_000
/** Page load (images, fonts) + print of one document. */
export const RENDER_TIMEOUT_MS = 90_000

/** Chromium in a container, as the unprivileged `nextjs` user. */
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--font-render-hinting=none',
]

/** What the user sees on the export (the technical cause is logged). */
export const EXPORT_FAILED_MESSAGE =
  'Não foi possível gerar o PDF. Tente de novo em instantes.'
export const EXPORT_TIMEOUT_MESSAGE =
  'O documento demorou demais para virar PDF. Tente de novo em instantes.'

export interface DocumentsPdfDeps {
  launchBrowser?: () => Promise<Browser>
  now?: () => Date
}

export type RenderResult =
  | { exportId: string; status: 'skipped' }
  | { exportId: string; status: 'READY'; pageCount: number; sizeBytes: number }

export class PrintTimeoutError extends Error {
  constructor(step: string, ms: number) {
    super(`PDF ${step} timed out after ${ms} ms`)
    this.name = 'PrintTimeoutError'
  }
}

function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  step: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PrintTimeoutError(step, ms)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

async function launchChromium(): Promise<Browser> {
  const { chromium } = await import('playwright-core')
  return chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
    timeout: LAUNCH_TIMEOUT_MS,
    ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
  })
}

/** The app's own public hosts, allowed even when they look internal. */
export function trustedPrintHosts(): string[] {
  return [hostOf(MINIO_PUBLIC_URL), hostOf(BETTER_AUTH_URL)].filter(
    (host): host is string => host !== null,
  )
}

export interface PrintPageOptions {
  format: 'A4' | 'Letter'
  landscape: boolean
}

/** Fallback page when the HTML has no `@page` (`preferCSSPageSize` wins). */
export function printPageOptions(
  settings: DocumentSettingsDTO,
): PrintPageOptions {
  return {
    format: settings.pageSize === 'LETTER' ? 'Letter' : 'A4',
    landscape: settings.orientation === 'landscape',
  }
}

async function printInBrowser(
  browser: Browser,
  html: string,
  page: PrintPageOptions,
  trustedHosts: readonly string[],
): Promise<Buffer> {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const tab = await context.newPage()
  tab.setDefaultTimeout(RENDER_TIMEOUT_MS)
  await tab.route('**/*', (route) =>
    isAllowedPrintRequest(route.request().url(), trustedHosts)
      ? route.continue()
      : route.abort('blockedbyclient'),
  )
  await tab.emulateMedia({ media: 'print' })
  await tab.setContent(html, { waitUntil: 'networkidle' })
  const pdf = await tab.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    format: page.format,
    landscape: page.landscape,
  })
  return Buffer.from(pdf)
}

/** HTML → PDF in a fresh Chromium that is closed whatever happens. */
export async function printHtmlToPdf(
  html: string,
  page: PrintPageOptions,
  trustedHosts: readonly string[],
  launch: () => Promise<Browser> = launchChromium,
): Promise<Buffer> {
  const browser = await withTimeout(launch(), LAUNCH_TIMEOUT_MS, 'launch')
  try {
    return await withTimeout(
      printInBrowser(browser, html, page, trustedHosts),
      RENDER_TIMEOUT_MS,
      'render',
    )
  } finally {
    await browser.close().catch(() => undefined)
  }
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function renderDocumentExport(
  exportId: string,
  deps: DocumentsPdfDeps = {},
): Promise<RenderResult> {
  const now = deps.now ?? (() => new Date())
  const job = unwrap(await DocumentExportRepository.findRenderJob(exportId))
  if (job?.status !== 'PENDING') {
    logger.warn('queue.documents_pdf.skipped', {
      component: 'Worker',
      exportId,
      status: job?.status ?? 'missing',
    })
    return { exportId, status: 'skipped' }
  }

  const startedAt = now()
  try {
    if (!unwrap(await DocumentExportRepository.markRunning(exportId))) {
      return { exportId, status: 'skipped' }
    }
    const variables = unwrap(
      await DocumentVariablesService.forDocument(
        job.documentId,
        job.recipientId,
      ),
    )
    // null version = the editable draft (owner preview).
    const source = job.version ?? job.document
    const settings = parseDocumentSettings(source.settings)
    const html = renderDocumentHtml({
      content: source.content as unknown as CanvasDocument,
      theme: asRecord(source.theme),
      title: job.document.title,
      context: {
        mode: 'print',
        settings,
        variables,
        validUntil: job.document.validUntil?.toISOString() ?? null,
        brand: {
          name: job.document.workspace.name,
          logoUrl: job.document.workspace.logoUrl,
        },
        paymentEnabled: false,
      },
    })

    const pdf = await printHtmlToPdf(
      html,
      printPageOptions(settings),
      trustedPrintHosts(),
      deps.launchBrowser,
    )
    const pageCount = (await PDFDocument.load(pdf)).getPageCount()
    const key = documentExportStorageKey(
      job.workspaceId,
      job.documentId,
      exportId,
    )
    await ensureBucket(DOCUMENTS_BUCKET)
    await putObject({
      bucket: DOCUMENTS_BUCKET,
      key,
      body: pdf,
      contentType: PDF_CONTENT_TYPE,
    })

    const finishedAt = now()
    unwrap(
      await DocumentExportRepository.markReady(exportId, {
        storageKey: key,
        sizeBytes: pdf.length,
        pageCount,
        finishedAt,
        expiresAt: new Date(finishedAt.getTime() + DocumentExportRetentionMs),
      }),
    )
    logger.info('queue.documents_pdf.ready', {
      component: 'Worker',
      exportId,
      documentId: job.documentId,
      pageCount,
      sizeBytes: pdf.length,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    })
    return { exportId, status: 'READY', pageCount, sizeBytes: pdf.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('queue.documents_pdf.failed', {
      component: 'Worker',
      exportId,
      documentId: job.documentId,
      message,
    })
    const failed = await DocumentExportRepository.markFailed(
      exportId,
      error instanceof PrintTimeoutError
        ? EXPORT_TIMEOUT_MESSAGE
        : EXPORT_FAILED_MESSAGE,
      now(),
    )
    if (!failed.ok) {
      logger.error('queue.documents_pdf.mark_failed_failed', {
        component: 'Worker',
        exportId,
      })
    }
    throw error
  }
}

async function pruneExports(now: Date) {
  const result = await DocumentExportService.pruneExpired(now)
  if (!result.ok) {
    // Read or delete failure: throw so the failure alarm sees it.
    throw new Error(
      `Failed to prune document exports: ${result.error.code} (${result.error.message})`,
    )
  }
  logger.info('queue.documents_pdf.pruned', {
    component: 'Worker',
    ...result.value,
  })
  return result.value
}

/** Inner entry point with dependencies injected (tests). */
export async function handleDocumentsPdfJob(
  job: Job,
  deps: DocumentsPdfDeps = {},
): Promise<RenderResult | { deleted: number; files: number }> {
  switch (job.name) {
    case DocumentsPdfJob.Render: {
      const data = job.data as DocumentsPdfJobPayload['render']
      return renderDocumentExport(data.exportId, deps)
    }
    case DocumentsPdfJob.PruneExpired:
      return pruneExports((deps.now ?? (() => new Date()))())
    default:
      throw new Error(
        `Unknown documents-pdf job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}

export async function processDocumentsPdf(
  job: Job,
): Promise<RenderResult | { deleted: number; files: number }> {
  return handleDocumentsPdfJob(job)
}
