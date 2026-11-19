import z from 'zod'

/**
 * Banners / mídia display (CRM > Atrair > Tráfego pago > Banners). O documento
 * guarda uma lista de formatos de tamanho fixo e, em cada um, o fundo e os
 * elementos posicionados em pixels do próprio formato. Renderização para PNG,
 * JPG ou WebP acontece no navegador (`src/lib/banners/render.ts`).
 */

export const BANNER_MAX_FORMATS = 20
export const BANNER_MAX_ELEMENTS = 60
export const BANNER_MAX_TAGS = 10

export const BANNER_OBJECTIVES = [
  'AWARENESS',
  'LEADS',
  'SALES',
  'PROMOTION',
  'EVENT',
  'RETENTION',
] as const
export type BannerObjective = (typeof BANNER_OBJECTIVES)[number]

export const BANNER_OBJECTIVE_LABELS: Record<BannerObjective, string> = {
  AWARENESS: 'Reconhecimento de marca',
  LEADS: 'Geração de leads',
  SALES: 'Vendas',
  PROMOTION: 'Promoção',
  EVENT: 'Evento',
  RETENTION: 'Fidelização',
}

const Color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Cor inválida')

const Url = z.string().trim().max(2000)

export const BannerFillSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color: Color }),
  z.object({
    kind: z.literal('gradient'),
    from: Color,
    to: Color,
    angle: z.number().min(0).max(360),
  }),
])
export type BannerFill = z.infer<typeof BannerFillSchema>

export const BannerBackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color: Color }),
  z.object({
    kind: z.literal('gradient'),
    from: Color,
    to: Color,
    angle: z.number().min(0).max(360),
  }),
  z.object({
    kind: z.literal('image'),
    src: Url,
    /** Cor por cima da foto (com transparência) para o texto ler bem. */
    overlay: Color,
    /** Cor mostrada enquanto a imagem não carrega. */
    fallback: Color,
  }),
])
export type BannerBackground = z.infer<typeof BannerBackgroundSchema>

export const BANNER_ROLES = [
  'headline',
  'subheadline',
  'cta',
  'logo',
  'image',
  'badge',
  'decor',
] as const
export type BannerRole = (typeof BANNER_ROLES)[number]

export const BANNER_FONT_FAMILIES = [
  'sans',
  'serif',
  'mono',
  'display',
] as const
export type BannerFontFamily = (typeof BANNER_FONT_FAMILIES)[number]

const ElementBase = {
  id: z.string().min(1).max(40),
  name: z.string().trim().max(80),
  role: z.enum(BANNER_ROLES),
  x: z.number().min(-5000).max(5000),
  y: z.number().min(-5000).max(5000),
  w: z.number().min(1).max(5000),
  h: z.number().min(1).max(5000),
  rotation: z.number().min(-360).max(360),
  opacity: z.number().min(0).max(1),
  hidden: z.boolean(),
  locked: z.boolean(),
}

export const BannerTextElementSchema = z.object({
  ...ElementBase,
  type: z.literal('text'),
  text: z.string().max(500),
  fontFamily: z.enum(BANNER_FONT_FAMILIES),
  fontSize: z.number().min(4).max(800),
  fontWeight: z.number().int().min(100).max(900),
  color: Color,
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().min(0.7).max(3),
  letterSpacing: z.number().min(-10).max(50),
  uppercase: z.boolean(),
})

export const BannerShapeElementSchema = z.object({
  ...ElementBase,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse']),
  fill: BannerFillSchema,
  radius: z.number().min(0).max(2000),
  strokeColor: Color,
  strokeWidth: z.number().min(0).max(100),
})

const imageFields = {
  ...ElementBase,
  src: Url,
  fit: z.enum(['cover', 'contain']),
  radius: z.number().min(0).max(2000),
  alt: z.string().trim().max(200),
}

export const BannerImageElementSchema = z.object({
  ...imageFields,
  type: z.literal('image'),
})

export const BannerLogoElementSchema = z.object({
  ...imageFields,
  type: z.literal('logo'),
})

export const BannerButtonElementSchema = z.object({
  ...ElementBase,
  type: z.literal('button'),
  text: z.string().max(80),
  background: BannerFillSchema,
  color: Color,
  radius: z.number().min(0).max(2000),
  fontFamily: z.enum(BANNER_FONT_FAMILIES),
  fontSize: z.number().min(4).max(400),
  fontWeight: z.number().int().min(100).max(900),
  uppercase: z.boolean(),
})

export const BannerElementSchema = z.discriminatedUnion('type', [
  BannerTextElementSchema,
  BannerShapeElementSchema,
  BannerImageElementSchema,
  BannerLogoElementSchema,
  BannerButtonElementSchema,
])
export type BannerElement = z.infer<typeof BannerElementSchema>
export type BannerTextElement = z.infer<typeof BannerTextElementSchema>
export type BannerShapeElement = z.infer<typeof BannerShapeElementSchema>
export type BannerImageElement = z.infer<typeof BannerImageElementSchema>
export type BannerLogoElement = z.infer<typeof BannerLogoElementSchema>
export type BannerButtonElement = z.infer<typeof BannerButtonElementSchema>

export const BannerFormatSchema = z.object({
  /** Chave do catálogo (`src/lib/banners/formats.ts`), ex.: `gdn-300x250`. */
  formatId: z.string().min(1).max(40),
  width: z.number().int().min(16).max(4096),
  height: z.number().int().min(16).max(4096),
  background: BannerBackgroundSchema,
  elements: z.array(BannerElementSchema).max(BANNER_MAX_ELEMENTS),
})
export type BannerFormat = z.infer<typeof BannerFormatSchema>

export const BannerDocumentSchema = z.object({
  version: z.literal(1),
  formats: z.array(BannerFormatSchema).min(1).max(BANNER_MAX_FORMATS),
})
export type BannerDocument = z.infer<typeof BannerDocumentSchema>

const NameField = z.string().trim().min(1, 'Informe o nome do banner').max(120)
const FolderField = z.string().trim().max(60)
const TagsField = z
  .array(z.string().trim().min(1).max(30))
  .max(BANNER_MAX_TAGS)
  .transform((tags) => [...new Set(tags)])

export const CreateCrmBannerSchema = z.object({
  name: NameField,
  folder: FolderField.default(''),
  tags: TagsField.default([]),
  objective: z.enum(BANNER_OBJECTIVES).nullable().default(null),
  document: BannerDocumentSchema,
})
export type CreateCrmBannerDTO = z.infer<typeof CreateCrmBannerSchema>

export const UpdateCrmBannerSchema = z
  .object({
    name: NameField,
    folder: FolderField,
    tags: TagsField,
    objective: z.enum(BANNER_OBJECTIVES).nullable(),
    document: BannerDocumentSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  })
export type UpdateCrmBannerDTO = z.infer<typeof UpdateCrmBannerSchema>

export const DuplicateCrmBannerSchema = z.object({
  name: NameField.optional(),
})
export type DuplicateCrmBannerDTO = z.infer<typeof DuplicateCrmBannerSchema>

/* ----------------------------- IA (briefing) ----------------------------- */

export const BANNER_AI_TONES = [
  'DIRECT',
  'FRIENDLY',
  'URGENT',
  'PREMIUM',
] as const
export type BannerAiTone = (typeof BANNER_AI_TONES)[number]

export const BANNER_AI_TONE_LABELS: Record<BannerAiTone, string> = {
  DIRECT: 'Direto',
  FRIENDLY: 'Amigável',
  URGENT: 'Urgente',
  PREMIUM: 'Premium',
}

export const BannerAiBriefSchema = z.object({
  /** `BANNER` cria o texto de um banner novo; `VARIANTS` gera opções A/B. */
  mode: z.enum(['BANNER', 'VARIANTS']),
  headline: z.string().trim().max(120).default(''),
  offer: z.string().trim().max(200).default(''),
  cta: z.string().trim().max(40).default(''),
  /** Ideia da imagem principal (a IA descreve, o usuário escolhe o arquivo). */
  imageIdea: z.string().trim().max(200).default(''),
  /** Para `BANNER`: o que se quer divulgar, em uma ou duas frases. */
  description: z.string().trim().max(600).default(''),
  objective: z.enum(BANNER_OBJECTIVES).nullable().default(null),
  tone: z.enum(BANNER_AI_TONES).default('DIRECT'),
  /** Nome da empresa, para ancorar o texto (não é dado sensível). */
  companyName: z.string().trim().max(120).default(''),
  /** Quantas opções devolver (A/B). */
  count: z.number().int().min(1).max(5).default(3),
  /** Textos atuais do banner (`VARIANTS`): a IA reescreve estes. */
  current: z
    .object({
      headline: z.string().max(200).default(''),
      subheadline: z.string().max(300).default(''),
      cta: z.string().max(60).default(''),
    })
    .optional(),
})
export type CrmBannerAiBriefDTO = z.infer<typeof BannerAiBriefSchema>
export type CrmBannerAiBriefInput = z.input<typeof BannerAiBriefSchema>

export const BANNER_COPY_LIMITS = {
  headline: 60,
  subheadline: 120,
  cta: 24,
  badge: 24,
} as const

export const BannerAiCopySchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  cta: z.string(),
  badge: z.string(),
})
export type BannerAiCopy = z.infer<typeof BannerAiCopySchema>

/** Saída estruturada pedida ao provedor. */
export const BannerAiOutputSchema = z.object({
  variants: z.array(BannerAiCopySchema).min(1),
  imageIdea: z.string(),
})

export const BANNER_AI_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['variants', 'imageIdea'],
  properties: {
    imageIdea: { type: 'string' },
    variants: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'subheadline', 'cta', 'badge'],
        properties: {
          headline: { type: 'string' },
          subheadline: { type: 'string' },
          cta: { type: 'string' },
          badge: { type: 'string' },
        },
      },
    },
  },
}
