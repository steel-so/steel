import { createId } from '@paralleldrive/cuid2'
import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import {
  type CanvasDocument,
  type CanvasFragment,
  type CanvasNode,
  type CanvasNodeId,
  ROOT_ID,
} from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import {
  EMAIL_BLOCK_TYPES,
  EMAIL_CATALOG_ID,
  EMAIL_CATALOG_VERSION,
  emailCatalog,
} from './catalog'
import {
  BODY,
  COLUMN,
  defaultBodyProps,
  defaultColumnProps,
  defaultFooterProps,
  defaultSectionProps,
  FOOTER,
  SECTION,
} from './components/layout'
import {
  changesHtmlBlocks,
  normalizeEmailDocument,
  validateEmailDocument,
} from './validate'

/**
 * Detached pieces of an e-mail (saved blocks, AI-generated sections):
 * what may be saved, and the same validation a whole document gets — the
 * fragment is placed in a minimal e-mail (body → section → column → …,
 * footer) and checked by the catalog, so nothing invalid is ever stored or
 * inserted.
 */

/** Largest fragment accepted (a few sections' worth of blocks). */
export const MAX_FRAGMENT_NODES = 300

/** A saved block is a section (with its columns) or a single block. */
export type EmailFragmentKind = 'section' | 'block'

export function fragmentKindOf(
  type: string | undefined,
): EmailFragmentKind | null {
  if (type === SECTION) return 'section'
  if (type && EMAIL_BLOCK_TYPES.includes(type)) return 'block'
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The fragment inside a minimal e-mail, with wrapper ids that cannot
 * clash with the fragment's own. */
function wrapInDocument(
  fragment: CanvasFragment,
  kind: EmailFragmentKind,
  withFooter = true,
) {
  const fresh = () => {
    let id = createId()
    while (Object.hasOwn(fragment.nodes, id)) id = createId()
    return id
  }
  const footer = fresh()
  const nodes: Record<CanvasNodeId, CanvasNode> = { ...fragment.nodes }
  let top = fragment.rootId
  if (kind === 'block') {
    const section = fresh()
    const column = fresh()
    nodes[section] = {
      id: section,
      type: SECTION,
      props: defaultSectionProps(),
      children: [column],
    }
    nodes[column] = {
      id: column,
      type: COLUMN,
      props: defaultColumnProps(),
      children: [fragment.rootId],
    }
    top = section
  }
  nodes[ROOT_ID] = {
    id: ROOT_ID,
    type: BODY,
    props: defaultBodyProps(),
    children: withFooter ? [top, footer] : [top],
  }
  if (withFooter) {
    nodes[footer] = {
      id: footer,
      type: FOOTER,
      props: defaultFooterProps(),
    }
  }
  const doc: CanvasDocument = {
    catalog: EMAIL_CATALOG_ID,
    version: EMAIL_CATALOG_VERSION,
    rootId: ROOT_ID,
    nodes,
  }
  return doc
}

/** Ids of a subtree, root first. */
function subtreeIds(doc: CanvasDocument, rootId: CanvasNodeId): CanvasNodeId[] {
  const ids: CanvasNodeId[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop() as CanvasNodeId
    ids.push(id)
    const node = getNode(doc, id)
    for (const child of [...(node?.children ?? [])].reverse()) stack.push(child)
  }
  return ids
}

export type ValidatedEmailFragment = {
  fragment: CanvasFragment
  kind: EmailFragmentKind
  /** Carries an HTML block (only admins may save one). */
  hasHtml: boolean
  nodeCount: number
}

/**
 * Validates an incoming fragment (saved block or AI output) against the
 * e-mail catalog and returns it normalized (rich text and HTML sanitized).
 * pt-BR messages on failure.
 */
export function validateEmailFragment(
  input: unknown,
  catalog: CanvasCatalog = emailCatalog,
): Result<ValidatedEmailFragment, string[]> {
  if (
    !isRecord(input) ||
    typeof input.rootId !== 'string' ||
    !isRecord(input.nodes)
  ) {
    return err(['Bloco inválido'])
  }
  if (input.roots !== undefined) {
    return err(['Salve um bloco ou uma seção por vez'])
  }
  const nodes = input.nodes as Record<string, unknown>
  const count = Object.keys(nodes).length
  if (count > MAX_FRAGMENT_NODES) {
    return err([`O bloco passou do limite de ${MAX_FRAGMENT_NODES} elementos`])
  }
  if (Object.hasOwn(nodes, ROOT_ID)) return err(['Bloco inválido'])
  const root = nodes[input.rootId]
  const kind = fragmentKindOf(
    isRecord(root) && typeof root.type === 'string' ? root.type : undefined,
  )
  if (!kind) {
    return err(['Só seções e blocos de conteúdo podem ser salvos'])
  }
  const fragment = input as unknown as CanvasFragment
  const doc = normalizeEmailDocument(wrapInDocument(fragment, kind))
  const validated = validateEmailDocument(doc, catalog)
  if (!validated.ok) return validated

  const clean: CanvasFragment = { rootId: fragment.rootId, nodes: {} }
  for (const id of subtreeIds(validated.value, fragment.rootId)) {
    clean.nodes[id] = validated.value.nodes[id]
  }
  return ok({
    fragment: clean,
    kind,
    hasHtml: changesHtmlBlocks(null, validated.value),
    nodeCount: count,
  })
}

/**
 * A fragment alone in an e-mail (no footer), for previews and thumbnails —
 * render only, it does not validate. `null` when the root is neither a
 * section nor a block.
 */
export function fragmentPreviewDocument(
  fragment: CanvasFragment,
): CanvasDocument | null {
  const kind = fragmentKindOf(fragment.nodes[fragment.rootId]?.type)
  return kind ? wrapInDocument(fragment, kind, false) : null
}

/** Types in a fragment (for the list badge and search). */
export function fragmentTypes(fragment: CanvasFragment): string[] {
  return [...new Set(Object.values(fragment.nodes).map((node) => node.type))]
}
