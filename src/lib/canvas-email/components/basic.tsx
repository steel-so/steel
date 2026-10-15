import type { CSSProperties } from 'react'
import { Button, Heading, Hr, Img, Link } from 'react-email'
import { defineComponent } from '@/src/lib/canvas/registry'
import { spacing, spacingToCss } from '@/src/lib/canvas/values'
import { CAMPAIGN_LINK } from '@/src/lib/crm-email-builder/variables'
import {
  alignField,
  BLOCK_LAYOUT_SECTION,
  colorField,
  linkField,
  typographyField,
} from '../inspector'
import { mobileClass } from '../mobile'
import {
  BlockFrame,
  EditorHint,
  EmailTable,
  emailHref,
  joinClasses,
  pick,
  SHOWN,
  softColor,
  typographyStyle,
} from '../primitives'
import { emailRichTextHtml } from '../rich-text'
import {
  buttonSchema,
  dividerSchema,
  type EmailButtonProps,
  type EmailDividerProps,
  type EmailHeadingProps,
  type EmailImageProps,
  type EmailListProps,
  type EmailSpacerProps,
  type EmailTextProps,
  headingSchema,
  imageSchema,
  listSchema,
  spacerSchema,
  textSchema,
} from '../schemas'
import { EMAIL_PALETTE, type EmailViewProps, emailColor } from '../theme'
import { emailBody, emailView } from './layout'

const blockPadding = () => spacing(8, 0)

// ─── heading ──────────────────────────────────────────────────────────────

export const HEADING_SIZES = {
  h1: { fontSize: 28, lineHeight: '36px' },
  h2: { fontSize: 20, lineHeight: '28px' },
  h3: { fontSize: 17, lineHeight: '24px' },
} as const

function HeadingView(props: EmailViewProps<EmailHeadingProps>) {
  const { node, breakpoint, editing } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  if (!p.text.trim() && !editing) return null
  return (
    <BlockFrame {...props} align={p.align}>
      <Heading
        as={p.level}
        className={editing ? undefined : mobileClass(node, 'text')}
        style={{
          margin: 0,
          ...HEADING_SIZES[p.level],
          fontWeight: 700,
          fontFamily: body.fontStack,
          color: emailColor(p.color, tokens) ?? EMAIL_PALETTE.fg,
          ...typographyStyle(p.typography, breakpoint, editing),
        }}
      >
        {p.text || 'Título'}
      </Heading>
    </BlockFrame>
  )
}

export const headingDefinition = defineComponent<EmailHeadingProps>({
  type: 'email.heading',
  label: 'Título',
  icon: 'heading',
  category: 'Básicos',
  keywords: ['h1', 'h2', 'cabeçalho', 'titulo', 'chamada'],
  propsSchema: headingSchema,
  defaultProps: () => ({
    text: 'Um título que chama atenção',
    level: 'h2',
    align: 'left',
    padding: blockPadding(),
    visibility: { ...SHOWN },
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
          control: { kind: 'text', maxLength: 300 },
          help: 'Aceita variáveis, como {{primeiro_nome}}.',
        },
        {
          path: 'level',
          label: 'Tamanho',
          control: {
            kind: 'segmented',
            options: [
              { value: 'h1', label: 'Grande' },
              { value: 'h2', label: 'Médio' },
              { value: 'h3', label: 'Pequeno' },
            ],
          },
        },
        alignField(),
      ],
    },
    {
      id: 'style',
      label: 'Tipografia',
      tab: 'style',
      fields: [colorField('color', 'Cor'), typographyField()],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(HeadingView),
})

// ─── text ─────────────────────────────────────────────────────────────────

function TextView(props: EmailViewProps<EmailTextProps>) {
  const { node, breakpoint, editing } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const html = emailRichTextHtml(
    p.html,
    emailColor(p.linkColor, tokens) ?? body.linkColor,
  )
  if (!html && !editing) return null
  return (
    <BlockFrame {...props} align={p.align}>
      <div
        className={editing ? undefined : mobileClass(node, 'text')}
        style={{
          fontSize: 16,
          lineHeight: '26px',
          fontFamily: body.fontStack,
          color: emailColor(p.color, tokens) ?? body.textColor,
          ...typographyStyle(p.typography, breakpoint, editing),
        }}
        dangerouslySetInnerHTML={{
          __html: html || '<p style="margin:0">Escreva o seu texto</p>',
        }}
      />
    </BlockFrame>
  )
}

export const textDefinition = defineComponent<EmailTextProps>({
  type: 'email.text',
  label: 'Texto',
  icon: 'text',
  category: 'Básicos',
  keywords: ['parágrafo', 'paragrafo', 'conteúdo', 'corpo'],
  propsSchema: textSchema,
  defaultProps: () => ({
    html: '<p>Escreva aqui a sua mensagem. Use <strong>negrito</strong> para destacar o que importa.</p>',
    align: 'left',
    padding: blockPadding(),
    visibility: { ...SHOWN },
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
        alignField(),
      ],
    },
    {
      id: 'style',
      label: 'Tipografia',
      tab: 'style',
      fields: [
        colorField('color', 'Cor do texto'),
        colorField('linkColor', 'Cor dos links'),
        typographyField(),
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(TextView),
})

// ─── button ───────────────────────────────────────────────────────────────

function ButtonView(props: EmailViewProps<EmailButtonProps>) {
  const { node, breakpoint, editing } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  if (!p.label.trim() && !editing) return null
  const border = p.border
  const style: CSSProperties = {
    backgroundColor: emailColor(p.backgroundColor, tokens),
    color: emailColor(p.textColor, tokens),
    borderRadius: p.radius,
    padding: spacingToCss(p.buttonPadding),
    fontSize: 15,
    fontWeight: 600,
    fontFamily: body.fontStack,
    textDecoration: 'none',
    textAlign: 'center',
    display: p.fullWidth ? 'block' : 'inline-block',
    ...(border && border.style !== 'none' && border.width > 0
      ? {
          border: `${border.width}px ${border.style} ${emailColor(border.color, tokens)}`,
        }
      : {}),
    ...typographyStyle(p.typography, breakpoint, editing),
  }
  return (
    <BlockFrame {...props} align={p.align}>
      <Button
        href={emailHref(p.link)}
        className={editing ? undefined : mobileClass(node, 'text')}
        style={style}
      >
        {p.label || 'Texto do botão'}
      </Button>
    </BlockFrame>
  )
}

export const buttonDefinition = defineComponent<EmailButtonProps>({
  type: 'email.button',
  label: 'Botão',
  icon: 'button',
  category: 'Básicos',
  keywords: ['cta', 'link', 'chamada', 'ação'],
  propsSchema: buttonSchema,
  defaultProps: () => ({
    label: 'Saiba mais',
    link: { type: 'url', value: CAMPAIGN_LINK },
    align: 'left',
    backgroundColor: 'token:primary',
    textColor: 'token:on-primary',
    radius: 8,
    buttonPadding: spacing(12, 24),
    fullWidth: false,
    padding: blockPadding(),
    visibility: { ...SHOWN },
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
          control: { kind: 'text', maxLength: 80 },
        },
        linkField(),
        alignField(),
        {
          path: 'fullWidth',
          label: 'Largura total',
          control: { kind: 'toggle' },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        colorField('backgroundColor', 'Fundo'),
        colorField('textColor', 'Texto'),
        {
          path: 'radius',
          label: 'Cantos',
          control: { kind: 'number', min: 0, max: 40, unit: 'px' },
        },
        {
          path: 'buttonPadding',
          label: 'Espaço interno',
          control: { kind: 'spacing', min: 0, max: 80 },
        },
        { path: 'border', label: 'Borda', control: { kind: 'border' } },
        typographyField(),
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(ButtonView),
})

// ─── image ────────────────────────────────────────────────────────────────

function ImageView(props: EmailViewProps<EmailImageProps>) {
  const { node, editing } = props
  const body = emailBody(props.ctx)
  const p = node.props
  const src = p.image.src.trim()
  if (!src && !editing) return null
  const href = emailHref(p.link)
  const img = src ? (
    <Img
      src={src}
      alt={p.image.alt}
      width={p.width ?? body.width}
      className={
        editing ? undefined : joinClasses(p.mobileFullWidth && 'ec-img-full')
      }
      style={{
        display: 'inline-block',
        width: p.width ? `${p.width}px` : '100%',
        maxWidth: '100%',
        height: 'auto',
        border: 0,
        borderRadius: p.radius || undefined,
      }}
    />
  ) : (
    <EditorHint editing={editing} label='Escolha uma imagem' minHeight={120} />
  )
  return (
    <BlockFrame {...props} align={p.align}>
      {href && src ? <Link href={href}>{img}</Link> : img}
    </BlockFrame>
  )
}

export const imageDefinition = defineComponent<EmailImageProps>({
  type: 'email.image',
  label: 'Imagem',
  icon: 'image',
  category: 'Básicos',
  keywords: ['foto', 'banner', 'figura'],
  propsSchema: imageSchema,
  defaultProps: () => ({
    image: { src: '', alt: '' },
    width: null,
    align: 'center',
    radius: 12,
    mobileFullWidth: true,
    padding: blockPadding(),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Imagem',
      tab: 'content',
      fields: [
        {
          path: 'image',
          label: 'Imagem',
          control: {
            kind: 'image',
            accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          },
          help: 'Descreva a imagem no texto alternativo: muitos leitores bloqueiam imagens.',
        },
        linkField('link', 'Link ao clicar'),
        alignField(),
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
          control: { kind: 'number', min: 16, max: 800, unit: 'px' },
          help: 'Vazio ocupa a largura da coluna.',
        },
        {
          path: 'radius',
          label: 'Cantos',
          control: { kind: 'number', min: 0, max: 40, unit: 'px' },
        },
        {
          path: 'mobileFullWidth',
          label: 'Largura total no celular',
          control: { kind: 'toggle' },
        },
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(ImageView),
})

// ─── divider ──────────────────────────────────────────────────────────────

function DividerView(props: EmailViewProps<EmailDividerProps>) {
  const { tokens } = props.ctx
  const p = props.node.props
  return (
    <BlockFrame {...props} align='center'>
      <Hr
        style={{
          border: 'none',
          borderTop: `${p.thickness}px ${p.style} ${emailColor(p.color, tokens) ?? EMAIL_PALETTE.stroke}`,
          width: `${p.width}%`,
          margin: '0 auto',
        }}
      />
    </BlockFrame>
  )
}

export const dividerDefinition = defineComponent<EmailDividerProps>({
  type: 'email.divider',
  label: 'Divisor',
  icon: 'divider',
  category: 'Básicos',
  keywords: ['linha', 'separador', 'hr'],
  propsSchema: dividerSchema,
  defaultProps: () => ({
    color: 'token:border',
    thickness: 1,
    style: 'solid',
    width: 100,
    padding: spacing(16, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'style',
      label: 'Linha',
      tab: 'style',
      fields: [
        colorField('color', 'Cor'),
        {
          path: 'thickness',
          label: 'Espessura',
          control: { kind: 'number', min: 1, max: 10, unit: 'px' },
        },
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
          path: 'width',
          label: 'Largura',
          control: { kind: 'number', min: 10, max: 100, unit: '%' },
        },
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(DividerView),
})

// ─── spacer ───────────────────────────────────────────────────────────────

function SpacerView(props: EmailViewProps<EmailSpacerProps>) {
  const { node, breakpoint, editing } = props
  const height = pick(node.props.height, breakpoint, editing)
  return (
    <BlockFrame
      {...props}
      cellStyle={{
        height,
        lineHeight: `${height}px`,
        fontSize: 1,
        ...({ msoLineHeightRule: 'exactly' } as CSSProperties),
      }}
    >
      {' '}
    </BlockFrame>
  )
}

export const spacerDefinition = defineComponent<EmailSpacerProps>({
  type: 'email.spacer',
  label: 'Espaço',
  icon: 'spacer',
  category: 'Básicos',
  keywords: ['espaçador', 'respiro', 'distância'],
  propsSchema: spacerSchema,
  defaultProps: () => ({ height: 24, visibility: { ...SHOWN } }),
  accepts: false,
  inspector: [
    {
      id: 'style',
      label: 'Espaço',
      tab: 'style',
      fields: [
        {
          path: 'height',
          label: 'Altura',
          responsive: true,
          control: { kind: 'number', min: 4, max: 200, unit: 'px' },
        },
        {
          path: 'visibility',
          label: 'Exibir em',
          control: { kind: 'visibility' },
        },
      ],
    },
  ],
  render: emailView(SpacerView),
})

// ─── list ─────────────────────────────────────────────────────────────────

const MARKERS = { bullet: '•', check: '✓' } as const

function ListView(props: EmailViewProps<EmailListProps>) {
  const { node, breakpoint, editing } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const accent = emailColor(p.markerColor, tokens) ?? EMAIL_PALETTE.fg
  const textColor = emailColor(p.color, tokens) ?? body.textColor
  const typography = typographyStyle(p.typography, breakpoint, editing)
  return (
    <BlockFrame {...props}>
      {p.items.map((item, index) => (
        <EmailTable
          key={index}
          style={{ margin: index === p.items.length - 1 ? 0 : '0 0 12px' }}
          cellStyle={{ padding: 0 }}
        >
          <table
            role='presentation'
            cellPadding={0}
            cellSpacing={0}
            border={0}
            width='100%'
          >
            <tbody>
              <tr>
                <td
                  width={40}
                  valign='top'
                  style={{ width: 40, verticalAlign: 'top' }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      lineHeight: '28px',
                      borderRadius: 14,
                      textAlign: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: body.fontStack,
                      backgroundColor:
                        p.marker === 'number'
                          ? softColor(accent, 0.12)
                          : undefined,
                      color: accent,
                    }}
                  >
                    {p.marker === 'number' ? index + 1 : MARKERS[p.marker]}
                  </div>
                </td>
                <td
                  valign='top'
                  className={editing ? undefined : mobileClass(node, 'text')}
                  style={{
                    verticalAlign: 'top',
                    fontFamily: body.fontStack,
                    ...typography,
                  }}
                >
                  {item.title ? (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 16,
                        lineHeight: '24px',
                        fontWeight: 600,
                        color: EMAIL_PALETTE.fg,
                      }}
                    >
                      {item.title}
                    </p>
                  ) : null}
                  {item.text ? (
                    <p
                      style={{
                        margin: item.title ? '2px 0 0' : 0,
                        fontSize: 14,
                        lineHeight: '22px',
                        color: textColor,
                      }}
                    >
                      {item.text}
                    </p>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>
        </EmailTable>
      ))}
    </BlockFrame>
  )
}

export const listDefinition = defineComponent<EmailListProps>({
  type: 'email.list',
  label: 'Lista',
  icon: 'list',
  category: 'Básicos',
  keywords: ['tópicos', 'itens', 'passos', 'benefícios', 'recursos'],
  propsSchema: listSchema,
  defaultProps: () => ({
    items: [
      { title: 'Primeiro item', text: 'Uma frase curta sobre ele.' },
      { title: 'Segundo item', text: 'Outra frase curta.' },
      { title: 'Terceiro item', text: 'E mais uma.' },
    ],
    marker: 'number',
    markerColor: 'token:primary',
    padding: blockPadding(),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Itens',
      tab: 'content',
      fields: [
        {
          path: 'items',
          label: 'Itens',
          control: {
            kind: 'list',
            itemLabel: 'Item',
            max: 20,
            fields: [
              {
                path: 'title',
                label: 'Título',
                control: { kind: 'text', maxLength: 160 },
              },
              {
                path: 'text',
                label: 'Texto',
                control: { kind: 'textarea', maxLength: 400, rows: 2 },
              },
            ],
          },
        },
        {
          path: 'marker',
          label: 'Marcador',
          control: {
            kind: 'segmented',
            options: [
              { value: 'number', label: 'Números' },
              { value: 'bullet', label: 'Pontos' },
              { value: 'check', label: 'Checks' },
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
        colorField('markerColor', 'Cor do marcador'),
        colorField('color', 'Cor do texto'),
        typographyField(),
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(ListView),
})
