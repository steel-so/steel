import {
  type Context,
  type CSSProperties,
  createContext,
  useContext,
} from 'react'
import { Container, Hr, Link, Text } from 'react-email'
import {
  type CanvasRenderProps,
  defineComponent,
} from '@/src/lib/canvas/registry'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import {
  type CanvasBackground,
  type CanvasColorToken,
  spacing,
  spacingToCss,
} from '@/src/lib/canvas/values'
import { UNSUBSCRIBE_URL } from '@/src/lib/crm-email-builder/variables'
import {
  ALIGN_OPTIONS,
  BLOCK_LAYOUT_SECTION,
  colorField,
  FONT_OPTIONS,
  VALIGN_OPTIONS,
} from '../inspector'
import { mobileClass } from '../mobile'
import {
  BlockFrame,
  EditorHint,
  EmailTable,
  joinClasses,
  pick,
  SHOWN,
} from '../primitives'
import {
  bodySchema,
  columnSchema,
  type EmailBodyProps,
  type EmailColumnProps,
  type EmailFooterProps,
  type EmailSectionProps,
  footerSchema,
  sectionSchema,
} from '../schemas'
import { EMAIL_PALETTE, emailColor, emailFont, useEmailContext } from '../theme'

export const BODY = 'email.body'
export const SECTION = 'email.section'
export const COLUMN = 'email.column'
export const FOOTER = 'email.footer'

/** Marker spans swapped for Outlook "ghost table" comments after render
 * (React cannot emit conditional comments). */
export const MSO_OPEN_MARKER = 'open'
export const MSO_CLOSE_MARKER = 'close'

// ─── body (root) ──────────────────────────────────────────────────────────

/** Document-level defaults the blocks inherit (font, colors, width). */
export type EmailBodyDefaults = {
  width: number
  fontStack: string
  textColor: string
  linkColor: string
}

const BodyContext: Context<EmailBodyDefaults> =
  createContext<EmailBodyDefaults>({
    width: 600,
    fontStack: emailFont('system').stack,
    textColor: EMAIL_PALETTE.fg2,
    linkColor: '#2893CC',
  })

export function useEmailBody(): EmailBodyDefaults {
  return useContext(BodyContext)
}

export function bodyDefaults(
  props: EmailBodyProps,
  tokens: readonly CanvasColorToken[],
): EmailBodyDefaults {
  return {
    width: props.width,
    fontStack: emailFont(props.fontFamily).stack,
    textColor: emailColor(props.textColor, tokens) ?? EMAIL_PALETTE.fg2,
    linkColor: emailColor(props.linkColor, tokens) ?? EMAIL_PALETTE.fg,
  }
}

export function defaultBodyProps(): EmailBodyProps {
  return {
    width: 600,
    backgroundColor: 'token:canvas',
    contentBackground: 'token:surface',
    contentRadius: 16,
    fontFamily: 'system',
    textColor: 'token:text-muted',
    linkColor: 'token:primary',
    preheader: '',
  }
}

function BodyView({
  node,
  children,
  attributes,
  editing,
}: CanvasRenderProps<EmailBodyProps>) {
  const { tokens } = useEmailContext()
  const p = node.props
  const defaults = bodyDefaults(p, tokens)
  const style: CSSProperties = {
    maxWidth: p.width,
    width: '100%',
    backgroundColor: emailColor(p.contentBackground, tokens),
    borderRadius: p.contentRadius,
    overflow: 'hidden',
  }
  return (
    <BodyContext.Provider value={defaults}>
      {editing ? (
        <div
          {...attributes}
          style={{ ...style, margin: '0 auto', minHeight: 120 }}
        >
          {children}
        </div>
      ) : (
        <>
          <span data-ec-mso={MSO_OPEN_MARKER} />
          <Container className='ec-container' style={style}>
            {children}
          </Container>
          <span data-ec-mso={MSO_CLOSE_MARKER} />
        </>
      )}
    </BodyContext.Provider>
  )
}

export const bodyDefinition = defineComponent<EmailBodyProps>({
  type: BODY,
  label: 'E-mail',
  icon: 'mail',
  propsSchema: bodySchema,
  defaultProps: defaultBodyProps,
  accepts: [SECTION, FOOTER],
  minChildren: 1,
  inspector: [
    {
      id: 'general',
      label: 'E-mail',
      tab: 'content',
      fields: [
        {
          path: 'preheader',
          label: 'Texto de pré-visualização',
          control: {
            kind: 'textarea',
            maxLength: 150,
            rows: 2,
            placeholder: 'Aparece ao lado do assunto na caixa de entrada',
          },
          help: 'Entre 40 e 130 caracteres funciona melhor.',
        },
        {
          path: 'fontFamily',
          label: 'Fonte',
          control: { kind: 'select', options: FONT_OPTIONS },
          help: 'Fontes do Google aparecem na Apple e no Gmail; os demais usam uma fonte segura parecida.',
        },
      ],
    },
    {
      id: 'colors',
      label: 'Cores e largura',
      tab: 'style',
      fields: [
        colorField('backgroundColor', 'Fundo externo'),
        colorField('contentBackground', 'Fundo do conteúdo'),
        colorField('textColor', 'Texto'),
        colorField('linkColor', 'Links'),
        {
          path: 'width',
          label: 'Largura',
          control: { kind: 'number', min: 320, max: 800, step: 10, unit: 'px' },
          help: '600 px é o padrão aceito por todos os leitores.',
        },
        {
          path: 'contentRadius',
          label: 'Cantos do conteúdo',
          control: { kind: 'number', min: 0, max: 40, unit: 'px' },
        },
      ],
    },
  ],
  render: (props) => <BodyView {...props} />,
})

// ─── section ──────────────────────────────────────────────────────────────

/** Background CSS for e-mail: a solid color always comes first (it is the
 * fallback when images or gradients are not supported). */
export function emailBackground(
  value: CanvasBackground,
  tokens: readonly CanvasColorToken[],
): { style: CSSProperties; bgcolor?: string } {
  switch (value.kind) {
    case 'none':
      return { style: {} }
    case 'color': {
      const color = emailColor(value.color, tokens)
      return { style: { backgroundColor: color }, bgcolor: color }
    }
    case 'gradient': {
      const from = emailColor(value.from, tokens)
      const to = emailColor(value.to, tokens)
      return {
        style: {
          backgroundColor: from,
          backgroundImage: `linear-gradient(${value.angle}deg, ${from}, ${to})`,
        },
        bgcolor: from,
      }
    }
    case 'image': {
      const color = emailColor(value.color, tokens)
      const style: CSSProperties = {
        backgroundColor: color,
        backgroundPosition: value.position,
        backgroundSize: value.size,
        backgroundRepeat: value.repeat ? 'repeat' : 'no-repeat',
      }
      if (value.url) {
        style.backgroundImage = `url("${cssUrl(value.url)}")`
      }
      return { style, bgcolor: color }
    }
  }
}

/** URL safe inside `url("…")` in an inline style. */
function cssUrl(url: string): string {
  return url.replace(
    /["'()\\\s]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  )
}

/** Width (%) of each column: explicit widths first, the rest split
 * equally; the total is normalized to 100. */
export function columnWidths(widths: Array<number | null>): number[] {
  if (widths.length === 0) return []
  const fixed = widths.reduce<number>((sum, w) => sum + (w ?? 0), 0)
  const auto = widths.filter((w) => w === null).length
  const share = auto > 0 ? Math.max(100 - fixed, 0) / auto : 0
  const raw = widths.map((w) => (w === null ? share : w))
  const total = raw.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return widths.map(() => 100 / widths.length)
  return raw.map((w) => Math.round((w / total) * 10000) / 100)
}

/** Ids of the columns of the section being rendered (in order). */
const ColumnSiblingsContext = createContext<readonly string[]>([])

function SectionView({
  node,
  children,
  attributes,
  breakpoint,
  editing,
}: CanvasRenderProps<EmailSectionProps>) {
  const { tokens } = useEmailContext()
  const p = node.props
  const background = emailBackground(p.background, tokens)
  const border = p.border
  return (
    <BlockFrame
      node={node}
      attributes={attributes}
      breakpoint={breakpoint}
      editing={editing}
      style={{
        ...background.style,
        borderRadius: p.radius || undefined,
        ...(border && border.style !== 'none' && border.width > 0
          ? {
              border: `${border.width}px ${border.style} ${emailColor(border.color, tokens)}`,
            }
          : {}),
      }}
    >
      <ColumnSiblingsContext.Provider value={node.children ?? []}>
        <table
          role='presentation'
          width='100%'
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ width: '100%', tableLayout: 'fixed' }}
        >
          <tbody>
            <tr>{children}</tr>
          </tbody>
        </table>
      </ColumnSiblingsContext.Provider>
    </BlockFrame>
  )
}

function oneColumnSection(): CanvasFragment {
  return {
    rootId: 's',
    nodes: {
      s: {
        id: 's',
        type: SECTION,
        props: defaultSectionProps(),
        children: ['c'],
      },
      c: { id: 'c', type: COLUMN, props: defaultColumnProps(), children: [] },
    },
  }
}

export function defaultSectionProps(): EmailSectionProps {
  return {
    background: { kind: 'none' },
    padding: spacing(16, 40),
    radius: 0,
    visibility: { ...SHOWN },
  }
}

export const sectionDefinition = defineComponent<EmailSectionProps>({
  type: SECTION,
  label: 'Seção',
  icon: 'section',
  category: 'Básicos',
  keywords: ['linha', 'bloco', 'layout', 'colunas', 'faixa'],
  propsSchema: sectionSchema,
  defaultProps: defaultSectionProps,
  accepts: [COLUMN],
  parents: [BODY],
  minChildren: 1,
  maxChildren: 4,
  template: oneColumnSection,
  inspector: [
    {
      id: 'background',
      label: 'Fundo',
      tab: 'style',
      fields: [
        {
          path: 'background',
          label: 'Fundo',
          control: {
            kind: 'background',
            allowImage: true,
            allowGradient: true,
          },
          help: 'Imagem e degradê não aparecem no Outlook: escolha também uma cor de fundo.',
        },
        { path: 'border', label: 'Borda', control: { kind: 'border' } },
        {
          path: 'radius',
          label: 'Cantos',
          control: { kind: 'number', min: 0, max: 40, unit: 'px' },
        },
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: (props) => <SectionView {...props} />,
})

/** Legacy HTML attributes (`bgcolor`) React's types do not list; React
 * still renders them as written. */
function legacyAttrs(attrs: Record<string, string | undefined>) {
  return attrs as Record<string, string>
}

// ─── column ───────────────────────────────────────────────────────────────

export function defaultColumnProps(): EmailColumnProps {
  return {
    width: null,
    verticalAlign: 'top',
    padding: spacing(0),
    stackOnMobile: true,
  }
}

function ColumnView({
  node,
  children,
  attributes,
  breakpoint,
  editing,
}: CanvasRenderProps<EmailColumnProps>) {
  const { tokens, lookup } = useEmailContext()
  const siblings = useContext(ColumnSiblingsContext)
  const p = node.props
  const index = siblings.indexOf(node.id)
  const widths = columnWidths(
    siblings.map((id) =>
      id === node.id
        ? p.width
        : ((lookup?.(id)?.props.width as number | null | undefined) ?? null),
    ),
  )
  const width = index === -1 ? 100 : widths[index]
  const stacked = editing && breakpoint === 'mobile' && p.stackOnMobile
  const background = emailColor(p.backgroundColor, tokens)
  const empty = !node.children?.length
  return (
    <td
      {...attributes}
      className={
        editing
          ? undefined
          : joinClasses(
              p.stackOnMobile && 'ec-stack',
              mobileClass(node, 'cell'),
            )
      }
      width={`${width}%`}
      valign={p.verticalAlign}
      {...legacyAttrs({ bgcolor: background })}
      style={{
        width: stacked ? '100%' : `${width}%`,
        display: stacked ? 'block' : undefined,
        verticalAlign: p.verticalAlign,
        backgroundColor: background,
        padding: spacingToCss(pick(p.padding, breakpoint, editing)),
      }}
    >
      {children}
      {empty ? (
        <EditorHint editing={editing} label='Arraste blocos para esta coluna' />
      ) : null}
    </td>
  )
}

export const columnDefinition = defineComponent<EmailColumnProps>({
  type: COLUMN,
  label: 'Coluna',
  icon: 'column',
  category: 'Básicos',
  keywords: ['coluna', 'dividir', 'lado a lado'],
  propsSchema: columnSchema,
  defaultProps: defaultColumnProps,
  // Filled in by the catalog with every block type.
  accepts: [],
  parents: [SECTION],
  inspector: [
    {
      id: 'column',
      label: 'Coluna',
      tab: 'style',
      fields: [
        {
          path: 'width',
          label: 'Largura (%)',
          control: { kind: 'number', min: 5, max: 100, unit: '%' },
          help: 'Vazio divide o espaço igualmente entre as colunas.',
        },
        {
          path: 'verticalAlign',
          label: 'Alinhamento vertical',
          control: { kind: 'segmented', options: VALIGN_OPTIONS },
        },
        colorField('backgroundColor', 'Fundo'),
        {
          path: 'padding',
          label: 'Margem interna',
          responsive: true,
          control: { kind: 'spacing', min: 0, max: 200 },
        },
        {
          path: 'stackOnMobile',
          label: 'Empilhar no celular',
          control: { kind: 'toggle' },
          help: 'No celular, cada coluna ocupa a largura toda.',
        },
      ],
    },
  ],
  render: (props) => <ColumnView {...props} />,
})

// ─── footer (required, LGPD) ──────────────────────────────────────────────

export function defaultFooterProps(): EmailFooterProps {
  return {
    note: '',
    address: '',
    showWebsite: true,
    showDivider: true,
    unsubscribeLabel: 'Descadastrar',
    align: 'center',
    textColor: 'token:text-subtle',
    fontSize: 12,
    padding: { top: 8, right: 40, bottom: 32, left: 40 },
  }
}

function FooterView({
  node,
  attributes,
  breakpoint,
  editing,
}: CanvasRenderProps<EmailFooterProps>) {
  const { brand, tokens } = useEmailContext()
  const { fontStack } = useEmailBody()
  const p = node.props
  const color = emailColor(p.textColor, tokens) ?? EMAIL_PALETTE.fg3
  const line: CSSProperties = {
    margin: '0 0 6px',
    fontSize: p.fontSize,
    lineHeight: `${Math.round(p.fontSize * 1.5)}px`,
    color,
    textAlign: p.align,
    fontFamily: fontStack,
  }
  const address = p.address.trim() || brand.address
  const website = brand.website
  return (
    <EmailTable
      attributes={attributes}
      align={p.align}
      cellClassName={editing ? undefined : mobileClass(node, 'cell')}
      cellStyle={{
        padding: spacingToCss(pick(p.padding, breakpoint, editing)),
        textAlign: p.align,
      }}
    >
      {p.showDivider ? (
        <Hr
          style={{ borderColor: EMAIL_PALETTE.stroke, margin: '8px 0 20px' }}
        />
      ) : null}
      {p.note ? <Text style={line}>{p.note}</Text> : null}
      <Text style={{ ...line, fontWeight: 600, color: EMAIL_PALETTE.fg2 }}>
        {brand.companyName}
      </Text>
      {address ? <Text style={line}>{address}</Text> : null}
      {p.showWebsite && website ? (
        <Text style={line}>
          <Link href={website} style={{ color }}>
            {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </Link>
        </Text>
      ) : null}
      <Text style={{ ...line, margin: '12px 0 0' }}>
        {`Você recebeu este e-mail porque está na base de contatos de ${brand.companyName}. Não quer mais receber? `}
        <Link
          href={UNSUBSCRIBE_URL}
          style={{ color, textDecoration: 'underline' }}
        >
          {p.unsubscribeLabel}
        </Link>
        .
      </Text>
    </EmailTable>
  )
}

export const footerDefinition = defineComponent<EmailFooterProps>({
  type: FOOTER,
  label: 'Rodapé',
  icon: 'footer',
  propsSchema: footerSchema,
  defaultProps: defaultFooterProps,
  accepts: false,
  parents: [BODY],
  required: true,
  unique: true,
  inspector: [
    {
      id: 'content',
      label: 'Rodapé',
      tab: 'content',
      fields: [
        {
          path: 'note',
          label: 'Observação',
          control: { kind: 'textarea', maxLength: 500, rows: 2 },
        },
        {
          path: 'address',
          label: 'Endereço',
          control: {
            kind: 'text',
            maxLength: 300,
            placeholder: 'Vazio usa o endereço da marca',
          },
          help: 'A LGPD pede que o remetente seja identificável.',
        },
        {
          path: 'unsubscribeLabel',
          label: 'Texto do link de descadastro',
          control: { kind: 'text', maxLength: 60 },
          help: 'O link de descadastro é obrigatório e não pode ser removido.',
        },
        {
          path: 'showWebsite',
          label: 'Mostrar o site',
          control: { kind: 'toggle' },
        },
        {
          path: 'showDivider',
          label: 'Linha acima do rodapé',
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
          path: 'align',
          label: 'Alinhamento',
          control: { kind: 'segmented', options: ALIGN_OPTIONS },
        },
        colorField('textColor', 'Cor do texto'),
        {
          path: 'fontSize',
          label: 'Tamanho do texto',
          control: { kind: 'number', min: 10, max: 16, unit: 'px' },
        },
        {
          path: 'padding',
          label: 'Margem interna',
          responsive: true,
          control: { kind: 'spacing', min: 0, max: 200 },
        },
      ],
    },
  ],
  render: (props) => <FooterView {...props} />,
})
