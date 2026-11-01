import z from 'zod'
import {
  type CrmInstagramPostType,
  CrmInstagramPostTypeSchema,
} from '@/src/schemas/crm-social-instagram.schema'
import { CrmTiktokPrivacySchema } from '@/src/schemas/crm-social-tiktok.schema'
import { CrmSocialYoutubePrivacySchema } from '@/src/schemas/crm-social-youtube.schema'

export const CRM_SOCIAL_PLATFORMS = [
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
  'GOOGLE_ANALYTICS',
  'GOOGLE_ADS',
] as const

/** Nome legível da plataforma (legenda de gráfico, opções de UI). */
export const CRM_SOCIAL_PLATFORM_LABELS: Record<
  (typeof CRM_SOCIAL_PLATFORMS)[number],
  string
> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  GOOGLE_ANALYTICS: 'Google Analytics',
  GOOGLE_ADS: 'Google Ads',
}

/** Enum → slug minúsculo usado nas rotas/URLs (ex.: "FACEBOOK" → "facebook"). */
export function crmPlatformToSlug(
  platform: (typeof CRM_SOCIAL_PLATFORMS)[number],
): string {
  return platform.toLowerCase()
}

/** Slug de rota → enum, ou `null` se desconhecido. */
export function parseCrmPlatformSlug(
  slug: string,
): (typeof CRM_SOCIAL_PLATFORMS)[number] | null {
  const parsed = z.enum(CRM_SOCIAL_PLATFORMS).safeParse(slug.toUpperCase())
  return parsed.success ? parsed.data : null
}

// Registro manual (fluxo legado, sem OAuth) — mantido para contas já
// autorizadas fora do Steel. O fluxo principal agora é o handshake OAuth
// completo (ver app/api/social/connect|callback).
export const CreateCrmSocialConnectionSchema = z.object({
  platform: z.enum(CRM_SOCIAL_PLATFORMS),
  externalAccountId: z.string().min(1, 'ID da conta é obrigatório').max(200),
  accountName: z.string().max(200).optional(),
})

export type CreateCrmSocialConnectionDTO = z.infer<
  typeof CreateCrmSocialConnectionSchema
>

/** Plataformas que suportam publicação (subconjunto de CRM_SOCIAL_PLATFORMS — exclui as de só-leitura Google Analytics/Ads). */
export const CRM_PUBLISHABLE_PLATFORMS = [
  'INSTAGRAM',
  'FACEBOOK',
  'TIKTOK',
  'YOUTUBE',
] as const

export const CrmPublishablePlatformSchema = z.enum(CRM_PUBLISHABLE_PLATFORMS)
export type CrmPublishablePlatform = z.infer<
  typeof CrmPublishablePlatformSchema
>

/** Requisito de mídia de cada plataforma — usado na validação e na UI. */
export const CRM_PLATFORM_MEDIA_REQUIREMENT: Record<
  CrmPublishablePlatform,
  'image' | 'video' | 'optional'
> = {
  INSTAGRAM: 'image',
  FACEBOOK: 'optional',
  TIKTOK: 'video',
  YOUTUBE: 'video',
}

/**
 * Requisito de mídia do Instagram por modelo de post — sobrepõe
 * `CRM_PLATFORM_MEDIA_REQUIREMENT.INSTAGRAM` (que cobre só o feed). `either`
 * aceita imagem ou vídeo (stories).
 */
export const CRM_INSTAGRAM_POST_TYPE_MEDIA: Record<
  CrmInstagramPostType,
  'image' | 'video' | 'either'
> = {
  FEED: 'image',
  REELS: 'video',
  STORIES: 'either',
}

/** Limite de caracteres do texto por plataforma (o menor vira o teto da UI). */
export const CRM_PLATFORM_TEXT_LIMIT: Record<CrmPublishablePlatform, number> = {
  INSTAGRAM: 2200,
  FACEBOOK: 5000,
  TIKTOK: 2200,
  YOUTUBE: 5000,
}

/** Opções específicas por plataforma — persistidas em `CrmScheduledPost.options`. */
export const CrmScheduledPostOptionsSchema = z
  .object({
    instagram: z
      .object({ postType: CrmInstagramPostTypeSchema.default('FEED') })
      .optional(),
    youtube: z
      .object({
        privacy: CrmSocialYoutubePrivacySchema.default('public'),
        tags: z.array(z.string().trim().min(1)).max(30).default([]),
      })
      .optional(),
    tiktok: z
      .object({
        privacy: CrmTiktokPrivacySchema.default('SELF_ONLY'),
        disableComment: z.boolean().default(false),
        disableDuet: z.boolean().default(false),
        disableStitch: z.boolean().default(false),
      })
      .optional(),
    facebook: z.object({ link: z.url().nullable().default(null) }).optional(),
  })
  .default({})

export type CrmScheduledPostOptions = z.infer<
  typeof CrmScheduledPostOptionsSchema
>

/** Modo de publicação escolhido pelo usuário. */
export const CrmPublishModeSchema = z.enum(['now', 'schedule'])
export type CrmPublishMode = z.infer<typeof CrmPublishModeSchema>

/**
 * Campos de criação (sem os arquivos, validados à parte na rota). `scheduledFor`
 * é exigido quando `mode = "schedule"` e precisa estar no futuro.
 */
export const CreateCrmScheduledPostSchema = z
  .object({
    platforms: z
      .array(CrmPublishablePlatformSchema)
      .min(1, 'Selecione ao menos uma plataforma'),
    content: z.string().trim().max(10_000).default(''),
    title: z.string().trim().max(200).optional(),
    mode: CrmPublishModeSchema.default('schedule'),
    scheduledFor: z.coerce.date().optional(),
    options: CrmScheduledPostOptionsSchema,
  })
  .refine((v) => v.mode === 'now' || v.scheduledFor !== undefined, {
    message: 'Informe a data e hora do agendamento',
    path: ['scheduledFor'],
  })
  .refine(
    (v) =>
      v.mode === 'now' ||
      !v.scheduledFor ||
      v.scheduledFor.getTime() > Date.now(),
    {
      message: 'A data do agendamento deve estar no futuro',
      path: ['scheduledFor'],
    },
  )

export type CreateCrmScheduledPostDTO = z.infer<
  typeof CreateCrmScheduledPostSchema
>

export const UpdateCrmScheduledPostSchema = z
  .object({
    content: z.string().trim().max(10_000).optional(),
    title: z.string().trim().max(200).optional(),
    scheduledFor: z.coerce.date().optional(),
  })
  .refine((v) => !v.scheduledFor || v.scheduledFor.getTime() > Date.now(), {
    message: 'A data do agendamento deve estar no futuro',
    path: ['scheduledFor'],
  })

export type UpdateCrmScheduledPostDTO = z.infer<
  typeof UpdateCrmScheduledPostSchema
>

/** Body do reagendamento — reabre o post pra SCHEDULED com uma nova data. */
export const RescheduleCrmScheduledPostSchema = z.object({
  scheduledFor: z.coerce.date().refine((v) => v.getTime() > Date.now(), {
    message: 'A data do agendamento deve estar no futuro',
  }),
})

export type RescheduleCrmScheduledPostDTO = z.infer<
  typeof RescheduleCrmScheduledPostSchema
>
