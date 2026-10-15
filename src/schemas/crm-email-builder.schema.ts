import z from 'zod'

/**
 * Visual e-mail builder (CRM): a template is a locked layout from the
 * gallery plus the content of each section. The document is the public
 * contract — what the editor saves and what the server renders.
 * See docs/crm-email-builder.md.
 */

export const EMAIL_BUILDER_LAYOUT_IDS = [
  'newsletter',
  'promocao',
  'convite-evento',
  'boas-vindas',
  'follow-up-proposta',
  'pesquisa-nps',
  'anuncio-produto',
  'lembrete',
] as const

export const EmailBuilderLayoutIdSchema = z.enum(EMAIL_BUILDER_LAYOUT_IDS)
export type EmailBuilderLayoutId = z.infer<typeof EmailBuilderLayoutIdSchema>

export const EMAIL_BUILDER_SECTION_TYPES = [
  'header',
  'hero',
  'text',
  'image',
  'button',
  'products',
  'features',
  'event',
  'nps',
  'quote',
  'coupon',
  'signature',
  'footer',
] as const

export type EmailBuilderSectionType =
  (typeof EMAIL_BUILDER_SECTION_TYPES)[number]

const VARIABLE_ONLY = /^\{\{\s*[a-z_]+\s*(\|[^}]*)?\}\}/
const SAFE_LINK = /^(https?:\/\/|mailto:|tel:)/i

/** Link accepted in a button/link field: empty, an absolute http(s),
 * `mailto:`/`tel:`, or starting with a variable (`{{campaign_link}}`). */
export function isEmailBuilderLink(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  return SAFE_LINK.test(trimmed) || VARIABLE_ONLY.test(trimmed)
}

/** Image source: empty or an absolute http(s) URL. */
export function isEmailBuilderImage(value: string): boolean {
  const trimmed = value.trim()
  return !trimmed || /^https?:\/\//i.test(trimmed)
}

const text = (max: number) => z.string().max(max, `Máximo de ${max} caracteres`)
const richText = z.string().max(10_000, 'Texto muito longo')
const link = z.string().max(2000).refine(isEmailBuilderLink, 'Link inválido')
const image = z
  .string()
  .max(2000)
  .refine(isEmailBuilderImage, 'Imagem precisa de um endereço https://')

const base = {
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  hidden: z.boolean(),
}

export const EmailBuilderProductSchema = z.object({
  name: text(120),
  description: text(300),
  price: text(40),
  oldPrice: text(40),
  imageSrc: image,
  imageAlt: text(200),
  url: link,
})

export const EmailBuilderFeatureSchema = z.object({
  title: text(120),
  text: text(300),
})

export const EmailBuilderSectionSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('header'), props: z.object({}) }),
  z.object({
    ...base,
    type: z.literal('hero'),
    props: z.object({
      eyebrow: text(80),
      heading: text(200),
      body: richText,
      imageSrc: image,
      imageAlt: text(200),
      buttonLabel: text(60),
      buttonUrl: link,
    }),
  }),
  z.object({
    ...base,
    type: z.literal('text'),
    props: z.object({ heading: text(200), body: richText }),
  }),
  z.object({
    ...base,
    type: z.literal('image'),
    props: z.object({
      imageSrc: image,
      imageAlt: text(200),
      linkUrl: link,
      caption: text(200),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('button'),
    props: z.object({ label: text(60), url: link, note: text(200) }),
  }),
  z.object({
    ...base,
    type: z.literal('products'),
    props: z.object({
      heading: text(200),
      buttonLabel: text(60),
      items: z.array(EmailBuilderProductSchema).min(1).max(6),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('features'),
    props: z.object({
      heading: text(200),
      items: z.array(EmailBuilderFeatureSchema).min(1).max(6),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('event'),
    props: z.object({
      heading: text(200),
      date: text(80),
      time: text(80),
      location: text(200),
      buttonLabel: text(60),
      buttonUrl: link,
    }),
  }),
  z.object({
    ...base,
    type: z.literal('nps'),
    props: z.object({
      question: text(200),
      lowLabel: text(60),
      highLabel: text(60),
      url: link,
    }),
  }),
  z.object({
    ...base,
    type: z.literal('quote'),
    props: z.object({ text: text(500), author: text(120), role: text(120) }),
  }),
  z.object({
    ...base,
    type: z.literal('coupon'),
    props: z.object({ label: text(120), code: text(40), expiry: text(120) }),
  }),
  z.object({
    ...base,
    type: z.literal('signature'),
    props: z.object({
      closing: text(80),
      name: text(120),
      role: text(120),
      contact: text(200),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('footer'),
    props: z.object({ note: text(300) }),
  }),
])

export type EmailBuilderSection = z.infer<typeof EmailBuilderSectionSchema>
export type EmailBuilderSectionOf<T extends EmailBuilderSectionType> = Extract<
  EmailBuilderSection,
  { type: T }
>
export type EmailBuilderProduct = z.infer<typeof EmailBuilderProductSchema>
export type EmailBuilderFeature = z.infer<typeof EmailBuilderFeatureSchema>

export const EmailBuilderDocumentSchema = z.object({
  version: z.literal(1),
  layout: EmailBuilderLayoutIdSchema,
  previewText: text(150),
  sections: z.array(EmailBuilderSectionSchema).min(1).max(20),
})

export type EmailBuilderDocument = z.infer<typeof EmailBuilderDocumentSchema>

/**
 * Steel Canvas e-mail document (`catalog: 'email'`, version 2 — ADR 0026):
 * a normalized tree of sections, columns and blocks. This schema only checks
 * the envelope; the server validates every node against the e-mail catalog
 * (`validateEmailDocument` in src/lib/canvas-email/validate.ts).
 */
export const EmailCanvasDocumentSchema = z.object({
  catalog: z.literal('email'),
  version: z.literal(2),
  rootId: z.string().min(1).max(64),
  nodes: z
    .record(z.string().max(64), z.record(z.string(), z.unknown()))
    .refine((nodes) => Object.keys(nodes).length <= 1500, {
      message: 'O e-mail passou do limite de 1500 elementos',
    }),
})

export type EmailCanvasDocument = z.infer<typeof EmailCanvasDocumentSchema>

/** What `builderDocument` accepts on save: v1 (locked layouts) or v2. */
export const EmailTemplateDocumentSchema = z.union([
  EmailBuilderDocumentSchema,
  EmailCanvasDocumentSchema,
])

/** Workspace branding applied to every builder template. */
export const CrmEmailBrandSchema = z.object({
  companyName: text(120),
  logoUrl: image,
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB'),
  address: text(300),
  website: z
    .string()
    .max(2000)
    .refine(
      (v) => !v.trim() || /^https?:\/\//i.test(v.trim()),
      'Site inválido',
    ),
})

export type CrmEmailBrandInput = z.infer<typeof CrmEmailBrandSchema>

/** Contact used to personalize a render (CRM person/lead or a sample). */
export const EmailBuilderContactSchema = z.object({
  email: z.string().max(320),
  name: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  city: z.string().max(120).optional(),
})

export type EmailBuilderContact = z.infer<typeof EmailBuilderContactSchema>

/** Render/test-send input: a CRM person or an inline sample contact. */
export const RenderCrmEmailTemplateSchema = z.object({
  personId: z.string().min(1).optional(),
  sample: EmailBuilderContactSchema.optional(),
  campaignLink: z.url().max(2000).optional(),
})

export type RenderCrmEmailTemplateDTO = z.infer<
  typeof RenderCrmEmailTemplateSchema
>
