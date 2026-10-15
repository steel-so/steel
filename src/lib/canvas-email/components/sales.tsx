import type { CSSProperties } from 'react'
import { Img, Link, Text } from 'react-email'
import { defineComponent } from '@/src/lib/canvas/registry'
import { spacing } from '@/src/lib/canvas/values'
import { CAMPAIGN_LINK } from '@/src/lib/crm-email-builder/variables'
import { BLOCK_LAYOUT_SECTION, colorField, linkField } from '../inspector'
import { BlockFrame, EditorHint, emailHref, SHOWN } from '../primitives'
import {
  couponSchema,
  type EmailCouponProps,
  type EmailProductProps,
  productSchema,
} from '../schemas'
import {
  EMAIL_PALETTE,
  type EmailProductData,
  type EmailViewProps,
  emailColor,
} from '../theme'
import { emailBody, emailView } from './layout'

// ─── product ──────────────────────────────────────────────────────────────

/** What a product block shows: the fields filled in the block win; empty
 * ones come from the CRM product (`productId`). */
export function resolveProduct(
  props: EmailProductProps,
  products: Record<string, EmailProductData>,
): EmailProductData & { oldPrice: string } {
  const crm = props.productId ? products[props.productId] : undefined
  return {
    name: props.name.trim() || crm?.name || '',
    description: props.description.trim() || crm?.description || '',
    price: props.price.trim() || crm?.price || '',
    oldPrice: props.oldPrice.trim(),
  }
}

function ProductView(props: EmailViewProps<EmailProductProps>) {
  const { node, editing } = props
  const { tokens, products } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const data = resolveProduct(p, products)
  if (!data.name && !editing) return null
  const accent = emailColor(p.accentColor, tokens) ?? EMAIL_PALETTE.fg
  const href = emailHref(p.link)
  const src = p.image.src.trim()
  const border = p.border
  const font = body.fontStack
  const vertical = p.layout === 'vertical'
  const image = src ? (
    <Img
      src={src}
      alt={p.image.alt || data.name}
      width={vertical ? 240 : 96}
      style={{
        display: 'block',
        width: vertical ? '100%' : 96,
        maxWidth: vertical ? '100%' : 96,
        height: 'auto',
        borderRadius: 8,
        border: 0,
      }}
    />
  ) : null
  const details = (
    <>
      <Text
        style={{
          margin: 0,
          fontSize: 16,
          lineHeight: '24px',
          fontWeight: 600,
          fontFamily: font,
          color: EMAIL_PALETTE.fg,
        }}
      >
        {data.name || 'Escolha um produto do CRM'}
      </Text>
      {data.description ? (
        <Text
          style={{
            margin: '4px 0 0',
            fontSize: 14,
            lineHeight: '20px',
            fontFamily: font,
            color: EMAIL_PALETTE.fg2,
          }}
        >
          {data.description}
        </Text>
      ) : null}
      {data.price ? (
        <Text
          style={{
            margin: '8px 0 0',
            fontSize: 16,
            lineHeight: '24px',
            fontWeight: 700,
            fontFamily: font,
            color: EMAIL_PALETTE.fg,
          }}
        >
          {data.oldPrice ? (
            <span
              style={{
                color: EMAIL_PALETTE.fg3,
                fontWeight: 400,
                textDecoration: 'line-through',
                marginRight: 8,
              }}
            >
              {data.oldPrice}
            </span>
          ) : null}
          {data.price}
        </Text>
      ) : null}
      {href && p.buttonLabel ? (
        <Link
          href={href}
          style={{
            display: 'inline-block',
            marginTop: 8,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: font,
            color: accent,
          }}
        >
          {`${p.buttonLabel} →`}
        </Link>
      ) : null}
    </>
  )
  const card: CSSProperties = {
    borderRadius: 12,
    border:
      border && border.style !== 'none' && border.width > 0
        ? `${border.width}px ${border.style} ${emailColor(border.color, tokens)}`
        : `1px solid ${EMAIL_PALETTE.stroke}`,
  }
  return (
    <BlockFrame {...props}>
      <table
        role='presentation'
        width='100%'
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ ...card, borderCollapse: 'separate' }}
      >
        <tbody>
          {vertical ? (
            <>
              {image ? (
                <tr>
                  <td style={{ padding: '12px 12px 0' }}>{image}</td>
                </tr>
              ) : null}
              <tr>
                <td style={{ padding: 16 }}>{details}</td>
              </tr>
            </>
          ) : (
            <tr>
              {image ? (
                <td
                  width={112}
                  valign='top'
                  style={{ width: 112, padding: 12, verticalAlign: 'top' }}
                >
                  {image}
                </td>
              ) : null}
              <td valign='top' style={{ padding: 16, verticalAlign: 'top' }}>
                {details}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </BlockFrame>
  )
}

export const productDefinition = defineComponent<EmailProductProps>({
  type: 'email.product',
  label: 'Produto',
  icon: 'product',
  category: 'Vendas',
  keywords: ['vitrine', 'oferta', 'preço', 'catálogo', 'loja'],
  propsSchema: productSchema,
  defaultProps: () => ({
    productId: null,
    name: '',
    description: '',
    price: '',
    oldPrice: '',
    image: { src: '', alt: '' },
    link: { type: 'url', value: CAMPAIGN_LINK },
    buttonLabel: 'Comprar',
    layout: 'horizontal',
    accentColor: 'token:primary',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'product',
      label: 'Produto',
      tab: 'content',
      fields: [
        {
          path: 'productId',
          label: 'Produto do CRM',
          control: { kind: 'text', placeholder: 'Escolha um produto' },
          help: 'Nome, descrição e preço vêm do produto; preencha abaixo só o que quiser trocar.',
        },
        {
          path: 'name',
          label: 'Nome',
          control: { kind: 'text', maxLength: 120 },
        },
        {
          path: 'description',
          label: 'Descrição',
          control: { kind: 'textarea', maxLength: 300, rows: 2 },
        },
        {
          path: 'price',
          label: 'Preço',
          control: { kind: 'text', maxLength: 40 },
        },
        {
          path: 'oldPrice',
          label: 'Preço anterior (riscado)',
          control: { kind: 'text', maxLength: 40 },
        },
        { path: 'image', label: 'Imagem', control: { kind: 'image' } },
        linkField(),
        {
          path: 'buttonLabel',
          label: 'Texto do link',
          control: { kind: 'text', maxLength: 60 },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        {
          path: 'layout',
          label: 'Disposição',
          control: {
            kind: 'segmented',
            options: [
              { value: 'horizontal', label: 'Lado a lado' },
              { value: 'vertical', label: 'Empilhado' },
            ],
          },
        },
        colorField('accentColor', 'Cor do link'),
        { path: 'border', label: 'Borda', control: { kind: 'border' } },
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(ProductView),
})

// ─── coupon ───────────────────────────────────────────────────────────────

function CouponView(props: EmailViewProps<EmailCouponProps>) {
  const { node, editing } = props
  const { tokens } = props.ctx
  const body = emailBody(props.ctx)
  const p = node.props
  const accent = emailColor(p.accentColor, tokens) ?? EMAIL_PALETTE.fg
  const small: CSSProperties = {
    margin: '8px 0 0',
    fontSize: 13,
    lineHeight: '20px',
    fontFamily: body.fontStack,
    color: EMAIL_PALETTE.fg3,
  }
  return (
    <BlockFrame {...props}>
      <table
        role='presentation'
        width='100%'
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{
          border: `2px dashed ${accent}`,
          borderRadius: 12,
          borderCollapse: 'separate',
          backgroundColor: emailColor(p.backgroundColor, tokens),
        }}
      >
        <tbody>
          <tr>
            <td
              align='center'
              style={{ padding: '20px 16px', textAlign: 'center' }}
            >
              {p.label ? (
                <Text
                  style={{
                    margin: 0,
                    fontSize: 14,
                    lineHeight: '20px',
                    fontFamily: body.fontStack,
                    color: EMAIL_PALETTE.fg2,
                  }}
                >
                  {p.label}
                </Text>
              ) : null}
              {p.code ? (
                <Text
                  style={{
                    margin: '8px 0 0',
                    fontSize: 28,
                    lineHeight: '36px',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
                    color: accent,
                  }}
                >
                  {p.code}
                </Text>
              ) : (
                <EditorHint
                  editing={editing}
                  label='Informe o código do cupom'
                />
              )}
              {p.expiry ? <Text style={small}>{p.expiry}</Text> : null}
            </td>
          </tr>
        </tbody>
      </table>
    </BlockFrame>
  )
}

export const couponDefinition = defineComponent<EmailCouponProps>({
  type: 'email.coupon',
  label: 'Cupom',
  icon: 'coupon',
  category: 'Vendas',
  keywords: ['desconto', 'código', 'promoção', 'oferta'],
  propsSchema: couponSchema,
  defaultProps: () => ({
    label: 'Use o cupom na finalização da compra',
    code: 'BEMVINDO10',
    expiry: 'Válido por 7 dias',
    accentColor: 'token:primary',
    padding: spacing(8, 0),
    visibility: { ...SHOWN },
  }),
  accepts: false,
  inspector: [
    {
      id: 'content',
      label: 'Cupom',
      tab: 'content',
      fields: [
        {
          path: 'label',
          label: 'Chamada',
          control: { kind: 'text', maxLength: 120 },
        },
        {
          path: 'code',
          label: 'Código',
          control: { kind: 'text', maxLength: 40 },
        },
        {
          path: 'expiry',
          label: 'Validade',
          control: { kind: 'text', maxLength: 120 },
        },
      ],
    },
    {
      id: 'style',
      label: 'Aparência',
      tab: 'style',
      fields: [
        colorField('accentColor', 'Cor do destaque'),
        colorField('backgroundColor', 'Fundo'),
      ],
    },
    BLOCK_LAYOUT_SECTION,
  ],
  render: emailView(CouponView),
})
