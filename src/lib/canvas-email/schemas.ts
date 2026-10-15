import { z } from 'zod'
import {
  canvasBackgroundSchema,
  canvasBorderSchema,
  canvasColorSchema,
  canvasSpacingSchema,
  canvasTypographySchema,
  canvasVisibilitySchema,
  responsiveSchema,
} from '@/src/lib/canvas/values'
import {
  isEmailBuilderImage,
  isEmailBuilderLink,
} from '@/src/schemas/crm-email-builder.schema'
import { EMAIL_FONT_IDS } from './theme'

/**
 * Props schemas of the e-mail catalog (`email`, version 2). Composite values
 * (color, spacing, border, background, typography, visibility) use the shared
 * shapes of `src/lib/canvas/values.ts`, so the shell controls edit them.
 * Responsive props are `{ base, mobile? }`; mobile values become media
 * queries in the output.
 */

const text = (max: number) => z.string().max(max, `Máximo de ${max} caracteres`)

/** Links an e-mail can carry: a URL (or a variable like `{{campaign_link}}`),
 * an e-mail address or a phone number. */
export const emailLinkSchema = z
  .object({
    type: z.enum(['url', 'email', 'phone']),
    value: z.string().max(2000),
    newTab: z.boolean().optional(),
  })
  .refine(
    (link) =>
      link.type === 'url'
        ? isEmailBuilderLink(link.value)
        : !/[\s<>"']/.test(link.value.trim()),
    { message: 'Link inválido', path: ['value'] },
  )
export type EmailLink = z.infer<typeof emailLinkSchema>

/** Image source: empty, an absolute http(s) URL or a variable. */
export const emailImageSchema = z.object({
  src: z
    .string()
    .max(2000)
    .refine(
      (src) => isEmailBuilderImage(src) || /^\{\{/.test(src.trim()),
      'Imagem precisa de um endereço https://',
    ),
  alt: text(300),
})
export type EmailImage = z.infer<typeof emailImageSchema>

export const ALIGNS = ['left', 'center', 'right'] as const
export const alignSchema = z.enum(ALIGNS)
export type EmailAlign = z.infer<typeof alignSchema>

export const responsiveAlign = responsiveSchema(alignSchema)
export const responsiveSpacing = responsiveSchema(canvasSpacingSchema)
export const responsiveTypography = responsiveSchema(canvasTypographySchema)

/** Props every block carries: outer padding and per-device visibility. */
const blockBase = {
  padding: responsiveSpacing,
  visibility: canvasVisibilitySchema,
}

const optionalColor = canvasColorSchema.optional()

// ─── layout ───────────────────────────────────────────────────────────────

export const bodySchema = z.object({
  width: z.number().int().min(320).max(800),
  backgroundColor: canvasColorSchema,
  contentBackground: canvasColorSchema,
  contentRadius: z.number().min(0).max(40),
  fontFamily: z.enum(EMAIL_FONT_IDS),
  textColor: canvasColorSchema,
  linkColor: canvasColorSchema,
  preheader: text(150),
})
export type EmailBodyProps = z.infer<typeof bodySchema>

export const sectionSchema = z.object({
  background: canvasBackgroundSchema,
  padding: responsiveSpacing,
  border: canvasBorderSchema.optional(),
  radius: z.number().min(0).max(40),
  visibility: canvasVisibilitySchema,
})
export type EmailSectionProps = z.infer<typeof sectionSchema>

export const columnSchema = z.object({
  /** Share of the section width (%); `null` splits the rest equally. */
  width: z.number().min(5).max(100).nullable(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  padding: responsiveSpacing,
  backgroundColor: optionalColor,
  /** Columns become full-width rows on phones. */
  stackOnMobile: z.boolean(),
})
export type EmailColumnProps = z.infer<typeof columnSchema>

export const footerSchema = z.object({
  note: text(500),
  /** Overrides the brand address (LGPD: sender identification). */
  address: text(300),
  showWebsite: z.boolean(),
  showDivider: z.boolean(),
  unsubscribeLabel: text(60).refine((v) => v.trim().length > 0, {
    message: 'O link de descadastro precisa de um texto',
  }),
  align: alignSchema,
  textColor: canvasColorSchema,
  fontSize: z.number().min(10).max(16),
  padding: responsiveSpacing,
})
export type EmailFooterProps = z.infer<typeof footerSchema>

// ─── basic blocks ─────────────────────────────────────────────────────────

export const headingSchema = z.object({
  ...blockBase,
  text: text(300),
  level: z.enum(['h1', 'h2', 'h3']),
  align: responsiveAlign,
  color: optionalColor,
  typography: responsiveTypography.optional(),
})
export type EmailHeadingProps = z.infer<typeof headingSchema>

export const textSchema = z.object({
  ...blockBase,
  html: text(20_000),
  align: responsiveAlign,
  color: optionalColor,
  linkColor: optionalColor,
  typography: responsiveTypography.optional(),
})
export type EmailTextProps = z.infer<typeof textSchema>

export const buttonSchema = z.object({
  ...blockBase,
  label: text(80),
  link: emailLinkSchema,
  align: responsiveAlign,
  backgroundColor: canvasColorSchema,
  textColor: canvasColorSchema,
  radius: z.number().min(0).max(40),
  buttonPadding: canvasSpacingSchema,
  border: canvasBorderSchema.optional(),
  fullWidth: z.boolean(),
  typography: responsiveTypography.optional(),
})
export type EmailButtonProps = z.infer<typeof buttonSchema>

export const imageSchema = z.object({
  ...blockBase,
  image: emailImageSchema,
  link: emailLinkSchema.optional(),
  /** Width in px; `null` fills the column. */
  width: z.number().int().min(16).max(800).nullable(),
  align: responsiveAlign,
  radius: z.number().min(0).max(40),
  /** Fills the screen width on phones. */
  mobileFullWidth: z.boolean(),
})
export type EmailImageProps = z.infer<typeof imageSchema>

export const dividerSchema = z.object({
  ...blockBase,
  color: canvasColorSchema,
  thickness: z.number().int().min(1).max(10),
  style: z.enum(['solid', 'dashed', 'dotted']),
  /** Width in % of the column. */
  width: z.number().min(10).max(100),
})
export type EmailDividerProps = z.infer<typeof dividerSchema>

export const spacerSchema = z.object({
  height: responsiveSchema(z.number().int().min(4).max(200)),
  visibility: canvasVisibilitySchema,
})
export type EmailSpacerProps = z.infer<typeof spacerSchema>

export const listItemSchema = z.object({
  title: text(160),
  text: text(400),
})
export const listSchema = z.object({
  ...blockBase,
  items: z.array(listItemSchema).min(1).max(20),
  marker: z.enum(['number', 'bullet', 'check']),
  markerColor: canvasColorSchema,
  color: optionalColor,
  typography: responsiveTypography.optional(),
})
export type EmailListProps = z.infer<typeof listSchema>

// ─── brand blocks ─────────────────────────────────────────────────────────

export const logoSchema = z.object({
  ...blockBase,
  /** Empty `src` uses the workspace brand logo (or its name). */
  image: emailImageSchema,
  height: z.number().int().min(16).max(160),
  align: responsiveAlign,
  link: emailLinkSchema.optional(),
})
export type EmailLogoProps = z.infer<typeof logoSchema>

export const SOCIAL_NETWORKS = [
  'instagram',
  'facebook',
  'linkedin',
  'x',
  'youtube',
  'tiktok',
  'whatsapp',
  'website',
] as const

export const socialSchema = z.object({
  ...blockBase,
  items: z
    .array(
      z.object({
        network: z.enum(SOCIAL_NETWORKS),
        link: emailLinkSchema,
      }),
    )
    .min(1)
    .max(10),
  align: responsiveAlign,
  variant: z.enum(['solid', 'outline', 'text']),
  color: canvasColorSchema,
})
export type EmailSocialProps = z.infer<typeof socialSchema>

export const menuSchema = z.object({
  ...blockBase,
  items: z
    .array(z.object({ label: text(60), link: emailLinkSchema }))
    .min(1)
    .max(8),
  separator: text(3),
  align: responsiveAlign,
  color: canvasColorSchema,
  typography: responsiveTypography.optional(),
})
export type EmailMenuProps = z.infer<typeof menuSchema>

export const signatureSchema = z.object({
  ...blockBase,
  closing: text(80),
  name: text(120),
  role: text(120),
  contact: text(200),
  photo: emailImageSchema,
  align: responsiveAlign,
  color: optionalColor,
})
export type EmailSignatureProps = z.infer<typeof signatureSchema>

// ─── sales ────────────────────────────────────────────────────────────────

export const productSchema = z.object({
  ...blockBase,
  /** CRM product (`CrmProduct.id`); its name, description and price fill
   * the fields left empty below. */
  productId: z.string().max(40).nullable(),
  name: text(120),
  description: text(300),
  price: text(40),
  oldPrice: text(40),
  image: emailImageSchema,
  link: emailLinkSchema,
  buttonLabel: text(60),
  layout: z.enum(['horizontal', 'vertical']),
  accentColor: canvasColorSchema,
  border: canvasBorderSchema.optional(),
})
export type EmailProductProps = z.infer<typeof productSchema>

export const couponSchema = z.object({
  ...blockBase,
  label: text(120),
  code: text(40),
  expiry: text(120),
  accentColor: canvasColorSchema,
  backgroundColor: optionalColor,
})
export type EmailCouponProps = z.infer<typeof couponSchema>

// ─── relationship ─────────────────────────────────────────────────────────

export const quoteSchema = z.object({
  ...blockBase,
  text: text(600),
  author: text(120),
  role: text(120),
  accentColor: canvasColorSchema,
  color: optionalColor,
})
export type EmailQuoteProps = z.infer<typeof quoteSchema>

export const npsSchema = z.object({
  ...blockBase,
  question: text(200),
  lowLabel: text(60),
  highLabel: text(60),
  /** Each score links here with `?nota=<0-10>`. */
  link: emailLinkSchema,
  accentColor: canvasColorSchema,
})
export type EmailNpsProps = z.infer<typeof npsSchema>

export const eventSchema = z.object({
  ...blockBase,
  heading: text(200),
  date: text(80),
  time: text(80),
  location: text(200),
  buttonLabel: text(60),
  link: emailLinkSchema,
  backgroundColor: canvasColorSchema,
  accentColor: canvasColorSchema,
})
export type EmailEventProps = z.infer<typeof eventSchema>

export const videoSchema = z.object({
  ...blockBase,
  thumbnail: emailImageSchema,
  link: emailLinkSchema,
  label: text(80),
  accentColor: canvasColorSchema,
  radius: z.number().min(0).max(40),
})
export type EmailVideoProps = z.infer<typeof videoSchema>

// ─── advanced ─────────────────────────────────────────────────────────────

export const htmlSchema = z.object({
  ...blockBase,
  /** Sanitized on save and on render (admins only). */
  html: text(50_000),
})
export type EmailHtmlProps = z.infer<typeof htmlSchema>
