import { z } from 'zod'
import {
  ApplySiteExperimentWinnerSchema,
  CreateSiteExperimentSchema,
  RecordSiteExperimentEventsSchema,
  SiteExperimentActionSchema,
  UpdateSiteExperimentSchema,
} from '@/src/schemas/site-experiment.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SiteExperimentDTOSchema,
  SiteExperimentImpactDTOSchema,
} from '../../schemas/crm/site-experiments'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Sites — testes A/B (S4). */

const TAG = ['CRM · Sites'] as ['CRM · Sites']
const BASE = '/workspaces/{id}/crm/sites/{siteId}/experiments'

const SITE_ID = {
  description: 'Id do site.',
  example: 'ckw1site0000ab7d3k1e5xyz',
}
const EXPERIMENT_ID = {
  description: 'Id do teste A/B.',
  example: 'ckw1abts0000ab7d3k1e5xyz',
}
const SITE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_NOT_FOUND',
  when: 'Site inexistente, excluído ou de outro workspace',
}
const NOT_FOUND: ErrorEntry = {
  code: 'SITE_EXPERIMENT_NOT_FOUND',
  when: 'Teste inexistente ou de outro site',
}
const NOT_PUBLISHED: ErrorEntry = {
  code: 'SITE_EXPERIMENT_NOT_PUBLISHED',
  when: 'Alguma variante não está na versão publicada (publique antes)',
}
const INVALID_STATE: ErrorEntry = {
  code: 'SITE_EXPERIMENT_INVALID_STATE',
  when: 'A ação não vale para o estado do teste (por exemplo, já encerrado)',
}
const RUNS_LIVE =
  'O teste roda sobre a versão publicada: as variantes vivem no rascunho (seção irmã marcada como variante, ou cópia oculta da página) e precisam estar publicadas para iniciar. Uma publicação que muda as variantes de um teste em andamento o reinicia.'

export const crmSiteExperimentRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAG,
    summary: 'Listar testes A/B do site',
    description: describe(
      'Testes do site, do mais novo ao mais antigo, com os resultados da rodada atual (visitantes, conversões, taxa, ganho sobre o original e probabilidade bayesiana de vencer o original).',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: { description: 'Testes.', schema: z.array(SiteExperimentDTOSchema) },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'post',
    path: BASE,
    tags: TAG,
    summary: 'Criar teste A/B',
    description: describe(
      'SECTION: informe a seção testada e as cópias já criadas no editor (B, C). PAGE: o servidor cria as cópias ocultas da página (fora do menu e do sitemap). O teste nasce em rascunho.',
      crmAccess('landing-pages', 'EDIT'),
      RUNS_LIVE,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: CreateSiteExperimentSchema,
    responses: {
      201: { description: 'Criado.', schema: SiteExperimentDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      {
        code: 'SITE_PAGE_NOT_FOUND',
        when: 'Página testada ou da meta inexistente',
      },
      { code: 'SITE_LIMIT_REACHED', when: 'O site já tem 50 testes' },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/impact`,
    tags: TAG,
    summary: 'Testes que a próxima publicação reinicia',
    description: describe(
      'Testes em andamento ou pausados cujas variantes mudaram no rascunho; o diálogo de publicação avisa antes.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: { description: 'Impacto.', schema: SiteExperimentImpactDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/{experimentId}`,
    tags: TAG,
    summary: 'Detalhar teste A/B',
    description: describe(crmAccess('landing-pages', 'VIEW')),
    params: { siteId: SITE_ID, experimentId: EXPERIMENT_ID },
    responses: {
      200: { description: 'Teste.', schema: SiteExperimentDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/{experimentId}`,
    tags: TAG,
    summary: 'Alterar teste A/B',
    description: describe(
      'Nome e agenda mudam a qualquer momento. Variantes, divisão do tráfego e meta de um teste em andamento ou pausado só mudam com `restart: true` (os resultados recomeçam numa nova rodada).',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID, experimentId: EXPERIMENT_ID },
    consent: true,
    body: UpdateSiteExperimentSchema,
    responses: {
      200: { description: 'Alterado.', schema: SiteExperimentDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      NOT_FOUND,
      INVALID_STATE,
      NOT_PUBLISHED,
      {
        code: 'SITE_EXPERIMENT_RUNNING',
        when: 'Mudança de variantes ou meta num teste em andamento sem `restart: true`',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/{experimentId}`,
    tags: TAG,
    summary: 'Excluir teste A/B',
    description: describe(
      'As variantes saem do rascunho (o original fica), a não ser que a vencedora já tenha sido aplicada.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID, experimentId: EXPERIMENT_ID },
    consent: true,
    responses: { 200: 'Excluído.' },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/{experimentId}/status`,
    tags: TAG,
    summary: 'Iniciar, pausar, retomar, encerrar ou reiniciar',
    description: describe(
      'Vale na hora no site no ar. Iniciar exige as variantes publicadas e nenhum outro teste na mesma seção (ou página). Reiniciar abre uma nova rodada com resultados zerados.',
      crmAccess('landing-pages', 'EDIT'),
      RUNS_LIVE,
    ),
    params: { siteId: SITE_ID, experimentId: EXPERIMENT_ID },
    consent: true,
    body: SiteExperimentActionSchema,
    responses: {
      200: {
        description: 'Teste atualizado.',
        schema: SiteExperimentDTOSchema,
      },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      NOT_FOUND,
      INVALID_STATE,
      NOT_PUBLISHED,
      {
        code: 'SITE_EXPERIMENT_CONFLICT',
        when: 'Outro teste já roda nesta seção ou página',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/{experimentId}/apply-winner`,
    tags: TAG,
    summary: 'Aplicar vencedora',
    description: describe(
      'Leva a variante para o rascunho (a seção no lugar da original, ou o conteúdo da página), remove as outras versões e encerra o teste. Publique para valer no site.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { siteId: SITE_ID, experimentId: EXPERIMENT_ID },
    consent: true,
    body: ApplySiteExperimentWinnerSchema,
    responses: {
      200: { description: 'Teste encerrado.', schema: SiteExperimentDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      NOT_FOUND,
      INVALID_STATE,
      {
        code: 'VALIDATION_ERROR',
        when: 'A variante não está mais no rascunho',
      },
    ],
  },

  /* ------------------------------ beacon público ---------------------------- */
  {
    auth: 'public',
    rateLimit: 'ip',
    method: 'post',
    path: '/sites/{siteSlug}/experiments',
    tags: ['CRM público · Sites'],
    summary: 'Registrar exposição ou conversão de teste A/B',
    description:
      'Beacon do site publicado, com a mesma regra de consentimento das visualizações. O servidor recalcula a variante pela chave do visitante (o cookie `ss-ab-<slug>`, gravado só após o aceite, ou um hash do visitante do dia); uma conversão só conta para quem foi exposto na mesma rodada, uma vez.',
    params: {
      siteSlug: {
        description: 'Endereço do site.',
        example: 'clinica-sao-lucas',
      },
    },
    body: {
      schema: RecordSiteExperimentEventsSchema,
      example: {
        events: [
          { experimentId: 'ckw1abts0000ab7d3k1e5xyz', kind: 'EXPOSURE' },
        ],
      },
    },
    responses: {
      202: {
        description: 'Eventos registrados.',
        schema: z.object({ recorded: z.number().int() }),
      },
    },
    errors: [
      {
        code: 'SITE_NOT_FOUND',
        when: 'Site inexistente, não publicado ou com o CRM desabilitado',
      },
    ],
  },
]
