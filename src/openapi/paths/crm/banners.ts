import { z } from 'zod'
import {
  BannerAiBriefSchema,
  CreateCrmBannerSchema,
  DuplicateCrmBannerSchema,
  UpdateCrmBannerSchema,
} from '@/src/schemas/crm-banner.schema'
import type { RouteConfig } from '../../registry'
import {
  CrmBannerAiResultDTO,
  CrmBannerDTO,
  CrmBannerListItemDTO,
} from '../../schemas/crm/banners'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · Banners — biblioteca de banners e criativos de mídia display. A
 * renderização para PNG/JPG/WebP acontece no navegador; o servidor guarda o
 * documento e escreve textos com a IA do workspace.
 */

const BANNER_PARAM = { description: 'ID do banner.' }
const BANNER_NOT_FOUND = notFoundError('CrmBanner', 'Banner inexistente')

export const crmBannerRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/banners',
    tags: ['CRM · Banners'],
    summary: 'Listar banners',
    description: describe(
      'Até 500 banners, mais recentes primeiro. Cada item traz só o formato de capa em `document` (miniatura), mais `formatCount` e `formatIds`.',
      crmAccess('social', 'VIEW'),
    ),
    responses: {
      200: {
        description: 'Banners.',
        schema: z.array(CrmBannerListItemDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/banners',
    tags: ['CRM · Banners'],
    summary: 'Criar banner',
    description: describe(
      'O documento precisa ter ao menos um formato (até 20, com até 60 elementos cada).',
      crmAccess('social', 'CREATE'),
    ),
    consent: true,
    body: CreateCrmBannerSchema,
    responses: { 201: { description: 'Banner criado.', schema: CrmBannerDTO } },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        when: 'Nome vazio ou documento fora do formato',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/banners/{bannerId}',
    tags: ['CRM · Banners'],
    summary: 'Obter banner',
    description: crmAccess('social', 'VIEW'),
    params: { bannerId: BANNER_PARAM },
    responses: {
      200: {
        description: 'Banner com todos os formatos.',
        schema: CrmBannerDTO,
      },
    },
    errors: [...CRM_ERRORS, BANNER_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/banners/{bannerId}',
    tags: ['CRM · Banners'],
    summary: 'Atualizar banner',
    description: describe(
      'Atualização parcial — informe ao menos um campo. `document` substitui o documento inteiro.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: { bannerId: BANNER_PARAM },
    body: UpdateCrmBannerSchema,
    responses: {
      200: { description: 'Banner atualizado.', schema: CrmBannerDTO },
    },
    errors: [...CRM_ERRORS, BANNER_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/banners/{bannerId}',
    tags: ['CRM · Banners'],
    summary: 'Excluir banner',
    description: describe(
      'Exclusão lógica (soft delete). Arquivos já exportados para a biblioteca de imagens continuam lá.',
      crmAccess('social', 'DELETE'),
    ),
    consent: true,
    params: { bannerId: BANNER_PARAM },
    responses: { 200: { description: 'Banner excluído.', schema: null } },
    errors: [...CRM_ERRORS, BANNER_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/banners/{bannerId}/duplicate',
    tags: ['CRM · Banners'],
    summary: 'Duplicar banner',
    description: describe(
      'Cria uma cópia com o nome informado ou "<nome> (cópia)".',
      crmAccess('social', 'CREATE'),
    ),
    consent: true,
    params: { bannerId: BANNER_PARAM },
    body: DuplicateCrmBannerSchema,
    responses: { 201: { description: 'Cópia criada.', schema: CrmBannerDTO } },
    errors: [...CRM_ERRORS, BANNER_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/banners/ai',
    tags: ['CRM · Banners'],
    summary: 'Escrever texto de banner com IA',
    description: describe(
      '`mode: BANNER` escreve o texto de um banner novo a partir de um briefing curto (título, oferta, CTA, imagem sugerida); `mode: VARIANTS` reescreve o texto atual em até 5 variações para teste A/B. Só o briefing vai ao provedor, nunca dados do CRM. Usa a IA do workspace e consome a cota mensal de IA (mesmo gate do assistente do CRM).',
      crmAccess('social', 'CREATE'),
    ),
    consent: true,
    body: BannerAiBriefSchema,
    responses: {
      200: { description: 'Textos sugeridos.', schema: CrmBannerAiResultDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'FEATURE_NOT_ENABLED',
        when: 'Feature `crm.aiAssistant` desligada para o workspace',
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
        code: 'CRM_TEXT_AI_FAILED',
        when: 'Falha do provedor ou resposta fora do formato',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/banners/image',
    tags: ['CRM · Banners'],
    summary: 'Copiar imagem da biblioteca para o canvas',
    description: describe(
      'Devolve os bytes de uma imagem da biblioteca de mídia (`?url=`, só do armazenamento do próprio app) no mesmo domínio, para o navegador desenhar o banner sem bloquear a exportação por CORS.',
      crmAccess('social', 'VIEW'),
    ),
    query: z.object({
      url: z.string().meta({ description: 'URL pública da imagem.' }),
    }),
    queryValidationError: false,
    responses: {
      200: {
        description: 'Bytes da imagem.',
        envelope: false,
        contentType: 'image/*',
        schema: { type: 'string', format: 'binary' },
      },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'BAD_REQUEST',
        when: 'URL ausente, fora da biblioteca de mídia ou imagem inválida',
      },
      'STORAGE_ERROR',
    ],
  },
]
