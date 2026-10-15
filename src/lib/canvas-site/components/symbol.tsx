import type { ReactNode } from 'react'
import z from 'zod'
import { getNode } from '@/src/lib/canvas/nodes'
import { getIn, setIn } from '@/src/lib/canvas/path'
import {
  type CanvasCatalog,
  type CanvasRenderProps,
  defineComponent,
} from '@/src/lib/canvas/registry'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { canvasVisibilitySchema } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '../constants'
import type { SiteRenderContext } from '../context'
import { classNames } from '../css'

/**
 * Instance of a reusable component ("Componentes reutilizáveis", a SYMBOL
 * global of the site). The instance stores only which symbol it shows and
 * the texts it overrides; the content always comes from the symbol's
 * document, so editing the master updates every instance. On the canvas the
 * instance is one block: its inner nodes are not selectable.
 */

export const SITE_SYMBOL_TYPE = 'site.symbol'

export const siteSymbolSchema = z.object({
  symbolId: z.string().max(40),
  /** Text per node of the symbol (`nodeId → value` at the node type's
   * inline-text path: heading `text`, text `html`, button `label`). */
  overrides: z.record(z.string(), z.string().max(20000)).optional(),
  visibility: canvasVisibilitySchema.optional(),
})

export type SiteSymbolProps = z.infer<typeof siteSymbolSchema>

/** A symbol document with the instance's text overrides applied (nodes
 * without an override keep their identity). Overrides of nodes the symbol
 * no longer has, or of types without inline text, are ignored. */
export function applySymbolOverrides(
  doc: CanvasDocument,
  overrides: Record<string, string> | undefined,
  catalog: CanvasCatalog,
): CanvasDocument {
  const entries = Object.entries(overrides ?? {})
  if (entries.length === 0) return doc
  const nodes: Record<CanvasNodeId, CanvasNode> = { ...doc.nodes }
  for (const [id, value] of entries) {
    const node = getNode(doc, id)
    const path = node && catalog.components[node.type]?.inlineText?.path
    if (!node || !path) continue
    nodes[id] = { ...node, props: setIn(node.props, path, value) }
  }
  return { ...doc, nodes }
}

/** Nodes of a symbol whose text an instance can override, in render
 * order, with the master's value. */
export function symbolTextNodes(
  doc: CanvasDocument,
  catalog: CanvasCatalog,
): Array<{ id: CanvasNodeId; type: string; rich: boolean; value: string }> {
  const out: Array<{
    id: CanvasNodeId
    type: string
    rich: boolean
    value: string
  }> = []
  const stack = [doc.rootId]
  while (stack.length > 0) {
    const node = getNode(doc, stack.pop() as string)
    if (!node || node.meta?.hidden) continue
    const inline = catalog.components[node.type]?.inlineText
    if (inline) {
      const value = getIn(node.props, inline.path)
      out.push({
        id: node.id,
        type: node.type,
        rich: inline.rich,
        value: typeof value === 'string' ? value : '',
      })
    }
    const children = node.children ?? []
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return out
}

/** Every symbol id the documents show (to compile their CSS and ship
 * only the symbols a page uses). */
export function usedSymbolIds(docs: CanvasDocument[]): string[] {
  const ids = new Set<string>()
  for (const doc of docs) {
    for (const node of Object.values(doc.nodes)) {
      if (node.type !== SITE_SYMBOL_TYPE || node.meta?.hidden) continue
      const id = (node.props as Partial<SiteSymbolProps>).symbolId
      if (typeof id === 'string' && id) ids.add(id)
    }
  }
  return [...ids]
}

function renderTree(
  doc: CanvasDocument,
  id: CanvasNodeId,
  catalog: CanvasCatalog,
): ReactNode {
  const node = getNode(doc, id)
  if (!node || node.meta?.hidden) return null
  const definition = Object.hasOwn(catalog.components, node.type)
    ? catalog.components[node.type]
    : undefined
  if (!definition) return null
  const children = node.children?.map((child) => (
    <SymbolNode key={child} doc={doc} id={child} catalog={catalog} />
  ))
  return definition.render({
    node,
    children,
    breakpoint: 'base',
    editing: false,
  })
}

function SymbolNode({
  doc,
  id,
  catalog,
}: {
  doc: CanvasDocument
  id: CanvasNodeId
  catalog: CanvasCatalog
}): ReactNode {
  return renderTree(doc, id, catalog)
}

/**
 * `nested` builds the catalog the symbol's content renders with (the same
 * context, with this symbol on the stack so a symbol never renders inside
 * itself).
 */
export function symbolDefinition(
  ctx: SiteRenderContext,
  nested: (ctx: SiteRenderContext) => CanvasCatalog,
) {
  return defineComponent<SiteSymbolProps>({
    type: SITE_SYMBOL_TYPE,
    label: 'Componente reutilizável',
    icon: 'symbol',
    keywords: ['símbolo', 'componente', 'global', 'reutilizável'],
    propsSchema: siteSymbolSchema,
    defaultProps: () => ({ symbolId: '', overrides: {} }),
    accepts: false,
    parents: [SITE_TYPES.page],
    inspector: [
      {
        id: 'symbol',
        label: 'Componente',
        tab: 'content',
        fields: ctx.symbolControl
          ? [
              {
                path: 'overrides',
                label: 'Textos desta cópia',
                control: { kind: 'custom', component: ctx.symbolControl },
              },
            ]
          : [],
      },
      {
        id: 'visibility',
        label: 'Visibilidade',
        tab: 'advanced',
        fields: [
          {
            path: 'visibility',
            label: 'Mostrar em',
            control: { kind: 'visibility' },
          },
        ],
      },
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SiteSymbolProps>) => {
      const { symbolId } = node.props
      const stack = ctx.symbolStack ?? []
      const master = ctx.symbols?.[symbolId]
      if (!master || stack.includes(symbolId)) {
        return editing ? (
          <div {...attributes} className='s-empty'>
            Componente reutilizável removido
          </div>
        ) : null
      }
      const catalog = nested({ ...ctx, symbolStack: [...stack, symbolId] })
      const doc = applySymbolOverrides(master, node.props.overrides, catalog)
      const root = getNode(doc, doc.rootId)
      return (
        <div
          {...attributes}
          className={classNames(node, 's-symbol')}
          data-symbol={editing ? symbolId : undefined}
        >
          {root?.children?.map((child) => (
            <SymbolNode key={child} doc={doc} id={child} catalog={catalog} />
          ))}
        </div>
      )
    },
  })
}
