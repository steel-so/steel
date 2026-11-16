import { escapeHtml } from '@/src/lib/canvas-site/sanitize'
import {
  DEFAULT_PAGE_NUMBER_FORMAT,
  type DocumentAlignment,
  type DocumentHeaderFooterDTO,
  type DocumentSettingsDTO,
  type DocumentWatermarkDTO,
} from '@/src/schemas/document.schema'
import type { DocumentVariableValues } from './context'
import { substituteVariables } from './variables'

/**
 * Page furniture of a document: running header and footer, page numbers and
 * watermark (`settings.header|footer|pageNumbers|watermark`).
 *
 * - PDF: header, footer and numbers go through Chromium's header/footer
 *   templates (they repeat on every page and know `pageNumber`/`totalPages`);
 *   the watermark is a fixed layer, which Chromium repeats on every page.
 * - Screen (editor, public link): header and footer show once, around the
 *   document; page numbers need a page count and are PDF only; the text
 *   watermark repeats per sheet in the paged layout.
 */

export type PageFurnitureSettings = Pick<
  DocumentSettingsDTO,
  'header' | 'footer' | 'pageNumbers' | 'watermark'
>

/** Smallest top/bottom page margin that fits a running header or footer. */
export const FURNITURE_MIN_MARGIN_MM = 16

const hasContent = (
  band: DocumentHeaderFooterDTO | null | undefined,
): boolean => Boolean(band && (band.text.trim() || band.imageUrl))

/** Which bands the PDF needs: a header and/or a footer. */
export function furnitureBands(settings: PageFurnitureSettings): {
  header: boolean
  footer: boolean
} {
  const numbers = settings.pageNumbers?.enabled ? settings.pageNumbers : null
  return {
    header: hasContent(settings.header) || numbers?.position === 'header',
    footer: hasContent(settings.footer) || numbers?.position === 'footer',
  }
}

/** Page margins of the PDF in mm: the bands never get less than the minimum. */
export function printMargins(
  margin: number,
  settings: PageFurnitureSettings,
): { top: number; bottom: number } {
  const bands = furnitureBands(settings)
  return {
    top: bands.header ? Math.max(margin, FURNITURE_MIN_MARGIN_MM) : margin,
    bottom: bands.footer ? Math.max(margin, FURNITURE_MIN_MARGIN_MM) : margin,
  }
}

// ─── watermark ───────────────────────────────────────────────────────────

/** An http(s) address safe to sit inside a CSS `url("…")`. */
export function cssSafeUrl(value: string | undefined): string | null {
  if (!value || !/^https?:\/\//i.test(value.trim())) return null
  return encodeURI(value.trim()).replace(/["'()\\<>]/g, (char) =>
    encodeURIComponent(char),
  )
}

function textWatermarkSvg(text: string, angle: number): string {
  const size = Math.max(
    36,
    Math.min(160, Math.floor(900 / (text.length * 0.62))),
  )
  return [
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000'>",
    `<text x='500' y='500' text-anchor='middle' dominant-baseline='middle' transform='rotate(${angle} 500 500)' font-family='Arial,Helvetica,sans-serif' font-weight='700' font-size='${size}' fill='#475569'>${escapeHtml(text)}</text>`,
    '</svg>',
  ].join('')
}

export interface WatermarkCssOptions {
  /** Paged sheets on screen: the text repeats once per sheet. */
  paged: boolean
  print: boolean
  page: { width: number; height: number }
}

/**
 * CSS of the watermark layer (`.d-doc::after`), or '' without one. An image
 * wins over the text; the angle turns the text only.
 */
export function watermarkCss(
  watermark: DocumentWatermarkDTO | null | undefined,
  options: WatermarkCssOptions,
): string {
  if (!watermark) return ''
  const image = cssSafeUrl(watermark.imageUrl)
  const text = watermark.text.trim()
  if (!image && !text) return ''

  const background = image
    ? `url("${image}")`
    : `url("data:image/svg+xml,${encodeURIComponent(textWatermarkSvg(text, watermark.angle))}")`
  const tiled = options.paged && !options.print && !image
  const size = tiled
    ? `100% ${options.page.height}mm`
    : image
      ? 'min(70%,720px) auto'
      : 'contain'
  return `.d-root .d-doc::after{content:"";position:${tiled ? 'absolute' : 'fixed'};inset:0;z-index:40;pointer-events:none;opacity:${watermark.opacity};background-image:${background};background-repeat:${tiled ? 'repeat-y' : 'no-repeat'};background-position:center ${tiled ? 'top' : 'center'};background-size:${size};-webkit-print-color-adjust:exact;print-color-adjust:exact}`
}

// ─── PDF header and footer ───────────────────────────────────────────────

/** `Página {n} de {total}` as Chromium's template markup. */
export function pageNumberMarkup(format: string): string {
  return escapeHtml(format.trim() || DEFAULT_PAGE_NUMBER_FORMAT)
    .replaceAll('{n}', '<span class="pageNumber"></span>')
    .replaceAll('{total}', '<span class="totalPages"></span>')
}

/** Page number text for a known page (previews, tests). */
export function formatPageNumber(
  format: string,
  page: number,
  total: number,
): string {
  return (format.trim() || DEFAULT_PAGE_NUMBER_FORMAT)
    .replaceAll('{n}', String(page))
    .replaceAll('{total}', String(total))
}

const ALIGN_STYLE: Record<DocumentAlignment, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
}

export interface PrintTemplateInput {
  settings: PageFurnitureSettings
  variables: DocumentVariableValues
  /** Side margin of the page in mm, so the band lines up with the content. */
  sideMarginMm: number
  /** Images as `data:` URIs (the template cannot load a remote image). */
  images?: { header?: string; footer?: string }
}

export interface PrintTemplates {
  displayHeaderFooter: boolean
  headerTemplate: string
  footerTemplate: string
}

type Cells = Record<DocumentAlignment, string[]>

function bandMarkup(
  band: 'header' | 'footer',
  input: PrintTemplateInput,
): string {
  const { settings } = input
  const cells: Cells = { left: [], center: [], right: [] }
  const config = settings[band]
  const dataUri = input.images?.[band]
  if (config && hasContent(config)) {
    const parts: string[] = []
    if (dataUri) {
      parts.push(
        `<img src="${escapeHtml(dataUri)}" style="height:7mm;max-width:40mm;object-fit:contain;vertical-align:middle;margin-right:2mm">`,
      )
    }
    const text = substituteVariables(config.text.trim(), input.variables)
    if (text) parts.push(escapeHtml(text))
    if (parts.length > 0) cells[config.align].push(parts.join(''))
  }
  const numbers = settings.pageNumbers
  if (numbers?.enabled && numbers.position === band) {
    cells[numbers.align].push(pageNumberMarkup(numbers.format))
  }
  const cell = (align: DocumentAlignment) =>
    `<div style="flex:1 1 0;min-width:0;text-align:${ALIGN_STYLE[align]}">${cells[align].join(' · ')}</div>`
  const vertical =
    band === 'header' ? 'padding-top:6mm' : 'padding-bottom:6mm;margin-top:auto'
  return `<div style="box-sizing:border-box;width:100%;padding:0 ${input.sideMarginMm}mm;${vertical};font-family:Arial,Helvetica,sans-serif;font-size:8px;line-height:1.3;color:#64748b;display:flex;gap:4mm;-webkit-print-color-adjust:exact">${cell('left')}${cell('center')}${cell('right')}</div>`
}

/** Header/footer templates of `page.pdf()`; both blank without furniture. */
export function printTemplates(input: PrintTemplateInput): PrintTemplates {
  const bands = furnitureBands(input.settings)
  const blank = '<span></span>'
  return {
    displayHeaderFooter: bands.header || bands.footer,
    headerTemplate: bands.header ? bandMarkup('header', input) : blank,
    footerTemplate: bands.footer ? bandMarkup('footer', input) : blank,
  }
}

// ─── screen header and footer ────────────────────────────────────────────

export interface ScreenBand {
  text: string
  imageUrl: string | null
  align: DocumentAlignment
}

/** The band as shown once on screen (variables filled), or null if empty. */
export function screenBand(
  band: DocumentHeaderFooterDTO | null | undefined,
  variables: DocumentVariableValues,
): ScreenBand | null {
  if (!band || !hasContent(band)) return null
  return {
    text: substituteVariables(band.text.trim(), variables),
    imageUrl: cssSafeUrl(band.imageUrl) ? (band.imageUrl ?? null) : null,
    align: band.align,
  }
}
