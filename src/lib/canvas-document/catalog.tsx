import {
  Add01Icon,
  Attachment01Icon,
  Building03Icon,
  Building06Icon,
  Calendar01Icon,
  Calendar03Icon,
  ChartColumnIcon,
  CheckListIcon,
  CheckmarkBadge01Icon,
  CheckmarkSquare02Icon,
  CodeIcon,
  ContactIcon,
  ContainerIcon,
  Cursor01Icon,
  DashedLine01Icon,
  File02Icon,
  GalleryThumbnailsIcon,
  Heading02Icon,
  HourglassIcon,
  IdIcon,
  Image01Icon,
  InformationCircleIcon,
  InputTextIcon,
  Invoice01Icon,
  Layout01Icon,
  LayoutThreeRowIcon,
  LayoutTwoColumnIcon,
  LeftToRightListBulletIcon,
  ListViewIcon,
  Mail01Icon,
  QuoteDownIcon,
  ScissorIcon,
  SmartPhone01Icon,
  SquareArrowExpand01Icon,
  StarIcon,
  TableIcon,
  TextAlignLeftIcon,
  TextIcon,
  TextNumberSignIcon,
  UserGroupIcon,
  Video01Icon,
  Wallet01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type CanvasOpError, validateDocument } from '@/src/lib/canvas/ops'
import { type CanvasCatalog, defineCatalog } from '@/src/lib/canvas/registry'
import { type CanvasDocument, ROOT_ID } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import { contentDefinitions } from './components/content'
import { functionalDefinitions } from './components/functional'
import { layoutDefinitions } from './components/layout'
import { toDocCtx } from './components/shared'
import {
  DOCUMENT_CATALOG_ID,
  DOCUMENT_CATALOG_VERSION,
  DOCUMENT_ROOT_TYPE,
  DOCUMENT_SECTION_TYPE,
} from './constants'
import type { DocumentRenderContext } from './context'
import { documentRootClass } from './styles'

/**
 * The `document` catalog of Steel Canvas (ADR 0063): root → sections →
 * content, functional elements and form fields. Components render semantic
 * HTML with `d-*` classes (the stylesheet comes from `documentCss`) and
 * inline styles for what the author set. The editor, the public link and
 * the PDF share the same render functions; the mode in the context decides
 * what is a preview, what is live and what is static.
 */

export const DOCUMENT_CATEGORIES = [
  'Estrutura',
  'Texto',
  'Mídia',
  'Destaques',
  'Vendas',
  'Campos',
] as const

export const DOCUMENT_BREAKPOINTS = ['base', 'mobile'] as const

const ICONS = {
  document: File02Icon,
  section: Layout01Icon,
  container: ContainerIcon,
  columns: LayoutTwoColumnIcon,
  column: ContainerIcon,
  divider: DashedLine01Icon,
  spacer: SquareArrowExpand01Icon,
  'page-break': ScissorIcon,
  heading: Heading02Icon,
  text: TextIcon,
  list: LeftToRightListBulletIcon,
  quote: QuoteDownIcon,
  callout: InformationCircleIcon,
  table: TableIcon,
  button: Cursor01Icon,
  image: Image01Icon,
  icon: StarIcon,
  video: Video01Icon,
  gallery: GalleryThumbnailsIcon,
  accordion: LayoutThreeRowIcon,
  'accordion-item': Add01Icon,
  stats: ChartColumnIcon,
  testimonials: UserGroupIcon,
  logos: Building06Icon,
  toc: ListViewIcon,
  contact: ContactIcon,
  accept: CheckmarkBadge01Icon,
  pricing: Invoice01Icon,
  payment: Wallet01Icon,
  attachments: Attachment01Icon,
  validity: HourglassIcon,
  meeting: Calendar03Icon,
  'field-text': InputTextIcon,
  'field-textarea': TextAlignLeftIcon,
  'field-email': Mail01Icon,
  'field-phone': SmartPhone01Icon,
  'field-number': TextNumberSignIcon,
  'field-date': Calendar01Icon,
  'field-select': CheckListIcon,
  'field-checkbox': CheckmarkSquare02Icon,
  'field-id': IdIcon,
  'field-company': Building03Icon,
  variables: CodeIcon,
}

/**
 * Builds the catalog for a render context. `getDocument` gives the
 * elements that read other nodes (table of contents, payment total,
 * section names) the document being rendered; without it — the editor —
 * they read the live document the canvas hands to their `dependsOn`.
 */
export function buildDocumentCatalog(
  ctx?: Partial<DocumentRenderContext>,
  getDocument?: () => CanvasDocument | undefined,
): CanvasCatalog {
  let live: CanvasDocument | undefined
  const remember = (doc: CanvasDocument) => {
    live = doc
  }
  const docCtx = toDocCtx(ctx, getDocument ?? (() => live), remember)
  const definitions = [
    ...layoutDefinitions(docCtx),
    ...contentDefinitions(docCtx),
    ...functionalDefinitions(docCtx),
  ]
  const rootClass = documentRootClass(docCtx.mode, docCtx.settings)
  return defineCatalog({
    id: DOCUMENT_CATALOG_ID,
    version: DOCUMENT_CATALOG_VERSION,
    rootType: DOCUMENT_ROOT_TYPE,
    categories: [...DOCUMENT_CATEGORIES],
    breakpoints: DOCUMENT_BREAKPOINTS,
    icons: ICONS,
    components: Object.fromEntries(
      definitions.map((definition) => [definition.type, definition]),
    ),
    renderDocument: ({ children }) => (
      <div className={rootClass}>{children}</div>
    ),
  })
}

/** The `document` catalog for a render context (editor, public or print). */
export function createDocumentCatalog(
  ctx?: Partial<DocumentRenderContext>,
): CanvasCatalog {
  return buildDocumentCatalog(ctx)
}

/** A new document: the root with one empty section. */
export function createEmptyDocumentContent(): CanvasDocument {
  return {
    catalog: DOCUMENT_CATALOG_ID,
    version: DOCUMENT_CATALOG_VERSION,
    rootId: ROOT_ID,
    nodes: {
      [ROOT_ID]: {
        id: ROOT_ID,
        type: DOCUMENT_ROOT_TYPE,
        props: {},
        children: ['section-1'],
      },
      'section-1': {
        id: 'section-1',
        type: DOCUMENT_SECTION_TYPE,
        props: {},
        children: [],
        meta: { name: 'Seção 1' },
      },
    },
  }
}

let validationCatalog: CanvasCatalog | undefined

/** Context-free catalog used to validate stored and incoming content. */
export function documentCatalog(): CanvasCatalog {
  validationCatalog ??= buildDocumentCatalog()
  return validationCatalog
}

/** pt-BR description of the first problem found in a document. */
export function describeDocumentError(error: CanvasOpError): string {
  switch (error.code) {
    case 'UNKNOWN_TYPE':
      return `elemento desconhecido (${error.type})`
    case 'INVALID_PROPS':
      return `propriedades inválidas em ${error.id}: ${error.issues[0] ?? ''}`
    case 'NOT_ACCEPTED':
      return `${error.childType} não pode ficar dentro de ${error.parentType}`
    case 'MAX_CHILDREN':
      return `${error.parentType} aceita no máximo ${error.max} itens`
    case 'MIN_CHILDREN':
      return `${error.parentType} precisa de pelo menos ${error.min} item`
    case 'UNIQUE':
      return `só pode haver um elemento ${error.type}`
    case 'NODE_NOT_FOUND':
      return `elemento ${error.id} não encontrado`
    case 'CYCLE':
      return `o elemento ${error.id} aparece duas vezes`
    case 'INVALID_DOCUMENT':
      return error.reason
    default:
      return error.code
  }
}

/**
 * Validates stored or incoming content against the catalog: envelope
 * (catalog, version, root), tree, catalog rules and every node's props.
 */
export function validateDocumentContent(
  input: unknown,
): Result<CanvasDocument, string> {
  if (typeof input !== 'object' || input === null) {
    return err('O conteúdo do documento é inválido')
  }
  const doc = input as Partial<CanvasDocument>
  if (doc.catalog !== DOCUMENT_CATALOG_ID) {
    return err('O conteúdo não é de um documento')
  }
  if (doc.version !== DOCUMENT_CATALOG_VERSION) {
    return err('Versão do documento não suportada')
  }
  const root =
    doc.rootId && doc.nodes && Object.hasOwn(doc.nodes, doc.rootId)
      ? doc.nodes[doc.rootId]
      : undefined
  if (root?.type !== DOCUMENT_ROOT_TYPE) {
    return err('O documento não tem a raiz esperada')
  }
  const result = validateDocument(input, documentCatalog())
  if (!result.ok) {
    const first = result.error[0]
    const message = first
      ? `O documento é inválido: ${describeDocumentError(first)}`
      : 'O documento é inválido'
    return err(message)
  }
  return ok(result.value)
}
