import {
  Cursor01Icon,
  File02Icon,
  Heading02Icon,
  Image01Icon,
  Layout01Icon,
  LayoutLeftIcon,
  LayoutTwoColumnIcon,
  LeftToRightListBulletIcon,
  TextIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { CSSProperties } from 'react'
import { z } from 'zod'
import { resolveResponsive } from '@/src/lib/canvas/ops'
import {
  type CanvasCatalog,
  type CanvasRenderProps,
  defineCatalog,
  defineComponent,
  type InspectorSection,
} from '@/src/lib/canvas/registry'
import type {
  CanvasBreakpoint,
  CanvasDocument,
  CanvasFragment,
  CanvasNode,
} from '@/src/lib/canvas/types'
import {
  backgroundToCss,
  borderToCss,
  type CanvasColorToken,
  canvasBackgroundSchema,
  canvasBorderSchema,
  canvasColorSchema,
  canvasImageSchema,
  canvasLinkSchema,
  canvasRadiusSchema,
  canvasShadowSchema,
  canvasSizeSchema,
  canvasSpacingSchema,
  canvasTypographySchema,
  canvasVisibilitySchema,
  linkHref,
  radiusToCss,
  resolveColor,
  responsiveSchema,
  shadowToCss,
  sizeToCss,
  spacing,
  spacingToCss,
  typographyToCss,
  VISIBLE_EVERYWHERE,
} from '@/src/lib/canvas/values'
import type { CanvasPresetItem } from '../types'

/**
 * Demo catalog for the shell playground (`/[workspace]/canvas-lab`) and the
 * component tests: a small site-like catalog that exercises every inspector
 * control, responsive values, templates and the catalog rules. Not a
 * product catalog.
 */

export const DEMO_TOKENS: CanvasColorToken[] = [
  { id: 'primary', label: 'Primária', value: '#2563EB' },
  { id: 'accent', label: 'Destaque', value: '#F59E0B' },
  { id: 'ink', label: 'Texto', value: '#18181B' },
  { id: 'muted', label: 'Texto suave', value: '#71717A' },
  { id: 'surface', label: 'Superfície', value: '#F4F4F5' },
]

const color = (value: string | undefined) => resolveColor(value, DEMO_TOKENS)

const align = z.enum(['left', 'center', 'right'])
const responsiveAlign = responsiveSchema(align)
const responsiveSpacing = responsiveSchema(canvasSpacingSchema)
const responsiveNumber = responsiveSchema(z.number())

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Esquerda', icon: 'text-left' },
  { value: 'center', label: 'Centro', icon: 'text-center' },
  { value: 'right', label: 'Direita', icon: 'text-right' },
]

const visibilityField = {
  path: 'visibility',
  label: 'Mostrar em',
  control: { kind: 'visibility' as const },
}

const advanced: InspectorSection = {
  id: 'advanced',
  label: 'Visibilidade',
  tab: 'advanced',
  fields: [
    visibilityField,
    {
      path: 'anchor',
      label: 'Âncora',
      help: 'Identificador para links do tipo âncora (#contato).',
      control: { kind: 'text', placeholder: 'contato', maxLength: 60 },
    },
  ],
}

const commonAdvanced = {
  visibility: canvasVisibilitySchema.optional(),
  anchor: z.string().max(60).optional(),
}

function hiddenStyle(
  node: CanvasNode,
  breakpoint: CanvasBreakpoint,
  editing: boolean,
): CSSProperties | null {
  const visibility =
    (node.props.visibility as typeof VISIBLE_EVERYWHERE | undefined) ??
    VISIBLE_EVERYWHERE
  if (visibility[breakpoint]) return null
  return editing
    ? {
        opacity: 0.35,
        backgroundImage:
          'repeating-linear-gradient(135deg, transparent 0 6px, rgba(0,0,0,.06) 6px 12px)',
      }
    : { display: 'none' }
}

function EmptySlot({ label }: { label: string }) {
  return (
    <div
      style={{
        border: '1.5px dashed #c7c7d1',
        borderRadius: 8,
        padding: '22px 12px',
        textAlign: 'center',
        color: '#8b8b98',
        font: '500 13px/1.4 system-ui, sans-serif',
        background: 'rgba(244,244,245,.6)',
      }}
    >
      {label}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────

const pageSchema = z.object({
  background: canvasColorSchema,
  textColor: canvasColorSchema,
  fontFamily: z.string().max(200),
})
type PageProps = z.infer<typeof pageSchema>

// ─── section ──────────────────────────────────────────────────────────────

const sectionSchema = z.object({
  background: canvasBackgroundSchema,
  padding: responsiveSpacing,
  border: canvasBorderSchema.optional(),
  radius: canvasRadiusSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  minHeight: canvasSizeSchema.optional(),
  ...commonAdvanced,
})
type SectionProps = z.infer<typeof sectionSchema>

// ─── columns / column ─────────────────────────────────────────────────────

const columnsSchema = z.object({
  gap: responsiveNumber,
  stackOnMobile: z.boolean(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  ...commonAdvanced,
})
type ColumnsProps = z.infer<typeof columnsSchema>

const columnSchema = z.object({
  background: canvasBackgroundSchema,
  padding: canvasSpacingSchema,
  radius: canvasRadiusSchema.optional(),
})
type ColumnProps = z.infer<typeof columnSchema>

// ─── leaves ───────────────────────────────────────────────────────────────

const headingSchema = z.object({
  text: z.string().max(300),
  level: z.enum(['h1', 'h2', 'h3']),
  align: responsiveAlign,
  color: canvasColorSchema.optional(),
  typography: canvasTypographySchema.optional(),
  margin: canvasSpacingSchema.optional(),
  ...commonAdvanced,
})
type HeadingProps = z.infer<typeof headingSchema>

const textSchema = z.object({
  html: z.string().max(20000),
  align: responsiveAlign,
  color: canvasColorSchema.optional(),
  typography: canvasTypographySchema.optional(),
  ...commonAdvanced,
})
type TextProps = z.infer<typeof textSchema>

const buttonSchema = z.object({
  label: z.string().max(80),
  link: canvasLinkSchema,
  variant: z.enum(['solid', 'outline']),
  background: canvasColorSchema,
  textColor: canvasColorSchema,
  align: responsiveAlign,
  padding: canvasSpacingSchema,
  radius: canvasRadiusSchema,
  border: canvasBorderSchema.optional(),
  shadow: canvasShadowSchema.optional(),
  fullWidth: responsiveSchema(z.boolean()),
  typography: canvasTypographySchema.optional(),
  ...commonAdvanced,
})
type ButtonProps = z.infer<typeof buttonSchema>

const imageSchema = z.object({
  image: canvasImageSchema,
  width: responsiveSchema(canvasSizeSchema),
  align: responsiveAlign,
  radius: canvasRadiusSchema.optional(),
  link: canvasLinkSchema.optional(),
  ...commonAdvanced,
})
type ImageProps = z.infer<typeof imageSchema>

const listSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().max(120),
        description: z.string().max(400),
      }),
    )
    .max(12),
  marker: z.enum(['check', 'dot', 'number']),
  accent: canvasColorSchema,
  ...commonAdvanced,
})
type ListProps = z.infer<typeof listSchema>

function rr<T>(value: T | { base: T }, breakpoint: CanvasBreakpoint): T {
  return resolveResponsive(value as T, breakpoint)
}

const LEAF_TYPES = [
  'demo.heading',
  'demo.text',
  'demo.button',
  'demo.image',
  'demo.list',
]

const IMAGE_PLACEHOLDER =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'><defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'><stop offset='0' stop-color='%23dbeafe'/><stop offset='1' stop-color='%23fde68a'/></linearGradient></defs><rect width='640' height='360' fill='url(%23g)'/><circle cx='470' cy='120' r='46' fill='%23fff' fill-opacity='.7'/><path d='M0 360 L210 170 L360 300 L450 230 L640 360 Z' fill='%232563eb' fill-opacity='.35'/></svg>"

function twoColumns(): CanvasFragment {
  return {
    rootId: 'tpl-cols',
    nodes: {
      'tpl-cols': {
        id: 'tpl-cols',
        type: 'demo.columns',
        props: { gap: 24, stackOnMobile: true, verticalAlign: 'top' },
        children: ['tpl-col-a', 'tpl-col-b'],
      },
      'tpl-col-a': {
        id: 'tpl-col-a',
        type: 'demo.column',
        props: { background: { kind: 'none' }, padding: spacing(0) },
        children: [],
      },
      'tpl-col-b': {
        id: 'tpl-col-b',
        type: 'demo.column',
        props: { background: { kind: 'none' }, padding: spacing(0) },
        children: [],
      },
    },
  }
}

export const demoCatalog: CanvasCatalog = defineCatalog({
  id: 'demo',
  version: 1,
  rootType: 'demo.page',
  categories: ['Layout', 'Básicos', 'Mídia'],
  breakpoints: ['base', 'tablet', 'mobile'],
  icons: {
    page: File02Icon,
    section: Layout01Icon,
    columns: LayoutTwoColumnIcon,
    column: LayoutLeftIcon,
    heading: Heading02Icon,
    text: TextIcon,
    button: Cursor01Icon,
    image: Image01Icon,
    list: LeftToRightListBulletIcon,
  },
  renderDocument: ({ children, rootProps }) => {
    const props = rootProps as PageProps
    return (
      <div
        style={{
          background: color(props.background),
          color: color(props.textColor),
          fontFamily: props.fontFamily || 'Inter, system-ui, sans-serif',
          minHeight: '100%',
        }}
      >
        {children}
      </div>
    )
  },
  components: {
    'demo.page': defineComponent<PageProps>({
      type: 'demo.page',
      label: 'Página',
      icon: 'page',
      propsSchema: pageSchema,
      defaultProps: () => ({
        background: '#FFFFFF',
        textColor: 'token:ink',
        fontFamily: '',
      }),
      accepts: ['demo.section'],
      inspector: [
        {
          id: 'page',
          label: 'Página',
          tab: 'content',
          fields: [
            {
              path: 'background',
              label: 'Cor de fundo',
              control: { kind: 'color' },
            },
            {
              path: 'textColor',
              label: 'Cor do texto',
              control: { kind: 'color' },
            },
            {
              path: 'fontFamily',
              label: 'Fonte',
              control: {
                kind: 'select',
                options: [
                  { value: '', label: 'Inter (padrão)' },
                  { value: 'Georgia, serif', label: 'Georgia' },
                  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
                  { value: '"Courier New", monospace', label: 'Courier New' },
                ],
              },
            },
          ],
        },
      ],
      render: ({
        node,
        children,
        attributes,
        editing,
      }: CanvasRenderProps<PageProps>) => (
        <div
          {...attributes}
          style={{ minHeight: '100%', paddingBottom: editing ? 48 : 0 }}
        >
          {children}
          {editing && !node.children?.length && (
            <div style={{ padding: 48 }}>
              <EmptySlot label='Arraste uma Seção para começar' />
            </div>
          )}
        </div>
      ),
    }),

    'demo.section': defineComponent<SectionProps>({
      type: 'demo.section',
      label: 'Seção',
      icon: 'section',
      category: 'Layout',
      keywords: ['bloco', 'faixa', 'container'],
      propsSchema: sectionSchema,
      defaultProps: () => ({
        background: { kind: 'none' },
        padding: spacing(56, 24),
      }),
      accepts: ['demo.columns', ...LEAF_TYPES],
      parents: ['demo.page'],
      inspector: [
        {
          id: 'background',
          label: 'Fundo',
          tab: 'style',
          fields: [
            {
              path: 'background',
              label: 'Fundo',
              control: { kind: 'background' },
            },
          ],
        },
        {
          id: 'spacing',
          label: 'Espaçamento',
          tab: 'style',
          fields: [
            {
              path: 'padding',
              label: 'Margem interna',
              responsive: true,
              control: { kind: 'spacing', max: 400 },
            },
            {
              path: 'minHeight',
              label: 'Altura mínima',
              control: { kind: 'size', units: ['auto', 'px', 'vh'] },
            },
          ],
        },
        {
          id: 'border',
          label: 'Borda e sombra',
          tab: 'style',
          collapsed: true,
          fields: [
            { path: 'border', label: 'Borda', control: { kind: 'border' } },
            { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
            { path: 'shadow', label: 'Sombra', control: { kind: 'shadow' } },
          ],
        },
        advanced,
      ],
      render: ({
        node,
        children,
        attributes,
        breakpoint,
        editing,
      }: CanvasRenderProps<SectionProps>) => {
        const p = node.props
        const pageWidth = 1080
        return (
          <section
            {...attributes}
            id={p.anchor || undefined}
            style={{
              ...backgroundToCss(p.background, DEMO_TOKENS),
              padding: spacingToCss(rr(p.padding, breakpoint)),
              border: borderToCss(p.border, DEMO_TOKENS),
              borderRadius: radiusToCss(p.radius),
              boxShadow: shadowToCss(p.shadow, DEMO_TOKENS),
              minHeight: p.minHeight ? sizeToCss(p.minHeight) : undefined,
              ...hiddenStyle(node, breakpoint, editing),
            }}
          >
            <div
              style={{
                maxWidth: pageWidth,
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {children}
              {editing && !node.children?.length && (
                <EmptySlot label='Arraste componentes para esta seção' />
              )}
            </div>
          </section>
        )
      },
    }),

    'demo.columns': defineComponent<ColumnsProps>({
      type: 'demo.columns',
      label: 'Colunas',
      icon: 'columns',
      category: 'Layout',
      keywords: ['grade', 'linha', 'grid', '2 colunas'],
      propsSchema: columnsSchema,
      defaultProps: () => ({
        gap: 24,
        stackOnMobile: true,
        verticalAlign: 'top',
      }),
      accepts: ['demo.column'],
      parents: ['demo.section'],
      minChildren: 1,
      maxChildren: 4,
      template: twoColumns,
      inspector: [
        {
          id: 'layout',
          label: 'Layout',
          tab: 'content',
          fields: [
            {
              path: 'gap',
              label: 'Espaço entre colunas',
              responsive: true,
              control: { kind: 'number', min: 0, max: 120, unit: 'px' },
            },
            {
              path: 'verticalAlign',
              label: 'Alinhamento vertical',
              control: {
                kind: 'segmented',
                options: [
                  { value: 'top', label: 'Topo', icon: 'align-top' },
                  { value: 'middle', label: 'Meio', icon: 'align-middle' },
                  { value: 'bottom', label: 'Base', icon: 'align-bottom' },
                ],
              },
            },
            {
              path: 'stackOnMobile',
              label: 'Empilhar no celular',
              control: { kind: 'toggle' },
            },
          ],
        },
        advanced,
      ],
      render: ({
        node,
        children,
        attributes,
        breakpoint,
        editing,
      }: CanvasRenderProps<ColumnsProps>) => {
        const p = node.props
        const stacked = p.stackOnMobile && breakpoint === 'mobile'
        return (
          <div
            {...attributes}
            style={{
              display: 'flex',
              flexDirection: stacked ? 'column' : 'row',
              gap: rr(p.gap, breakpoint),
              alignItems: {
                top: 'flex-start',
                middle: 'center',
                bottom: 'flex-end',
              }[p.verticalAlign],
              ...hiddenStyle(node, breakpoint, editing),
            }}
          >
            {children}
          </div>
        )
      },
    }),

    'demo.column': defineComponent<ColumnProps>({
      type: 'demo.column',
      label: 'Coluna',
      icon: 'column',
      propsSchema: columnSchema,
      defaultProps: () => ({
        background: { kind: 'none' },
        padding: spacing(0),
      }),
      accepts: LEAF_TYPES,
      parents: ['demo.columns'],
      inspector: [
        {
          id: 'style',
          label: 'Aparência',
          tab: 'style',
          fields: [
            {
              path: 'background',
              label: 'Fundo',
              control: { kind: 'background', allowImage: false },
            },
            {
              path: 'padding',
              label: 'Margem interna',
              control: { kind: 'spacing' },
            },
            { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
          ],
        },
      ],
      render: ({
        node,
        children,
        attributes,
        editing,
      }: CanvasRenderProps<ColumnProps>) => (
        <div
          {...attributes}
          style={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            ...backgroundToCss(node.props.background, DEMO_TOKENS),
            padding: spacingToCss(node.props.padding),
            borderRadius: radiusToCss(node.props.radius),
            minHeight: editing && !node.children?.length ? 72 : undefined,
          }}
        >
          {children}
          {editing && !node.children?.length && (
            <EmptySlot label='Coluna vazia' />
          )}
        </div>
      ),
    }),

    'demo.heading': defineComponent<HeadingProps>({
      type: 'demo.heading',
      label: 'Título',
      icon: 'heading',
      category: 'Básicos',
      keywords: ['h1', 'h2', 'cabeçalho', 'titulo'],
      propsSchema: headingSchema,
      defaultProps: () => ({
        text: 'Um título que chama atenção',
        level: 'h2',
        align: 'left',
      }),
      inlineText: { path: 'text', rich: false },
      accepts: false,
      inspector: [
        {
          id: 'content',
          label: 'Texto',
          tab: 'content',
          fields: [
            {
              path: 'text',
              label: 'Texto',
              control: { kind: 'text', maxLength: 300 },
            },
            {
              path: 'level',
              label: 'Nível',
              control: {
                kind: 'segmented',
                options: [
                  { value: 'h1', label: 'H1' },
                  { value: 'h2', label: 'H2' },
                  { value: 'h3', label: 'H3' },
                ],
              },
            },
            {
              path: 'align',
              label: 'Alinhamento',
              responsive: true,
              control: { kind: 'segmented', options: ALIGN_OPTIONS },
            },
          ],
        },
        {
          id: 'style',
          label: 'Tipografia',
          tab: 'style',
          fields: [
            { path: 'color', label: 'Cor', control: { kind: 'color' } },
            {
              path: 'typography',
              label: 'Tipografia',
              control: { kind: 'typography' },
            },
            {
              path: 'margin',
              label: 'Margem externa',
              control: { kind: 'spacing' },
            },
          ],
        },
        advanced,
      ],
      render: ({
        node,
        attributes,
        breakpoint,
        editing,
      }: CanvasRenderProps<HeadingProps>) => {
        const p = node.props
        const Tag = p.level
        const size = { h1: 44, h2: 32, h3: 24 }[p.level]
        return (
          <Tag
            {...attributes}
            id={p.anchor || undefined}
            style={{
              margin: p.margin ? spacingToCss(p.margin) : 0,
              fontSize: breakpoint === 'mobile' ? Math.round(size * 0.8) : size,
              lineHeight: 1.15,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              textAlign: rr(p.align, breakpoint),
              color: color(p.color),
              ...typographyToCss(p.typography),
              ...hiddenStyle(node, breakpoint, editing),
            }}
          >
            {p.text || (editing ? 'Título vazio' : '')}
          </Tag>
        )
      },
    }),

    'demo.text': defineComponent<TextProps>({
      type: 'demo.text',
      label: 'Texto',
      icon: 'text',
      category: 'Básicos',
      keywords: ['parágrafo', 'paragrafo', 'conteúdo'],
      propsSchema: textSchema,
      defaultProps: () => ({
        html: '<p>Escreva aqui o seu texto. Clique duas vezes para editar direto no canvas.</p>',
        align: 'left',
      }),
      inlineText: { path: 'html', rich: true },
      accepts: false,
      inspector: [
        {
          id: 'content',
          label: 'Texto',
          tab: 'content',
          fields: [
            {
              path: 'html',
              label: 'Conteúdo',
              control: {
                kind: 'richtext',
                marks: [
                  'bold',
                  'italic',
                  'underline',
                  'strike',
                  'link',
                  'list',
                ],
              },
            },
            {
              path: 'align',
              label: 'Alinhamento',
              responsive: true,
              control: { kind: 'segmented', options: ALIGN_OPTIONS },
            },
          ],
        },
        {
          id: 'style',
          label: 'Tipografia',
          tab: 'style',
          fields: [
            { path: 'color', label: 'Cor', control: { kind: 'color' } },
            {
              path: 'typography',
              label: 'Tipografia',
              control: { kind: 'typography' },
            },
          ],
        },
        advanced,
      ],
      render: ({
        node,
        attributes,
        breakpoint,
        editing,
      }: CanvasRenderProps<TextProps>) => {
        const p = node.props
        return (
          <div
            {...attributes}
            style={{
              fontSize: 16,
              lineHeight: 1.6,
              textAlign: rr(p.align, breakpoint),
              color: color(p.color),
              ...typographyToCss(p.typography),
              ...hiddenStyle(node, breakpoint, editing),
            }}
            dangerouslySetInnerHTML={{
              __html: p.html || (editing ? '<p>Texto vazio</p>' : ''),
            }}
          />
        )
      },
    }),

    'demo.button': defineComponent<ButtonProps>({
      type: 'demo.button',
      label: 'Botão',
      icon: 'button',
      category: 'Básicos',
      keywords: ['cta', 'link', 'chamada'],
      propsSchema: buttonSchema,
      defaultProps: () => ({
        label: 'Quero saber mais',
        link: { type: 'url', value: 'https://' },
        variant: 'solid',
        background: 'token:primary',
        textColor: '#FFFFFF',
        align: 'left',
        padding: spacing(12, 22),
        radius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
        fullWidth: false,
      }),
      inlineText: { path: 'label', rich: false },
      accepts: false,
      inspector: [
        {
          id: 'content',
          label: 'Botão',
          tab: 'content',
          fields: [
            {
              path: 'label',
              label: 'Texto',
              control: { kind: 'text', maxLength: 80 },
            },
            {
              path: 'link',
              label: 'Link',
              control: {
                kind: 'link',
                targets: ['url', 'anchor', 'email', 'phone', 'file'],
              },
            },
            {
              path: 'align',
              label: 'Alinhamento',
              responsive: true,
              control: { kind: 'segmented', options: ALIGN_OPTIONS },
            },
            {
              path: 'fullWidth',
              label: 'Largura total',
              responsive: true,
              control: { kind: 'toggle' },
            },
          ],
        },
        {
          id: 'style',
          label: 'Aparência',
          tab: 'style',
          fields: [
            {
              path: 'variant',
              label: 'Estilo',
              control: {
                kind: 'select',
                options: [
                  { value: 'solid', label: 'Preenchido' },
                  { value: 'outline', label: 'Contorno' },
                ],
              },
            },
            {
              path: 'background',
              label: 'Cor do botão',
              control: { kind: 'color' },
            },
            {
              path: 'textColor',
              label: 'Cor do texto',
              control: { kind: 'color' },
            },
            {
              path: 'typography',
              label: 'Tipografia',
              control: { kind: 'typography' },
            },
          ],
        },
        {
          id: 'box',
          label: 'Forma',
          tab: 'style',
          fields: [
            {
              path: 'padding',
              label: 'Margem interna',
              control: { kind: 'spacing', max: 80 },
            },
            { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
            { path: 'border', label: 'Borda', control: { kind: 'border' } },
            { path: 'shadow', label: 'Sombra', control: { kind: 'shadow' } },
          ],
        },
        advanced,
      ],
      render: ({
        node,
        attributes,
        breakpoint,
        editing,
      }: CanvasRenderProps<ButtonProps>) => {
        const p = node.props
        const outline = p.variant === 'outline'
        const full = rr(p.fullWidth, breakpoint)
        return (
          <div
            {...attributes}
            style={{
              textAlign: rr(p.align, breakpoint),
              ...hiddenStyle(node, breakpoint, editing),
            }}
          >
            <a
              href={linkHref(p.link)}
              target={p.link.newTab ? '_blank' : undefined}
              rel={p.link.newTab ? 'noopener noreferrer' : undefined}
              style={{
                display: full ? 'block' : 'inline-block',
                textAlign: 'center',
                padding: spacingToCss(p.padding),
                borderRadius: radiusToCss(p.radius),
                background: outline ? 'transparent' : color(p.background),
                color: outline ? color(p.background) : color(p.textColor),
                border:
                  borderToCss(p.border, DEMO_TOKENS) ??
                  (outline ? `2px solid ${color(p.background)}` : 'none'),
                boxShadow: shadowToCss(p.shadow, DEMO_TOKENS),
                fontWeight: 600,
                fontSize: 15,
                lineHeight: 1.2,
                textDecoration: 'none',
                ...typographyToCss(p.typography),
              }}
            >
              {p.label || (editing ? 'Botão' : '')}
            </a>
          </div>
        )
      },
    }),

    'demo.image': defineComponent<ImageProps>({
      type: 'demo.image',
      label: 'Imagem',
      icon: 'image',
      category: 'Mídia',
      keywords: ['foto', 'figura', 'banner'],
      propsSchema: imageSchema,
      defaultProps: () => ({
        image: { src: IMAGE_PLACEHOLDER, alt: '' },
        width: { value: 100, unit: '%' },
        align: 'center',
        radius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
      }),
      accepts: false,
      inspector: [
        {
          id: 'content',
          label: 'Imagem',
          tab: 'content',
          fields: [
            { path: 'image', label: 'Imagem', control: { kind: 'image' } },
            {
              path: 'link',
              label: 'Link ao clicar',
              control: { kind: 'link' },
            },
          ],
        },
        {
          id: 'style',
          label: 'Tamanho',
          tab: 'style',
          fields: [
            {
              path: 'width',
              label: 'Largura',
              responsive: true,
              control: { kind: 'size', units: ['%', 'px', 'auto'] },
            },
            {
              path: 'align',
              label: 'Alinhamento',
              responsive: true,
              control: { kind: 'segmented', options: ALIGN_OPTIONS },
            },
            { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
          ],
        },
        advanced,
      ],
      render: ({
        node,
        attributes,
        breakpoint,
        editing,
      }: CanvasRenderProps<ImageProps>) => {
        const p = node.props
        const img = (
          <img
            src={p.image.src || IMAGE_PLACEHOLDER}
            alt={p.image.alt}
            style={{
              display: 'inline-block',
              width: sizeToCss(rr(p.width, breakpoint)),
              maxWidth: '100%',
              height: 'auto',
              borderRadius: radiusToCss(p.radius),
              verticalAlign: 'top',
            }}
          />
        )
        const href = linkHref(p.link)
        return (
          <div
            {...attributes}
            style={{
              textAlign: rr(p.align, breakpoint),
              lineHeight: 0,
              ...hiddenStyle(node, breakpoint, editing),
            }}
          >
            {href ? <a href={href}>{img}</a> : img}
          </div>
        )
      },
    }),

    'demo.list': defineComponent<ListProps>({
      type: 'demo.list',
      label: 'Lista',
      icon: 'list',
      category: 'Básicos',
      keywords: ['benefícios', 'itens', 'tópicos', 'checklist'],
      propsSchema: listSchema,
      defaultProps: () => ({
        items: [
          { title: 'Sem fidelidade', description: 'Cancele quando quiser.' },
          {
            title: 'Suporte humano',
            description: 'Atendimento em até 2 horas.',
          },
        ],
        marker: 'check',
        accent: 'token:primary',
      }),
      accepts: false,
      inspector: [
        {
          id: 'items',
          label: 'Itens',
          tab: 'content',
          fields: [
            {
              path: 'items',
              label: 'Itens',
              control: {
                kind: 'list',
                itemLabel: 'Item',
                max: 12,
                fields: [
                  {
                    path: 'title',
                    label: 'Título',
                    control: { kind: 'text', maxLength: 120 },
                  },
                  {
                    path: 'description',
                    label: 'Descrição',
                    control: { kind: 'textarea', maxLength: 400, rows: 2 },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'style',
          label: 'Marcador',
          tab: 'style',
          fields: [
            {
              path: 'marker',
              label: 'Marcador',
              control: {
                kind: 'segmented',
                options: [
                  { value: 'check', label: '✓' },
                  { value: 'dot', label: '•' },
                  { value: 'number', label: '1.' },
                ],
              },
            },
            {
              path: 'accent',
              label: 'Cor do marcador',
              control: { kind: 'color' },
            },
          ],
        },
        advanced,
      ],
      render: ({
        node,
        attributes,
        breakpoint,
        editing,
      }: CanvasRenderProps<ListProps>) => {
        const p = node.props
        return (
          <ul
            {...attributes}
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 12,
              ...hiddenStyle(node, breakpoint, editing),
            }}
          >
            {p.items.map((item, index) => (
              <li key={index} style={{ display: 'flex', gap: 12 }}>
                <span
                  style={{
                    flex: '0 0 22px',
                    height: 22,
                    borderRadius: 999,
                    background: color(p.accent),
                    color: '#fff',
                    font: '600 12px/22px system-ui, sans-serif',
                    textAlign: 'center',
                  }}
                >
                  {p.marker === 'check'
                    ? '✓'
                    : p.marker === 'dot'
                      ? '•'
                      : index + 1}
                </span>
                <span>
                  <strong style={{ display: 'block', fontSize: 15 }}>
                    {item.title}
                  </strong>
                  <span style={{ fontSize: 14, opacity: 0.75 }}>
                    {item.description}
                  </span>
                </span>
              </li>
            ))}
            {editing && p.items.length === 0 && (
              <EmptySlot label='Lista vazia' />
            )}
          </ul>
        )
      },
    }),
  },
})

// ─── sample document and presets ──────────────────────────────────────────

function node<P extends Record<string, unknown>>(
  id: string,
  type: string,
  props: P,
  children?: string[],
): CanvasNode {
  return children ? { id, type, props, children } : { id, type, props }
}

/** A landing-page-like starting document for the playground. */
export function demoDocument(): CanvasDocument {
  const def = (type: string) => demoCatalog.components[type].defaultProps()
  const nodes: CanvasNode[] = [
    node('root', 'demo.page', def('demo.page'), ['hero', 'features']),
    node(
      'hero',
      'demo.section',
      {
        background: {
          kind: 'gradient',
          angle: 135,
          from: '#EFF6FF',
          to: '#FEF3C7',
        },
        padding: { base: spacing(88, 32), mobile: spacing(48, 20) },
      },
      ['hero-cols'],
    ),
    node(
      'hero-cols',
      'demo.columns',
      { gap: 48, stackOnMobile: true, verticalAlign: 'middle' },
      ['hero-left', 'hero-right'],
    ),
    node('hero-left', 'demo.column', def('demo.column'), [
      'hero-title',
      'hero-text',
      'hero-cta',
    ]),
    node('hero-title', 'demo.heading', {
      text: 'Internet de verdade para a sua empresa',
      level: 'h1',
      align: { base: 'left', mobile: 'center' },
    }),
    node('hero-text', 'demo.text', {
      html: '<p>Fibra dedicada, suporte <strong>24 horas</strong> e instalação em até 7 dias. Monte esta página do seu jeito: arraste, solte e edite.</p>',
      align: { base: 'left', mobile: 'center' },
      color: 'token:muted',
    }),
    node('hero-cta', 'demo.button', {
      ...def('demo.button'),
      label: 'Falar com um especialista',
      align: { base: 'left', mobile: 'center' },
      fullWidth: { base: false, mobile: true },
    }),
    node('hero-right', 'demo.column', def('demo.column'), ['hero-image']),
    node('hero-image', 'demo.image', def('demo.image')),
    node(
      'features',
      'demo.section',
      { background: { kind: 'none' }, padding: spacing(64, 32) },
      ['features-title', 'features-list'],
    ),
    node('features-title', 'demo.heading', {
      text: 'Por que escolher a Stratus',
      level: 'h2',
      align: 'center',
    }),
    node('features-list', 'demo.list', def('demo.list')),
  ]
  return {
    catalog: demoCatalog.id,
    version: demoCatalog.version,
    rootId: 'root',
    nodes: Object.fromEntries(nodes.map((item) => [item.id, item])),
  }
}

function section(
  id: string,
  children: CanvasNode[],
  props: Record<string, unknown>,
): CanvasFragment {
  const nodes: Record<string, CanvasNode> = {
    [id]: node(
      id,
      'demo.section',
      { background: { kind: 'none' }, padding: spacing(56, 24), ...props },
      children.map((child) => child.id),
    ),
  }
  for (const child of children) nodes[child.id] = child
  return { rootId: id, nodes }
}

export const demoPresets: CanvasPresetItem[] = [
  {
    id: 'cta',
    label: 'Chamada para ação',
    category: 'Conversão',
    fragment: () =>
      section(
        'p-cta',
        [
          node('p-cta-title', 'demo.heading', {
            text: 'Pronto para começar?',
            level: 'h2',
            align: 'center',
          }),
          node('p-cta-text', 'demo.text', {
            html: '<p>Fale com o nosso time e receba uma proposta hoje.</p>',
            align: 'center',
            color: 'token:muted',
          }),
          node('p-cta-btn', 'demo.button', {
            ...demoCatalog.components['demo.button'].defaultProps(),
            label: 'Pedir proposta',
            align: 'center',
          }),
        ],
        { background: { kind: 'color', color: 'token:surface' } },
      ),
  },
  {
    id: 'features',
    label: 'Lista de benefícios',
    category: 'Conteúdo',
    fragment: () =>
      section(
        'p-feat',
        [
          node('p-feat-title', 'demo.heading', {
            text: 'O que está incluso',
            level: 'h2',
            align: 'left',
          }),
          node(
            'p-feat-list',
            'demo.list',
            demoCatalog.components['demo.list'].defaultProps(),
          ),
        ],
        {},
      ),
  },
]
