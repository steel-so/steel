import { CreateSeoKeywordSchema } from '@/src/schemas/site-seo.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SiteSeoDetailDTOSchema,
  SiteSeoKeywordDTOSchema,
  SiteSeoOverviewDTOSchema,
  SiteSeoReindexDTOSchema,
} from '../../schemas/crm/site-seo'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Sites — visão central de SEO (Atrair > Site e SEO > SEO). */

const TAG = ['CRM · Sites'] as ['CRM · Sites']

const SITE_ID = {
  description: 'Id do site.',
  example: 'ckw1site0000ab7d3k1e5xyz',
}
const KEYWORD_ID = {
  description: 'Id da palavra-chave acompanhada.',
  example: 'ckw1kw000000ab7d3k1e5xyz',
}
const SITE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_NOT_FOUND',
  when: 'Site inexistente, excluído ou de outro workspace',
}

export const crmSiteSeoRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/seo',
    tags: TAG,
    summary: 'SEO dos sites do workspace',
    description: describe(
      'Para cada site: notas de SEO, AEO e GEO (0 a 100), principais problemas, piores páginas, resumo do checklist técnico, palavras-chave acompanhadas, prontidão para IndexNow e histórico dos últimos 30 dias. A primeira leitura do dia grava o ponto de hoje no histórico (o worker grava os demais às 05:10).',
      crmAccess('landing-pages', 'VIEW'),
    ),
    responses: {
      200: { description: 'Visão geral.', schema: SiteSeoOverviewDTOSchema },
    },
    errors: [...CRM_ERRORS],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/search/seo',
    tags: TAG,
    summary: 'Detalhe de SEO de um site',
    description: describe(
      'Páginas com as três notas, problemas ordenados pelo impacto, checklist técnico agregado (title, description, H1, canônico, alt de imagens, links quebrados, sitemap, robots), palavras-chave acompanhadas (onde aparecem, densidade, lacunas) e histórico de 90 dias.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: { description: 'Detalhe.', schema: SiteSeoDetailDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/search/keywords',
    tags: TAG,
    summary: 'Acompanhar palavra-chave',
    description: describe(
      'Cadastro manual de uma palavra-chave (até 50 por site; sem distinguir maiúsculas e acentos). A análise de onde ela aparece vem no detalhe do site.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: CreateSeoKeywordSchema,
    responses: {
      201: { description: 'Criada.', schema: SiteSeoKeywordDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      {
        code: 'SEO_KEYWORD_DUPLICATE',
        when: 'O site já acompanha esta palavra-chave',
      },
      {
        code: 'SEO_KEYWORD_LIMIT_REACHED',
        when: 'O site já tem 50 palavras-chave',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/sites/{siteId}/search/keywords/{keywordId}',
    tags: TAG,
    summary: 'Parar de acompanhar palavra-chave',
    description: describe(crmAccess('landing-pages', 'EDIT')),
    params: { siteId: SITE_ID, keywordId: KEYWORD_ID },
    consent: true,
    responses: { 200: 'Removida.' },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      {
        code: 'SEO_KEYWORD_NOT_FOUND',
        when: 'Palavra-chave inexistente ou de outro site',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/search/reindex',
    tags: TAG,
    summary: 'Reindexar agora (IndexNow)',
    description: describe(
      'Envia agora ao IndexNow (Bing, Yandex, Seznam, Naver) as URLs indexáveis da versão publicada, fora de uma publicação. Exige site publicado, IndexNow ligado e site visível aos buscadores. O Google não participa do IndexNow.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID },
    consent: true,
    responses: {
      200: { description: 'Enviado.', schema: SiteSeoReindexDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      { code: 'SEO_NOT_PUBLISHED', when: 'O site ainda não foi publicado' },
      {
        code: 'SEO_INDEXNOW_OFF',
        when: 'IndexNow desligado, sem chave ou site marcado como noindex',
      },
    ],
  },
]
