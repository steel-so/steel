// The internal module, not 'pdf-parse': the package index runs a self-test on
// import when `module.parent` is undefined (see knowledge-document.ts).
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import { normalizeExtractedText } from '@/src/lib/ai/attachments'
import { err, ok, type Result } from '@/src/lib/result'
import { extractKnowledgeDocumentText } from '@/src/lib/whatsapp/knowledge-document'
import { DOCUMENT_IMPORT_DOCX_TYPE } from './constants'

/**
 * Reading the files of the AI import (CRM > Documentos, ADR 0063): page
 * count of a PDF at upload, the text of each page for models that cannot
 * read a PDF natively, and the text of a DOCX (the same extraction the
 * Steel AI attachments use).
 */

interface PdfTextItem {
  str: string
  transform: number[]
}

interface PdfPage {
  getTextContent(options?: Record<string, unknown>): Promise<{
    items: PdfTextItem[]
  }>
}

/** Text of one page, a line break whenever the baseline changes. */
async function pageText(page: PdfPage): Promise<string> {
  const content = await page.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  })
  let lastY: number | undefined
  let text = ''
  for (const item of content.items) {
    const y = item.transform[5]
    text += lastY === undefined || lastY === y ? item.str : `\n${item.str}`
    lastY = y
  }
  return text
}

const UNREADABLE_PDF =
  'Não foi possível ler este PDF. Ele pode estar protegido por senha ou corrompido.'

/** `%PDF-` at the start (some files carry a few junk bytes first). */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes('%PDF-')
}

/** DOCX is a ZIP archive: `PK\x03\x04`. */
export function looksLikeDocx(buffer: Buffer): boolean {
  return (
    buffer.length > 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  )
}

/** Number of pages, reading only the first one. */
export async function countPdfPages(
  buffer: Buffer,
): Promise<Result<number, string>> {
  try {
    const parsed = await pdfParse(buffer, { max: 1 })
    return ok(parsed.numpages)
  } catch {
    return err(UNREADABLE_PDF)
  }
}

/** Text of every page, in order (empty string for a page without text). */
export async function extractPdfPages(
  buffer: Buffer,
): Promise<Result<string[], string>> {
  const pages: string[] = []
  try {
    await pdfParse(buffer, {
      pagerender: async (page: PdfPage) => {
        // Keep one entry per page even when a page fails to render.
        const text = await pageText(page).catch(() => '')
        pages.push(normalizeExtractedText(text))
        return text
      },
    })
    return ok(pages)
  } catch {
    return err(UNREADABLE_PDF)
  }
}

/** Text of a DOCX, normalized (no images, no layout). */
export async function extractDocxText(
  buffer: Buffer,
): Promise<Result<string, string>> {
  const extracted = await extractKnowledgeDocumentText(
    DOCUMENT_IMPORT_DOCX_TYPE,
    buffer,
  )
  const text = extracted.ok ? normalizeExtractedText(extracted.value) : ''
  if (!text) {
    return err(
      'Não foi possível ler o texto deste DOCX. Confira se o arquivo abre no Word.',
    )
  }
  return ok(text)
}

/** Pages as the model reads them when the PDF itself cannot be sent. */
export function pagesAsText(pages: string[]): string {
  return pages
    .map(
      (text, index) =>
        `<pagina numero="${index + 1}">\n${text || '[página sem texto]'}\n</pagina>`,
    )
    .join('\n\n')
}
