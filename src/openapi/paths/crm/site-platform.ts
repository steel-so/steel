import { z } from 'zod'
import {
  SiteAnalyticsQuerySchema,
  SiteAnalyticsSummaryQuerySchema,
} from '@/src/schemas/site-analytics.schema'
import {
  CreateSiteRedirectSchema,
  UpdateSiteRedirectSchema,
} from '@/src/schemas/site-redirect.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SiteAnalyticsDTOSchema,
  SiteAnalyticsSummaryDTOSchema,
  SiteRedirectDTOSchema,
} from '../../schemas/crm/site-platform'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Sites — fase S2 (plataforma): redirecionamentos e métricas. */

const TAG = ['CRM · Sites'] as ['CRM · Sites']

const SITE_ID = {
  description: 'Id do site.',
  example: 'ckw1site0000ab7d3k1e5xyz',
}
const REDIRECT_ID = {
  description: 'Id do redirecionamento.',
  example: 'ckw1redi0000ab7d3k1e5xyz',
}
const SITE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_NOT_FOUND',
  when: 'Site inexistente, excluído ou de outro workspace',
}
const REDIRECT_NOT_FOUND: ErrorEntry = {
  code: 'SITE_REDIRECT_NOT_FOUND',
  when: 'Redirecionamento inexistente ou de outro site',
}
const PATH_TAKEN: ErrorEntry = {
  code: 'SITE_REDIRECT_PATH_TAKEN',
  when: 'Outro redirecionamento do site já parte deste endereço',
}
const LOOP: ErrorEntry = {
  code: 'SITE_REDIRECT_LOOP',
  when: 'O destino leva de volta à origem (direto ou por uma cadeia)',
}
const LIVE =
  'Vale na hora, sem publicar: o site no ar consulta os redirecionamentos a cada visita (com cache expirado a cada mudança). Permanente responde 301; temporário, 302 (decidido no proxy, antes da página).'

export const crmSitePlatformRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/redirects',
    tags: TAG,
    summary: 'Listar redirecionamentos do site',
    description: describe(
      'Endereços antigos do site e para onde levam, em ordem alfabética.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: {
        description: 'Redirecionamentos.',
        schema: z.array(SiteRedirectDTOSchema),
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/redirects',
    tags: TAG,
    summary: 'Criar redirecionamento',
    description: describe(
      'Origem exata (`/antigo`) ou prefixo (`/blog/*`); o destino é um caminho do site ou um endereço https. Um destino terminado em `/*` leva o resto do caminho.',
      crmAccess('landing-pages', 'EDIT'),
      LIVE,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: CreateSiteRedirectSchema,
    responses: {
      201: { description: 'Criado.', schema: SiteRedirectDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      PATH_TAKEN,
      LOOP,
      {
        code: 'SITE_LIMIT_REACHED',
        when: 'O site já tem 500 redirecionamentos',
      },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/sites/{siteId}/redirects/{redirectId}',
    tags: TAG,
    summary: 'Alterar redirecionamento',
    description: describe(crmAccess('landing-pages', 'EDIT'), LIVE),
    params: { siteId: SITE_ID, redirectId: REDIRECT_ID },
    consent: true,
    body: UpdateSiteRedirectSchema,
    responses: {
      200: { description: 'Alterado.', schema: SiteRedirectDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      REDIRECT_NOT_FOUND,
      PATH_TAKEN,
      LOOP,
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/sites/{siteId}/redirects/{redirectId}',
    tags: TAG,
    summary: 'Excluir redirecionamento',
    description: describe(crmAccess('landing-pages', 'EDIT'), LIVE),
    params: { siteId: SITE_ID, redirectId: REDIRECT_ID },
    consent: true,
    responses: { 200: 'Excluído.' },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, REDIRECT_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/analytics',
    tags: TAG,
    summary: 'Métricas do site',
    description: describe(
      'Visitas, visitantes por dia, páginas mais vistas, origens, UTM e conversões de formulário por página no período (até 366 dias; padrão: os últimos 30). Dias contados no fuso do site (`settings.timezone`). Dados anônimos: o visitante é um hash diário calculado no servidor, sem cookie.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { siteId: SITE_ID },
    query: SiteAnalyticsQuerySchema,
    responses: {
      200: { description: 'Métricas.', schema: SiteAnalyticsDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/analytics',
    tags: TAG,
    summary: 'Visitas diárias de todos os sites',
    description: describe(
      'Uma série de visitas por dia para cada site do workspace (os gráficos pequenos da lista), de 7 a 90 dias.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    query: SiteAnalyticsSummaryQuerySchema,
    responses: {
      200: {
        description: 'Séries por site.',
        schema: SiteAnalyticsSummaryDTOSchema,
      },
    },
    errors: [...CRM_ERRORS],
  },
]
