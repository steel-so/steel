import { z } from 'zod'
import {
  CRM_COMPETITOR_METRICS_RANGES,
  CreateCrmCompetitorSchema,
  GenerateCrmCompetitorIdeasSchema,
  PreviewCrmCompetitorSchema,
  ReorderCrmCompetitorsSchema,
  UpdateCrmCompetitorSchema,
} from '@/src/schemas/crm-competitor.schema'
import {
  CRM_SOCIAL_PLATFORMS,
  CreateCrmScheduledPostSchema,
  CreateCrmSocialConnectionSchema,
  RescheduleCrmScheduledPostSchema,
  UpdateCrmScheduledPostSchema,
} from '@/src/schemas/crm-social.schema'
import type { JsonSchema } from '../../json-schema'
import type { ErrorEntry, ParamSpec, RouteConfig } from '../../registry'
import {
  CrmCompetitorAnalysisDTO,
  CrmCompetitorDTO,
  CrmCompetitorIdeaSetDTO,
  CrmCompetitorMetricsDTO,
  CrmCompetitorPreviewDTO,
  CrmCompetitorSyncResultDTO,
  CrmInstagramStoriesDTO,
  CrmScheduledPostDTO,
  CrmSocialConnectionDTO,
  CrmSocialDeletedPostDTO,
  CrmSocialInsightsDTO,
  CrmSocialOverviewDTO,
  CrmSocialPublishJobDTO,
  CrmSocialPublishJobStatusDTO,
  CrmSocialPublishResultDTO,
  CrmSocialRecentContentDTO,
  CrmSocialTrendingItemDTO,
  CrmSocialWeeklyEngagementDTO,
} from '../../schemas/crm/social'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · Redes sociais — conexões (`social-connections`, OAuth em
 * `social/{platform}/connect`), analytics e publicação por plataforma
 * (`social/{platform}/**`), posts agendados, "Em Alta" e concorrentes.
 * Tudo usa a permissão `social`.
 */

const TAG = 'CRM · Redes sociais' as const

type Platform = (typeof CRM_SOCIAL_PLATFORMS)[number]

/** `{platform}`: slug minúsculo (a rota aceita qualquer caixa). */
function platformParam(
  platforms: readonly Platform[],
  note?: string,
): ParamSpec {
  return {
    description: [
      `Plataforma (slug minúsculo do enum \`CrmSocialPlatform\`). Suportadas neste endpoint: ${platforms.map((p) => `\`${p.toLowerCase()}\``).join(', ')}.`,
      note,
    ]
      .filter(Boolean)
      .join(' '),
    example: platforms[0].toLowerCase(),
    schema: {
      type: 'string',
      enum: CRM_SOCIAL_PLATFORMS.map((p) => p.toLowerCase()),
    },
  }
}

const CONNECTION_QUERY: JsonSchema = {
  type: 'string',
  description:
    'Conexão específica (contas múltiplas da mesma plataforma). Omitido → a conexão primária da plataforma.',
}

const POST_PARAM = { description: 'ID do post agendado.' }
const CONNECTION_PARAM = { description: 'ID da conexão social.' }
const COMPETITOR_PARAM = { description: 'ID do concorrente acompanhado.' }

/* ------------------------------ erros comuns ------------------------------ */

const INVALID_PLATFORM: ErrorEntry = {
  code: 'VALIDATION_ERROR',
  message: 'Plataforma inválida',
  when: 'Slug de plataforma desconhecido',
}
const PLATFORM_UNSUPPORTED: ErrorEntry = {
  code: 'CRM_SOCIAL_NOT_CONFIGURED',
  when: 'Plataforma sem suporte neste endpoint',
}
const NO_CONNECTION: ErrorEntry = {
  code: 'CRM_SOCIAL_CONNECTION_NOT_FOUND',
  when: 'Sem conexão ativa na plataforma (inexistente, expirada ou sem token)',
}
const CONNECTION_ID_NOT_FOUND = notFoundError(
  'CrmSocialConnection',
  '`connectionId` inexistente no workspace',
)
const SCOPE_MISSING: ErrorEntry = {
  code: 'CRM_SOCIAL_SCOPE_MISSING',
  when: 'A conexão não concedeu o escopo necessário — reconectar',
}
const PROVIDER_FAILED: ErrorEntry = {
  code: 'CRM_SOCIAL_OAUTH_FAILED',
  when: 'A API da plataforma falhou ou recusou a chamada',
}
/** Erros das leituras/ações que usam o token da conexão. */
const PLATFORM_CALL_ERRORS: ErrorEntry[] = [
  INVALID_PLATFORM,
  PLATFORM_UNSUPPORTED,
  NO_CONNECTION,
  CONNECTION_ID_NOT_FOUND,
  SCOPE_MISSING,
  PROVIDER_FAILED,
]

const POST_NOT_FOUND = notFoundError('CrmScheduledPost', 'Post inexistente')
const COMPETITOR_NOT_FOUND = notFoundError(
  'CrmTrackedCompetitor',
  'Concorrente inexistente',
)
const PUBLISHING_OFF: ErrorEntry = {
  code: 'FEATURE_NOT_ENABLED',
  when: 'Feature `crm.socialPublishing` desligada para o workspace',
}

/* --------------------------- publicação direta --------------------------- */

const PUBLISH_BODY = {
  contentType: 'multipart/form-data',
  description:
    'Campos variam por plataforma (ver a descrição da operação). Booleanos do TikTok aceitam `true`/`on`/`1`.',
  schema: {
    type: 'object',
    properties: {
      connectionId: {
        type: 'string',
        description:
          'Facebook/Instagram: conexão específica (omitido → primária).',
      },
      message: {
        type: 'string',
        maxLength: 5000,
        description: 'Facebook: texto do post (exige `message` ou `link`).',
      },
      link: {
        type: 'string',
        format: 'uri',
        description: 'Facebook: link anexado.',
      },
      caption: {
        type: 'string',
        maxLength: 2200,
        description: 'Instagram: legenda (ignorada em `STORIES`).',
      },
      postType: {
        type: 'string',
        enum: ['FEED', 'REELS', 'STORIES'],
        default: 'FEED',
        description:
          'Instagram: `FEED` exige imagem, `REELS` exige vídeo, `STORIES` aceita os dois.',
      },
      text: {
        type: 'string',
        description: 'X (1–280 caracteres) ou LinkedIn (1–3000): texto.',
      },
      title: {
        type: 'string',
        description:
          'YouTube: título (obrigatório, até 100). TikTok: legenda (até 2200).',
      },
      description: {
        type: 'string',
        maxLength: 5000,
        description: 'YouTube: descrição.',
      },
      privacyStatus: {
        type: 'string',
        enum: ['private', 'unlisted', 'public'],
        default: 'private',
        description: 'YouTube: visibilidade.',
      },
      tags: {
        type: 'string',
        description: 'YouTube: tags separadas por vírgula (até 30).',
      },
      privacyLevel: {
        type: 'string',
        enum: [
          'SELF_ONLY',
          'FOLLOWER_OF_CREATOR',
          'MUTUAL_FOLLOW_FRIENDS',
          'PUBLIC_TO_EVERYONE',
        ],
        default: 'SELF_ONLY',
        description:
          'TikTok: privacidade (só `SELF_ONLY` enquanto o app não passa pela auditoria do TikTok).',
      },
      disableComment: { type: 'string', description: 'TikTok.' },
      disableDuet: { type: 'string', description: 'TikTok.' },
      disableStitch: { type: 'string', description: 'TikTok.' },
      file: {
        type: 'string',
        format: 'binary',
        description:
          'YouTube (até 256 MB) / TikTok (até 64 MB): arquivo de vídeo, obrigatório.',
      },
      image: {
        type: 'string',
        format: 'binary',
        description:
          'Facebook, Instagram: imagem (até 10 MB, opcional exceto no feed do Instagram).',
      },
      video: {
        type: 'string',
        format: 'binary',
        description:
          'Facebook/Instagram: vídeo (até 256 MB) — publicação assíncrona.',
      },
      cover: {
        type: 'string',
        format: 'binary',
        description: 'Instagram `REELS`: capa opcional (até 10 MB).',
      },
    },
  },
}

const PUBLISHABLE: Platform[] = [
  'FACEBOOK',
  'INSTAGRAM',
  'YOUTUBE',
  'TIKTOK',
]

/* ------------------------------ posts agendados ------------------------------ */

const SCHEDULED_POST_RULES = [
  'Requisitos por plataforma (conferidos antes de gravar, `400 CRM_SCHEDULED_POST_INVALID`):',
  '- Instagram: `FEED` exige imagem, `REELS` exige vídeo, `STORIES` imagem ou vídeo; legenda até 2200.',
  '- TikTok e YouTube exigem vídeo; YouTube exige título (ou texto para usar como título).',
  '- Facebook exige texto, imagem ou vídeo (até 5000).',
].join('\n')

export const crmSocialRoutes: RouteConfig[] = [
  /* -------------------------------- conexões -------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social-connections',
    tags: [TAG],
    summary: 'Listar conexões sociais',
    description: describe(
      'Contas de redes sociais conectadas ao workspace (tokens nunca são expostos).',
      crmAccess('social', 'VIEW'),
    ),
    responses: {
      200: {
        description: 'Conexões.',
        schema: z.array(CrmSocialConnectionDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/social-connections',
    tags: [TAG],
    summary: 'Registrar conexão social manualmente',
    description: describe(
      '**Fluxo legado**, sem OAuth: registra uma conta já autorizada fora do Steel (sem token — não serve para analytics nem publicação). O fluxo principal é `GET .../social/{platform}/connect`.',
      crmAccess('social', 'CREATE'),
    ),
    consent: true,
    body: CreateCrmSocialConnectionSchema,
    responses: {
      201: { description: 'Conexão criada.', schema: CrmSocialConnectionDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_SOCIAL_CONNECTION_CONFLICT',
        when: 'A conta já está conectada neste workspace',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/social-connections/{connectionId}',
    tags: [TAG],
    summary: 'Remover conexão social',
    description: crmAccess('social', 'DELETE'),
    consent: true,
    params: { connectionId: CONNECTION_PARAM },
    responses: { 200: { description: 'Conexão removida.', schema: null } },
    errors: [
      ...CRM_ERRORS,
      notFoundError('CrmSocialConnection', 'Conexão inexistente'),
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/social-connections/{connectionId}/primary',
    tags: [TAG],
    summary: 'Definir conexão primária',
    description: describe(
      'Marca a conexão como a primária da sua plataforma (as demais da mesma plataforma deixam de ser). A primária é usada quando `connectionId` não é informado.',
      crmAccess('social', 'EDIT'),
    ),
    params: { connectionId: CONNECTION_PARAM },
    responses: {
      200: {
        description: 'Conexão atualizada.',
        schema: CrmSocialConnectionDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      notFoundError('CrmSocialConnection', 'Conexão inexistente'),
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social/{platform}/connect',
    tags: [TAG],
    summary: 'Iniciar conexão OAuth',
    description: describe(
      'Redireciona (`302`) para a tela de autorização da plataforma. Depois do consentimento, a plataforma volta para `GET /social/callback/{platform}`, que grava a(s) conexão(ões) e leva o usuário de volta ao CRM. Plataformas com PKCE recebem o cookie `social_pkce` (HttpOnly, 10 min). Abra no navegador — não é uma chamada JSON.',
      crmAccess('social', 'CREATE'),
    ),
    params: { platform: platformParam(CRM_SOCIAL_PLATFORMS) },
    responses: {
      302: {
        description: 'Redirect para a autorização OAuth da plataforma.',
        envelope: false,
        headers: {
          Location: { description: 'URL de autorização da plataforma.' },
          'Set-Cookie': {
            description:
              '`social_pkce=<verifier>` quando a plataforma usa PKCE.',
          },
        },
      },
    },
    errors: [
      ...CRM_ERRORS,
      INVALID_PLATFORM,
      {
        code: 'CRM_SOCIAL_NOT_CONFIGURED',
        when: 'Credenciais OAuth da plataforma (ou a chave de cifra de tokens) ausentes no servidor',
      },
      {
        code: 'CRM_SOCIAL_OAUTH_FAILED',
        when: 'Workspace não encontrado ao montar o `state`',
      },
    ],
  },

  /* ------------------------ analytics por plataforma ------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social/{platform}/overview',
    tags: [TAG],
    summary: 'Visão geral da conta conectada',
    description: describe(
      'Identidade e contagens da conta conectada — o formato depende da plataforma (ver `CrmSocialOverview`). `connectionId` só é considerado para Facebook e Instagram.',
      crmAccess('social', 'VIEW'),
    ),
    params: { platform: platformParam(CRM_SOCIAL_PLATFORMS) },
    query: { type: 'object', properties: { connectionId: CONNECTION_QUERY } },
    responses: {
      200: { description: 'Visão da conta.', schema: CrmSocialOverviewDTO },
    },
    errors: [...CRM_ERRORS, ...PLATFORM_CALL_ERRORS],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social/{platform}/insights',
    tags: [TAG],
    summary: 'Analytics da conta',
    description: describe(
      [
        'Resumo + série diária da janela `range`. Janelas aceitas por plataforma:',
        '- Facebook, Instagram, Google Analytics: `7d`, `28d`, `90d`',
        '- YouTube: `7d`, `28d`, `90d`, `365d`',
        '- Google Ads: `7d`, `30d`, `90d`',
        '',
        '`connectionId` só é considerado para Facebook e Instagram.',
      ].join('\n'),
      crmAccess('social', 'VIEW'),
    ),
    params: {
      platform: platformParam([
        'FACEBOOK',
        'INSTAGRAM',
        'YOUTUBE',
        'GOOGLE_ANALYTICS',
        'GOOGLE_ADS',
      ]),
    },
    query: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: ['7d', '28d', '30d', '90d', '365d'],
          description:
            'Janela de tempo (valores válidos dependem da plataforma; omitido → padrão da plataforma).',
        },
        connectionId: CONNECTION_QUERY,
      },
    },
    responses: {
      200: { description: 'Analytics.', schema: CrmSocialInsightsDTO },
    },
    errors: [
      ...CRM_ERRORS,
      ...PLATFORM_CALL_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        message: 'Janela de tempo inválida',
        when: '`range` não aceito pela plataforma',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social/{platform}/engagement',
    tags: [TAG],
    summary: 'Engajamento semanal',
    description: describe(
      'Views/saves/visitas ao perfil dos últimos 7 dias + top 5 posts mais quentes. `connectionId` só é considerado para Instagram.',
      crmAccess('social', 'VIEW'),
    ),
    params: { platform: platformParam(['INSTAGRAM', 'TIKTOK']) },
    query: { type: 'object', properties: { connectionId: CONNECTION_QUERY } },
    responses: {
      200: {
        description: 'Engajamento.',
        schema: CrmSocialWeeklyEngagementDTO,
      },
    },
    errors: [...CRM_ERRORS, ...PLATFORM_CALL_ERRORS],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social/{platform}/videos',
    tags: [TAG],
    summary: 'Conteúdo recente da conta',
    description: describe(
      'Posts/mídias/vídeos recentes, lidos direto da API da plataforma (Facebook → posts da página, Instagram → mídias, YouTube → uploads, TikTok → vídeos). `connectionId` só é considerado para Facebook e Instagram.',
      crmAccess('social', 'VIEW'),
    ),
    params: {
      platform: platformParam([
        'FACEBOOK',
        'INSTAGRAM',
        'YOUTUBE',
        'TIKTOK',
      ]),
    },
    query: { type: 'object', properties: { connectionId: CONNECTION_QUERY } },
    responses: {
      200: {
        description: 'Conteúdo recente.',
        schema: CrmSocialRecentContentDTO,
      },
    },
    errors: [...CRM_ERRORS, ...PLATFORM_CALL_ERRORS],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social/{platform}/stories',
    tags: [TAG],
    summary: 'Stories ativos',
    description: describe(
      'Stories das últimas 24 h. Só Instagram.',
      crmAccess('social', 'VIEW'),
    ),
    params: { platform: platformParam(['INSTAGRAM']) },
    query: { type: 'object', properties: { connectionId: CONNECTION_QUERY } },
    responses: {
      200: { description: 'Stories.', schema: CrmInstagramStoriesDTO },
    },
    errors: [...CRM_ERRORS, ...PLATFORM_CALL_ERRORS],
  },

  /* ------------------------- publicação por plataforma ------------------------ */
  {
    method: 'post',
    path: '/workspaces/{id}/crm/social/{platform}/publish',
    tags: [TAG],
    summary: 'Publicar agora na plataforma',
    description: describe(
      [
        'Publica imediatamente na conta conectada. Corpo `multipart/form-data`, com campos por plataforma:',
        '- **Facebook**: `message` e/ou `link`, `image` opcional → `201`; com `video` → `202` (fila).',
        '- **Instagram**: `caption`, `postType` e a mídia em `image` ou `video` (+ `cover` em Reels) → sempre `202` (fila).',
        '- **YouTube**: `file` (vídeo), `title`, `description`, `privacyStatus`, `tags` → `202` (fila).',
        '- **TikTok**: `file` (vídeo), `title`, `privacyLevel`, `disable*` → `201`.',
        '',
        'Publicações assíncronas (`202`) devolvem `jobId`: acompanhe em `GET .../publish/{jobId}` — os erros de plataforma (escopo, conexão, vídeo inválido) aparecem lá, em `state: failed` + `code`.',
      ].join('\n'),
      `${crmAccess('social', 'CREATE')} Nas publicações assíncronas a permissão e o consentimento LGPD são conferidos antes de enfileirar (e a permissão de novo pelo worker).`,
    ),
    params: { platform: platformParam(PUBLISHABLE) },
    body: PUBLISH_BODY,
    responses: {
      201: {
        description: 'Publicado (Facebook sem vídeo, TikTok).',
        schema: CrmSocialPublishResultDTO,
      },
      202: {
        description:
          'Enfileirado (Instagram, YouTube, Facebook com vídeo) — faça polling do `jobId`.',
        schema: CrmSocialPublishJobDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      ...PLATFORM_CALL_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        message: 'Dados da publicação inválidos',
        when: 'Campos de texto inválidos para a plataforma',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Corpo inválido (esperado multipart/form-data)',
        when: 'Corpo não é multipart',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Arquivo de vídeo ausente',
        when: 'YouTube/TikTok sem `file`',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Vídeo excede o tamanho máximo (256 MB)',
        when: 'Arquivo acima do limite da plataforma',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Mídia obrigatória — o Instagram exige mídia para publicar',
        when: 'Instagram sem mídia ou mídia incompatível com `postType`',
      },
      {
        code: 'FORBIDDEN',
        message: 'Consentimento obrigatório',
        when: 'Publicação assíncrona com consentimento LGPD pendente',
      },
      {
        code: 'STORAGE_ERROR',
        when: 'Falha ao gravar a mídia de uma publicação assíncrona',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social/{platform}/publish/{jobId}',
    tags: [TAG],
    summary: 'Status de publicação assíncrona',
    description: describe(
      'Polling de um publish enfileirado (YouTube, Instagram, Facebook com vídeo). `state`: `pending` → `completed` (com `result`) ou `failed` (com `error` e, em falhas de domínio, `code` — ex.: `CRM_SOCIAL_SCOPE_MISSING` pede reconexão). Só o usuário que enfileirou o job o enxerga.',
      crmAccess('social', 'VIEW'),
    ),
    params: {
      platform: platformParam(['YOUTUBE', 'INSTAGRAM', 'FACEBOOK']),
      jobId: 'ID do job devolvido pelo `POST .../publish` (`202`).',
    },
    responses: {
      200: {
        description: 'Estado do job.',
        schema: CrmSocialPublishJobStatusDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'BAD_REQUEST',
        message: 'Plataforma inválida para este endpoint',
        when: 'Plataforma sem publicação assíncrona',
      },
      notFoundError(
        'Publicação',
        'Job inexistente ou de outro usuário/workspace',
      ),
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/social/{platform}/posts/{postId}',
    tags: [TAG],
    summary: 'Excluir publicação na plataforma',
    description: describe(
      'Apaga, na própria rede, uma publicação já feita. TikTok não permite exclusão pela API (`400`). `connectionId` só é considerado para Facebook e Instagram.',
      crmAccess('social', 'DELETE'),
    ),
    params: {
      platform: platformParam([
        'FACEBOOK',
        'INSTAGRAM',
        'YOUTUBE',
      ]),
      postId:
        'ID devolvido no publish (post, mídia ou vídeo).',
    },
    query: { type: 'object', properties: { connectionId: CONNECTION_QUERY } },
    responses: {
      200: {
        description: 'Publicação excluída.',
        schema: CrmSocialDeletedPostDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'BAD_REQUEST',
        message: 'Plataforma inválida',
        when: 'Slug de plataforma desconhecido',
      },
      {
        code: 'BAD_REQUEST',
        message:
          'O TikTok não permite excluir publicações pela API — exclua diretamente no app do TikTok.',
        when: 'Plataforma TikTok',
      },
      PLATFORM_UNSUPPORTED,
      NO_CONNECTION,
      CONNECTION_ID_NOT_FOUND,
      SCOPE_MISSING,
      PROVIDER_FAILED,
    ],
  },

  /* ----------------------------- posts agendados ----------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/scheduled-posts',
    tags: [TAG],
    summary: 'Listar posts agendados',
    description: describe(
      'Posts agendados/publicados do workspace, com os alvos por plataforma e as mídias.',
      crmAccess('social', 'VIEW'),
    ),
    responses: {
      200: { description: 'Posts.', schema: z.array(CrmScheduledPostDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/scheduled-posts',
    tags: [TAG],
    summary: 'Criar post agendado',
    description: describe(
      [
        'Cria um post para uma ou mais plataformas. `mode: "schedule"` exige `scheduledFor` no futuro (o worker publica no horário); `mode: "now"` publica na hora e devolve o post com o resultado de cada alvo.',
        '',
        'Aceita `application/json` (sem mídia) ou `multipart/form-data` com os mesmos campos (`platforms` repetido, `options` como JSON em string) e os arquivos em `media` (repetível, até 64 MB cada; `video/*` vira vídeo, o resto imagem).',
        '',
        SCHEDULED_POST_RULES,
        '',
        'Exige a feature `crm.socialPublishing`.',
      ].join('\n'),
      crmAccess('social', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmScheduledPostSchema,
      example: {
        platforms: ['INSTAGRAM', 'FACEBOOK'],
        content: 'Novidade no ar! 🚀',
        mode: 'schedule',
        scheduledFor: '2026-09-20T12:00:00.000Z',
        options: { instagram: { postType: 'FEED' } },
      },
    },
    responses: {
      201: { description: 'Post criado.', schema: CrmScheduledPostDTO },
    },
    errors: [
      ...CRM_ERRORS,
      PUBLISHING_OFF,
      {
        code: 'VALIDATION_ERROR',
        message: 'Arquivo excede o limite de 64MB',
        when: 'Mídia acima de 64 MB (multipart)',
      },
      {
        code: 'CRM_SCHEDULED_POST_INVALID',
        message: 'Publicação no Instagram exige uma imagem.',
        when: 'Requisito de mídia/texto de uma plataforma não atendido',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/scheduled-posts/{postId}',
    tags: [TAG],
    summary: 'Detalhe do post agendado',
    description: crmAccess('social', 'VIEW'),
    params: { postId: POST_PARAM },
    responses: { 200: { description: 'Post.', schema: CrmScheduledPostDTO } },
    errors: [...CRM_ERRORS, POST_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/scheduled-posts/{postId}',
    tags: [TAG],
    summary: 'Atualizar post agendado',
    description: describe(
      'Edita texto, título ou data (futura). Posts já publicados ou em publicação não podem ser editados. A resposta não traz `targets`/`media`.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: { postId: POST_PARAM },
    body: UpdateCrmScheduledPostSchema,
    responses: {
      200: { description: 'Post atualizado.', schema: CrmScheduledPostDTO },
    },
    errors: [
      ...CRM_ERRORS,
      POST_NOT_FOUND,
      {
        code: 'CRM_SCHEDULED_POST_ALREADY_PUBLISHED',
        when: 'Post `PUBLISHED` ou `PUBLISHING`',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/scheduled-posts/{postId}',
    tags: [TAG],
    summary: 'Excluir post agendado',
    description: describe(
      'Exclusão lógica do post no Steel — não apaga o que já foi publicado nas redes.',
      crmAccess('social', 'DELETE'),
    ),
    consent: true,
    params: { postId: POST_PARAM },
    responses: { 200: { description: 'Post excluído.', schema: null } },
    errors: [...CRM_ERRORS, POST_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/scheduled-posts/{postId}/cancel',
    tags: [TAG],
    summary: 'Cancelar post agendado',
    description: describe(
      'Cancela um post `SCHEDULED`, `FAILED` ou `PARTIALLY_FAILED` — não desfaz publicações já feitas.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: { postId: POST_PARAM },
    responses: {
      200: { description: 'Post cancelado.', schema: CrmScheduledPostDTO },
    },
    errors: [
      ...CRM_ERRORS,
      POST_NOT_FOUND,
      {
        code: 'CRM_SCHEDULED_POST_INVALID',
        message: 'Só é possível cancelar posts agendados ou que falharam.',
        when: 'Status não cancelável',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/scheduled-posts/{postId}/publish',
    tags: [TAG],
    summary: 'Publicar post agendado agora',
    description: describe(
      'Dispara a publicação imediata (inclusive para repetir alvos que falharam) e devolve o post com o resultado de cada alvo. Exige a feature `crm.socialPublishing`.',
      crmAccess('social', 'CREATE'),
    ),
    consent: true,
    params: { postId: POST_PARAM },
    responses: {
      200: {
        description: 'Post após a publicação.',
        schema: CrmScheduledPostDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      PUBLISHING_OFF,
      POST_NOT_FOUND,
      {
        code: 'CRM_SCHEDULED_POST_ALREADY_PUBLISHED',
        when: 'Post já `PUBLISHED`',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/scheduled-posts/{postId}/reschedule',
    tags: [TAG],
    summary: 'Reagendar post',
    description: describe(
      'Reabre o post como `SCHEDULED` na nova data (futura). Exige a feature `crm.socialPublishing`.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: { postId: POST_PARAM },
    body: RescheduleCrmScheduledPostSchema,
    responses: {
      200: { description: 'Post reagendado.', schema: CrmScheduledPostDTO },
    },
    errors: [
      ...CRM_ERRORS,
      PUBLISHING_OFF,
      POST_NOT_FOUND,
      {
        code: 'CRM_SCHEDULED_POST_INVALID',
        message: 'Não é possível reagendar um post já publicado.',
        when: 'Post `PUBLISHED` ou `PUBLISHING`',
      },
    ],
  },

  /* --------------------------------- Em Alta --------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/social-trending',
    tags: [TAG],
    summary: 'Em Alta (posts de hoje)',
    description: describe(
      'Ranking dos posts de hoje da conta de Instagram conectada por velocidade de engajamento, do maior `score` para o menor (a fonte do TikTok ainda não está implementada e não contribui). Sem conexão ativa, responde lista vazia — sem erro.',
      crmAccess('social', 'VIEW'),
    ),
    responses: {
      200: {
        description: 'Posts em alta.',
        schema: z.array(CrmSocialTrendingItemDTO),
      },
    },
    errors: CRM_ERRORS,
  },

  /* ------------------------------- concorrentes ------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/competitors',
    tags: [TAG],
    summary: 'Listar concorrentes',
    description: describe(
      'Perfis concorrentes acompanhados (Instagram e YouTube), na ordem manual.',
      crmAccess('social', 'VIEW'),
    ),
    responses: {
      200: { description: 'Concorrentes.', schema: z.array(CrmCompetitorDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/competitors',
    tags: [TAG],
    summary: 'Cadastrar concorrente',
    description: describe(
      'Cadastra um perfil para acompanhar. Os dados podem vir de `POST .../competitors/preview` ou ser informados manualmente; o job diário (04:00) sincroniza seguidores/posts.',
      crmAccess('social', 'CREATE'),
    ),
    consent: true,
    body: CreateCrmCompetitorSchema,
    responses: {
      201: { description: 'Concorrente cadastrado.', schema: CrmCompetitorDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/competitors/preview',
    tags: [TAG],
    summary: 'Pré-visualizar perfil concorrente',
    description: describe(
      'Busca os dados públicos do perfil (nome, avatar, bio, seguidores) usando o token da conta conectada da mesma plataforma — não grava nada. No Instagram só contas Business/Creator públicas são encontradas.',
      crmAccess('social', 'VIEW'),
    ),
    body: PreviewCrmCompetitorSchema,
    responses: {
      200: { description: 'Dados públicos.', schema: CrmCompetitorPreviewDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_SOCIAL_CONNECTION_NOT_FOUND',
        when: 'Sem conexão ativa na plataforma do concorrente',
      },
      {
        code: 'CRM_COMPETITOR_PROFILE_NOT_FOUND',
        when: 'Perfil inexistente, privado ou pessoal',
      },
      PROVIDER_FAILED,
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/competitors/sync',
    tags: [TAG],
    summary: 'Sincronizar concorrentes agora',
    description: describe(
      'Roda na hora a sincronização do job diário, só para este workspace. Falhas por concorrente não interrompem o lote — aparecem em `failed` (e no `syncStatus` do concorrente).',
      crmAccess('social', 'EDIT'),
    ),
    responses: {
      200: {
        description: 'Resumo da sincronização.',
        schema: CrmCompetitorSyncResultDTO,
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/competitors/reorder',
    tags: [TAG],
    summary: 'Reordenar concorrentes',
    description: describe(
      '`orderedIds` define a nova ordem (`position` = índice na lista).',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    body: ReorderCrmCompetitorsSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/competitors/{competitorId}',
    tags: [TAG],
    summary: 'Atualizar concorrente',
    description: describe(
      'Atualização parcial — informe ao menos um campo.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: { competitorId: COMPETITOR_PARAM },
    body: UpdateCrmCompetitorSchema,
    responses: {
      200: { description: 'Concorrente atualizado.', schema: CrmCompetitorDTO },
    },
    errors: [...CRM_ERRORS, COMPETITOR_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/competitors/{competitorId}',
    tags: [TAG],
    summary: 'Excluir concorrente',
    description: crmAccess('social', 'DELETE'),
    consent: true,
    params: { competitorId: COMPETITOR_PARAM },
    responses: { 200: { description: 'Concorrente excluído.', schema: null } },
    errors: [...CRM_ERRORS, COMPETITOR_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/competitors/{competitorId}/metrics',
    tags: [TAG],
    summary: 'Métricas do concorrente',
    description: describe(
      'Série histórica (seguidores/posts) do concorrente comparada à conta conectada da mesma plataforma, na janela `range`.',
      crmAccess('social', 'VIEW'),
    ),
    params: { competitorId: COMPETITOR_PARAM },
    query: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: [...CRM_COMPETITOR_METRICS_RANGES],
          default: '30d',
          description: 'Janela de tempo.',
        },
      },
    },
    responses: {
      200: { description: 'Métricas.', schema: CrmCompetitorMetricsDTO },
    },
    errors: [
      ...CRM_ERRORS,
      COMPETITOR_NOT_FOUND,
      {
        code: 'VALIDATION_ERROR',
        message: 'Janela de tempo inválida',
        when: '`range` fora de `7d`/`30d`/`90d`',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/competitors/{competitorId}/analysis',
    tags: [TAG],
    summary: 'Análise do concorrente',
    description: describe(
      'Comparação, sem IA, dos posts coletados do concorrente com os da conta conectada da mesma plataforma: frequência, interações, engajamento, formatos, dias, horários (fuso de São Paulo), hashtags, posts de destaque e leituras comparativas. Os posts são coletados pelo sync diário.',
      crmAccess('social', 'VIEW'),
    ),
    params: { competitorId: COMPETITOR_PARAM },
    query: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: [...CRM_COMPETITOR_METRICS_RANGES],
          default: '30d',
          description: 'Janela de tempo.',
        },
      },
    },
    responses: {
      200: { description: 'Análise.', schema: CrmCompetitorAnalysisDTO },
    },
    errors: [
      ...CRM_ERRORS,
      COMPETITOR_NOT_FOUND,
      {
        code: 'VALIDATION_ERROR',
        message: 'Janela de tempo inválida',
        when: '`range` fora de `7d`/`30d`/`90d`',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/competitors/{competitorId}/ideas',
    tags: [TAG],
    summary: 'Últimas ideias de publicação',
    description: describe(
      'Último conjunto de ideias gerado para o concorrente (`null` se nunca foi gerado). Não consome cota de IA.',
      crmAccess('social', 'VIEW'),
    ),
    params: { competitorId: COMPETITOR_PARAM },
    responses: {
      200: {
        description: 'Ideias ou `null`.',
        schema: CrmCompetitorIdeaSetDTO,
      },
    },
    errors: [...CRM_ERRORS, COMPETITOR_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/competitors/{competitorId}/ideas',
    tags: [TAG],
    summary: 'Gerar ideias de publicação',
    description: describe(
      'Gera ideias com a IA do workspace (OpenAI ou Anthropic, mesmo modelo do assistente do CRM) a partir da análise da janela `range`. Consome a cota mensal de IA. Legendas vão ao provedor sem e-mail, telefone, documento ou @menções.',
      crmAccess('social', 'CREATE'),
    ),
    params: { competitorId: COMPETITOR_PARAM },
    body: GenerateCrmCompetitorIdeasSchema,
    responses: {
      201: { description: 'Ideias geradas.', schema: CrmCompetitorIdeaSetDTO },
    },
    errors: [
      ...CRM_ERRORS,
      COMPETITOR_NOT_FOUND,
      {
        code: 'FEATURE_NOT_ENABLED',
        when: 'Feature `crm.aiAssistant` desligada para o workspace',
      },
      {
        code: 'CRM_COMPETITOR_NO_POSTS',
        when: 'Nenhum post do concorrente coletado na janela',
      },
      {
        code: 'AI_QUOTA_EXCEEDED',
        when: 'Cota mensal de IA do workspace esgotada',
      },
      {
        code: 'AI_PROVIDER_UNAVAILABLE',
        when: 'Nenhum modelo habilitado com provedor configurado',
      },
      {
        code: 'CRM_COMPETITOR_IDEAS_FAILED',
        when: 'Falha do provedor ou resposta fora do formato',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Janela de tempo inválida',
        when: '`range` fora de `7d`/`30d`/`90d`',
      },
    ],
  },
]
