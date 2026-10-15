import { z } from 'zod'
import {
  CreateSiteSchema,
  SiteSlugSchema,
  UpdateSiteSchema,
} from '@/src/schemas/site.schema'
import {
  CreateSiteGlobalSchema,
  UpdateSiteGlobalSchema,
} from '@/src/schemas/site-global.schema'
import {
  CreateSitePageSchema,
  DuplicateSitePageSchema,
  ReorderSitePagesSchema,
  UpdateSitePageSchema,
} from '@/src/schemas/site-page.schema'
import { RecordSiteViewSchema } from '@/src/schemas/site-view.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SiteDTOSchema,
  SiteGlobalDTOSchema,
  SiteLandingMigrationReportDTO,
  SitePageDTOSchema,
  SitePageSummaryDTOSchema,
  SitePublishResultDTO,
  SiteSlugAvailabilityDTO,
  SiteSummaryDTOSchema,
  SiteVersionDTOSchema,
} from '../../schemas/crm/sites'
import {
  CRM_ERRORS,
  CRM_PRIVILEGED_ERRORS,
  crmAccess,
  describe,
} from './shared'

/** CRM · Sites — `sites/**`, plus the public view beacon `/sites/{siteSlug}/views`. */

const TAG = ['CRM · Sites'] as ['CRM · Sites']

const SITE_ID = {
  description: 'Id do site.',
  example: 'ckw1site0000ab7d3k1e5xyz',
}
const PAGE_ID = {
  description: 'Id da página.',
  example: 'ckw1page0000ab7d3k1e5xyz',
}
const GLOBAL_ID = {
  description: 'Id do componente global.',
  example: 'ckw1glob0000ab7d3k1e5xyz',
}

const SITE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_NOT_FOUND',
  when: 'Site inexistente, excluído ou de outro workspace',
}
const PAGE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_PAGE_NOT_FOUND',
  when: 'Página (ou página mãe) inexistente ou de outro site',
}
const GLOBAL_NOT_FOUND: ErrorEntry = {
  code: 'SITE_GLOBAL_NOT_FOUND',
  when: 'Componente global inexistente ou de outro site',
}
const DOCUMENT_INVALID: ErrorEntry = {
  code: 'SITE_DOCUMENT_INVALID',
  when: 'O documento não passa na validação do catálogo `site` (os problemas vêm em `details`)',
}
const PATH_TAKEN: ErrorEntry = {
  code: 'SITE_PAGE_PATH_TAKEN',
  when: 'Outra página do site já responde no mesmo caminho',
}
const SLUG_TAKEN: ErrorEntry = {
  code: 'SITE_SLUG_TAKEN',
  when: 'O endereço já é usado por outro site (de qualquer workspace)',
}

const SITE_ERRORS = [...CRM_ERRORS, SITE_NOT_FOUND]

const ACCESS =
  'Os sites usam a permissão `landing-pages` (o menu Sites substitui as landing pages).'

const view = crmAccess('landing-pages', 'VIEW')
const edit = crmAccess('landing-pages', 'EDIT')

export const crmSitesRoutes: RouteConfig[] = [
  /* --------------------------------- sites -------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites',
    tags: TAG,
    summary: 'Listar sites',
    description: describe(
      'Sites do workspace, do mais recente para o mais antigo, com o número de páginas e o endereço público.',
      view,
      ACCESS,
    ),
    responses: {
      200: { description: 'Sites.', schema: z.array(SiteSummaryDTOSchema) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites',
    tags: TAG,
    summary: 'Criar site',
    description: describe(
      'Cria o site em rascunho com a página inicial em branco. Sem `slug`, ele é derivado do nome (`clinica`, `clinica-2`…). Limite de 100 sites por workspace.',
      crmAccess('landing-pages', 'CREATE'),
      ACCESS,
    ),
    consent: true,
    body: CreateSiteSchema,
    responses: { 201: { description: 'Site criado.', schema: SiteDTOSchema } },
    errors: [
      ...CRM_ERRORS,
      SLUG_TAKEN,
      { code: 'SITE_LIMIT_REACHED', when: 'O workspace já tem 100 sites' },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/slug-availability',
    tags: TAG,
    summary: 'Verificar endereço do site',
    description: describe(
      'Diz se o `slug` está livre. Com `siteId`, o próprio site não conta como ocupante (renomear).',
      view,
    ),
    query: z.object({
      slug: SiteSlugSchema,
      siteId: z.string().optional(),
    }),
    responses: {
      200: { description: 'Disponibilidade.', schema: SiteSlugAvailabilityDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/migrate-landing-pages',
    tags: TAG,
    summary: 'Migrar landing pages para sites',
    description: describe(
      'Converte cada landing page do workspace num site de uma página (cabeçalho e rodapé viram componentes globais). Landing pages publicadas viram sites publicados e o link `/l/<token>` passa a redirecionar. Idempotente: páginas já migradas são puladas.',
      crmAccess('privileged'),
    ),
    consent: true,
    responses: {
      200: {
        description: 'Resumo da migração.',
        schema: SiteLandingMigrationReportDTO,
      },
    },
    errors: CRM_PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}',
    tags: TAG,
    summary: 'Detalhe do site',
    description: view,
    params: { siteId: SITE_ID },
    responses: { 200: { description: 'Site.', schema: SiteDTOSchema } },
    errors: SITE_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/sites/{siteId}',
    tags: TAG,
    summary: 'Atualizar site',
    description: describe(
      'Nome, endereço, tema, configurações (SEO, ícone, imagem social, IDs de rastreamento, aviso de cookies) e página inicial. Mudanças só vão ao ar na próxima publicação — exceto o `slug`, que muda o endereço do site publicado na hora.',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: UpdateSiteSchema,
    responses: { 200: { description: 'Site.', schema: SiteDTOSchema } },
    errors: [...SITE_ERRORS, SLUG_TAKEN, PAGE_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/sites/{siteId}',
    tags: TAG,
    summary: 'Excluir site',
    description: describe(
      'Tira o site do ar e libera o endereço. As versões ficam guardadas.',
      crmAccess('landing-pages', 'DELETE'),
    ),
    params: { siteId: SITE_ID },
    consent: true,
    responses: { 200: { description: 'Site excluído.', schema: null } },
    errors: SITE_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/publish',
    tags: TAG,
    summary: 'Publicar site',
    description: describe(
      'Valida todas as páginas e componentes globais, grava um instantâneo imutável (nova versão numerada) e o coloca no ar. O cache público do site expira na hora.',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    responses: {
      200: { description: 'Site publicado.', schema: SitePublishResultDTO },
    },
    errors: [
      ...SITE_ERRORS,
      DOCUMENT_INVALID,
      { code: 'CONFLICT', when: 'Outra publicação do mesmo site em andamento' },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/sites/{siteId}/publish',
    tags: TAG,
    summary: 'Despublicar site',
    description: describe(
      'Tira o site do ar. O rascunho e as versões continuam.',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    responses: { 200: { description: 'Site.', schema: SiteDTOSchema } },
    errors: SITE_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/versions',
    tags: TAG,
    summary: 'Listar versões',
    description: describe(
      'As 50 publicações mais recentes, da mais nova para a mais antiga.',
      view,
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: { description: 'Versões.', schema: z.array(SiteVersionDTOSchema) },
    },
    errors: SITE_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/versions/{versionId}/restore',
    tags: TAG,
    summary: 'Restaurar versão no rascunho',
    description: describe(
      'Substitui o rascunho (páginas, componentes globais, tema e configurações) pelo instantâneo da versão. O site no ar só muda na próxima publicação.',
      edit,
    ),
    params: {
      siteId: SITE_ID,
      versionId: {
        description: 'Id da versão.',
        example: 'ckw1sver0000ab7d3k1e5xyz',
      },
    },
    consent: true,
    responses: { 200: { description: 'Site.', schema: SiteDTOSchema } },
    errors: [
      ...SITE_ERRORS,
      {
        code: 'SITE_VERSION_NOT_FOUND',
        when: 'Versão inexistente ou de outro site',
      },
      {
        code: 'SITE_DOCUMENT_INVALID',
        when: 'O instantâneo guardado não pode ser lido',
      },
    ],
  },

  /* -------------------------------- páginas ------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/pages',
    tags: TAG,
    summary: 'Listar páginas',
    description: describe('Páginas na ordem do menu, sem o documento.', view),
    params: { siteId: SITE_ID },
    responses: {
      200: {
        description: 'Páginas.',
        schema: z.array(SitePageSummaryDTOSchema),
      },
    },
    errors: SITE_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/pages',
    tags: TAG,
    summary: 'Criar página',
    description: describe(
      'Acrescenta a página no fim do menu. Sem `slug`, ele vem do título (com sufixo se já existir); sem `document`, a página nasce em branco. Até 3 níveis e 200 páginas por site.',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: CreateSitePageSchema,
    responses: {
      201: { description: 'Página criada.', schema: SitePageDTOSchema },
    },
    errors: [
      ...SITE_ERRORS,
      PAGE_NOT_FOUND,
      PATH_TAKEN,
      DOCUMENT_INVALID,
      { code: 'SITE_PAGE_PROTECTED', when: 'Passaria de 3 níveis' },
      { code: 'SITE_LIMIT_REACHED', when: 'O site já tem 200 páginas' },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/sites/{siteId}/pages/reorder',
    tags: TAG,
    summary: 'Reordenar páginas',
    description: describe(
      'Grava a ordem do menu: `orderedIds` na ordem desejada.',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: ReorderSitePagesSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: [...SITE_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/pages/{pageId}',
    tags: TAG,
    summary: 'Detalhe da página',
    description: describe('Página com o documento do canvas.', view),
    params: { siteId: SITE_ID, pageId: PAGE_ID },
    responses: { 200: { description: 'Página.', schema: SitePageDTOSchema } },
    errors: [...SITE_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/sites/{siteId}/pages/{pageId}',
    tags: TAG,
    summary: 'Atualizar página',
    description: describe(
      'Título, endereço, página mãe, SEO e documento (validado pelo catálogo `site`). Mudar `slug` ou `parentId` reescreve o caminho das subpáginas.',
      edit,
    ),
    params: { siteId: SITE_ID, pageId: PAGE_ID },
    consent: true,
    body: UpdateSitePageSchema,
    responses: { 200: { description: 'Página.', schema: SitePageDTOSchema } },
    errors: [
      ...SITE_ERRORS,
      PAGE_NOT_FOUND,
      PATH_TAKEN,
      DOCUMENT_INVALID,
      {
        code: 'SITE_PAGE_PROTECTED',
        when: 'A página ficaria dentro dela mesma ou passaria de 3 níveis',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/sites/{siteId}/pages/{pageId}',
    tags: TAG,
    summary: 'Excluir página',
    description: describe(
      'Exclui a página do rascunho. A página inicial e páginas com subpáginas não podem ser excluídas.',
      edit,
    ),
    params: { siteId: SITE_ID, pageId: PAGE_ID },
    consent: true,
    responses: { 200: { description: 'Página excluída.', schema: null } },
    errors: [
      ...SITE_ERRORS,
      PAGE_NOT_FOUND,
      {
        code: 'SITE_PAGE_PROTECTED',
        when: 'É a página inicial ou tem subpáginas',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/pages/{pageId}/duplicate',
    tags: TAG,
    summary: 'Duplicar página',
    description: describe(
      'Cópia da página sob a mesma página mãe, com o endereço `<slug>-copia` (e sufixo, se preciso). Nunca vira a página inicial.',
      edit,
    ),
    params: { siteId: SITE_ID, pageId: PAGE_ID },
    consent: true,
    body: DuplicateSitePageSchema,
    responses: {
      201: { description: 'Cópia criada.', schema: SitePageDTOSchema },
    },
    errors: [
      ...SITE_ERRORS,
      PAGE_NOT_FOUND,
      PATH_TAKEN,
      { code: 'SITE_LIMIT_REACHED', when: 'O site já tem 200 páginas' },
    ],
  },

  /* --------------------------- componentes globais ------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/globals',
    tags: TAG,
    summary: 'Listar componentes globais',
    description: describe('Cabeçalho, rodapé e símbolos do site.', view),
    params: { siteId: SITE_ID },
    responses: {
      200: {
        description: 'Componentes globais.',
        schema: z.array(SiteGlobalDTOSchema),
      },
    },
    errors: SITE_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/sites/{siteId}/globals',
    tags: TAG,
    summary: 'Criar componente global',
    description: describe(
      'Um cabeçalho e um rodapé por site; símbolos à vontade (até 50 globais).',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: CreateSiteGlobalSchema,
    responses: {
      201: { description: 'Componente criado.', schema: SiteGlobalDTOSchema },
    },
    errors: [
      ...SITE_ERRORS,
      DOCUMENT_INVALID,
      {
        code: 'SITE_GLOBAL_KIND_TAKEN',
        when: 'O site já tem um cabeçalho (ou rodapé)',
      },
      {
        code: 'SITE_LIMIT_REACHED',
        when: 'O site já tem 50 componentes globais',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/sites/{siteId}/globals/{globalId}',
    tags: TAG,
    summary: 'Detalhe do componente global',
    description: view,
    params: { siteId: SITE_ID, globalId: GLOBAL_ID },
    responses: {
      200: { description: 'Componente.', schema: SiteGlobalDTOSchema },
    },
    errors: [...SITE_ERRORS, GLOBAL_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/sites/{siteId}/globals/{globalId}',
    tags: TAG,
    summary: 'Atualizar componente global',
    description: edit,
    params: { siteId: SITE_ID, globalId: GLOBAL_ID },
    consent: true,
    body: UpdateSiteGlobalSchema,
    responses: {
      200: { description: 'Componente.', schema: SiteGlobalDTOSchema },
    },
    errors: [...SITE_ERRORS, GLOBAL_NOT_FOUND, DOCUMENT_INVALID],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/sites/{siteId}/globals/{globalId}',
    tags: TAG,
    summary: 'Excluir componente global',
    description: edit,
    params: { siteId: SITE_ID, globalId: GLOBAL_ID },
    consent: true,
    responses: { 200: { description: 'Componente excluído.', schema: null } },
    errors: [...SITE_ERRORS, GLOBAL_NOT_FOUND],
  },

  /* ------------------------------ beacon público ---------------------------- */
  {
    auth: 'public',
    rateLimit: 'ip',
    method: 'post',
    path: '/sites/{siteSlug}/views',
    tags: ['CRM público · Sites'],
    summary: 'Registrar visualização de site',
    description:
      'Beacon do site publicado. Anônimo (LGPD): nenhum cookie; o visitante vira um hash diário (IP + navegador + site + dia, com segredo do servidor) e do referenciador fica só o domínio. Com o aviso de cookies do site ligado, o site só envia depois do aceite.',
    params: {
      siteSlug: {
        description: 'Endereço do site.',
        example: 'clinica-sao-lucas',
      },
    },
    body: {
      schema: RecordSiteViewSchema,
      example: {
        pageId: 'ckw1page0000ab7d3k1e5xyz',
        path: '/contato',
        referrer: 'https://www.google.com/',
        utmSource: 'instagram',
        utmCampaign: 'outubro',
      },
    },
    responses: {
      202: { description: 'Visualização registrada.', schema: null },
    },
    errors: [
      {
        code: 'SITE_NOT_FOUND',
        when: 'Site inexistente, não publicado ou com o CRM desabilitado',
      },
    ],
  },
]
