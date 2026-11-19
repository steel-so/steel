import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * PDF import (CRM > Documentos): every page of the file becomes one PNG, no
 * AI involved. Rendered with `pdftoppm` (poppler-utils, installed in the
 * worker image). One call per page keeps memory flat and lets a page that is
 * too heavy for the image library be rendered again at a lower resolution.
 */

const run = promisify(execFile)

/** Resolution of a page: sharp on screen and in the exported PDF. */
export const PAGE_DPI = 130
/** Fallback for a page whose PNG is over the image library limit. */
export const PAGE_FALLBACK_DPI = 80
/** The image library accepts up to 5 MB per picture. */
export const PAGE_MAX_BYTES = 5 * 1024 * 1024
const PAGE_TIMEOUT_MS = 60_000

export interface PdfPagePng {
  page: number
  bytes: Buffer
}

async function renderOne(
  dir: string,
  pdf: string,
  page: number,
  dpi: number,
): Promise<Buffer> {
  const prefix = join(dir, `p${page}-${dpi}`)
  await run(
    'pdftoppm',
    [
      '-png',
      '-singlefile',
      '-r',
      String(dpi),
      '-f',
      String(page),
      '-l',
      String(page),
      pdf,
      prefix,
    ],
    { timeout: PAGE_TIMEOUT_MS },
  )
  return readFile(`${prefix}.png`)
}

/** PNG of each page, in order. Throws when the PDF cannot be rendered. */
export async function renderPdfPages(
  buffer: Buffer,
  pageCount: number,
  onPage?: (done: number) => void | Promise<void>,
): Promise<PdfPagePng[]> {
  const dir = await mkdtemp(join(tmpdir(), 'steel-pdf-'))
  try {
    const pdf = join(dir, 'in.pdf')
    await writeFile(pdf, buffer)
    const pages: PdfPagePng[] = []
    for (let page = 1; page <= pageCount; page++) {
      let bytes = await renderOne(dir, pdf, page, PAGE_DPI)
      if (bytes.length > PAGE_MAX_BYTES) {
        bytes = await renderOne(dir, pdf, page, PAGE_FALLBACK_DPI)
      }
      pages.push({ page, bytes })
      await onPage?.(page)
    }
    return pages
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
