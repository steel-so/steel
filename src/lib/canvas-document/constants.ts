/**
 * `document` catalog of Steel Canvas (ADR 0063). Shared names used by the
 * catalog, the document service, the public link, the analytics tracker, the
 * PDF export, the AI import and the proposal converter. Changing a type name
 * breaks stored documents: add, never rename.
 */

export const DOCUMENT_CATALOG_ID = 'document'
export const DOCUMENT_CATALOG_VERSION = 1

/** Root node type (document settings live on the row, not on the node). */
export const DOCUMENT_ROOT_TYPE = 'document'
/** Unit of reading analytics, TOC and page breaks. Direct children of the root. */
export const DOCUMENT_SECTION_TYPE = 'section'

/** Layout and content elements (reused/adapted from the site catalog). */
export const DOCUMENT_CONTENT_TYPES = [
  'container',
  'columns',
  'column',
  'heading',
  'text',
  'list',
  'quote',
  'callout',
  'table',
  'button',
  'divider',
  'spacer',
  'page-break',
  'image',
  'icon',
  'video',
  'gallery',
  'accordion',
  'accordion-item',
  'stats',
  'testimonials',
  'logos',
  'toc',
  'contact-card',
] as const

/** Elements that read or write runtime state on the public link. */
export const DOCUMENT_FUNCTIONAL_TYPES = [
  'accept',
  'pricing-table',
  'payment',
  'attachments',
  'validity',
  'meeting',
] as const

/** Form fields; answers are keyed by the field node id. */
export const DOCUMENT_FIELD_TYPES = [
  'field-text',
  'field-textarea',
  'field-email',
  'field-phone',
  'field-number',
  'field-date',
  'field-select',
  'field-checkbox',
  'field-cpf',
  'field-cnpj',
] as const

export type DocumentFieldType = (typeof DOCUMENT_FIELD_TYPES)[number]

export const DOCUMENT_TYPES = [
  DOCUMENT_ROOT_TYPE,
  DOCUMENT_SECTION_TYPE,
  ...DOCUMENT_CONTENT_TYPES,
  ...DOCUMENT_FUNCTIONAL_TYPES,
  ...DOCUMENT_FIELD_TYPES,
] as const

/**
 * DOM contract between the renderer (public and print modes) and the
 * analytics tracker. The renderer puts these attributes on the outermost
 * element of each node; the tracker only reads them.
 */
export const DOC_SECTION_ATTR = 'data-doc-section'
export const DOC_SECTION_NAME_ATTR = 'data-doc-section-name'
/** `link` | `video` | `attachment` — clicks/plays reported as events. */
export const DOC_TRACK_ATTR = 'data-doc-track'
/** Element marking the end of the document (reachedEnd). */
export const DOC_END_ATTR = 'data-doc-end'

/** Page sizes in millimetres (print CSS `@page` and the paged editor view). */
export const DOCUMENT_PAGE_SIZES = {
  A4: { width: 210, height: 297 },
  LETTER: { width: 215.9, height: 279.4 },
} as const

/**
 * Merge tags usable in any text (`{{contato.nome}}`), resolved per recipient
 * when the link is rendered. `sample` is what the editor preview shows.
 */
export const DOCUMENT_VARIABLES = [
  {
    key: 'destinatario.nome',
    label: 'Nome do destinatário',
    sample: 'Maria Souza',
  },
  {
    key: 'destinatario.email',
    label: 'E-mail do destinatário',
    sample: 'maria@cliente.com.br',
  },
  {
    key: 'contato.nome',
    label: 'Nome do contato',
    sample: 'Maria Souza',
  },
  {
    key: 'contato.email',
    label: 'E-mail do contato',
    sample: 'maria@cliente.com.br',
  },
  {
    key: 'contato.telefone',
    label: 'Telefone do contato',
    sample: '(11) 98888-7777',
  },
  {
    key: 'empresa.nome',
    label: 'Nome da empresa',
    sample: 'Cliente Exemplo Ltda',
  },
  {
    key: 'empresa.cnpj',
    label: 'CNPJ da empresa',
    sample: '12.345.678/0001-90',
  },
  {
    key: 'oportunidade.titulo',
    label: 'Título da oportunidade',
    sample: 'Implantação 2027',
  },
  {
    key: 'oportunidade.valor',
    label: 'Valor da oportunidade',
    sample: 'R$ 48.000,00',
  },
  {
    key: 'responsavel.nome',
    label: 'Nome do responsável',
    sample: 'João Lima',
  },
  {
    key: 'responsavel.email',
    label: 'E-mail do responsável',
    sample: 'joao@suaempresa.com.br',
  },
  {
    key: 'documento.titulo',
    label: 'Título do documento',
    sample: 'Proposta comercial',
  },
  {
    key: 'documento.validade',
    label: 'Validade do documento',
    sample: '30/11/2026',
  },
  {
    key: 'documento.total',
    label: 'Total do documento',
    sample: 'R$ 48.000,00',
  },
  {
    key: 'workspace.nome',
    label: 'Nome da sua empresa',
    sample: 'Stratus Telecom',
  },
  {
    key: 'data.hoje',
    label: 'Data de hoje',
    sample: '11/11/2026',
  },
] as const

export type DocumentVariableKey = (typeof DOCUMENT_VARIABLES)[number]['key']
