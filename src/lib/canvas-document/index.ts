/**
 * `document` catalog of Steel Canvas — CRM > Documentos (ADR 0063,
 * docs/documents/README.md). Public API for the editor, the document
 * service, the public link, the analytics, the PDF export and the AI import.
 */

export {
  buildDocumentCatalog,
  createDocumentCatalog,
  createEmptyDocumentContent,
  DOCUMENT_CATEGORIES,
  describeDocumentError,
  documentCatalog,
  validateDocumentContent,
} from './catalog'
export { documentChecklist } from './checklist'
export { fieldValueError, formatFieldValue } from './components/views'
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
  DEFAULT_DOCUMENT_TIME_ZONE,
  formatBRL,
  formatDocumentDate,
  isValidEmail,
  maskCnpj,
  maskCpf,
  maskPhone,
} from './format'
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
  DOCUMENT_SECTION_PRESETS,
  type DocumentSectionPreset,
  sectionFragment,
} from './presets'
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
  getDocumentStarterOutline,
} from './starters'
export {
  type DocumentCssOptions,
  type DocumentLayoutSettings,
  documentCss,
  documentRootClass,
} from './styles'
export {
  DOCUMENT_COLOR_IDS,
  DOCUMENT_FONTS,
  type DocumentTheme,
  defaultDocumentTheme,
  documentColorTokens,
  documentPageBox,
  documentViewportWidths,
  parseDocumentTheme,
} from './theme'
export {
  documentVariableSamples,
  documentVariablesUsed,
  substituteVariables,
  variableTag,
} from './variables'
export { DocumentStyles, DocumentView, type DocumentViewProps } from './view'
