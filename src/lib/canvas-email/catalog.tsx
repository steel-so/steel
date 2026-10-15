import {
  Award01Icon,
  Building03Icon,
  Calendar03Icon,
  CouponPercentIcon,
  Cursor01Icon,
  DashedLine01Icon,
  Heading02Icon,
  Image01Icon,
  LayoutBottomIcon,
  LayoutLeftIcon,
  LayoutTwoColumnIcon,
  LeftToRightListBulletIcon,
  Mail01Icon,
  Menu01Icon,
  QuoteDownIcon,
  Share08Icon,
  ShoppingBag01Icon,
  SignatureIcon,
  SourceCodeIcon,
  SquareArrowExpand01Icon,
  TextIcon,
  Video01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { Body, Head, Html, Preview } from 'react-email'
import {
  type CanvasCatalog,
  type CanvasComponentDefinition,
  defineCatalog,
} from '@/src/lib/canvas/registry'
import type { CanvasProps } from '@/src/lib/canvas/types'
import { HTML_BLOCK, htmlDefinition } from './components/advanced'
import {
  buttonDefinition,
  dividerDefinition,
  headingDefinition,
  imageDefinition,
  listDefinition,
  spacerDefinition,
  textDefinition,
} from './components/basic'
import {
  logoDefinition,
  menuDefinition,
  signatureDefinition,
  socialDefinition,
} from './components/brand'
import {
  BODY,
  bodyDefaults,
  bodyDefinition,
  COLUMN,
  columnDefinition,
  footerDefinition,
  sectionDefinition,
} from './components/layout'
import {
  eventDefinition,
  npsDefinition,
  quoteDefinition,
  videoDefinition,
} from './components/relationship'
import { couponDefinition, productDefinition } from './components/sales'
import type { EmailBodyProps } from './schemas'
import { emailColor, emailFont, googleFontHref, useEmailContext } from './theme'

/**
 * The e-mail catalog of Steel Canvas (`email`, version 2): body → section →
 * column → blocks, plus the required footer. Every component renders with
 * React Email and inline styles, so the editor canvas, the test send and the
 * campaign send all use the same code (ADR 0026).
 */

export const EMAIL_CATALOG_ID = 'email'
export const EMAIL_CATALOG_VERSION = 2

export const EMAIL_CATEGORIES = [
  'Básicos',
  'Marca',
  'Vendas',
  'Relacionamento',
  'Avançado',
] as const

const BLOCKS = [
  headingDefinition,
  textDefinition,
  buttonDefinition,
  imageDefinition,
  dividerDefinition,
  spacerDefinition,
  listDefinition,
  logoDefinition,
  socialDefinition,
  menuDefinition,
  signatureDefinition,
  productDefinition,
  couponDefinition,
  quoteDefinition,
  npsDefinition,
  eventDefinition,
  videoDefinition,
  htmlDefinition,
]

/** Types a column accepts (every block). */
export const EMAIL_BLOCK_TYPES = BLOCKS.map((block) => block.type)

const ICONS = {
  mail: Mail01Icon,
  section: LayoutLeftIcon,
  column: LayoutTwoColumnIcon,
  footer: LayoutBottomIcon,
  heading: Heading02Icon,
  text: TextIcon,
  button: Cursor01Icon,
  image: Image01Icon,
  divider: DashedLine01Icon,
  spacer: SquareArrowExpand01Icon,
  list: LeftToRightListBulletIcon,
  logo: Building03Icon,
  social: Share08Icon,
  menu: Menu01Icon,
  signature: SignatureIcon,
  product: ShoppingBag01Icon,
  coupon: CouponPercentIcon,
  quote: QuoteDownIcon,
  nps: Award01Icon,
  event: Calendar03Icon,
  video: Video01Icon,
  html: SourceCodeIcon,
}

/** Marker swapped for Outlook's font fallback after render. */
export const MSO_FONT_MARKER = 'ec-mso-font'

function EmailDocument({
  rootProps,
  editing,
  children,
}: {
  rootProps: CanvasProps
  editing: boolean
  children: ReactNode
}) {
  const ctx = useEmailContext()
  const props = rootProps as EmailBodyProps
  const defaults = bodyDefaults(props, ctx.tokens)
  const font = emailFont(props.fontFamily)
  const fontHref = googleFontHref(font)
  const outer = {
    margin: 0,
    padding: '24px 0',
    backgroundColor: emailColor(props.backgroundColor, ctx.tokens),
    fontFamily: defaults.fontStack,
    color: defaults.textColor,
  }
  if (editing) {
    return (
      <div style={{ ...outer, minHeight: '100%', boxSizing: 'border-box' }}>
        {fontHref ? <link rel='stylesheet' href={fontHref} /> : null}
        {children}
      </div>
    )
  }
  return (
    <Html lang='pt-BR' dir='ltr'>
      <Head>
        <title>{ctx.subject}</title>
        <meta name='color-scheme' content='light' />
        <meta name='supported-color-schemes' content='light' />
        <meta name='x-apple-disable-message-reformatting' />
        {fontHref ? <link rel='stylesheet' href={fontHref} /> : null}
        {fontHref ? <meta name={MSO_FONT_MARKER} content='' /> : null}
        <style dangerouslySetInnerHTML={{ __html: ctx.mobileCss }} />
      </Head>
      <Body lang='pt-BR' style={outer}>
        {props.preheader ? (
          <Preview useTitleTag={false}>{props.preheader}</Preview>
        ) : null}
        {children}
      </Body>
    </Html>
  )
}

/**
 * Builds the catalog. `allowHtml: false` keeps the HTML block registered
 * (documents that have one still validate and render) but hides it from the
 * palette — for members who are not workspace admins.
 */
export function createEmailCatalog(
  options: { allowHtml?: boolean } = {},
): CanvasCatalog {
  const allowHtml = options.allowHtml ?? true
  const column: CanvasComponentDefinition = {
    ...columnDefinition,
    accepts: EMAIL_BLOCK_TYPES,
  }
  const blocks = BLOCKS.map(
    (block): CanvasComponentDefinition =>
      block.type === HTML_BLOCK && !allowHtml
        ? { ...block, category: undefined, parents: [COLUMN] }
        : { ...block, parents: [COLUMN] },
  )
  const components: Record<string, CanvasComponentDefinition> = {
    [BODY]: bodyDefinition,
    [sectionDefinition.type]: sectionDefinition,
    [COLUMN]: column,
    [footerDefinition.type]: footerDefinition,
  }
  for (const block of blocks) components[block.type] = block
  return defineCatalog({
    id: EMAIL_CATALOG_ID,
    version: EMAIL_CATALOG_VERSION,
    rootType: BODY,
    components,
    categories: [...EMAIL_CATEGORIES],
    breakpoints: ['base', 'mobile'],
    icons: ICONS,
    renderDocument: ({ children, rootProps, editing }) => (
      <EmailDocument rootProps={rootProps} editing={editing}>
        {children}
      </EmailDocument>
    ),
  })
}

/** The full catalog (server validation and rendering). */
export const emailCatalog = createEmailCatalog()
