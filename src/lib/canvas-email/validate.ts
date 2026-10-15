import { type CanvasOpError, validateDocument } from '@/src/lib/canvas/ops'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import { emailCatalog } from './catalog'
import { HTML_BLOCK } from './components/advanced'
import { BODY, FOOTER } from './components/layout'
import { sanitizeRichText } from './rich-text'
import { sanitizeEmailHtml } from './sanitize-html'

/**
 * Server-side checks of an e-mail canvas document: the engine's
 * `validateDocument` (shape, catalog rules, every props schema) plus the
 * e-mail rules the engine cannot express (footer last, size cap).
 */

/** Hard cap on nodes — far above any real e-mail, below abuse. */
export const MAX_EMAIL_NODES = 1500

function labelOf(catalog: CanvasCatalog, type: string): string {
  return catalog.components[type]?.label ?? type
}

/** pt-BR message of an engine error (shown in the editor toast/422 body). */
export function describeCanvasError(
  error: CanvasOpError,
  catalog: CanvasCatalog = emailCatalog,
): string {
  switch (error.code) {
    case 'NODE_NOT_FOUND':
      return `Um elemento do e-mail não foi encontrado (${error.id})`
    case 'NOT_ACCEPTED':
      return `"${labelOf(catalog, error.childType)}" não pode ficar dentro de "${labelOf(catalog, error.parentType)}"`
    case 'MAX_CHILDREN':
      return `"${labelOf(catalog, error.parentType)}" aceita no máximo ${error.max} itens`
    case 'MIN_CHILDREN':
      return `"${labelOf(catalog, error.parentType)}" precisa de pelo menos ${error.min} item`
    case 'REQUIRED':
      return `O e-mail precisa de "${labelOf(catalog, error.type)}"`
    case 'UNIQUE':
      return `Só pode haver um "${labelOf(catalog, error.type)}" no e-mail`
    case 'INVALID_PROPS':
      return `Valores inválidos no elemento ${error.id}: ${error.issues.join('; ')}`
    case 'UNKNOWN_TYPE':
      return `Tipo de bloco desconhecido: ${error.type}`
    case 'CYCLE':
      return `O elemento ${error.id} aparece em dois lugares`
    case 'INVALID_DOCUMENT':
      return `Documento inválido: ${error.reason}`
    default:
      return `Operação recusada (${error.code})`
  }
}

/**
 * Full validation of a stored/incoming v2 document. Returns the document or
 * every problem as a pt-BR message.
 */
export function validateEmailDocument(
  input: unknown,
  catalog: CanvasCatalog = emailCatalog,
): Result<CanvasDocument, string[]> {
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as { nodes?: unknown }).nodes === 'object' &&
    (input as { nodes?: object }).nodes !== null &&
    Object.keys((input as { nodes: object }).nodes).length > MAX_EMAIL_NODES
  ) {
    return err([`O e-mail passou do limite de ${MAX_EMAIL_NODES} elementos`])
  }
  const validated = validateDocument(input, catalog)
  if (!validated.ok) {
    return err([
      ...new Set(validated.error.map((e) => describeCanvasError(e, catalog))),
    ])
  }
  const doc = validated.value
  const root = doc.nodes[doc.rootId]
  // The root has at least one child (`minChildren`), checked above.
  const last = (root.children as string[]).at(-1) as string
  if (doc.nodes[last].type !== FOOTER) {
    return err(['O rodapé precisa ser o último elemento do e-mail'])
  }
  return ok(doc)
}

/**
 * Copy ready to store: the footer moved to the end of the body, rich text
 * and HTML blocks sanitized. Runs before `validateEmailDocument` on save;
 * leaves anything it does not recognize for the validator to report.
 */
export function normalizeEmailDocument<T>(input: T): T {
  if (typeof input !== 'object' || input === null) return input
  const doc = structuredClone(input) as unknown as CanvasDocument
  if (typeof doc.nodes !== 'object' || doc.nodes === null) return input
  for (const node of Object.values(doc.nodes)) {
    if (typeof node !== 'object' || node === null) continue
    const props = node.props as Record<string, unknown> | undefined
    if (!props) continue
    if (node.type === 'email.text' && typeof props.html === 'string') {
      props.html = sanitizeRichText(props.html)
    }
    if (node.type === HTML_BLOCK && typeof props.html === 'string') {
      props.html = sanitizeEmailHtml(props.html)
    }
  }
  const root = doc.nodes[doc.rootId] as CanvasNode | undefined
  if (root?.type === BODY && Array.isArray(root.children)) {
    const isFooter = (id: string) => doc.nodes[id]?.type === FOOTER
    root.children = [
      ...root.children.filter((id) => !isFooter(id)),
      ...root.children.filter(isFooter),
    ]
  }
  return doc as unknown as T
}

function htmlBlocks(doc: CanvasDocument | null): Map<string, string> {
  const blocks = new Map<string, string>()
  if (!doc) return blocks
  for (const node of Object.values(doc.nodes)) {
    if (node.type === HTML_BLOCK) {
      blocks.set(node.id, String((node.props as { html?: unknown }).html))
    }
  }
  return blocks
}

/** Whether `next` adds an HTML block or changes the code of one, compared
 * with `previous` (only admins may). Removing one is allowed. */
export function changesHtmlBlocks(
  previous: CanvasDocument | null,
  next: CanvasDocument,
): boolean {
  const before = htmlBlocks(previous)
  for (const [id, html] of htmlBlocks(next)) {
    if (before.get(id) !== html) return true
  }
  return false
}

/** CRM product ids referenced by product blocks (visible or not). */
export function productIdsOf(doc: CanvasDocument): string[] {
  const ids = new Set<string>()
  for (const node of Object.values(doc.nodes)) {
    const productId = (node.props as { productId?: unknown }).productId
    if (node.type === 'email.product' && typeof productId === 'string') {
      ids.add(productId)
    }
  }
  return [...ids]
}
