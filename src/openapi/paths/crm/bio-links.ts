import { z } from 'zod'
import {
  BioAnalyticsQuerySchema,
  BioSlugAvailabilityQuerySchema,
  CreateBioLinkSchema,
  RecordBioViewSchema,
  UpdateBioLinkSchema,
} from '@/src/schemas/bio-link.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  BioLinkAnalyticsDTOSchema,
  BioLinkDTOSchema,
  BioLinkOptionsDTOSchema,
  BioLinkSlugAvailabilityDTO,
  BioLinkSummaryDTOSchema,
} from '../../schemas/crm/bio-links'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Link da bio — `bio-links/**`, plus the public view beacon `/b/{slug}/view`. */

const TAG = ['CRM · Link da bio'] as ['CRM · Link da bio']

const BIO_ID = {
  description: 'Id da página de link da bio.',
  example: 'ckw1bio00000ab7d3k1e5xyz',
}

const NOT_FOUND: ErrorEntry = {
  code: 'BIO_LINK_NOT_FOUND',
  when: 'Página inexistente, excluída ou de outro workspace',
}
const SLUG_TAKEN: ErrorEntry = {
  code: 'BIO_LINK_SLUG_TAKEN',
  when: 'O endereço já é usado por outra página (de qualquer workspace)',
}

const BIO_ERRORS = [...CRM_ERRORS, NOT_FOUND]

const ACCESS =
  'O link da bio usa a permissão `landing-pages`, a mesma dos Sites.'

const view = crmAccess('landing-pages', 'VIEW')
const edit = crmAccess('landing-pages', 'EDIT')

export const crmBioLinksRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/bio-links',
    tags: TAG,
    summary: 'Listar páginas de link da bio',
    description: describe(
      'Páginas do workspace, da mais recente para a mais antiga, com o total de visitas e cliques de sempre.',
      view,
      ACCESS,
    ),
    responses: {
      200: {
        description: 'Páginas.',
        schema: z.array(BioLinkSummaryDTOSchema),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/bio-links',
    tags: TAG,
    summary: 'Criar página de link da bio',
    description: describe(
      'Cria a página em rascunho, sem itens. Sem `slug`, o endereço é derivado do nome (`minha-loja`, `minha-loja-2`…). Limite de 50 páginas por workspace.',
      crmAccess('landing-pages', 'CREATE'),
      ACCESS,
    ),
    consent: true,
    body: CreateBioLinkSchema,
    responses: {
      201: { description: 'Página criada.', schema: BioLinkDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SLUG_TAKEN,
      {
        code: 'BIO_LINK_LIMIT_REACHED',
        when: 'O workspace já tem 50 páginas',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/bio-links/options',
    tags: TAG,
    summary: 'Opções para os botões prontos',
    description: describe(
      'Linhas de WhatsApp conectadas, sites publicados e formulários publicados do workspace: alimentam os botões prontos do editor.',
      view,
    ),
    responses: {
      200: { description: 'Opções.', schema: BioLinkOptionsDTOSchema },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/bio-links/slug-availability',
    tags: TAG,
    summary: 'Verificar endereço da página',
    description: describe(
      'Diz se o `slug` está livre. Com `bioLinkId`, a própria página não conta como ocupante (renomear).',
      view,
    ),
    query: BioSlugAvailabilityQuerySchema,
    responses: {
      200: {
        description: 'Disponibilidade.',
        schema: BioLinkSlugAvailabilityDTO,
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/bio-links/{bioLinkId}',
    tags: TAG,
    summary: 'Detalhe da página',
    description: describe(view, ACCESS),
    params: { bioLinkId: BIO_ID },
    responses: { 200: { description: 'Página.', schema: BioLinkDTOSchema } },
    errors: BIO_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/bio-links/{bioLinkId}',
    tags: TAG,
    summary: 'Atualizar página',
    description: describe(
      'Atualização parcial. `status` publica (`PUBLISHED`, carimba `publishedAt`) ou despublica (`DRAFT`). Cada item é validado: o destino precisa servir ao tipo do botão (número de WhatsApp com DDD, e-mail válido, endereço http/https…), o vídeo precisa ser do YouTube, o agendamento precisa ter fim depois do início e o formulário do CRM precisa estar publicado neste workspace. Mudanças valem na página pública na hora.',
      edit,
      ACCESS,
    ),
    params: { bioLinkId: BIO_ID },
    consent: true,
    body: UpdateBioLinkSchema,
    responses: {
      200: { description: 'Página atualizada.', schema: BioLinkDTOSchema },
    },
    errors: [
      ...BIO_ERRORS,
      SLUG_TAKEN,
      {
        code: 'BIO_LINK_FORM_INVALID',
        when: 'Um item aponta para um formulário não publicado neste workspace',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/bio-links/{bioLinkId}',
    tags: TAG,
    summary: 'Excluir página',
    description: describe(
      'Exclusão definitiva: a página sai do ar, o endereço fica livre e as estatísticas de visitas e cliques são apagadas.',
      crmAccess('landing-pages', 'DELETE'),
      ACCESS,
    ),
    params: { bioLinkId: BIO_ID },
    consent: true,
    responses: { 200: { description: 'Página excluída.', schema: null } },
    errors: BIO_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/bio-links/{bioLinkId}/analytics',
    tags: TAG,
    summary: 'Métricas da página',
    description: describe(
      'Visitas, visitantes únicos, cliques e taxa de cliques; série diária; cliques por link; origem (domínio do referenciador), `utm_source`, países e dispositivos das visitas. Os dias são contados no horário de Brasília. Anônimo: sem cookies e sem guardar o IP.',
      view,
      ACCESS,
    ),
    params: { bioLinkId: BIO_ID },
    query: BioAnalyticsQuerySchema,
    responses: {
      200: {
        description: 'Métricas do período.',
        schema: BioLinkAnalyticsDTOSchema,
      },
    },
    errors: BIO_ERRORS,
  },

  /* ------------------------------ beacon público ---------------------------- */
  {
    auth: 'public',
    rateLimit: 'ip',
    method: 'post',
    path: '/b/{slug}/view',
    tags: ['CRM público · Link da bio'],
    summary: 'Registrar visita em página de link da bio',
    description:
      'Beacon da página pública `/b/<slug>`. Anônimo (LGPD): nenhum cookie; o visitante vira um hash diário (IP + navegador + página + dia, com segredo do servidor), do referenciador fica só o domínio e o país vem do IP no momento do acesso (o IP não é guardado). Robôs não são contados. Os cliques são contados no redirecionamento `GET /b/<slug>/l/<id>` (302), que não faz parte desta API.',
    params: {
      slug: {
        description: 'Endereço da página.',
        example: 'minha-loja',
      },
    },
    body: {
      schema: RecordBioViewSchema,
      example: {
        referrer: 'https://l.instagram.com/',
        utmSource: 'instagram',
        utmCampaign: 'lancamento',
      },
    },
    responses: {
      202: { description: 'Visita registrada.', schema: null },
    },
    errors: [
      {
        code: 'BIO_LINK_NOT_FOUND',
        when: 'Página inexistente, não publicada ou com o CRM desabilitado',
      },
    ],
  },
]
