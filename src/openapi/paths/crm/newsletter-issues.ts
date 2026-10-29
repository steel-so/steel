import { z } from 'zod'
import {
  CreateCrmNewsletterIssueSchema,
  CrmNewsletterIssueTestSendSchema,
  ListCrmNewsletterIssueRecipientsQuerySchema,
  ListCrmNewsletterIssuesQuerySchema,
  SendCrmNewsletterIssueSchema,
  UpdateCrmNewsletterIssueSchema,
} from '@/src/schemas/crm-newsletter-issue.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmNewsletterIssueDTO,
  CrmNewsletterIssuePageDTO,
  CrmNewsletterIssuePreflightDTO,
  CrmNewsletterIssueRecipientPageDTO,
  CrmNewsletterIssueReportDTO,
  CrmNewsletterIssueTrendDTO,
  CrmNewsletterUsageDTO,
} from '../../schemas/crm/newsletter-issues'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Newsletter: edições (ADR 0054, frente nl-issues) — editor, envio
 * de teste, envio/agendamento, cancelar e parar, relatório (funil, cliques
 * por link, destinatários) e o uso mensal. Recurso de permissão `email`.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Newsletter · Edições']
const BASE = '/workspaces/{id}/crm/newsletters/{newsletterId}/issues'
const NEWSLETTER_ID = 'ID da newsletter.'
const ISSUE_ID = 'ID da edição.'
const ISSUE_PARAMS = { newsletterId: NEWSLETTER_ID, issueId: ISSUE_ID }

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
  when: 'A edição saiu de rascunho/agendada (está sendo enviada ou já foi)',
}
const SCOPE_ERRORS = [...CRM_ERRORS, NEWSLETTER_NOT_FOUND]
const ISSUE_ERRORS = [...SCOPE_ERRORS, ISSUE_NOT_FOUND]

export const crmNewsletterIssueRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAGS,
    summary: 'Listar edições',
    description: describe(
      'Rascunhos primeiro, depois as edições numeradas (mais recentes primeiro), com o funil das que já saíram.',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    query: ListCrmNewsletterIssuesQuerySchema,
    responses: {
      200: { description: 'Edições.', schema: CrmNewsletterIssuePageDTO },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'post',
    path: BASE,
    tags: TAGS,
    summary: 'Criar edição',
    description: describe(
      'Rascunho a partir do modelo da newsletter (ou em branco), de outro modelo (`templateId`) ou copiando outra edição (`duplicateOfIssueId`). O `slug` sai do assunto quando omitido.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    params: { newsletterId: NEWSLETTER_ID },
    body: {
      schema: CreateCrmNewsletterIssueSchema,
      example: { subject: 'Novidades de outubro' },
    },
    responses: {
      201: { description: 'Edição criada.', schema: CrmNewsletterIssueDTO },
    },
    errors: [
      ...SCOPE_ERRORS,
      { code: 'CRM_NEWSLETTER_ARCHIVED', when: 'Newsletter arquivada' },
      { code: 'CONFLICT', when: 'Já existe uma edição com este `slug`' },
      {
        code: 'RESOURCE_NOT_FOUND',
        when: 'Modelo ou edição de origem inexistente',
      },
      ISSUE_NOT_FOUND,
    ],
  },
  {
    method: 'get',
    path: `${BASE}/trend`,
    tags: TAGS,
    summary: 'Evolução das últimas edições',
    description: describe(
      'Taxas de abertura e clique das últimas 12 edições enviadas, da mais antiga para a mais nova.',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: { description: 'Evolução.', schema: CrmNewsletterIssueTrendDTO },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/{issueId}`,
    tags: TAGS,
    summary: 'Detalhe da edição',
    description: describe(
      'Inclui o `builderDocument` (documento Steel Canvas) e o funil.',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    responses: {
      200: { description: 'Edição.', schema: CrmNewsletterIssueDTO },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/{issueId}`,
    tags: TAGS,
    summary: 'Salvar edição',
    description: describe(
      'Salvamento automático do editor: assunto, pré-visualização, `slug` e documento. Só em `DRAFT`/`SCHEDULED`; blocos de HTML só OWNER/ADMIN.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    body: UpdateCrmNewsletterIssueSchema,
    responses: {
      200: { description: 'Edição.', schema: CrmNewsletterIssueDTO },
    },
    errors: [
      ...ISSUE_ERRORS,
      LOCKED,
      { code: 'CONFLICT', when: 'Já existe uma edição com este `slug`' },
      'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
      'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/{issueId}`,
    tags: TAGS,
    summary: 'Excluir rascunho',
    description: describe(
      'Só edições em `DRAFT`.',
      crmAccess('email', 'DELETE'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    responses: { 200: { description: 'Excluída.', schema: z.null() } },
    errors: [...ISSUE_ERRORS, LOCKED],
  },
  {
    method: 'post',
    path: `${BASE}/{issueId}/test`,
    tags: TAGS,
    summary: 'Enviar teste',
    description: describe(
      'Até 5 endereços, com dados de exemplo nas variáveis e "[Teste]" no assunto. 10 testes por hora por edição; não conta no limite do mês. Sai do remetente da newsletter quando o domínio está verificado, senão do remetente do Steel.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    body: {
      schema: CrmNewsletterIssueTestSendSchema,
      example: { emails: ['voce@empresa.com.br'] },
    },
    responses: {
      200: {
        description: 'Endereços que receberam o teste.',
        schema: z.object({ to: z.array(z.string()) }),
      },
    },
    errors: [
      ...ISSUE_ERRORS,
      'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
      { code: 'RATE_LIMITED', when: 'Mais de 10 testes na última hora' },
      'MAIL_ERROR',
    ],
  },
  {
    method: 'get',
    path: `${BASE}/{issueId}/preflight`,
    tags: TAGS,
    summary: 'Conferir antes de enviar',
    description: describe(
      'Audiência, saldo do mês, checklist do editor e tudo o que impede o envio, na ordem em que o envio confere.',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    responses: {
      200: {
        description: 'Conferência.',
        schema: CrmNewsletterIssuePreflightDTO,
      },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/{issueId}/send`,
    tags: TAGS,
    summary: 'Enviar agora ou agendar',
    description: describe(
      'Sem `scheduledAt`, o envio começa na hora: número da edição, fotografia da audiência (assinantes ativos fora do descadastro geral), versão web e envio em lotes pela fila `crm-newsletter`. Com `scheduledAt` (mínimo 5 minutos à frente), as conferências rodam agora e de novo na hora marcada.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    body: {
      schema: SendCrmNewsletterIssueSchema,
      example: { scheduledAt: '2026-11-03T12:00:00-03:00' },
    },
    responses: {
      200: { description: 'Edição.', schema: CrmNewsletterIssueDTO },
    },
    errors: [
      ...ISSUE_ERRORS,
      LOCKED,
      { code: 'CRM_NEWSLETTER_ARCHIVED', when: 'Newsletter arquivada' },
      {
        code: 'SENDING_DOMAIN_NOT_VERIFIED',
        when: 'O remetente não é de um domínio verificado do workspace',
      },
      {
        code: 'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
        when: 'O checklist do editor tem erros',
      },
      'CRM_NEWSLETTER_NO_SUBSCRIBERS',
      {
        code: 'CRM_NEWSLETTER_LIMIT_REACHED',
        when: 'A audiência não cabe no saldo de e-mails do mês (a mensagem traz os números)',
      },
      { code: 'VALIDATION_ERROR', when: 'Agendamento a menos de 5 minutos' },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/{issueId}/cancel`,
    tags: TAGS,
    summary: 'Cancelar agendamento',
    description: describe(
      'A edição agendada volta para rascunho.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    responses: {
      200: { description: 'Edição.', schema: CrmNewsletterIssueDTO },
    },
    errors: [
      ...ISSUE_ERRORS,
      LOCKED,
      { code: 'VALIDATION_ERROR', when: 'A edição não está agendada' },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/{issueId}/stop`,
    tags: TAGS,
    summary: 'Parar envio',
    description: describe(
      'Quem ainda não recebeu fica de fora (`SKIPPED`); a edição fecha como enviada (ou interrompida, se nada saiu).',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    responses: {
      200: { description: 'Edição.', schema: CrmNewsletterIssueDTO },
    },
    errors: [
      ...ISSUE_ERRORS,
      { code: 'VALIDATION_ERROR', when: 'A edição não está sendo enviada' },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/{issueId}/report`,
    tags: TAGS,
    summary: 'Relatório da edição',
    description: describe(
      'Funil (enviados, entregues, aberturas e cliques únicos, retornos, denúncias e saídas) e cliques por link.',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    responses: {
      200: { description: 'Relatório.', schema: CrmNewsletterIssueReportDTO },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/{issueId}/recipients`,
    tags: TAGS,
    summary: 'Destinatários da edição',
    description: describe(
      'Paginado, com filtro (abriram, não abriram, clicaram, retornaram…) e busca por e-mail ou nome.',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    query: ListCrmNewsletterIssueRecipientsQuerySchema,
    responses: {
      200: {
        description: 'Destinatários.',
        schema: CrmNewsletterIssueRecipientPageDTO,
      },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/newsletter-usage',
    tags: TAGS,
    summary: 'Uso de e-mails da newsletter no mês',
    description: describe(
      'E-mails de newsletter enviados no mês (fuso de São Paulo) e o limite: o ajuste do admin da plataforma ou o `newsletterEmailsPerMonth` do plano. Testes não contam.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Uso do mês.', schema: CrmNewsletterUsageDTO },
    },
    errors: CRM_ERRORS,
  },
]
