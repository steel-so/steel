import { type CanvasOpError, createDocument } from '@/src/lib/canvas/ops'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  SITE_TYPES,
  siteCatalog,
  validateSiteDocument as validateWithCatalog,
} from '@/src/lib/canvas-site'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Server-side checks of a `site` canvas document: the catalog's full
 * validation (tree, catalog rules, every node's props) plus a size cap,
 * with every problem as a pt-BR line for the editor and the API.
 */

/** Hard cap on nodes per document — far above a real page, below abuse. */
export const MAX_SITE_NODES = 3000

function labelOf(type: string): string {
  return Object.hasOwn(siteCatalog.components, type)
    ? siteCatalog.components[type].label
    : type
}

/** pt-BR message of a catalog/engine validation error. */
export function describeSiteError(error: CanvasOpError): string {
  switch (error.code) {
    case 'NODE_NOT_FOUND':
      return `Elemento não encontrado: ${error.id}`
    case 'NOT_ACCEPTED':
      return `"${labelOf(error.childType)}" não pode ficar dentro de "${labelOf(error.parentType)}"`
    case 'MAX_CHILDREN':
      return `"${labelOf(error.parentType)}" aceita no máximo ${error.max} itens`
    case 'MIN_CHILDREN':
      return `"${labelOf(error.parentType)}" precisa de pelo menos ${error.min} item`
    case 'REQUIRED':
      return `A página precisa de "${labelOf(error.type)}"`
    case 'UNIQUE':
      return `Só pode haver um "${labelOf(error.type)}" na página`
    case 'INVALID_PROPS':
      return `Valores inválidos no elemento ${error.id}: ${error.issues.join('; ')}`
    case 'UNKNOWN_TYPE':
      return `Tipo de elemento desconhecido: ${error.type}`
    case 'CYCLE':
      return `O elemento ${error.id} aparece em dois lugares`
    case 'INVALID_DOCUMENT':
      return `Documento inválido: ${error.reason}`
    default:
      return `Documento inválido (${error.code})`
  }
}

function nodeCount(input: unknown): number {
  const nodes = (input as { nodes?: unknown } | null)?.nodes
  return typeof nodes === 'object' && nodes !== null
    ? Object.keys(nodes).length
    : 0
}

/** Validates a stored or incoming document; every problem as a pt-BR line. */
export function validateSiteDocument(
  input: unknown,
): Result<CanvasDocument, string[]> {
  if (nodeCount(input) > MAX_SITE_NODES) {
    return err([`O documento passa do limite de ${MAX_SITE_NODES} elementos`])
  }
  const checked = validateWithCatalog(input)
  if (!checked.ok) return err(checked.error.map(describeSiteError))
  return ok(checked.value)
}

/** Blank page document: the root with the catalog's defaults. */
export function createEmptySiteDocument(): CanvasDocument {
  return createDocument(siteCatalog)
}

/** Public tokens of the CRM forms `site.form` nodes point to
 * (`props.formToken`), so the runtime loads the live forms once per page. */
export function collectFormTokens(documents: CanvasDocument[]): string[] {
  const tokens = new Set<string>()
  for (const doc of documents) {
    for (const node of Object.values(doc.nodes)) {
      const token = node.props.formToken
      if (node.type === SITE_TYPES.form && typeof token === 'string' && token) {
        tokens.add(token)
      }
    }
  }
  return [...tokens]
}

/** Newsletter ids the `site.newsletter-*` nodes point to
 * (`props.newsletterId`), so the runtime loads them once per page. */
export function collectNewsletterIds(documents: CanvasDocument[]): string[] {
  const ids = new Set<string>()
  for (const doc of documents) {
    for (const node of Object.values(doc.nodes)) {
      const id = node.props.newsletterId
      if (
        (node.type === SITE_TYPES.newsletterSubscribe ||
          node.type === SITE_TYPES.newsletterIssues) &&
        typeof id === 'string' &&
        id
      ) {
        ids.add(id)
      }
    }
  }
  return [...ids]
}
