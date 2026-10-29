import { z } from 'zod'
import { SetCrmNewsletterAbTestSchema } from '@/src/schemas/crm-newsletter-ab.schema'
import {
  CrmNewsletterAiDraftSchema,
  CrmNewsletterAiSubjectsSchema,
} from '@/src/schemas/crm-newsletter-ai.schema'
import {
  PreviewCrmNewsletterDigestSchema,
  UpsertCrmNewsletterDigestSchema,
} from '@/src/schemas/crm-newsletter-digest.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmNewsletterAbReportDTO,
  CrmNewsletterAbTestDTO,
  CrmNewsletterAiDraftResultDTO,
  CrmNewsletterAiSourcesDTO,
  CrmNewsletterAiSubjectsResultDTO,
  CrmNewsletterDigestPreviewDTO,
  CrmNewsletterDigestRunDTO,
  CrmNewsletterDigestSettingsDTO,
} from '../../schemas/crm/newsletter2-digest-ai'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · Newsletter, fase 2 (frente nl2-digest-ai): resumo automático a
 * partir do blog do Sites e/ou de um feed RSS, "Escrever com IA" e
 * "Sugerir assuntos" no editor e o teste A/B de assunto.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Newsletter · Edições']
const NL = '/workspaces/{id}/crm/newsletters/{newsletterId}'
const NEWSLETTER_ID = 'ID da newsletter.'
const ISSUE_PARAMS = { newsletterId: NEWSLETTER_ID, issueId: 'ID da edição.' }

const NEWSLETTER_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_NOT_FOUND',
  when: 'Newsletter inexistente no workspace',
}
const ISSUE_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
  when: 'Edição inexistente na newsletter',
}
const LOCKED: ErrorEntry = {
  code: 'CRM_NEWSLETTER_ISSUE_LOCKED',
  when: 'A edição saiu de rascunho/agendada',
}
const SOURCE_INVALID: ErrorEntry = {
  code: 'CRM_NEWSLETTER_DIGEST_SOURCE_INVALID',
  when: 'Site de outro workspace, ou feed fora de https / em endereço privado',
}
const AI_ERRORS: ErrorEntry[] = [
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
    code: 'CRM_NEWSLETTER_AI_FAILED',
    when: 'O provedor falhou ou não devolveu nada aproveitável',
  },
]
const SCOPE_ERRORS = [...CRM_ERRORS, NEWSLETTER_NOT_FOUND]
const ISSUE_ERRORS = [...SCOPE_ERRORS, ISSUE_NOT_FOUND]

export const crmNewsletterDigestAiRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${NL}/digest`,
    tags: TAGS,
    summary: 'Ver o resumo automático',
    description: describe(
      'Configuração do resumo automático (null se nunca configurado) e os sites do workspace cujo blog pode servir de fonte.',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: { description: 'Resumo.', schema: CrmNewsletterDigestSettingsDTO },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'put',
    path: `${NL}/digest`,
    tags: TAGS,
    summary: 'Salvar o resumo automático',
    description: describe(
      'Fonte: blog de um site do workspace e/ou feed RSS/Atom (https, host público). Semanal (dia da semana) ou mensal (dia 1–28), em hora cheia no fuso de São Paulo. `DRAFT` cria um rascunho e avisa quem configurou; `AUTO_SEND` envia se houver posts novos e as conferências do envio passarem. `{data}` no assunto vira a data do resumo.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: { newsletterId: NEWSLETTER_ID },
    body: {
      schema: UpsertCrmNewsletterDigestSchema,
      example: {
        enabled: true,
        siteId: 'ckw1site000ab7d3k1e5xyz',
        rssUrl: null,
        cadence: 'WEEKLY',
        weekday: 1,
        monthDay: null,
        hour: 9,
        mode: 'DRAFT',
        maxItems: 5,
        subject: 'Resumo de {data}',
        intro: 'Os destaques da semana no nosso blog.',
      },
    },
    responses: {
      200: { description: 'Resumo.', schema: CrmNewsletterDigestSettingsDTO },
    },
    errors: [...SCOPE_ERRORS, SOURCE_INVALID],
  },
  {
    method: 'delete',
    path: `${NL}/digest`,
    tags: TAGS,
    summary: 'Remover o resumo automático',
    description: describe(
      'As edições já criadas pelo resumo ficam.',
      crmAccess('email', 'DELETE'),
    ),
    consent: true,
    params: { newsletterId: NEWSLETTER_ID },
    responses: { 200: { description: 'Removido.', schema: z.null() } },
    errors: [
      ...SCOPE_ERRORS,
      notFoundError('CrmNewsletterDigest', 'Resumo nunca configurado'),
    ],
  },
  {
    method: 'post',
    path: `${NL}/digest/preview`,
    tags: TAGS,
    summary: 'Pré-visualizar o próximo resumo',
    description: describe(
      'Posts que entrariam no próximo resumo com estas fontes (mais novos que o último resumo; no primeiro, os últimos 7 ou 31 dias). Nada é salvo. Problemas de uma fonte voltam em `warnings`.',
      crmAccess('email', 'EDIT'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    body: PreviewCrmNewsletterDigestSchema,
    responses: {
      200: { description: 'Posts.', schema: CrmNewsletterDigestPreviewDTO },
    },
    errors: [...SCOPE_ERRORS, SOURCE_INVALID],
  },
  {
    method: 'post',
    path: `${NL}/digest/run`,
    tags: TAGS,
    summary: 'Gerar rascunho do resumo agora',
    description: describe(
      'Cria um rascunho com a configuração salva, sem enviar e sem mudar a marca de "posts novos" do próximo resumo agendado. Sem posts novos, nada é criado (`issueId` null).',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: { description: 'Resultado.', schema: CrmNewsletterDigestRunDTO },
    },
    errors: [
      ...SCOPE_ERRORS,
      { code: 'CRM_NEWSLETTER_ARCHIVED', when: 'Newsletter arquivada' },
      notFoundError('CrmNewsletterDigest', 'Resumo nunca configurado'),
    ],
  },
  {
    method: 'get',
    path: `${NL}/ai/sources`,
    tags: TAGS,
    summary: 'Fontes para escrever com IA',
    description: describe(
      'Títulos que o usuário pode marcar em "Escrever com IA": posts publicados do blog, artigos publicados e visíveis no portal da base de conhecimento (só com acesso ao ServiceDesk) e produtos ativos do CRM. Nada vai ao provedor nesta chamada.',
      crmAccess('email', 'EDIT'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: { description: 'Fontes.', schema: CrmNewsletterAiSourcesDTO },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'post',
    path: `${NL}/issues/{issueId}/ai/draft`,
    tags: TAGS,
    summary: 'Escrever a edição com IA',
    description: describe(
      'Assunto, pré-visualização e seções da edição a partir de um pedido curto e das fontes marcadas (só título e um trecho de cada uma vão ao provedor). Os posts marcados fecham a edição com os links e imagens reais. Nada é salvo: o editor aplica (e pode desfazer). Provedor e cota de IA do CRM (ADR 0007).',
      crmAccess('email', 'EDIT'),
    ),
    params: ISSUE_PARAMS,
    body: {
      schema: CrmNewsletterAiDraftSchema,
      example: {
        brief:
          'Edição de novembro: novidades do produto e convite para o webinar.',
        tone: 'friendly',
        postIds: [],
        kbArticleIds: [],
        productIds: [],
      },
    },
    responses: {
      200: { description: 'Rascunho.', schema: CrmNewsletterAiDraftResultDTO },
    },
    errors: [...ISSUE_ERRORS, LOCKED, ...AI_ERRORS],
  },
  {
    method: 'post',
    path: `${NL}/issues/{issueId}/ai/subjects`,
    tags: TAGS,
    summary: 'Sugerir assuntos com IA',
    description: describe(
      '5 assuntos com pré-visualização a partir do texto da própria edição (variáveis vão como `{{…}}`, nenhum dado de assinante).',
      crmAccess('email', 'EDIT'),
    ),
    params: ISSUE_PARAMS,
    body: CrmNewsletterAiSubjectsSchema,
    responses: {
      200: {
        description: 'Sugestões.',
        schema: CrmNewsletterAiSubjectsResultDTO,
      },
    },
    errors: [...ISSUE_ERRORS, LOCKED, ...AI_ERRORS],
  },
  {
    method: 'get',
    path: `${NL}/issues/{issueId}/ab-test`,
    tags: TAGS,
    summary: 'Teste A/B de assunto',
    description: describe(
      'Configuração do teste e, depois do início do envio, os números de cada variante (só a parcela de teste) e quantos esperam o vencedor.',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    responses: {
      200: { description: 'Teste A/B.', schema: CrmNewsletterAbReportDTO },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'put',
    path: `${NL}/issues/{issueId}/ab-test`,
    tags: TAGS,
    summary: 'Ligar o teste A/B de assunto',
    description: describe(
      'Segundo assunto para uma parcela de teste (10–50 %, metade recebe A e metade B). Depois de `waitHours` horas do início do envio, ganha a maior taxa de abertura (ou de clique) — empate fica com A — e o resto da audiência recebe o vencedor. Exige pelo menos 20 assinantes ativos no envio.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    body: {
      schema: SetCrmNewsletterAbTestSchema,
      example: {
        subjectB: 'Você viu o que mudou em outubro?',
        testPercent: 20,
        metric: 'OPENS',
        waitHours: 4,
      },
    },
    responses: {
      200: { description: 'Teste A/B.', schema: CrmNewsletterAbTestDTO },
    },
    errors: [
      ...ISSUE_ERRORS,
      LOCKED,
      { code: 'VALIDATION_ERROR', when: 'Assunto B igual ao assunto A' },
    ],
  },
  {
    method: 'delete',
    path: `${NL}/issues/{issueId}/ab-test`,
    tags: TAGS,
    summary: 'Desligar o teste A/B de assunto',
    description: describe(
      'Só em `DRAFT`/`SCHEDULED`.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    responses: { 200: { description: 'Desligado.', schema: z.null() } },
    errors: [...ISSUE_ERRORS, LOCKED],
  },
]
