import {
  type CanvasRenderProps,
  defineComponent,
} from '@/src/lib/canvas/registry'
import { spacing } from '@/src/lib/canvas/values'
import { SITE_TYPES } from '../constants'
import { type SiteRenderContext, siteLink } from '../context'
import { classNames } from '../css'
import { IconSvg, SITE_ICONS } from '../icons'
import {
  ALIGN_OPTIONS,
  advancedSection,
  BUTTON_VARIANT_OPTIONS,
  ICON_OPTIONS,
  presetOptions,
  SITE_LINK_TARGETS,
  spacingSection,
} from '../inspector'
import { sanitizeRichText } from '../sanitize'
import {
  BODY_PRESETS,
  HEADING_LEVELS,
  type SiteButtonProps,
  type SiteDividerProps,
  type SiteHeadingProps,
  type SiteListProps,
  type SiteSpacerProps,
  type SiteTextProps,
  siteButtonSchema,
  siteDividerSchema,
  siteHeadingSchema,
  siteListSchema,
  siteSpacerSchema,
  siteTextSchema,
} from '../schemas'
import { SITE_TEXT_PRESETS } from '../theme'

const anchorId = (anchor: string | undefined) => anchor || undefined

const typographyField = {
  path: 'typography',
  label: 'Tipografia personalizada',
  help: 'Sobrescreve o estilo do tema só neste elemento.',
  responsive: true,
  control: { kind: 'typography' as const },
}

const colorField = {
  path: 'color',
  label: 'Cor do texto',
  control: { kind: 'color' as const, allowTokens: true },
}

const maxWidthField = {
  path: 'maxWidth',
  label: 'Largura máxima',
  responsive: true,
  control: {
    kind: 'size' as const,
    units: ['auto' as const, 'px' as const, '%' as const],
  },
}

// ─── heading ──────────────────────────────────────────────────────────────

export function headingDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteHeadingProps>({
    type: SITE_TYPES.heading,
    label: 'Título',
    icon: 'heading',
    category: 'Básicos',
    keywords: ['titulo', 'h1', 'h2', 'cabeçalho', 'chamada'],
    propsSchema: siteHeadingSchema,
    defaultProps: () => ({
      text: 'Escreva um título marcante',
      level: 'h2',
      align: 'left',
    }),
    accepts: false,
    inlineText: { path: 'text', rich: false },
    inspector: [
      {
        id: 'content',
        label: 'Título',
        tab: 'content',
        fields: [
          {
            path: 'text',
            label: 'Texto',
            control: { kind: 'textarea', rows: 2, maxLength: 500 },
          },
          {
            path: 'level',
            label: 'Nível (SEO)',
            help: 'Use um único Título 1 por página.',
            control: {
              kind: 'segmented',
              options: HEADING_LEVELS.map((level) => ({
                value: level,
                label: level.toUpperCase(),
              })),
            },
          },
          {
            path: 'link',
            label: 'Link',
            control: { kind: 'link', targets: SITE_LINK_TARGETS },
          },
        ],
      },
      {
        id: 'style',
        label: 'Texto',
        tab: 'style',
        fields: [
          {
            path: 'preset',
            label: 'Estilo do tema',
            help: 'Por padrão segue o nível do título.',
            control: {
              kind: 'select',
              options: presetOptions(SITE_TEXT_PRESETS),
            },
          },
          {
            path: 'align',
            label: 'Alinhamento',
            responsive: true,
            control: { kind: 'segmented', options: ALIGN_OPTIONS },
          },
          colorField,
          typographyField,
          maxWidthField,
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({ node, attributes }: CanvasRenderProps<SiteHeadingProps>) => {
      const p = node.props
      const Tag = p.level
      const link = siteLink(p.link, ctx)
      return (
        <Tag
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, `s-t-${p.preset ?? p.level}`)}
        >
          {link.href ? <a {...link}>{p.text}</a> : p.text}
        </Tag>
      )
    },
  })
}

// ─── text ─────────────────────────────────────────────────────────────────

export const textDefinition = defineComponent<SiteTextProps>({
  type: SITE_TYPES.text,
  label: 'Texto',
  icon: 'text',
  category: 'Básicos',
  keywords: ['paragrafo', 'parágrafo', 'descrição', 'conteúdo'],
  propsSchema: siteTextSchema,
  defaultProps: () => ({
    html: '<p>Conte em poucas linhas o que torna sua empresa única. Clique duas vezes para editar.</p>',
    preset: 'body',
    align: 'left',
  }),
  accepts: false,
  inlineText: { path: 'html', rich: true },
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
            marks: ['bold', 'italic', 'underline', 'strike', 'link', 'list'],
          },
        },
      ],
    },
    {
      id: 'style',
      label: 'Texto',
      tab: 'style',
      fields: [
        {
          path: 'preset',
          label: 'Estilo do tema',
          control: { kind: 'select', options: presetOptions(BODY_PRESETS) },
        },
        {
          path: 'align',
          label: 'Alinhamento',
          responsive: true,
          control: {
            kind: 'segmented',
            options: [
              ...ALIGN_OPTIONS,
              { value: 'justify', label: 'Justificado', icon: 'text-justify' },
            ],
          },
        },
        colorField,
        typographyField,
        maxWidthField,
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({ node, attributes }: CanvasRenderProps<SiteTextProps>) => (
    <div
      {...attributes}
      id={anchorId(node.props.anchor)}
      className={classNames(node, 's-rich', `s-t-${node.props.preset}`)}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(node.props.html) }}
    />
  ),
})

// ─── button ───────────────────────────────────────────────────────────────

export function buttonDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteButtonProps>({
    type: SITE_TYPES.button,
    label: 'Botão',
    icon: 'button',
    category: 'Básicos',
    keywords: ['cta', 'chamada', 'link', 'acao', 'ação'],
    propsSchema: siteButtonSchema,
    defaultProps: () => ({
      label: 'Fale com a gente',
      link: { type: 'url', value: '' },
      variant: 'primary',
      size: 'md',
      align: 'left',
      iconPosition: 'end',
    }),
    accepts: false,
    inlineText: { path: 'label', rich: false },
    inspector: [
      {
        id: 'content',
        label: 'Botão',
        tab: 'content',
        fields: [
          {
            path: 'label',
            label: 'Texto',
            control: { kind: 'text', maxLength: 120 },
          },
          {
            path: 'link',
            label: 'Link',
            control: { kind: 'link', targets: SITE_LINK_TARGETS },
          },
          {
            path: 'icon',
            label: 'Ícone',
            control: {
              kind: 'select',
              options: [{ value: '', label: 'Sem ícone' }, ...ICON_OPTIONS],
            },
          },
          {
            path: 'iconPosition',
            label: 'Posição do ícone',
            showIf: (props) => !!props.icon,
            control: {
              kind: 'segmented',
              options: [
                { value: 'start', label: 'Antes' },
                { value: 'end', label: 'Depois' },
              ],
            },
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
            control: { kind: 'select', options: BUTTON_VARIANT_OPTIONS },
          },
          {
            path: 'size',
            label: 'Tamanho',
            control: {
              kind: 'segmented',
              options: [
                { value: 'sm', label: 'P' },
                { value: 'md', label: 'M' },
                { value: 'lg', label: 'G' },
              ],
            },
          },
          {
            path: 'align',
            label: 'Alinhamento',
            responsive: true,
            control: {
              kind: 'segmented',
              options: [
                ...ALIGN_OPTIONS,
                { value: 'stretch', label: 'Largura total' },
              ],
            },
          },
          {
            path: 'background',
            label: 'Cor de fundo',
            control: {
              kind: 'color',
              allowTokens: true,
              allowTransparent: true,
            },
          },
          {
            path: 'textColor',
            label: 'Cor do texto',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'borderColor',
            label: 'Cor da borda',
            control: {
              kind: 'color',
              allowTokens: true,
              allowTransparent: true,
            },
          },
          {
            path: 'radius',
            label: 'Arredondamento',
            control: { kind: 'number', min: 0, max: 999, unit: 'px' },
          },
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({ node, attributes }: CanvasRenderProps<SiteButtonProps>) => {
      const p = node.props
      const link = siteLink(p.link, ctx)
      const icon = p.icon ? (
        <IconSvg icon={SITE_ICONS[p.icon].svg} className='s-btn-icon' />
      ) : null
      const className = `s-btn s-btn-${p.variant}${p.size === 'md' ? '' : ` s-btn-${p.size}`}`
      const content = (
        <>
          {p.iconPosition === 'start' && icon}
          <span>{p.label}</span>
          {p.iconPosition === 'end' && icon}
        </>
      )
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-button')}
        >
          {link.href ? (
            <a {...link} className={className}>
              {content}
            </a>
          ) : p.interaction && p.interaction.action !== 'none' ? (
            // Opens a popup, scrolls… (effects): a real, focusable button.
            <button type='button' className={className}>
              {content}
            </button>
          ) : (
            <span className={className}>{content}</span>
          )}
        </div>
      )
    },
  })
}

// ─── list ─────────────────────────────────────────────────────────────────

export const listDefinition = defineComponent<SiteListProps>({
  type: SITE_TYPES.list,
  label: 'Lista',
  icon: 'list',
  category: 'Básicos',
  keywords: ['itens', 'tópicos', 'benefícios', 'checklist'],
  propsSchema: siteListSchema,
  defaultProps: () => ({
    items: [
      { text: 'Atendimento humano e rápido' },
      { text: 'Implantação sem dor de cabeça' },
      { text: 'Resultados que você acompanha' },
    ],
    marker: 'check',
    icon: 'check',
    markerColor: 'token:primary',
    preset: 'body',
    gap: 12,
    columns: 1,
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
            max: 50,
            fields: [
              {
                path: 'text',
                label: 'Texto',
                control: { kind: 'textarea', rows: 2, maxLength: 500 },
              },
              {
                path: 'icon',
                label: 'Ícone (marcador ícone)',
                control: {
                  kind: 'select',
                  options: [{ value: '', label: 'Padrão' }, ...ICON_OPTIONS],
                },
              },
            ],
          },
        },
        {
          path: 'marker',
          label: 'Marcador',
          control: {
            kind: 'select',
            options: [
              { value: 'check', label: 'Confirmação' },
              { value: 'dot', label: 'Ponto' },
              { value: 'number', label: 'Número' },
              { value: 'icon', label: 'Ícone' },
              { value: 'none', label: 'Nenhum' },
            ],
          },
        },
        {
          path: 'icon',
          label: 'Ícone padrão',
          showIf: { path: 'marker', equals: 'icon' },
          control: { kind: 'select', options: ICON_OPTIONS },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        {
          path: 'preset',
          label: 'Estilo do tema',
          control: {
            kind: 'select',
            options: presetOptions(['lead', 'body', 'small']),
          },
        },
        {
          path: 'markerColor',
          label: 'Cor do marcador',
          control: { kind: 'color', allowTokens: true },
        },
        colorField,
        {
          path: 'columns',
          label: 'Colunas',
          responsive: true,
          control: { kind: 'number', min: 1, max: 4 },
        },
        {
          path: 'gap',
          label: 'Espaço entre itens',
          responsive: true,
          control: { kind: 'number', min: 0, max: 400, unit: 'px' },
        },
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({ node, attributes }: CanvasRenderProps<SiteListProps>) => {
    const p = node.props
    const Tag = p.marker === 'number' ? 'ol' : 'ul'
    const markerIcon = (name: SiteListProps['icon']) => (
      <span className='s-marker'>
        <IconSvg icon={SITE_ICONS[name].svg} />
      </span>
    )
    return (
      <Tag
        {...attributes}
        id={anchorId(p.anchor)}
        className={classNames(
          node,
          's-list',
          `s-list-${p.marker}`,
          `s-t-${p.preset}`,
        )}
      >
        {p.items.map((item, index) => (
          <li key={index}>
            {p.marker === 'check' && markerIcon('check')}
            {p.marker === 'icon' && markerIcon(item.icon || p.icon)}
            <span>{item.text}</span>
          </li>
        ))}
      </Tag>
    )
  },
})

// ─── divider & spacer ─────────────────────────────────────────────────────

export const dividerDefinition = defineComponent<SiteDividerProps>({
  type: SITE_TYPES.divider,
  label: 'Divisor',
  icon: 'divider',
  category: 'Básicos',
  keywords: ['linha', 'separador', 'hr'],
  propsSchema: siteDividerSchema,
  defaultProps: () => ({
    style: 'solid',
    thickness: 1,
    color: 'token:border',
    width: { value: 100, unit: '%' },
    align: 'center',
    margin: spacing(16, 0),
  }),
  accepts: false,
  inspector: [
    {
      id: 'style',
      label: 'Linha',
      tab: 'style',
      fields: [
        {
          path: 'style',
          label: 'Estilo',
          control: {
            kind: 'segmented',
            options: [
              { value: 'solid', label: 'Contínua' },
              { value: 'dashed', label: 'Tracejada' },
              { value: 'dotted', label: 'Pontilhada' },
            ],
          },
        },
        {
          path: 'thickness',
          label: 'Espessura',
          control: { kind: 'number', min: 1, max: 20, unit: 'px' },
        },
        {
          path: 'color',
          label: 'Cor',
          control: { kind: 'color', allowTokens: true },
        },
        {
          path: 'width',
          label: 'Largura',
          responsive: true,
          control: { kind: 'size', units: ['px', '%'] },
        },
        {
          path: 'align',
          label: 'Alinhamento',
          responsive: true,
          control: { kind: 'segmented', options: ALIGN_OPTIONS },
        },
      ],
    },
    spacingSection(),
    advancedSection,
  ],
  render: ({ node, attributes }: CanvasRenderProps<SiteDividerProps>) => (
    <hr
      {...attributes}
      id={anchorId(node.props.anchor)}
      className={classNames(node, 's-divider')}
    />
  ),
})

export const spacerDefinition = defineComponent<SiteSpacerProps>({
  type: SITE_TYPES.spacer,
  label: 'Espaço',
  icon: 'spacer',
  category: 'Básicos',
  keywords: ['espaçador', 'respiro', 'vazio'],
  propsSchema: siteSpacerSchema,
  defaultProps: () => ({ height: { base: 48, mobile: 32 } }),
  accepts: false,
  inspector: [
    {
      id: 'size',
      label: 'Espaço',
      tab: 'style',
      fields: [
        {
          path: 'height',
          label: 'Altura',
          responsive: true,
          control: { kind: 'number', min: 0, max: 800, unit: 'px' },
        },
      ],
    },
    advancedSection,
  ],
  render: ({ node, attributes }: CanvasRenderProps<SiteSpacerProps>) => (
    <div
      {...attributes}
      id={anchorId(node.props.anchor)}
      aria-hidden='true'
      className={classNames(node, 's-spacer')}
    />
  ),
})
