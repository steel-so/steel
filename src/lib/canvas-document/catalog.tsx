import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import { type CanvasDocument, ROOT_ID } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import {
  DOCUMENT_CATALOG_ID,
  DOCUMENT_CATALOG_VERSION,
  DOCUMENT_ROOT_TYPE,
  DOCUMENT_SECTION_TYPE,
} from './constants'
import type { DocumentRenderContext } from './context'

/**
 * CONTRACT STUB (ADR 0063). The documents catalog slice replaces the bodies
 * below with the real catalog (`defineCatalog`, components, inspector). The
 * exported names and signatures are the contract other slices build on.
 */

/** The `document` catalog for a render context (editor, public or print). */
export function createDocumentCatalog(
  _ctx?: Partial<DocumentRenderContext>,
): CanvasCatalog {
  throw new Error('document catalog not implemented yet')
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

/**
 * Validates stored or incoming content against the catalog. The stub checks
 * only the envelope; the catalog slice delegates to `validateDocument`.
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
  const root = doc.rootId ? doc.nodes?.[doc.rootId] : undefined
  if (root?.type !== DOCUMENT_ROOT_TYPE) {
    return err('O documento não tem a raiz esperada')
  }
  return ok(doc as CanvasDocument)
}
