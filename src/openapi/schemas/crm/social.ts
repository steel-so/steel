import { z } from 'zod'
import {
  CRM_COMPETITOR_METRICS_RANGES,
  CRM_COMPETITOR_SYNCABLE_PLATFORMS,
  CRM_SOCIAL_POST_FORMATS,
  CrmCompetitorIdeaSchema,
} from '@/src/schemas/crm-competitor.schema'
import { CRM_SOCIAL_PLATFORMS } from '@/src/schemas/crm-social.schema'
import {
  CrmFacebookInsightsSchema,
  CrmFacebookPageOverviewSchema,
  CrmFacebookPostsSchema,
  CrmPublishFacebookPostResultSchema,
} from '@/src/schemas/crm-social-facebook.schema'
import {
  CrmSocialGoogleAdsInsightsSchema,
  CrmSocialGoogleAdsOverviewSchema,
} from '@/src/schemas/crm-social-google-ads.schema'
import {
  CrmSocialGoogleAnalyticsInsightsSchema,
  CrmSocialGoogleAnalyticsOverviewSchema,
} from '@/src/schemas/crm-social-google-analytics.schema'
import {
  CrmInstagramInsightsSchema,
  CrmInstagramMediaListSchema,
  CrmInstagramProfileOverviewSchema,
  CrmInstagramStoriesListSchema,
  CrmInstagramWeeklyEngagementSchema,
  CrmPublishInstagramPostResultSchema,
} from '@/src/schemas/crm-social-instagram.schema'
import {
  CrmPublishTiktokVideoResultSchema,
  CrmTiktokCreatorOverviewSchema,
  CrmTiktokVideosSchema,
  CrmTiktokWeeklyEngagementSchema,
} from '@/src/schemas/crm-social-tiktok.schema'
import { TrendingItemSchema } from '@/src/schemas/crm-social-trending.schema'
import {
  CrmSocialYoutubeInsightsSchema,
  CrmSocialYoutubeOverviewSchema,
  CrmSocialYoutubePublishVideoResultSchema,
  CrmSocialYoutubeVideosSchema,
} from '@/src/schemas/crm-social-youtube.schema'
import { dto } from '../../common'

/**
 * DTOs de redes sociais do CRM: conexões, posts agendados, concorrentes,
 * "Em Alta" (`types/crm-social.d.ts`, `types/crm-competitor.d.ts`) e as
 * respostas por plataforma (schemas Zod de `src/schemas/crm-social-*.schema.ts`).
 */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()
const Platform = z.enum(CRM_SOCIAL_PLATFORMS)

/* ------------------------------- conexões ------------------------------- */

export const CrmSocialConnectionDTO = dto(
  'CrmSocialConnection',
  z
    .object({
      id: z.string(),
      platform: Platform,
      externalAccountId: z.string().meta({
        description: 'ID da conta/página/canal na plataforma.',
      }),
      accountName: z.string().nullable(),
      scope: z
        .string()
        .nullable()
        .meta({ description: 'Escopos OAuth concedidos.' }),
      isPrimary: z.boolean().meta({
        description:
          'Conta usada por padrão na plataforma quando `connectionId` não é informado.',
      }),
      status: z.enum(['CONNECTED', 'EXPIRED', 'REVOKED']),
      expiresAt: nullableDateTime(),
      workspaceId: z.string(),
      createdById: z.string(),
      updatedById: z.string().nullable(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({
      description:
        'Conta de rede social conectada ao workspace. Tokens nunca são expostos.',
    }),
)

/* ----------------------------- posts agendados ----------------------------- */

const CrmScheduledPostTargetDTO = dto(
  'CrmScheduledPostTarget',
  z
    .object({
      id: z.string(),
      postId: z.string(),
      platform: Platform,
      status: z.enum([
        'PENDING',
        'PUBLISHING',
        'PUBLISHED',
        'FAILED',
        'CANCELED',
      ]),
      externalPostId: z.string().nullable(),
      error: z.string().nullable(),
      attempts: z.number().int(),
      publishedAt: nullableDateTime(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Publicação do post numa plataforma específica.' }),
)

const CrmScheduledPostMediaDTO = dto(
  'CrmScheduledPostMedia',
  z.object({
    id: z.string(),
    kind: z.enum(['IMAGE', 'VIDEO']),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    order: z.number().int(),
  }),
)

export const CrmScheduledPostDTO = dto(
  'CrmScheduledPost',
  z.object({
    id: z.string(),
    content: z.string(),
    title: z.string().nullable(),
    status: z.enum([
      'DRAFT',
      'SCHEDULED',
      'PUBLISHING',
      'PUBLISHED',
      'PARTIALLY_FAILED',
      'FAILED',
      'CANCELED',
    ]),
    scheduledFor: nullableDateTime(),
    publishedAt: nullableDateTime(),
    lastError: z.string().nullable(),
    workspaceId: z.string(),
    createdById: z.string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
    targets: z.array(CrmScheduledPostTargetDTO).optional().meta({
      description: 'Uma entrada por plataforma escolhida.',
    }),
    media: z.array(CrmScheduledPostMediaDTO).optional(),
  }),
)

/* -------------------------------- Em Alta -------------------------------- */

export const CrmSocialTrendingItemDTO = dto(
  'CrmSocialTrendingItem',
  TrendingItemSchema.meta({
    description:
      'Post de hoje das contas conectadas, ranqueado por velocidade de engajamento (`score` = (views + interações) / horas desde a publicação). `views`/`shares`/`saved` ficam `null` quando a plataforma não expõe a métrica.',
  }),
)

/* ------------------------------ concorrentes ------------------------------ */

export const CrmCompetitorDTO = dto(
  'CrmCompetitor',
  z
    .object({
      id: z.string(),
      platform: z.enum(CRM_COMPETITOR_SYNCABLE_PLATFORMS),
      handle: z.string().meta({ example: '@concorrente' }),
      profileUrl: z.string().nullable(),
      followersCount: z.number().int().nullable(),
      avatarUrl: z.string().nullable(),
      displayName: z.string().nullable(),
      bio: z.string().nullable(),
      syncStatus: z.enum(['MANUAL', 'SYNCED', 'SYNC_FAILED']),
      lastSyncedAt: nullableDateTime(),
      notes: z.string().nullable(),
      workspaceId: z.string(),
      createdById: z.string(),
      updatedById: z.string().nullable(),
      position: z.number(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Perfil concorrente acompanhado.' }),
)

export const CrmCompetitorPreviewDTO = dto(
  'CrmCompetitorPreview',
  z
    .object({
      displayName: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      bio: z.string().nullable(),
      followersCount: z.number().int(),
      postsCount: z.number().int().nullable(),
      profileUrl: z.string().nullable(),
    })
    .meta({
      description: 'Dados públicos buscados antes de salvar (não persistido).',
    }),
)

const CrmCompetitorMetricsSeries = z.object({
  followersCount: z.number().int().nullable(),
  growth: z
    .object({
      absolute: z.number(),
      percent: z.number().nullable(),
    })
    .nullable()
    .meta({
      description:
        'Variação entre o primeiro e o último snapshot da janela (`null` sem snapshots; `percent` é `null` quando o primeiro valor é 0).',
    }),
  snapshots: z.array(
    z.object({
      id: z.string(),
      followersCount: z.number().int(),
      postsCount: z.number().int().nullable(),
      capturedAt: dateTime(),
    }),
  ),
  todayStats: z
    .object({
      postsCount: z.number().int(),
      engagementRate: z.number().nullable().meta({
        description:
          '(curtidas + comentários) ÷ seguidores dos posts de hoje; `null` sem seguidores.',
      }),
    })
    .nullable()
    .meta({
      description:
        'Posts de hoje e engajamento do dia — `null` quando a plataforma não suporta (hoje só Instagram) ou a busca falhou.',
    }),
})

export const CrmCompetitorMetricsDTO = dto(
  'CrmCompetitorMetrics',
  z.object({
    range: z.enum(CRM_COMPETITOR_METRICS_RANGES),
    competitor: CrmCompetitorMetricsSeries,
    ownAccount: CrmCompetitorMetricsSeries.extend({
      connectionId: z.string(),
      accountName: z.string().nullable(),
    })
      .nullable()
      .meta({
        description:
          'Conta conectada da mesma plataforma no workspace, para comparação (`null` sem conexão).',
      }),
  }),
)

const PostFormat = z.enum(CRM_SOCIAL_POST_FORMATS).meta({
  description:
    'Formato normalizado. `SHORT` é heurístico (vídeo do YouTube de até 60 s).',
})

const PostBucket = z.object({
  postsCount: z.number().int(),
  avgInteractions: z
    .number()
    .nullable()
    .meta({ description: 'Média de curtidas + comentários do grupo.' }),
})

const CrmSocialPostSchema = z.object({
  externalId: z.string(),
  format: PostFormat,
  caption: z.string().nullable(),
  permalink: z.string().nullable(),
  likeCount: z
    .number()
    .int()
    .nullable()
    .meta({ description: '`null` = curtidas ocultas pelo dono do perfil.' }),
  commentsCount: z.number().int().nullable(),
  viewCount: z.number().int().nullable(),
  interactions: z.number().int().nullable(),
  publishedAt: dateTime(),
})

const CrmPostStatsSchema = dto(
  'CrmPostStats',
  z
    .object({
      postsCount: z.number().int(),
      postsPerWeek: z.number(),
      avgInteractions: z.number().nullable(),
      engagementRate: z.number().nullable().meta({
        description: 'Interações médias por post ÷ seguidores × 100.',
      }),
      avgViews: z.number().nullable(),
      hiddenLikesCount: z.number().int(),
      avgCaptionLength: z.number().nullable(),
      formats: z.array(
        PostBucket.extend({ format: PostFormat, share: z.number() }),
      ),
      weekdays: z
        .array(PostBucket.extend({ weekday: z.number().int() }))
        .meta({ description: 'Domingo (0) a sábado (6), fuso de São Paulo.' }),
      dayparts: z.array(
        PostBucket.extend({
          daypart: z.enum(['DAWN', 'MORNING', 'AFTERNOON', 'EVENING']),
        }),
      ),
      hashtags: z.array(PostBucket.extend({ tag: z.string() })),
      topPosts: z.array(CrmSocialPostSchema),
    })
    .meta({
      description:
        'Métricas de uma conta na janela, calculadas sem IA a partir dos posts coletados.',
    }),
)

export const CrmCompetitorAnalysisDTO = dto(
  'CrmCompetitorAnalysis',
  z.object({
    range: z.enum(CRM_COMPETITOR_METRICS_RANGES),
    competitor: CrmCompetitorDTO,
    competitorStats: CrmPostStatsSchema,
    ownAccount: z
      .object({
        connectionId: z.string(),
        accountName: z.string().nullable(),
        followersCount: z.number().int().nullable(),
        stats: CrmPostStatsSchema,
      })
      .nullable()
      .meta({
        description:
          'Conta conectada da mesma plataforma (`null` sem conexão).',
      }),
    insights: z.array(
      z.object({
        key: z.string(),
        tone: z.enum(['positive', 'negative', 'neutral']),
        text: z.string(),
      }),
    ),
  }),
)

export const CrmCompetitorIdeaSetDTO = dto(
  'CrmCompetitorIdeaSet',
  z
    .object({
      id: z.string(),
      competitorId: z.string(),
      range: z.enum(CRM_COMPETITOR_METRICS_RANGES),
      ideas: z.array(CrmCompetitorIdeaSchema),
      modelKey: z.string(),
      createdById: z.string().nullable(),
      createdAt: dateTime(),
    })
    .meta({
      description: 'Ideias de publicação geradas pela IA do workspace.',
    }),
)

export const CrmCompetitorSyncResultDTO = dto(
  'CrmCompetitorSyncResult',
  z.object({
    processed: z.number().int(),
    synced: z.number().int(),
    failed: z.number().int(),
  }),
)

/* ------------------------- respostas por plataforma ------------------------ */

export const CrmSocialOverviewDTO = dto(
  'CrmSocialOverview',
  z
    .union([
      dto('CrmFacebookPageOverview', CrmFacebookPageOverviewSchema),
      dto('CrmInstagramProfileOverview', CrmInstagramProfileOverviewSchema),
      dto('CrmYoutubeOverview', CrmSocialYoutubeOverviewSchema),
      dto('CrmGoogleAnalyticsOverview', CrmSocialGoogleAnalyticsOverviewSchema),
      dto('CrmGoogleAdsOverview', CrmSocialGoogleAdsOverviewSchema),
      dto('CrmTiktokCreatorOverview', CrmTiktokCreatorOverviewSchema),
    ])
    .meta({
      description:
        'Formato específico da plataforma do path (Facebook → página, Instagram → perfil, YouTube → canal, Google Analytics → propriedade, Google Ads → conta, TikTok → criador).',
    }),
)

export const CrmSocialInsightsDTO = dto(
  'CrmSocialInsights',
  z
    .union([
      dto('CrmFacebookInsights', CrmFacebookInsightsSchema),
      dto('CrmInstagramInsights', CrmInstagramInsightsSchema),
      dto('CrmYoutubeInsights', CrmSocialYoutubeInsightsSchema),
      dto('CrmGoogleAnalyticsInsights', CrmSocialGoogleAnalyticsInsightsSchema),
      dto('CrmGoogleAdsInsights', CrmSocialGoogleAdsInsightsSchema),
    ])
    .meta({
      description:
        'Resumo + série diária da janela pedida, no formato da plataforma do path.',
    }),
)

export const CrmSocialWeeklyEngagementDTO = dto(
  'CrmSocialWeeklyEngagement',
  z
    .union([
      dto('CrmInstagramWeeklyEngagement', CrmInstagramWeeklyEngagementSchema),
      dto('CrmTiktokWeeklyEngagement', CrmTiktokWeeklyEngagementSchema),
    ])
    .meta({
      description:
        'Resumo dos últimos 7 dias + top 5 posts mais quentes (Instagram ou TikTok).',
    }),
)

export const CrmSocialRecentContentDTO = dto(
  'CrmSocialRecentContent',
  z
    .union([
      dto('CrmFacebookPosts', CrmFacebookPostsSchema),
      dto('CrmInstagramMediaList', CrmInstagramMediaListSchema),
      dto('CrmYoutubeVideos', CrmSocialYoutubeVideosSchema),
      dto('CrmTiktokVideos', CrmTiktokVideosSchema),
    ])
    .meta({
      description:
        'Conteúdo recente da conta: Facebook → `posts`, Instagram → mídias, YouTube → uploads, TikTok → vídeos.',
    }),
)

export const CrmInstagramStoriesDTO = dto(
  'CrmInstagramStoriesList',
  CrmInstagramStoriesListSchema,
)

const CrmFacebookPublishResultDTO = dto(
  'CrmFacebookPublishResult',
  CrmPublishFacebookPostResultSchema,
)

export const CrmSocialPublishResultDTO = dto(
  'CrmSocialPublishResult',
  z
    .union([
      CrmFacebookPublishResultDTO,
      dto('CrmTiktokPublishResult', CrmPublishTiktokVideoResultSchema),
    ])
    .meta({
      description:
        'Resultado da publicação síncrona: Facebook (texto/imagem) ou TikTok.',
    }),
)

export const CrmSocialPublishJobDTO = dto(
  'CrmSocialPublishJob',
  z.object({
    jobId: z.string().meta({
      description:
        'ID do job na fila `crm-social-publish` — acompanhe em `GET .../publish/{jobId}`.',
    }),
  }),
)

export const CrmSocialPublishJobStatusDTO = dto(
  'CrmSocialPublishJobStatus',
  z.object({
    state: z.enum(['pending', 'completed', 'failed']),
    result: z
      .union([
        dto(
          'CrmYoutubePublishResult',
          CrmSocialYoutubePublishVideoResultSchema,
        ),
        dto('CrmInstagramPublishResult', CrmPublishInstagramPostResultSchema),
        CrmFacebookPublishResultDTO,
      ])
      .nullable()
      .meta({
        description:
          'Preenchido quando `state = completed`: YouTube → vídeo, Instagram → post, Facebook (vídeo) → `{ postId, url }`.',
      }),
    error: z
      .string()
      .nullable()
      .meta({ description: 'Mensagem da falha quando `state = failed`.' }),
    code: z.string().nullable().meta({
      description:
        'Código `AppError` da falha de domínio (ex.: `CRM_SOCIAL_SCOPE_MISSING`, `CRM_SOCIAL_VIDEO_INVALID`) — `null` em falhas de infraestrutura.',
    }),
  }),
)

export const CrmSocialDeletedPostDTO = dto(
  'CrmSocialDeletedPost',
  z.object({
    deletedId: z.string().meta({
      description: 'ID da publicação excluída.',
    }),
  }),
)
