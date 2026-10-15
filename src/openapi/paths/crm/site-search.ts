import {
  SearchAiOptimizeSchema,
  SearchAiSummarySchema,
  SearchApplySchema,
  UpdateSiteSearchSettingsSchema,
} from '@/src/schemas/site-search.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SiteSearchAiOptimizeDTOSchema,
  SiteSearchAiSummaryDTOSchema,
  SiteSearchApplyResultDTOSchema,
  SiteSearchReportDTOSchema,
  SiteSearchSettingsViewDTOSchema,
} from '../../schemas/crm/site-search'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Sites — Buscadores (SEO, AEO e GEO). */

const TAG = ['CRM · Sites'] as ['CRM · Sites']

const SITE_ID = {
  description: 'Id do site.',
  example: 'ckw1site0000ab7d3k1e5xyz',
}
const SITE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_NOT_FOUND',
  when: 'Site inexistente, excluído ou de outro workspace',
}
const PAGE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_PAGE_NOT_FOUND',
  when: 'Alguma página não existe ou é de outro site',
}
const AI_ERRORS: ErrorEntry[] = [
  {
    code: 'FEATURE_NOT_ENABLED',
    when: 'O plano não inclui o assistente de IA do CRM',
  },
  {
    code: 'AI_QUOTA_EXCEEDED',
    when: 'A cota mensal de IA do workspace acabou',
  },
  {
    code: 'SITE_SEARCH_AI_FAILED',
    when: 'O provedor de IA falhou ou devolveu algo inaproveitável',
  },
]
const ON_PUBLISH =
  'Fica no rascunho e entra no ar na próxima publicação (robots.txt, llms.txt, JSON-LD e metatags de verificação vêm da versão publicada).'

export const crmSiteSearchRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/search',
    tags: TAG,
    summary: 'Configurações dos Buscadores',
    description: describe(
      'Perfil do negócio, acesso por rastreador (Googlebot, GPTBot, PerplexityBot…), llms.txt, IndexNow e verificação de propriedade. Sem perfil salvo, devolve um rascunho montado com os dados do workspace, da marca de e-mail e do SEO do site (`prefilled: true`).',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: {
        description: 'Configurações.',
        schema: SiteSearchSettingsViewDTOSchema,
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'put',
    path: '/workspaces/{id}/crm/sites/{siteId}/search',
    tags: TAG,
    summary: 'Salvar configurações dos Buscadores',
    description: describe(
      'Só os blocos enviados mudam. Ligar o IndexNow gera a chave do site (mantida se desligar e ligar de novo).',
      crmAccess('landing-pages', 'EDIT'),
      ON_PUBLISH,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: UpdateSiteSearchSettingsSchema,
    responses: {
      200: { description: 'Salvo.', schema: SiteSearchSettingsViewDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/search/report',
    tags: TAG,
    summary: 'Saúde nos buscadores',
    description: describe(
      'Notas de SEO, AEO e GEO (0 a 100) de cada página do rascunho, a partir de verificações determinísticas, e os problemas ordenados pelo impacto somado no site.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: { description: 'Relatório.', schema: SiteSearchReportDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/search/ai/summary',
    tags: TAG,
    summary: 'Como a IA resumiria esta página',
    description: describe(
      'Uma chamada ao provedor de IA do CRM simulando um mecanismo generativo: resumo, entidades reconhecidas, perguntas respondidas e sugestões para ser citado. Consome a cota mensal de IA.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: SearchAiSummarySchema,
    responses: {
      200: { description: 'Resumo.', schema: SiteSearchAiSummaryDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, PAGE_NOT_FOUND, ...AI_ERRORS],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/search/ai/optimize',
    tags: TAG,
    summary: 'Otimizar com IA',
    description: describe(
      'Sugestões de título, descrição e respostas diretas para até 10 páginas (uma chamada por página), para revisão. Nada é salvo: aplique o que aprovar com `search/apply`. Páginas em que o provedor falhou voltam em `failed`.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: SearchAiOptimizeSchema,
    responses: {
      200: { description: 'Sugestões.', schema: SiteSearchAiOptimizeDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, PAGE_NOT_FOUND, ...AI_ERRORS],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/search/apply',
    tags: TAG,
    summary: 'Aplicar sugestões revisadas',
    description: describe(
      'Grava título, descrição e respostas no SEO das páginas. Respostas são casadas pela pergunta; perguntas novas são acrescentadas.',
      crmAccess('landing-pages', 'EDIT'),
      ON_PUBLISH,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: SearchApplySchema,
    responses: {
      200: {
        description: 'Páginas alteradas.',
        schema: SiteSearchApplyResultDTOSchema,
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, PAGE_NOT_FOUND],
  },
]
