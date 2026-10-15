import { z } from 'zod'
import { type CanvasCatalog, defineCatalog } from '@/src/lib/canvas/registry'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'

/**
 * Small catalog exercising every rule the engine enforces:
 * page (root) > section (max 3, parents: page) > columns (min 1, max 4) >
 * column (accepts by function) > text/button; footer is required + unique.
 */

const responsiveNumber = z.union([
  z.number(),
  z.object({
    base: z.number(),
    tablet: z.number().optional(),
    mobile: z.number().optional(),
  }),
])

const textProps = z.object({
  text: z.string(),
  size: responsiveNumber.optional(),
  style: z
    .object({
      color: z.string().optional(),
      padding: z
        .object({ top: z.number().optional(), left: z.number().optional() })
        .optional(),
    })
    .optional(),
  items: z.array(z.string()).optional(),
})

const noop = () => null

/** Toggle to make text props fail validation (replay-failure tests). */
export const schemaSwitch = { strictText: false }

export const catalog: CanvasCatalog = defineCatalog({
  id: 'demo',
  version: 1,
  rootType: 'demo.page',
  categories: ['Básicos', 'Layout'],
  breakpoints: ['base', 'tablet', 'mobile'],
  renderDocument: ({ children }) => children,
  components: {
    'demo.page': {
      type: 'demo.page',
      label: 'Página',
      icon: 'file',
      propsSchema: z.object({ title: z.string().optional() }),
      defaultProps: () => ({ title: 'Nova página' }),
      accepts: ['demo.section', 'demo.footer'],
      inspector: [],
      template: () => ({
        rootId: 'tpl-page',
        nodes: {
          'tpl-page': {
            id: 'tpl-page',
            type: 'demo.page',
            props: { title: 'Nova página' },
            children: ['tpl-footer'],
          },
          'tpl-footer': {
            id: 'tpl-footer',
            type: 'demo.footer',
            props: { address: 'Rua A, 1' },
          },
        },
      }),
      render: noop,
    },
    'demo.section': {
      type: 'demo.section',
      label: 'Seção',
      icon: 'layout',
      category: 'Layout',
      propsSchema: z.object({ background: z.string().optional() }),
      defaultProps: () => ({}),
      accepts: ['demo.columns', 'demo.text', 'demo.button'],
      parents: ['demo.page'],
      maxChildren: 3,
      inspector: [],
      render: noop,
    },
    'demo.columns': {
      type: 'demo.columns',
      label: 'Colunas',
      icon: 'columns',
      category: 'Layout',
      propsSchema: z.object({ gap: z.number().optional() }),
      defaultProps: () => ({ gap: 8 }),
      accepts: ['demo.column'],
      minChildren: 1,
      maxChildren: 4,
      inspector: [],
      template: () => ({
        rootId: 'cols',
        nodes: {
          cols: {
            id: 'cols',
            type: 'demo.columns',
            props: { gap: 8 },
            children: ['c1', 'c2'],
          },
          c1: { id: 'c1', type: 'demo.column', props: {}, children: [] },
          c2: { id: 'c2', type: 'demo.column', props: {}, children: [] },
        },
      }),
      render: noop,
    },
    'demo.column': {
      type: 'demo.column',
      label: 'Coluna',
      icon: 'column',
      propsSchema: z.object({ width: z.number().optional() }),
      defaultProps: () => ({}),
      accepts: (childType) =>
        childType === 'demo.text' || childType === 'demo.button',
      parents: ['demo.columns'],
      inspector: [],
      render: noop,
    },
    'demo.text': {
      type: 'demo.text',
      label: 'Texto',
      icon: 'text',
      category: 'Básicos',
      propsSchema: textProps.refine(
        (props) => !schemaSwitch.strictText || props.text.startsWith('ok'),
        'texto recusado',
      ),
      defaultProps: () => ({ text: 'Texto' }),
      accepts: false,
      inlineText: { path: 'text', rich: true },
      inspector: [],
      render: noop,
    },
    'demo.button': {
      type: 'demo.button',
      label: 'Botão',
      icon: 'button',
      category: 'Básicos',
      propsSchema: z.object({
        label: z.string().min(1),
        href: z.string().optional(),
      }),
      defaultProps: () => ({ label: 'Clique' }),
      accepts: false,
      inspector: [],
      render: noop,
    },
    'demo.footer': {
      type: 'demo.footer',
      label: 'Rodapé',
      icon: 'footer',
      category: 'Básicos',
      propsSchema: z.object({ address: z.string() }),
      defaultProps: () => ({ address: '' }),
      accepts: false,
      parents: ['demo.page'],
      required: true,
      unique: true,
      inspector: [],
      render: noop,
    },
  },
})

export function node(
  id: CanvasNodeId,
  type: string,
  props: Record<string, unknown>,
  children?: CanvasNodeId[],
): CanvasNode {
  return children ? { id, type, props, children } : { id, type, props }
}

/**
 * root
 * ├─ s1 (section)
 * │  ├─ t1 (text)
 * │  └─ cols (columns)
 * │     ├─ c1 (column) ─ b1 (button)
 * │     └─ c2 (column)
 * ├─ s2 (section) ─ t2 (text)
 * └─ footer
 */
export function sampleDoc(): CanvasDocument {
  return {
    catalog: 'demo',
    version: 1,
    rootId: 'root',
    nodes: {
      root: node('root', 'demo.page', { title: 'Home' }, [
        's1',
        's2',
        'footer',
      ]),
      s1: node('s1', 'demo.section', {}, ['t1', 'cols']),
      t1: node('t1', 'demo.text', { text: 'Olá', style: { color: '#000' } }),
      cols: node('cols', 'demo.columns', { gap: 8 }, ['c1', 'c2']),
      c1: node('c1', 'demo.column', {}, ['b1']),
      c2: node('c2', 'demo.column', {}, []),
      b1: node('b1', 'demo.button', { label: 'Comprar' }),
      s2: node('s2', 'demo.section', {}, ['t2']),
      t2: node('t2', 'demo.text', { text: 'Tchau' }),
      footer: node('footer', 'demo.footer', { address: 'Rua A, 1' }),
    },
  }
}

/** Ids of the tree in pre-order, with each node's children — a readable
 * snapshot for asserting shape. */
export function outline(doc: CanvasDocument): string {
  const walk = (id: CanvasNodeId): string => {
    const children = doc.nodes[id].children
    return children && children.length > 0
      ? `${id}(${children.map(walk).join(',')})`
      : id
  }
  return walk(doc.rootId)
}
