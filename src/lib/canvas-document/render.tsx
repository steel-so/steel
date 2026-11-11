import type { CanvasDocument } from '@/src/lib/canvas/types'
import { escapeHtml } from '@/src/lib/canvas-site/sanitize'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'
import { buildDocumentCatalog } from './catalog'
import type { DocumentRenderContext } from './context'
import { renderToHtml } from './html'
import { documentCss } from './styles'
import { documentFontsHref, parseDocumentTheme } from './theme'
import { DocumentTree, isCoverFirst } from './tree'

/**
 * Static render of a document for the PDF export (headless Chromium in the
 * worker) and previews. Always the `print` mode: no scripts, no inputs,
 * `@page` with the size, orientation and margin of the document, page
 * breaks on, the recipient's answers filled in when the context has them.
 * Synchronous and free of `react-dom/server`, so it runs anywhere.
 */
export interface RenderDocumentHtmlInput {
  content: CanvasDocument
  theme: Record<string, unknown>
  context: DocumentRenderContext
  title: string
}

/** Fonts the app serves itself have no URL in the headless browser. */
const PRINT_FONT_VARS = ':root{--font-geist-sans:"Geist"}'

/**
 * Full standalone HTML (`<!doctype html>`, inline CSS, print CSS with
 * `@page` size/margins and page breaks, no scripts) of a document.
 */
export function renderDocumentHtml(input: RenderDocumentHtmlInput): string {
  const theme = parseDocumentTheme(input.theme)
  const settings = { ...DEFAULT_DOCUMENT_SETTINGS, ...input.context.settings }
  const context: DocumentRenderContext = {
    ...input.context,
    settings,
    mode: 'print',
  }
  const catalog = buildDocumentCatalog(context, () => input.content)
  const css = documentCss(theme, {
    mode: 'print',
    settings,
    coverFirst: isCoverFirst(input.content),
  })
  const tree = <DocumentTree doc={input.content} catalog={catalog} />
  const body = renderToHtml(tree)
  const fonts = documentFontsHref(theme)
  const fontLinks = fonts
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${escapeHtml(fonts)}">`
    : ''
  const title = escapeHtml(input.title.trim() || 'Documento')
  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    fontLinks,
    `<style>${PRINT_FONT_VARS}\n${css}</style>`,
    '</head>',
    `<body>${body}</body>`,
    '</html>',
  ].join('')
}
