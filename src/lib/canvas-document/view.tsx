import type { CanvasDocument } from '@/src/lib/canvas/types'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'
import { buildDocumentCatalog } from './catalog'
import type { DocumentRenderContext, DocumentRenderMode } from './context'
import { type DocumentLayoutSettings, documentCss } from './styles'
import { parseDocumentTheme } from './theme'
import { DocumentTree, isCoverFirst } from './tree'

/**
 * React renderer of a document outside the editor (public link). Functional
 * elements read `useDocumentRuntime()`; sections carry the tracker
 * attributes (`DOC_SECTION_ATTR`...) and one `DOC_END_ATTR` marker closes
 * the document. Renders its own stylesheet, so it needs nothing else.
 * Hook-free: memoize the element in the caller if the props are stable.
 */
export interface DocumentViewProps {
  content: CanvasDocument
  theme: Record<string, unknown>
  context: DocumentRenderContext
}

export function DocumentView({ content, theme, context }: DocumentViewProps) {
  const settings = { ...DEFAULT_DOCUMENT_SETTINGS, ...context.settings }
  const catalog = buildDocumentCatalog({ ...context, settings }, () => content)
  const css = documentCss(parseDocumentTheme(theme), {
    mode: context.mode,
    settings,
    coverFirst: isCoverFirst(content),
  })
  return (
    <>
      <style data-document-css='' dangerouslySetInnerHTML={{ __html: css }} />
      <DocumentTree doc={content} catalog={catalog} />
    </>
  )
}

/**
 * The stylesheet alone, for the editor canvas (`frameHead` of
 * `CanvasEditor`, mode `editor`) or a page that renders the tree itself.
 */
export function DocumentStyles({
  theme,
  settings,
  mode,
}: {
  theme: Record<string, unknown>
  settings: DocumentLayoutSettings
  mode: DocumentRenderMode
}) {
  const css = documentCss(parseDocumentTheme(theme), { mode, settings })
  return (
    <style data-document-css='' dangerouslySetInnerHTML={{ __html: css }} />
  )
}
