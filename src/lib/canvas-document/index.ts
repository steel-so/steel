/**
 * `document` catalog of Steel Canvas — CRM > Documentos (ADR 0063,
 * docs/documents/README.md). Public API for the editor, the document
 * service, the public link, the analytics, the PDF export and the AI import.
 */

export {
  createDocumentCatalog,
  createEmptyDocumentContent,
  validateDocumentContent,
} from './catalog'
export * from './constants'
export type {
  DocumentActionResult,
  DocumentFieldProps,
  DocumentPricingItem,
  DocumentRenderContext,
  DocumentRenderMode,
  DocumentRuntime,
  DocumentRuntimeStatus,
  DocumentVariableValues,
} from './context'
export { type DocumentFieldInfo, documentFields } from './fields'
export {
  type DocumentOutline,
  type DocumentOutlineBlock,
  DocumentOutlineBlockSchema,
  type DocumentOutlineLeafBlock,
  DocumentOutlineSchema,
  type DocumentOutlineSection,
  DocumentOutlineSectionSchema,
  type OutlineToDocumentResult,
  outlineToDocument,
} from './outline'
export {
  DOCUMENT_PRICING_TYPE,
  type DocumentPricingTotals,
  documentPricingItems,
  documentPricingTotals,
  pricingLineTotal,
} from './pricing'
export { type RenderDocumentHtmlInput, renderDocumentHtml } from './render'
export { type DocumentSectionInfo, documentSections } from './sections'
export {
  DOCUMENT_STARTERS,
  type DocumentStarterMeta,
  getDocumentStarter,
} from './starters'
export { DocumentView, type DocumentViewProps } from './view'
