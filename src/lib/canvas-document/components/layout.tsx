import type { CSSProperties } from 'react'
import {
  type CanvasComponentDefinition,
  defineComponent,
} from '@/src/lib/canvas/registry'
import type {
  CanvasDocument,
  CanvasFragment,
  CanvasNode,
} from '@/src/lib/canvas/types'
import {
  borderToCss,
  resolveColor,
  spacingToCss,
} from '@/src/lib/canvas/values'
import { BLOCK_TYPE_SET } from '../blocks'
import {
  DOC_END_ATTR,
  DOC_SECTION_ATTR,
  DOC_SECTION_NAME_ATTR,
  DOCUMENT_ROOT_TYPE,
  DOCUMENT_SECTION_TYPE,
} from '../constants'
import {
  alignField,
  backgroundField,
  colorField,
  paddingField,
  radiusField,
  section,
  toggleField,
} from '../inspector'
import {
  COLUMN_RATIOS,
  CONTAINER_STYLES,
  type DocumentColumnProps,
  type DocumentColumnsProps,
  type DocumentContainerProps,
  type DocumentDividerProps,
  type DocumentRootProps,
  type DocumentSectionProps,
  type DocumentSpacerProps,
  documentColumnSchema,
  documentColumnsSchema,
  documentContainerSchema,
  documentDividerSchema,
  documentPageBreakSchema,
  documentRootSchema,
  documentSectionSchema,
  documentSpacerSchema,
} from '../schemas'
import { documentSections } from '../sections'
import { backgroundCss, type DocCtx } from './shared'

/** Structure of a document: root, sections, containers, columns and the
 * spacing elements (divider, spacer, page break). */

const END_MARKER = { [DOC_END_ATTR]: '' }

const ALIGN_ITEMS: Record<string, string> = {
  top: 'start',
  center: 'center',
  bottom: 'end',
}

const SECTION_NAMES = new WeakMap<CanvasDocument, Map<string, string>>()

/** Analytics name of a section (layer name, first heading, "Seção N"). */
export function sectionName(ctx: DocCtx, node: CanvasNode): string {
  const doc = ctx.getDocument()
  if (doc) {
    let names = SECTION_NAMES.get(doc)
    if (!names) {
      names = new Map()
      for (const info of documentSections(doc)) names.set(info.id, info.name)
      SECTION_NAMES.set(doc, names)
    }
    const name = names.get(node.id)
    if (name) return name
  }
  return node.meta?.name?.trim() || 'Seção'
}

const SECTION_VARIANT_OPTIONS = [
  { value: 'default', label: 'Padrão' },
  { value: 'cover', label: 'Capa' },
  { value: 'highlight', label: 'Destaque' },
]

const CONTAINER_STYLE_LABELS: Record<string, string> = {
  plain: 'Sem moldura',
  card: 'Cartão',
  soft: 'Fundo suave',
  outline: 'Contorno',
}

const RATIO_LABELS: Record<string, string> = {
  '1-1': '2 colunas iguais',
  '1-2': 'Estreita + larga',
  '2-1': 'Larga + estreita',
  '1-1-1': '3 colunas iguais',
  '1-2-1': 'Larga no meio',
  '1-1-1-1': '4 colunas iguais',
}

/** `grid-template-columns` for a ratio; equal columns when the ratio does
 * not match the number of columns. */
export function columnsTemplate(
  ratio: string | undefined,
  count: number,
): string {
  const parts = (ratio ?? '').split('-').map(Number)
  const columns = Math.max(count, 1)
  const valid =
    parts.length === columns &&
    parts.every((part) => Number.isFinite(part) && part > 0)
  const weights = valid ? parts : Array.from({ length: columns }, () => 1)
  return weights.map((weight) => `minmax(0,${weight}fr)`).join(' ')
}

function textFragment(id: string, html: string): CanvasFragment['nodes'] {
  return {
    [id]: { id, type: 'text', props: { html } },
  }
}

export function layoutDefinitions(ctx: DocCtx): CanvasComponentDefinition[] {
  const editing = ctx.mode === 'editor'

  const root = defineComponent<DocumentRootProps>({
    type: DOCUMENT_ROOT_TYPE,
    label: 'Documento',
    icon: 'document',
    propsSchema: documentRootSchema,
    defaultProps: () => ({}),
    accepts: [DOCUMENT_SECTION_TYPE],
    inspector: [],
    render: ({ attributes, children }) => (
      <div {...attributes} className='d-doc'>
        {children}
        {editing ? null : (
          <div {...END_MARKER} className='d-end' aria-hidden='true' />
        )}
      </div>
    ),
  })

  const sectionDef = defineComponent<DocumentSectionProps>({
    type: DOCUMENT_SECTION_TYPE,
    label: 'Seção',
    icon: 'section',
    category: 'Estrutura',
    keywords: ['seção', 'secao', 'bloco', 'parte', 'capa', 'página'],
    propsSchema: documentSectionSchema,
    defaultProps: () => ({}),
    accepts: (type) => BLOCK_TYPE_SET.has(type),
    parents: [DOCUMENT_ROOT_TYPE],
    template: () => ({
      rootId: 'section',
      nodes: {
        section: {
          id: 'section',
          type: DOCUMENT_SECTION_TYPE,
          props: {},
          children: ['title', 'body'],
        },
        title: {
          id: 'title',
          type: 'heading',
          props: { text: 'Título da seção', level: 2 },
        },
        ...textFragment(
          'body',
          '<p>Escreva aqui o conteúdo desta parte do documento.</p>',
        ),
      },
    }),
    inspector: [
      section('section', 'Seção', [
        {
          path: 'variant',
          label: 'Estilo',
          help: 'Capa ocupa uma página inteira no PDF; Destaque usa o fundo suave do tema.',
          control: { kind: 'segmented', options: SECTION_VARIANT_OPTIONS },
        },
        toggleField(
          'pageBreakBefore',
          'Começar em nova página',
          'Vale para o layout paginado e para o PDF.',
        ),
        alignField,
      ]),
      section(
        'section-style',
        'Fundo e espaçamento',
        [backgroundField, paddingField],
        'style',
      ),
    ],
    render: ({ node, attributes, children }) => {
      const p = node.props
      const variant = p.variant ?? 'default'
      const styled = !!p.background && p.background.kind !== 'none'
      let className = 'd-section'
      if (variant !== 'default') className += ` d-section--${variant}`
      if (styled) className += ' d-section--styled'
      if (p.background?.kind === 'image') className += ' d-section--image'
      const style: CSSProperties = {
        ...backgroundCss(p.background),
        padding: spacingToCss(p.padding),
        textAlign: p.align,
      }
      const tracker: Record<string, string> = {}
      if (!editing) {
        tracker[DOC_SECTION_ATTR] = node.id
        tracker[DOC_SECTION_NAME_ATTR] = sectionName(ctx, node)
      }
      return (
        <section
          {...attributes}
          {...tracker}
          id={`d-sec-${node.id}`}
          className={className}
          style={style}
          data-page-break-before={p.pageBreakBefore ? '' : undefined}
        >
          <div className='d-section-inner'>{children}</div>
        </section>
      )
    },
  })

  const container = defineComponent<DocumentContainerProps>({
    type: 'container',
    label: 'Caixa',
    icon: 'container',
    category: 'Estrutura',
    keywords: ['caixa', 'cartão', 'cartao', 'grupo', 'container', 'moldura'],
    propsSchema: documentContainerSchema,
    defaultProps: () => ({ style: 'card' }),
    accepts: (type) => BLOCK_TYPE_SET.has(type),
    inspector: [
      section('container', 'Caixa', [
        {
          path: 'style',
          label: 'Moldura',
          control: {
            kind: 'select',
            options: CONTAINER_STYLES.map((value) => ({
              value,
              label: CONTAINER_STYLE_LABELS[value],
            })),
          },
        },
        alignField,
        {
          path: 'maxWidth',
          label: 'Largura máxima (px)',
          help: 'Vazio ocupa toda a largura.',
          control: { kind: 'number', min: 120, max: 1400, unit: 'px' },
        },
      ]),
      section(
        'container-style',
        'Aparência',
        [
          backgroundField,
          paddingField,
          { path: 'border', label: 'Borda', control: { kind: 'border' } },
          radiusField,
        ],
        'style',
      ),
    ],
    render: ({ node, attributes, children }) => {
      const p = node.props
      const style: CSSProperties = {
        ...backgroundCss(p.background),
        padding: spacingToCss(p.padding),
        border: borderToCss(p.border),
        borderRadius: p.radius,
        textAlign: p.align,
      }
      if (p.maxWidth) {
        style.maxWidth = p.maxWidth
        style.width = '100%'
        style.alignSelf = 'center'
      }
      const variant = p.style ?? 'plain'
      return (
        <div
          {...attributes}
          className={`d-container d-container--${variant}`}
          style={style}
        >
          {children}
        </div>
      )
    },
  })

  const columns = defineComponent<DocumentColumnsProps>({
    type: 'columns',
    label: 'Colunas',
    icon: 'columns',
    category: 'Estrutura',
    keywords: ['colunas', 'lado a lado', 'grade', 'duas colunas'],
    propsSchema: documentColumnsSchema,
    defaultProps: () => ({ ratio: '1-1' }),
    accepts: ['column'],
    minChildren: 1,
    maxChildren: 4,
    template: () => ({
      rootId: 'columns',
      nodes: {
        columns: {
          id: 'columns',
          type: 'columns',
          props: { ratio: '1-1' },
          children: ['left', 'right'],
        },
        left: { id: 'left', type: 'column', props: {}, children: ['a'] },
        right: { id: 'right', type: 'column', props: {}, children: ['b'] },
        ...textFragment('a', '<p>Conteúdo da primeira coluna.</p>'),
        ...textFragment('b', '<p>Conteúdo da segunda coluna.</p>'),
      },
    }),
    inspector: [
      section('columns', 'Colunas', [
        {
          path: 'ratio',
          label: 'Proporção',
          help: 'Use uma proporção com o mesmo número de colunas.',
          control: {
            kind: 'select',
            options: COLUMN_RATIOS.map((value) => ({
              value,
              label: RATIO_LABELS[value],
            })),
          },
        },
        {
          path: 'gap',
          label: 'Espaço entre colunas (px)',
          control: { kind: 'number', min: 0, max: 120, unit: 'px' },
        },
        {
          path: 'verticalAlign',
          label: 'Alinhamento vertical',
          control: {
            kind: 'segmented',
            options: [
              { value: 'top', label: 'Topo', icon: 'align-top' },
              { value: 'center', label: 'Meio', icon: 'align-middle' },
              { value: 'bottom', label: 'Base', icon: 'align-bottom' },
            ],
          },
        },
        toggleField(
          'stackOnMobile',
          'Empilhar no celular',
          'Abaixo de 640 px as colunas ficam uma embaixo da outra.',
        ),
      ]),
    ],
    render: ({ node, attributes, children }) => {
      const p = node.props
      const stack = p.stackOnMobile !== false
      const template = columnsTemplate(p.ratio, node.children?.length ?? 1)
      return (
        <div
          {...attributes}
          className={stack ? 'd-cols d-cols--stack' : 'd-cols'}
          style={{
            gridTemplateColumns: template,
            gap: p.gap,
            alignItems: ALIGN_ITEMS[p.verticalAlign ?? 'top'],
          }}
        >
          {children}
        </div>
      )
    },
  })

  const column = defineComponent<DocumentColumnProps>({
    type: 'column',
    label: 'Coluna',
    icon: 'column',
    propsSchema: documentColumnSchema,
    defaultProps: () => ({}),
    accepts: (type) => BLOCK_TYPE_SET.has(type) && type !== 'columns',
    parents: ['columns'],
    inspector: [
      section(
        'column-style',
        'Aparência',
        [backgroundField, paddingField, radiusField],
        'style',
      ),
    ],
    render: ({ node, attributes, children }) => (
      <div
        {...attributes}
        className='d-col'
        style={{
          ...backgroundCss(node.props.background),
          padding: spacingToCss(node.props.padding),
          borderRadius: node.props.radius,
        }}
      >
        {children}
      </div>
    ),
  })

  const divider = defineComponent<DocumentDividerProps>({
    type: 'divider',
    label: 'Divisor',
    icon: 'divider',
    category: 'Estrutura',
    keywords: ['linha', 'separador', 'divisor'],
    propsSchema: documentDividerSchema,
    defaultProps: () => ({}),
    accepts: false,
    resizable: {
      widthPath: 'width',
      widthUnit: '%',
      min: { width: 10 },
      max: { width: 100 },
    },
    inspector: [
      section(
        'divider',
        'Divisor',
        [
          {
            path: 'style',
            label: 'Traço',
            control: {
              kind: 'segmented',
              options: [
                { value: 'solid', label: 'Contínuo' },
                { value: 'dashed', label: 'Tracejado' },
                { value: 'dotted', label: 'Pontilhado' },
              ],
            },
          },
          colorField('color', 'Cor'),
          {
            path: 'thickness',
            label: 'Espessura (px)',
            control: { kind: 'number', min: 1, max: 8, unit: 'px' },
          },
          {
            path: 'width',
            label: 'Largura (%)',
            control: { kind: 'number', min: 10, max: 100, unit: '%' },
          },
        ],
        'style',
      ),
    ],
    render: ({ node, attributes }) => {
      const p = node.props
      return (
        <hr
          {...attributes}
          className='d-divider'
          style={{
            borderTopStyle: p.style,
            borderTopColor: resolveColor(p.color),
            borderTopWidth: p.thickness,
            width: p.width ? `${p.width}%` : undefined,
          }}
        />
      )
    },
  })

  const spacer = defineComponent<DocumentSpacerProps>({
    type: 'spacer',
    label: 'Espaço',
    icon: 'spacer',
    category: 'Estrutura',
    keywords: ['espaço', 'espaco', 'respiro', 'margem'],
    propsSchema: documentSpacerSchema,
    defaultProps: () => ({ height: 32 }),
    accepts: false,
    resizable: {
      heightPath: 'height',
      min: { height: 0 },
      max: { height: 400 },
    },
    inspector: [
      section('spacer', 'Espaço', [
        {
          path: 'height',
          label: 'Altura (px)',
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
      ]),
    ],
    render: ({ node, attributes }) => (
      <div
        {...attributes}
        aria-hidden='true'
        style={{ height: node.props.height ?? 32 }}
      />
    ),
  })

  const pageBreak = defineComponent<DocumentRootProps>({
    type: 'page-break',
    label: 'Quebra de página',
    icon: 'page-break',
    category: 'Estrutura',
    keywords: ['quebra', 'página', 'pagina', 'nova página', 'pdf'],
    propsSchema: documentPageBreakSchema,
    defaultProps: () => ({}),
    accepts: false,
    inspector: [],
    render: ({ attributes }) => (
      <div {...attributes} className='d-pagebreak' aria-hidden='true'>
        {editing ? 'Quebra de página' : null}
      </div>
    ),
  })

  return [
    root,
    sectionDef,
    container,
    columns,
    column,
    divider,
    spacer,
    pageBreak,
  ]
}
