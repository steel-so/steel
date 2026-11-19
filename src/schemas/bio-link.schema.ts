import z from 'zod'
import {
  BIO_NETWORKS,
  resolveBioDestination,
  youtubeVideoId,
} from '@/src/lib/bio-link/destination'
import {
  BIO_SLUG_MAX,
  BIO_SLUG_MIN,
  isValidBioSlug,
} from '@/src/lib/bio-link/slug'

/** Most blocks a bio page holds (abuse guard, far above real use). */
export const MAX_BIO_BLOCKS = 60

export const BioSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(BIO_SLUG_MIN, `O endereço precisa ter ao menos ${BIO_SLUG_MIN} letras`)
  .max(BIO_SLUG_MAX, `O endereço aceita até ${BIO_SLUG_MAX} caracteres`)
  .refine(isValidBioSlug, 'Use letras minúsculas, números e hífens')

/* -------------------------------- theme -------------------------------- */

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #RRGGBB)')

export const BIO_BUTTON_STYLES = ['solid', 'outline', 'soft'] as const
export const BIO_RADII = ['none', 'sm', 'md', 'lg', 'full'] as const
export const BIO_FONTS = ['sans', 'serif', 'mono', 'rounded'] as const
export const BIO_BACKGROUNDS = ['solid', 'gradient'] as const

export const BioThemeSchema = z.object({
  background: z.enum(BIO_BACKGROUNDS).default('solid'),
  backgroundColor: hexColor.default('#f4f4f5'),
  backgroundColor2: hexColor.default('#e4e4e7'),
  textColor: hexColor.default('#18181b'),
  buttonColor: hexColor.default('#18181b'),
  buttonTextColor: hexColor.default('#ffffff'),
  buttonStyle: z.enum(BIO_BUTTON_STYLES).default('solid'),
  radius: z.enum(BIO_RADII).default('lg'),
  font: z.enum(BIO_FONTS).default('sans'),
})

export type BioThemeDTO = z.infer<typeof BioThemeSchema>

export const DEFAULT_BIO_THEME: BioThemeDTO = BioThemeSchema.parse({})

/** Stored theme with every missing or invalid field back to its default. */
export function parseBioTheme(raw: unknown): BioThemeDTO {
  const parsed = BioThemeSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : DEFAULT_BIO_THEME
}

/* -------------------------------- blocks ------------------------------- */

const blockId = z.string().trim().min(1).max(40)
const title = z.string().trim().min(1, 'Informe o título').max(80)
const schedule = z.iso.datetime({ offset: true }).nullable().optional()

const base = {
  id: blockId,
  active: z.boolean().default(true),
  /** Visible from this instant (ISO), when set. */
  startsAt: schedule,
  /** Hidden from this instant (ISO), when set. */
  endsAt: schedule,
}

export const BioLinkBlockSchema = z.object({
  ...base,
  type: z.literal('link'),
  network: z.enum(BIO_NETWORKS).default('custom'),
  title,
  /** URL, handle, phone number or e-mail, depending on the network. */
  value: z.string().trim().min(1, 'Informe o destino').max(500),
  /** Pre-filled message of a WhatsApp button. */
  message: z.string().trim().max(500).nullable().optional(),
})

export const BioHeaderBlockSchema = z.object({
  ...base,
  type: z.literal('header'),
  title,
})

export const BioFormBlockSchema = z.object({
  ...base,
  type: z.literal('form'),
  title,
  /** Public token of a published CRM form. */
  formToken: z.string().trim().min(1).max(64),
  /** `link`: a button opening the form page; `embed`: the form inline. */
  mode: z.enum(['link', 'embed']).default('link'),
})

export const BioVideoBlockSchema = z.object({
  ...base,
  type: z.literal('video'),
  title: z.string().trim().max(80).nullable().optional(),
  url: z.string().trim().min(1, 'Informe o link do vídeo').max(300),
})

export const BioBlockSchema = z.discriminatedUnion('type', [
  BioLinkBlockSchema,
  BioHeaderBlockSchema,
  BioFormBlockSchema,
  BioVideoBlockSchema,
])

export type BioBlockDTO = z.infer<typeof BioBlockSchema>
export type BioLinkBlockDTO = z.infer<typeof BioLinkBlockSchema>

export const BioBlocksSchema = z
  .array(BioBlockSchema)
  .max(MAX_BIO_BLOCKS, `A página aceita até ${MAX_BIO_BLOCKS} itens`)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>()
    blocks.forEach((block, index) => {
      if (seen.has(block.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'Item repetido',
        })
      }
      seen.add(block.id)

      if (
        block.startsAt &&
        block.endsAt &&
        Date.parse(block.startsAt) >= Date.parse(block.endsAt)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'endsAt'],
          message: 'O fim precisa ser depois do início',
        })
      }

      if (block.type === 'link' && !resolveBioDestination(block)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'value'],
          message: 'Destino inválido para este tipo de botão',
        })
      }
      if (block.type === 'video' && !youtubeVideoId(block.url)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'url'],
          message: 'Use um link de vídeo do YouTube',
        })
      }
    })
  })

/** Stored blocks, dropping any that no longer validate (older shapes). */
export function parseBioBlocks(raw: unknown): BioBlockDTO[] {
  if (!Array.isArray(raw)) return []
  const blocks: BioBlockDTO[] = []
  for (const item of raw) {
    const parsed = BioBlockSchema.safeParse(item)
    if (parsed.success) blocks.push(parsed.data)
  }
  return blocks
}

/* ------------------------------ page inputs ---------------------------- */

const avatarUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => /^https:\/\//i.test(value), 'Use um endereço https')

export const CreateBioLinkSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(80),
  slug: BioSlugSchema.optional(),
})

export type CreateBioLinkDTO = z.infer<typeof CreateBioLinkSchema>

export const UpdateBioLinkSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(80),
    slug: BioSlugSchema,
    status: z.enum(['DRAFT', 'PUBLISHED']),
    title: z.string().trim().max(80).nullable(),
    description: z.string().trim().max(300).nullable(),
    avatarUrl: avatarUrl.nullable(),
    theme: BioThemeSchema,
    blocks: BioBlocksSchema,
    noIndex: z.boolean(),
  })
  .partial()

export type UpdateBioLinkDTO = z.infer<typeof UpdateBioLinkSchema>

export const BioSlugAvailabilityQuerySchema = z.object({
  slug: BioSlugSchema,
  bioLinkId: z.string().trim().min(1).max(40).optional(),
})

export const BIO_ANALYTICS_DAYS = [7, 30, 90] as const

export const BioAnalyticsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine(
      (value) => (BIO_ANALYTICS_DAYS as readonly number[]).includes(value),
      'Período inválido',
    )
    .default(30),
})

export type BioAnalyticsQueryDTO = z.infer<typeof BioAnalyticsQuerySchema>

/** Beacon of the public page (no PII). */
export const RecordBioViewSchema = z.object({
  referrer: z.string().trim().max(2000).optional(),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(120).optional(),
})

export type RecordBioViewDTO = z.infer<typeof RecordBioViewSchema>
