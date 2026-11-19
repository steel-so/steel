import { z } from 'zod'
import {
  GoogleDeletePhotoSchema,
  GooglePerformanceQuerySchema,
  ListGoogleReviewsQuerySchema,
  ReplyGoogleReviewSchema,
  SearchGoogleCategoriesSchema,
  SelectGoogleLocationSchema,
  UpdateGoogleAttributesSchema,
  UpdateGoogleProfileSchema,
  UpdateGoogleSettingsSchema,
} from '@/src/schemas/crm-google-presence.schema'
import { dto } from '../../common'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Presença no Google — Perfil da empresa (Google Business Profile),
 * Google Maps (links e desempenho) e Avaliações. A conexão OAuth é do
 * workspace, com tokens cifrados que nunca saem do servidor; avaliações e
 * métricas ficam em cache e o worker as atualiza a cada 30 minutos.
 */

const TAG = 'CRM · Redes sociais' as const
const BASE = '/workspaces/{id}/crm/google'
const WORKSPACE = { id: 'Id do workspace.' }
const dateTime = () => z.iso.datetime()

const GOOGLE_ACCESS: ErrorEntry[] = [
  ...CRM_ERRORS,
  {
    code: 'CRM_SOCIAL_CONNECTION_NOT_FOUND',
    when: 'O workspace ainda não conectou o Google',
  },
  {
    code: 'CRM_SOCIAL_TOKEN_EXPIRED',
    when: 'O acesso ao Google expirou ou foi revogado — reconectar',
  },
  {
    code: 'CRM_SOCIAL_SCOPE_MISSING',
    when: 'A permissão do Google Meu Negócio não foi concedida',
  },
  {
    code: 'CRM_GOOGLE_LOCATION_NOT_SELECTED',
    when: 'A conexão existe, mas o local ainda não foi escolhido',
  },
  {
    code: 'CRM_GOOGLE_API_FAILED',
    when: 'O Google recusou ou não respondeu (inclui API ainda não liberada)',
  },
]

const Connection = dto(
  'CrmGoogleConnection',
  z.object({
    configured: z.boolean().meta({
      description: 'O servidor tem as credenciais OAuth do Google.',
    }),
    connected: z.boolean(),
    status: z.enum(['CONNECTED', 'EXPIRED', 'REVOKED']).nullable(),
    googleEmail: z.string().nullable(),
    location: z
      .object({
        accountName: z.string().meta({ example: 'accounts/1234567890' }),
        locationName: z.string().meta({ example: 'locations/9876543210' }),
        title: z.string(),
        placeId: z.string().nullable(),
        mapsUri: z.string().nullable(),
        newReviewUri: z.string().nullable(),
      })
      .nullable(),
    replyTone: z.string().nullable(),
    averageRating: z.number().nullable(),
    totalReviewCount: z.number().int().nullable(),
    lastReviewsSyncAt: dateTime().nullable(),
    lastMetricsSyncAt: dateTime().nullable(),
    lastSyncError: z.string().nullable(),
  }),
)

const LocationOption = dto(
  'CrmGoogleLocationOption',
  z.object({
    accountName: z.string(),
    accountLabel: z.string(),
    locationName: z.string(),
    title: z.string(),
    address: z.string().nullable(),
    placeId: z.string().nullable(),
  }),
)

const Category = dto(
  'CrmGoogleCategory',
  z.object({ name: z.string(), displayName: z.string() }),
)

const HoursPeriod = z.object({
  day: z.enum([
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ]),
  open: z.string().meta({ example: '09:00' }),
  close: z.string().meta({ example: '18:00' }),
})

const Profile = dto(
  'CrmGoogleProfile',
  z.object({
    locationName: z.string(),
    title: z.string(),
    description: z.string(),
    primaryPhone: z.string().nullable(),
    additionalPhones: z.array(z.string()),
    websiteUri: z.string().nullable(),
    primaryCategory: Category.nullable(),
    additionalCategories: z.array(Category),
    address: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    hours: z.array(HoursPeriod),
    mapsUri: z.string().nullable(),
    newReviewUri: z.string().nullable(),
    placeId: z.string().nullable(),
    photoCount: z.number().int().nullable(),
    attributesFilled: z.number().int().nullable(),
    completeness: z.object({
      score: z.number().int().min(0).max(100),
      items: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          done: z.boolean(),
          hint: z.string(),
        }),
      ),
    }),
  }),
)

const Attribute = dto(
  'CrmGoogleAttribute',
  z.object({
    name: z.string().meta({ example: 'attributes/has_wifi' }),
    displayName: z.string(),
    group: z.string().nullable(),
    editable: z.boolean(),
    value: z.boolean().nullable(),
  }),
)

const Photo = dto(
  'CrmGooglePhoto',
  z.object({
    name: z.string(),
    url: z.string(),
    thumbnailUrl: z.string(),
    category: z.string().nullable(),
    createdAt: z.string().nullable(),
  }),
)

const Suggestion = dto(
  'CrmGoogleSuggestion',
  z.object({ suggestion: z.string() }),
)

const Links = dto(
  'CrmGoogleLinks',
  z.object({
    mapsUrl: z.string().nullable(),
    reviewUrl: z.string().nullable(),
    directionsUrl: z.string().nullable(),
    embedUrl: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    address: z.string().nullable(),
    title: z.string(),
  }),
)

const Totals = z.object({
  searchImpressions: z.number().int(),
  mapsImpressions: z.number().int(),
  callClicks: z.number().int(),
  directionRequests: z.number().int(),
  websiteClicks: z.number().int(),
})

const Performance = dto(
  'CrmGooglePerformance',
  z.object({
    range: z.enum(['7d', '28d', '90d']),
    startDate: z.string(),
    endDate: z.string(),
    totals: Totals,
    previousTotals: Totals,
    surfaces: z.object({
      mapsMobile: z.number().int(),
      mapsDesktop: z.number().int(),
      searchMobile: z.number().int(),
      searchDesktop: z.number().int(),
    }),
    series: z.array(Totals.extend({ date: z.string() })),
    syncedAt: dateTime().nullable(),
    hasData: z.boolean(),
  }),
)

const Keyword = dto(
  'CrmGoogleKeyword',
  z.object({
    keyword: z.string(),
    approximate: z.boolean(),
    impressions: z.number().int(),
  }),
)

const Review = dto(
  'CrmGoogleReview',
  z.object({
    id: z.string(),
    reviewerName: z.string(),
    reviewerPhotoUrl: z.string().nullable(),
    starRating: z.number().int().min(1).max(5),
    comment: z.string().nullable(),
    reviewedAt: dateTime(),
    reply: z
      .object({ comment: z.string(), updatedAt: dateTime().nullable() })
      .nullable(),
  }),
)

const ReviewsPage = dto(
  'CrmGoogleReviewsPage',
  z.object({
    items: z.array(Review),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalPages: z.number().int(),
  }),
)

const ReviewsSummary = dto(
  'CrmGoogleReviewsSummary',
  z.object({
    averageRating: z.number().nullable(),
    totalReviewCount: z.number().int().nullable(),
    cachedCount: z.number().int(),
    distribution: z.object({
      '1': z.number().int(),
      '2': z.number().int(),
      '3': z.number().int(),
      '4': z.number().int(),
      '5': z.number().int(),
    }),
    repliedCount: z.number().int(),
    unrepliedCount: z.number().int(),
    responseRate: z.number().nullable(),
    evolution: z.array(
      z.object({
        month: z.string().meta({ example: '2026-11' }),
        count: z.number().int(),
        average: z.number().nullable(),
        cumulativeAverage: z.number().nullable(),
      }),
    ),
    lastSyncAt: dateTime().nullable(),
  }),
)

const REVIEW_NOT_FOUND: ErrorEntry = {
  code: 'CRM_GOOGLE_REVIEW_NOT_FOUND',
  when: 'Avaliação fora do cache deste workspace',
}

const AI_ERRORS: ErrorEntry[] = [
  {
    code: 'FEATURE_NOT_IN_PLAN',
    when: 'O plano não inclui o assistente de IA do CRM',
  },
  {
    code: 'AI_QUOTA_EXCEEDED',
    when: 'A cota mensal de IA do workspace acabou',
  },
  { code: 'AI_PROVIDER_UNAVAILABLE', when: 'Nenhum modelo de IA disponível' },
  {
    code: 'CRM_GOOGLE_AI_FAILED',
    when: 'O modelo não devolveu uma sugestão válida',
  },
]

export const crmGoogleRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/google-business/callback',
    tags: ['Redes sociais (OAuth e mídia)'],
    summary: 'Callback OAuth do Google Meu Negócio',
    description:
      'Destino do OAuth ao conectar o Perfil da Empresa no Google. Troca o `code` pelos tokens (cifrados em repouso), grava a conexão do workspace e redireciona para `/<slug>/crm/google/profile?google=connected` — ou `?google=error&reason=<código>`. O `state` é assinado, expira em 10 minutos e só vale para o usuário que iniciou o fluxo. Sem sessão, redireciona para `/sign-in`. Registrar `<BETTER_AUTH_URL>/api/google-business/callback` como URI de redirecionamento autorizada no cliente OAuth do Google.',
    rateLimit: false,
    autoErrors: false,
    query: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Código de autorização do Google.',
        },
        state: {
          type: 'string',
          description: 'Estado assinado do início do fluxo.',
        },
        error: { type: 'string', description: 'Erro devolvido pelo Google.' },
      },
    },
    responses: {
      302: {
        description: 'Redirect de volta ao CRM.',
        envelope: false,
        headers: { Location: { description: 'Tela de perfil do Google.' } },
      },
    },
  },
  {
    method: 'get',
    path: `${BASE}/connect`,
    tags: [TAG],
    summary: 'Iniciar a conexão com o Google Meu Negócio',
    description: describe(
      'Redireciona (`302`) para a tela de consentimento do Google (escopo `business.manage`; `access_type=offline`). Abra no navegador — não é uma chamada JSON.',
      crmAccess('social', 'CREATE'),
    ),
    params: WORKSPACE,
    responses: {
      302: {
        description: 'Redirect para o consentimento do Google.',
        envelope: false,
        headers: { Location: { description: 'URL de autorização do Google.' } },
      },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_SOCIAL_NOT_CONFIGURED',
        when: 'Credenciais OAuth do Google (ou a chave de cifra de tokens) ausentes no servidor',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/connection`,
    tags: [TAG],
    summary: 'Estado da conexão com o Google',
    description: describe(
      'Funciona também sem conexão (`connected: false`): é o que as três telas leem primeiro. Tokens nunca são devolvidos.',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: { 200: { description: 'Conexão.', schema: Connection } },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/connection`,
    tags: [TAG],
    summary: 'Salvar o tom de voz da IA',
    description: describe(
      'Texto livre que a IA segue ao sugerir respostas e a descrição do perfil.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: WORKSPACE,
    body: UpdateGoogleSettingsSchema,
    responses: { 200: { description: 'Conexão.', schema: Connection } },
    errors: [
      ...CRM_ERRORS,
      { code: 'CRM_SOCIAL_OAUTH_FAILED', when: 'Google não conectado' },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/connection`,
    tags: [TAG],
    summary: 'Desconectar o Google',
    description: describe(
      'Apaga a conexão e o cache (avaliações e métricas) do workspace e revoga a autorização no Google. O perfil no Google não muda.',
      crmAccess('social', 'DELETE'),
    ),
    consent: true,
    params: WORKSPACE,
    responses: { 200: { description: 'Desconectado.', schema: null } },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/locations`,
    tags: [TAG],
    summary: 'Locais da conta do Google',
    description: describe(
      'Locais do Perfil da Empresa que a conta conectada administra, de todas as contas.',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: {
      200: { description: 'Locais.', schema: z.array(LocationOption) },
    },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'put',
    path: `${BASE}/location`,
    tags: [TAG],
    summary: 'Escolher o local gerenciado',
    description: describe(
      'Define o local do workspace e já sincroniza as primeiras avaliações. Trocar de local apaga o cache do anterior.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: WORKSPACE,
    body: SelectGoogleLocationSchema,
    responses: { 200: { description: 'Conexão.', schema: Connection } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'get',
    path: `${BASE}/profile`,
    tags: [TAG],
    summary: 'Perfil da empresa no Google',
    description: describe(
      'Lido ao vivo do Google, com o checklist de completude (nome, categoria, descrição de 250+ caracteres, telefone, site, horários, endereço, 5+ fotos e atributos).',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: { 200: { description: 'Perfil.', schema: Profile } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'patch',
    path: `${BASE}/profile`,
    tags: [TAG],
    summary: 'Editar o perfil no Google',
    description: describe(
      'Só os campos enviados mudam (nome, descrição, telefones, site, categorias, horários). O endereço não é editável por aqui.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: WORKSPACE,
    body: UpdateGoogleProfileSchema,
    responses: { 200: { description: 'Perfil atualizado.', schema: Profile } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'get',
    path: `${BASE}/profile/categories`,
    tags: [TAG],
    summary: 'Buscar categorias do Google',
    description: describe(
      'Busca por nome na lista oficial de categorias (pt-BR, Brasil).',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    query: SearchGoogleCategoriesSchema,
    responses: {
      200: { description: 'Categorias.', schema: z.array(Category) },
    },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'get',
    path: `${BASE}/profile/attributes`,
    tags: [TAG],
    summary: 'Atributos (sim/não) do local',
    description: describe(
      'Atributos booleanos disponíveis para a categoria do local, com o valor atual.',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: {
      200: { description: 'Atributos.', schema: z.array(Attribute) },
    },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'patch',
    path: `${BASE}/profile/attributes`,
    tags: [TAG],
    summary: 'Editar atributos do local',
    description: describe(
      'Liga ou desliga atributos sim/não.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: WORKSPACE,
    body: UpdateGoogleAttributesSchema,
    responses: { 200: { description: 'Salvo.', schema: null } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'get',
    path: `${BASE}/profile/photos`,
    tags: [TAG],
    summary: 'Fotos do local',
    description: describe(
      'Fotos do perfil no Google (sem vídeos).',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: { 200: { description: 'Fotos.', schema: z.array(Photo) } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'post',
    path: `${BASE}/profile/photos`,
    tags: [TAG],
    summary: 'Enviar uma foto ao Google',
    description: describe(
      'Multipart: `file` (JPG ou PNG, 10 KB a 5 MB) e `category` (`ADDITIONAL`, `COVER`, `PROFILE`, `EXTERIOR`, `INTERIOR`, `PRODUCT`, `AT_WORK`, `TEAMS`). O Google baixa a imagem de uma URL temporária do Steel (10 min).',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: WORKSPACE,
    body: {
      schema: z.object({
        file: z.string().meta({ format: 'binary' }),
        category: z.string().optional(),
      }),
      contentType: 'multipart/form-data',
    },
    responses: { 201: { description: 'Foto enviada.', schema: null } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'delete',
    path: `${BASE}/profile/photos`,
    tags: [TAG],
    summary: 'Remover uma foto do Google',
    description: describe(
      'Só fotos do local conectado podem ser removidas.',
      crmAccess('social', 'DELETE'),
    ),
    consent: true,
    params: WORKSPACE,
    body: GoogleDeletePhotoSchema,
    responses: { 200: { description: 'Removida.', schema: null } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'post',
    path: `${BASE}/profile/description-suggestion`,
    tags: [TAG],
    summary: 'Sugerir a descrição do perfil (IA)',
    description: describe(
      'A IA escreve uma descrição de até 750 caracteres a partir do nome, categorias, endereço e tom de voz — nada é publicado. Usa o modelo e a cota mensal de IA do workspace (o consumo fica no extrato de IA).',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: WORKSPACE,
    responses: { 200: { description: 'Sugestão.', schema: Suggestion } },
    errors: [...GOOGLE_ACCESS, ...AI_ERRORS],
  },
  {
    method: 'get',
    path: `${BASE}/links`,
    tags: [TAG],
    summary: 'Links públicos do local',
    description: describe(
      'Link do Maps, de avaliação, de rotas e o embed do mapa, montados a partir do local.',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: { 200: { description: 'Links.', schema: Links } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'get',
    path: `${BASE}/performance`,
    tags: [TAG],
    summary: 'Desempenho no Google e no Maps',
    description: describe(
      'Aparições na Busca e no Maps, ligações, pedidos de rota e cliques no site, no período (`7d`, `28d` ou `90d`), com o período anterior para comparar. Lê o cache diário; se estiver vazio ou com mais de 6 h, atualiza do Google antes. O Google fecha os números com 2 a 3 dias de atraso.',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    query: GooglePerformanceQuerySchema,
    responses: { 200: { description: 'Desempenho.', schema: Performance } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'get',
    path: `${BASE}/performance/keywords`,
    tags: [TAG],
    summary: 'Buscas que levaram ao negócio',
    description: describe(
      'Termos de busca com mais aparições nos últimos 3 meses fechados.',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: { 200: { description: 'Termos.', schema: z.array(Keyword) } },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'get',
    path: `${BASE}/reviews`,
    tags: [TAG],
    summary: 'Avaliações do Google',
    description: describe(
      'Lista paginada do cache (mais novas primeiro) com filtros por nota, respondidas e texto. Sem conexão devolve uma página vazia.',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    query: ListGoogleReviewsQuerySchema,
    responses: { 200: { description: 'Página.', schema: ReviewsPage } },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/reviews/summary`,
    tags: [TAG],
    summary: 'Resumo e evolução da nota',
    description: describe(
      'Nota média e total do Google, distribuição por estrelas, taxa de resposta e a evolução mensal (nota do mês e acumulada) dos últimos 12 meses.',
      crmAccess('social', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: { 200: { description: 'Resumo.', schema: ReviewsSummary } },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_SOCIAL_CONNECTION_NOT_FOUND',
        when: 'O workspace ainda não conectou o Google',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/reviews/sync`,
    tags: [TAG],
    summary: 'Atualizar as avaliações agora',
    description: describe(
      'Lê todas as páginas de avaliações do Google (até 2.000). Avaliações novas de 1 ou 2 estrelas, sem resposta e dos últimos 7 dias geram a notificação `CRM_GOOGLE_REVIEW_NEGATIVE` para os administradores. O worker faz o mesmo a cada 30 minutos.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: WORKSPACE,
    responses: {
      200: {
        description: 'Sincronizado.',
        schema: z.object({
          synced: z.number().int(),
          created: z.number().int(),
        }),
      },
    },
    errors: GOOGLE_ACCESS,
  },
  {
    method: 'put',
    path: `${BASE}/reviews/{reviewId}/reply`,
    tags: [TAG],
    summary: 'Responder (ou editar a resposta de) uma avaliação',
    description: describe(
      'Publica a resposta no Google, em nome do proprietário.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: { ...WORKSPACE, reviewId: 'Id da avaliação no Google.' },
    body: ReplyGoogleReviewSchema,
    responses: { 200: { description: 'Avaliação.', schema: Review } },
    errors: [...GOOGLE_ACCESS, REVIEW_NOT_FOUND],
  },
  {
    method: 'delete',
    path: `${BASE}/reviews/{reviewId}/reply`,
    tags: [TAG],
    summary: 'Apagar a resposta de uma avaliação',
    description: describe(
      'Remove a resposta do Google.',
      crmAccess('social', 'DELETE'),
    ),
    consent: true,
    params: { ...WORKSPACE, reviewId: 'Id da avaliação no Google.' },
    responses: { 200: { description: 'Avaliação.', schema: Review } },
    errors: [...GOOGLE_ACCESS, REVIEW_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/reviews/{reviewId}/suggestion`,
    tags: [TAG],
    summary: 'Sugerir a resposta a uma avaliação (IA)',
    description: describe(
      'Rascunho no tom de voz da marca (nota negativa: desculpas e convite ao contato direto; positiva: agradecimento). O texto do cliente é tratado como dado não confiável. Usa o modelo e a cota mensal de IA; nada é publicado.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: { ...WORKSPACE, reviewId: 'Id da avaliação no Google.' },
    responses: { 200: { description: 'Sugestão.', schema: Suggestion } },
    errors: [
      ...CRM_ERRORS,
      REVIEW_NOT_FOUND,
      {
        code: 'CRM_SOCIAL_CONNECTION_NOT_FOUND',
        when: 'O workspace ainda não conectou o Google',
      },
      ...AI_ERRORS,
    ],
  },
]
