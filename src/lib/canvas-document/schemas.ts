import { z } from 'zod'
import {
  canvasBackgroundSchema,
  canvasBorderSchema,
  canvasColorSchema,
  canvasLinkSchema,
  canvasSpacingSchema,
} from '@/src/lib/canvas/values'
import { SITE_ICON_NAMES } from '@/src/lib/canvas-site/icons'

/**
 * Props of every `document` catalog component (Zod). Optional fields are
 * the rule: the AI import, the proposal converter and the inspector's list
 * control all write partial objects, and the renderers fall back to the
 * theme. Changing a field's meaning breaks stored documents: add, never
 * rename.
 */

const shortText = z.string().max(500)
const longText = z.string().max(5000)
const richHtml = z.string().max(20_000)
const urlText = z.string().max(2000)
const alignSchema = z.enum(['left', 'center', 'right'])

export const SECTION_VARIANTS = ['default', 'cover', 'highlight'] as const

export const documentRootSchema = z.object({})
export type DocumentRootProps = z.infer<typeof documentRootSchema>

export const documentSectionSchema = z.object({
  variant: z.enum(SECTION_VARIANTS).optional(),
  background: canvasBackgroundSchema.optional(),
  padding: canvasSpacingSchema.optional(),
  /** Starts on a new page in the paged layout and in the PDF. */
  pageBreakBefore: z.boolean().optional(),
  align: alignSchema.optional(),
})
export type DocumentSectionProps = z.infer<typeof documentSectionSchema>

export const CONTAINER_STYLES = ['plain', 'card', 'soft', 'outline'] as const

export const documentContainerSchema = z.object({
  style: z.enum(CONTAINER_STYLES).optional(),
  background: canvasBackgroundSchema.optional(),
  padding: canvasSpacingSchema.optional(),
  border: canvasBorderSchema.optional(),
  radius: z.number().min(0).max(64).optional(),
  align: alignSchema.optional(),
  /** px; empty = full width. */
  maxWidth: z.number().min(120).max(1400).optional(),
})
export type DocumentContainerProps = z.infer<typeof documentContainerSchema>

export const COLUMN_RATIOS = [
  '1-1',
  '1-2',
  '2-1',
  '1-1-1',
  '1-2-1',
  '1-1-1-1',
] as const

export const documentColumnsSchema = z.object({
  ratio: z.enum(COLUMN_RATIOS).optional(),
  gap: z.number().min(0).max(120).optional(),
  verticalAlign: z.enum(['top', 'center', 'bottom']).optional(),
  /** Columns stack below 640 px (default true). */
  stackOnMobile: z.boolean().optional(),
})
export type DocumentColumnsProps = z.infer<typeof documentColumnsSchema>

export const documentColumnSchema = z.object({
  background: canvasBackgroundSchema.optional(),
  padding: canvasSpacingSchema.optional(),
  radius: z.number().min(0).max(64).optional(),
})
export type DocumentColumnProps = z.infer<typeof documentColumnSchema>

/** `'1'`–`'4'` (what the segmented control writes); numbers are accepted
 * for content written by code. */
const headingLevelSchema = z.union([
  z.enum(['1', '2', '3', '4']),
  z.number().int().min(1).max(4),
])

export const documentHeadingSchema = z.object({
  text: shortText,
  level: headingLevelSchema.optional(),
  align: alignSchema.optional(),
  color: canvasColorSchema.optional(),
  /** Small label above the title ("Proposta comercial"). */
  eyebrow: z.string().max(120).optional(),
})
export type DocumentHeadingProps = z.infer<typeof documentHeadingSchema>

export const documentTextSchema = z.object({
  html: richHtml,
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  color: canvasColorSchema.optional(),
})
export type DocumentTextProps = z.infer<typeof documentTextSchema>

const listItemSchema = z.object({ text: z.string().max(2000).optional() })

export const documentListSchema = z.object({
  items: z.array(listItemSchema).max(100),
  marker: z.enum(['bullet', 'number', 'check']).optional(),
  color: canvasColorSchema.optional(),
})
export type DocumentListProps = z.infer<typeof documentListSchema>

export const documentQuoteSchema = z.object({
  text: urlText,
  author: shortText.optional(),
  role: shortText.optional(),
  size: z.enum(['md', 'lg']).optional(),
})
export type DocumentQuoteProps = z.infer<typeof documentQuoteSchema>

export const CALLOUT_TONES = ['info', 'success', 'warning', 'neutral'] as const

export const documentCalloutSchema = z.object({
  title: shortText.optional(),
  text: urlText,
  tone: z.enum(CALLOUT_TONES).optional(),
})
export type DocumentCalloutProps = z.infer<typeof documentCalloutSchema>

export const documentTableSchema = z.object({
  rows: z.array(z.array(z.string().max(1000)).max(12)).max(200),
  /** The first row is the header. */
  headerRow: z.boolean().optional(),
  striped: z.boolean().optional(),
  compact: z.boolean().optional(),
})
export type DocumentTableProps = z.infer<typeof documentTableSchema>

export const BUTTON_VARIANTS = ['primary', 'secondary', 'outline'] as const

export const documentButtonSchema = z.object({
  label: shortText,
  link: canvasLinkSchema.optional(),
  variant: z.enum(BUTTON_VARIANTS).optional(),
  align: alignSchema.optional(),
  fullWidth: z.boolean().optional(),
})
export type DocumentButtonProps = z.infer<typeof documentButtonSchema>

export const documentDividerSchema = z.object({
  style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  color: canvasColorSchema.optional(),
  thickness: z.number().min(1).max(8).optional(),
  width: z.number().min(10).max(100).optional(),
})
export type DocumentDividerProps = z.infer<typeof documentDividerSchema>

export const documentSpacerSchema = z.object({
  height: z.number().min(0).max(400).optional(),
})
export type DocumentSpacerProps = z.infer<typeof documentSpacerSchema>

export const documentPageBreakSchema = z.object({})

export const documentImageSchema = z.object({
  src: urlText.optional(),
  alt: shortText.optional(),
  caption: shortText.optional(),
  /** % of the column. */
  width: z.number().min(10).max(100).optional(),
  align: alignSchema.optional(),
  radius: z.number().min(0).max(64).optional(),
  border: z.boolean().optional(),
})
export type DocumentImageProps = z.infer<typeof documentImageSchema>

export const documentIconSchema = z.object({
  name: z.enum(SITE_ICON_NAMES),
  size: z.number().min(12).max(160).optional(),
  color: canvasColorSchema.optional(),
  align: alignSchema.optional(),
  badge: z.boolean().optional(),
})
export type DocumentIconProps = z.infer<typeof documentIconSchema>

export const documentVideoSchema = z.object({
  url: urlText,
  title: shortText.optional(),
  caption: shortText.optional(),
})
export type DocumentVideoProps = z.infer<typeof documentVideoSchema>

const imageItemSchema = z.object({
  src: urlText.optional(),
  alt: shortText.optional(),
  caption: shortText.optional(),
})

export const documentGallerySchema = z.object({
  images: z.array(imageItemSchema).max(40),
  columns: z.number().int().min(1).max(4).optional(),
  aspect: z.enum(['auto', '1/1', '4/3', '16/9']).optional(),
})
export type DocumentGalleryProps = z.infer<typeof documentGallerySchema>

export const documentAccordionSchema = z.object({
  style: z.enum(['lines', 'cards']).optional(),
})
export type DocumentAccordionProps = z.infer<typeof documentAccordionSchema>

export const documentAccordionItemSchema = z.object({
  title: shortText,
  /** Starts open on the public link. */
  open: z.boolean().optional(),
})
export type DocumentAccordionItemProps = z.infer<
  typeof documentAccordionItemSchema
>

const statItemSchema = z.object({
  value: shortText.optional(),
  label: shortText.optional(),
})

export const documentStatsSchema = z.object({
  items: z.array(statItemSchema).max(8),
  style: z.enum(['plain', 'cards', 'accent']).optional(),
  align: alignSchema.optional(),
})
export type DocumentStatsProps = z.infer<typeof documentStatsSchema>

const testimonialSchema = z.object({
  quote: urlText.optional(),
  author: shortText.optional(),
  role: shortText.optional(),
  photo: urlText.optional(),
})

export const documentTestimonialsSchema = z.object({
  items: z.array(testimonialSchema).max(12),
  columns: z.number().int().min(1).max(3).optional(),
})
export type DocumentTestimonialsProps = z.infer<
  typeof documentTestimonialsSchema
>

export const documentLogosSchema = z.object({
  title: shortText.optional(),
  items: z.array(imageItemSchema).max(24),
  columns: z.number().int().min(2).max(6).optional(),
  grayscale: z.boolean().optional(),
})
export type DocumentLogosProps = z.infer<typeof documentLogosSchema>

export const documentTocSchema = z.object({
  title: shortText.optional(),
  numbered: z.boolean().optional(),
  columns: z.number().int().min(1).max(2).optional(),
})
export type DocumentTocProps = z.infer<typeof documentTocSchema>

export const documentContactCardSchema = z.object({
  name: shortText.optional(),
  role: shortText.optional(),
  company: shortText.optional(),
  email: shortText.optional(),
  phone: shortText.optional(),
  photo: urlText.optional(),
  title: shortText.optional(),
})
export type DocumentContactCardProps = z.infer<typeof documentContactCardSchema>

// ─── functional ───────────────────────────────────────────────────────────

export const documentAcceptSchema = z.object({
  title: shortText.optional(),
  /** Text shown above the form (conditions, what accepting means). */
  terms: urlText.optional(),
  buttonLabel: shortText.optional(),
  allowDecline: z.boolean().optional(),
  declineLabel: shortText.optional(),
  /** Asks the reader's e-mail besides the name (default true). */
  askEmail: z.boolean().optional(),
  /** `submit` only sends the form fields ("Enviar respostas"), without
   * accepting the document. */
  action: z.enum(['accept', 'submit']).optional(),
})
export type DocumentAcceptProps = z.infer<typeof documentAcceptSchema>

export const documentPricingItemSchema = z.object({
  id: z.string().min(1).max(64),
  productId: z.string().max(64).nullable().optional(),
  name: z.string().max(200),
  description: z.string().max(1000).optional(),
  unit: z.string().max(40).optional(),
  unitPrice: z.number().min(0).max(1_000_000_000),
  quantity: z.number().min(0).max(1_000_000),
  discountPct: z.number().min(0).max(100).optional(),
  optional: z.boolean().optional(),
  selectedByDefault: z.boolean().optional(),
  quantityEditable: z.boolean().optional(),
  recurrence: z.enum(['once', 'monthly', 'yearly']).optional(),
})

export const documentPricingTableSchema = z.object({
  title: shortText.optional(),
  items: z.array(documentPricingItemSchema).max(100),
  showTotals: z.boolean().optional(),
  showDescriptions: z.boolean().optional(),
  note: longText.optional(),
})
export type DocumentPricingTableProps = z.infer<
  typeof documentPricingTableSchema
>

export const documentPaymentSchema = z.object({
  title: shortText.optional(),
  description: urlText.optional(),
  pix: z.boolean().optional(),
  boleto: z.boolean().optional(),
})
export type DocumentPaymentProps = z.infer<typeof documentPaymentSchema>

const attachmentSchema = z.object({
  name: shortText.optional(),
  url: urlText.optional(),
  size: z.string().max(40).optional(),
})

export const documentAttachmentsSchema = z.object({
  title: shortText.optional(),
  files: z.array(attachmentSchema).max(20),
})
export type DocumentAttachmentsProps = z.infer<typeof documentAttachmentsSchema>

export const documentValiditySchema = z.object({
  label: shortText.optional(),
  showCountdown: z.boolean().optional(),
  style: z.enum(['badge', 'banner']).optional(),
})
export type DocumentValidityProps = z.infer<typeof documentValiditySchema>

export const documentMeetingSchema = z.object({
  title: shortText.optional(),
  description: urlText.optional(),
  url: urlText.optional(),
  buttonLabel: shortText.optional(),
  duration: z.string().max(60).optional(),
})
export type DocumentMeetingProps = z.infer<typeof documentMeetingSchema>

/** Props shared by the `field-*` types (see `DocumentFieldProps`). */
export const documentFieldSchema = z.object({
  label: z.string().max(500),
  required: z.boolean().optional(),
  placeholder: shortText.optional(),
  helpText: shortText.optional(),
  options: z.array(z.string().max(500)).max(50).optional(),
  multiple: z.boolean().optional(),
  crmField: z.string().max(80).optional(),
})
export type DocumentFieldSchemaProps = z.infer<typeof documentFieldSchema>
