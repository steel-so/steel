import { z } from 'zod'
import {
  CreateSiteFromTemplateSchema,
  DuplicateSiteSchema,
  RemoveSiteMediaSchema,
} from '@/src/schemas/site-studio.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SiteChangesDTOSchema,
  SiteMediaItemDTOSchema,
} from '../../schemas/crm/site-studio'
import { SiteDTOSchema } from '../../schemas/crm/sites'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Sites — rotas do editor: modelos, cópia, resumo da publicação e
 * biblioteca de mídia. */

const TAG = ['CRM · Sites'] as ['CRM · Sites']

const SITE_ID = {
  description: 'Id do site.',
  example: 'ckw1site0000ab7d3k1e5xyz',
}
const SITE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_NOT_FOUND',
  when: 'Site inexistente, excluído ou de outro workspace',
}
const LIMIT: ErrorEntry = {
  code: 'SITE_LIMIT_REACHED',
  when: 'O workspace já tem 100 sites',
}
const ACCESS =
  'Os sites usam a permissão `landing-pages` (o menu Sites substitui as landing pages).'

export const crmSiteStudioRoutes: RouteConfig[] = [
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/from-template',
    tags: TAG,
    summary: 'Criar site a partir de um modelo',
    description: describe(
      'Cria o site em rascunho com o tema do modelo, a página inicial com as seções do modelo e o cabeçalho e o rodapé como componentes globais.',
      crmAccess('landing-pages', 'CREATE'),
      ACCESS,
    ),
    consent: true,
    body: CreateSiteFromTemplateSchema,
    responses: { 201: { description: 'Site criado.', schema: SiteDTOSchema } },
    errors: [
      ...CRM_ERRORS,
      LIMIT,
      {
        code: 'SITE_SLUG_TAKEN',
        when: 'O endereço já é usado por outro site (de qualquer workspace)',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/duplicate',
    tags: TAG,
    summary: 'Duplicar site',
    description: describe(
      'Cópia em rascunho do site: tema, configurações, todas as páginas (mesma árvore e caminhos) e os componentes globais. O endereço vira `<slug>-copia` (com sufixo, se preciso).',
      crmAccess('landing-pages', 'CREATE'),
      ACCESS,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: DuplicateSiteSchema,
    responses: { 201: { description: 'Cópia criada.', schema: SiteDTOSchema } },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, LIMIT],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/changes',
    tags: TAG,
    summary: 'Resumo da próxima publicação',
    description: describe(
      'Compara o rascunho com a versão no ar: páginas e globais novos, alterados ou removidos, mudanças de ordem, tema e configurações. Antes da primeira publicação, tudo aparece como novo.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: { description: 'Resumo.', schema: SiteChangesDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      {
        code: 'SITE_VERSION_NOT_FOUND',
        when: 'A versão no ar não foi encontrada',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/media',
    tags: TAG,
    summary: 'Listar imagens dos sites',
    description: describe(
      'Biblioteca de mídia do editor: imagens enviadas para os sites do workspace e as das landing pages antigas, das mais novas para as mais antigas (até 500).',
      crmAccess('landing-pages', 'VIEW'),
    ),
    responses: {
      200: { description: 'Imagens.', schema: z.array(SiteMediaItemDTOSchema) },
    },
    errors: [
      ...CRM_ERRORS,
      { code: 'STORAGE_ERROR', when: 'O armazenamento não respondeu' },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/media',
    tags: TAG,
    summary: 'Enviar imagem para os sites',
    description: describe(
      'Upload **binário cru** (não multipart): o corpo é o arquivo e o `Content-Type` o seu tipo. Aceita JPEG, PNG ou WebP até 5 MB.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    rateLimit: 'upload',
    consent: true,
    body: {
      contentType: 'image/*',
      description:
        'Bytes da imagem (`image/jpeg`, `image/png` ou `image/webp`).',
      schema: { type: 'string', format: 'binary' },
    },
    responses: {
      201: { description: 'Imagem salva.', schema: SiteMediaItemDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'BAD_REQUEST',
        message: 'Content-Type é obrigatório',
        when: 'Sem header Content-Type',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Arquivo muito grande. Máximo 5 MB',
        when: 'Content-Length acima do limite',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Formato não suportado. Use JPEG, PNG ou WebP',
        when: 'Content-Type fora da lista aceita',
      },
      { code: 'STORAGE_ERROR', when: 'O armazenamento recusou o arquivo' },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/sites/media',
    tags: TAG,
    summary: 'Excluir imagem dos sites',
    description: describe(
      'Apaga uma imagem enviada pelo editor (`source: site`). Páginas que ainda a usam passam a mostrar a imagem quebrada.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    consent: true,
    body: RemoveSiteMediaSchema,
    responses: { 200: { description: 'Imagem excluída.', schema: null } },
    errors: [
      ...CRM_ERRORS,
      { code: 'STORAGE_ERROR', when: 'O armazenamento não respondeu' },
    ],
  },
]
