import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { ROOT_ID } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Server-side checks of a `site` canvas document.
 *
 * TODO(sites-integration): the `site` catalog (src/lib/canvas-site, slice
 * site-catalog) owns the full validation — engine rules plus every props
 * schema. Until it lands this checks the envelope and the tree only; swap
 * the body of `validateSiteDocument` for the catalog's `validateDocument`
 * and keep the signature (callers expect pt-BR messages).
 */

export const SITE_CATALOG_ID = 'site'
export const SITE_CATALOG_VERSION = 1
export const SITE_ROOT_TYPE = 'site.page'
/** Hard cap on nodes per document — far above a real page, below abuse. */
export const MAX_SITE_NODES = 3000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeShape(value: unknown, key: string): value is CanvasNode {
  if (!isRecord(value)) return false
  if (value.id !== key || typeof value.type !== 'string') return false
  if (!value.type.startsWith(`${SITE_CATALOG_ID}.`)) return false
  if (!isRecord(value.props)) return false
  if (value.meta !== undefined && !isRecord(value.meta)) return false
  return (
    value.children === undefined ||
    (Array.isArray(value.children) &&
      value.children.every((child) => typeof child === 'string'))
  )
}

/** Validates a stored or incoming document; every problem as a pt-BR line. */
export function validateSiteDocument(
  input: unknown,
): Result<CanvasDocument, string[]> {
  if (!isRecord(input)) return err(['O documento precisa ser um objeto'])
  const problems: string[] = []
  if (input.catalog !== SITE_CATALOG_ID) {
    problems.push(`O catálogo do documento precisa ser "${SITE_CATALOG_ID}"`)
  }
  if (input.version !== SITE_CATALOG_VERSION) {
    problems.push(`A versão do documento precisa ser ${SITE_CATALOG_VERSION}`)
  }
  if (input.rootId !== ROOT_ID) {
    problems.push(`A raiz do documento precisa ser "${ROOT_ID}"`)
  }
  if (!isRecord(input.nodes)) {
    return err([...problems, 'O documento não tem elementos'])
  }
  const nodes = input.nodes
  const keys = Object.keys(nodes)
  if (keys.length > MAX_SITE_NODES) {
    return err([
      ...problems,
      `O documento passa do limite de ${MAX_SITE_NODES} elementos`,
    ])
  }
  for (const key of keys) {
    if (!isNodeShape(nodes[key], key)) {
      problems.push(`Elemento malformado: ${key}`)
    }
  }
  if (problems.length > 0) return err(problems)

  const doc = input as unknown as CanvasDocument
  const root = Object.hasOwn(doc.nodes, ROOT_ID) ? doc.nodes[ROOT_ID] : null
  if (!root) return err(['O documento não tem o elemento raiz'])
  if (root.type !== SITE_ROOT_TYPE) {
    problems.push(`O elemento raiz precisa ser "${SITE_ROOT_TYPE}"`)
  }

  const reachable = new Set<CanvasNodeId>([ROOT_ID])
  const stack: CanvasNodeId[] = [ROOT_ID]
  while (stack.length > 0) {
    const node = doc.nodes[stack.pop() as CanvasNodeId]
    for (const child of node.children ?? []) {
      if (!Object.hasOwn(doc.nodes, child)) {
        problems.push(`Elemento não encontrado: ${child}`)
      } else if (reachable.has(child)) {
        problems.push(`O elemento ${child} aparece em dois lugares`)
      } else {
        reachable.add(child)
        stack.push(child)
      }
    }
  }
  for (const key of keys) {
    if (!reachable.has(key)) problems.push(`Elemento solto: ${key}`)
  }
  return problems.length > 0 ? err(problems) : ok(doc)
}

/** Blank page document: just the root. */
export function createEmptySiteDocument(): CanvasDocument {
  return {
    catalog: SITE_CATALOG_ID,
    version: SITE_CATALOG_VERSION,
    rootId: ROOT_ID,
    nodes: {
      [ROOT_ID]: { id: ROOT_ID, type: SITE_ROOT_TYPE, props: {}, children: [] },
    },
  }
}

/** Public tokens of the CRM forms `site.form` nodes point to
 * (`props.formToken`, as in the `site` catalog), so the runtime loads the
 * live forms once per page. */
export function collectFormTokens(documents: CanvasDocument[]): string[] {
  const tokens = new Set<string>()
  for (const doc of documents) {
    for (const node of Object.values(doc.nodes)) {
      const token = node.props.formToken
      if (node.type === 'site.form' && typeof token === 'string' && token) {
        tokens.add(token)
      }
    }
  }
  return [...tokens]
}
