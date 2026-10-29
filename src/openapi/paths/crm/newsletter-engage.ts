import {
  ListCrmNewsletterWhatsAppRecipientsQuerySchema,
  UpdateCrmNewsletterIssueWhatsAppSchema,
} from '@/src/schemas/crm-newsletter-engage.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmNewsletterIssuePollsDTO,
  CrmNewsletterIssueWhatsAppDTO,
  CrmNewsletterPollVoteResultDTO,
  CrmNewsletterWhatsAppReportDTO,
} from '../../schemas/crm/newsletter-engage'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Newsletter: engajamento das edições (frente nl2-engage) — bloco
 * "Enquete" (resultado, votantes, CSV e o voto público pelo link assinado)
 * e a versão da edição no WhatsApp. Recurso de permissão `email`.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Newsletter · Engajamento']
const BASE = '/workspaces/{id}/crm/newsletters/{newsletterId}/issues/{issueId}'
const ISSUE_PARAMS = {
  newsletterId: 'ID da newsletter.',
  issueId: 'ID da edição.',
}
const ISSUE_ERRORS: RouteConfig['errors'] = [
  ...CRM_ERRORS,
  {
    code: 'CRM_NEWSLETTER_NOT_FOUND',
    when: 'Newsletter inexistente no workspace',
  },
  {
    code: 'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
    when: 'Edição inexistente na newsletter',
  },
]
const POLL_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_POLL_NOT_FOUND',
  when: 'A edição não foi enviada, foi apagada ou não tem esta enquete/opção',
}

export const crmNewsletterEngageRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/polls`,
    tags: TAGS,
    summary: 'Resultado das enquetes',
    description: describe(
      'Cada bloco "Enquete" da edição: votos por opção e os 200 votantes mais recentes (com a pessoa do CRM, quando ligada).',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    responses: {
      200: { description: 'Enquetes.', schema: CrmNewsletterIssuePollsDTO },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/polls/export`,
    tags: TAGS,
    summary: 'Exportar votos (CSV)',
    description: describe(
      'Todos os votos das enquetes da edição em CSV (UTF-8 com BOM, datas em São Paulo). Auditado (dado pessoal).',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    responses: {
      200: {
        description: 'Arquivo CSV (`Content-Disposition: attachment`).',
        envelope: false,
        contentType: 'text/csv',
        schema: { type: 'string' },
      },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/whatsapp`,
    tags: TAGS,
    summary: 'Versão no WhatsApp',
    description: describe(
      'Configuração do "Enviar também no WhatsApp", o que ainda impede o envio e, em rascunho, quantos assinantes recebem hoje.',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    responses: {
      200: {
        description: 'Versão no WhatsApp.',
        schema: CrmNewsletterIssueWhatsAppDTO,
      },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/whatsapp`,
    tags: TAGS,
    summary: 'Salvar versão no WhatsApp',
    description: describe(
      [
        'Liga/desliga e configura a mensagem: conexão da Comunicação, template aprovado da Meta (com as variáveis: nome, primeiro nome, assunto, resumo, link da versão web, fim do link ou texto fixo) ou texto livre na Z-API (`{primeiro_nome}`, `{nome}`, `{assunto}`, `{resumo}`, `{link}` obrigatório).',
        '',
        '`confirmLegalBasis: true` registra quem declarou a base legal; trocar a base legal pede nova declaração. Só em `DRAFT`/`SCHEDULED`. Sai depois que o e-mail termina, para os assinantes ligados a uma pessoa do CRM com telefone de WhatsApp, respeitando os descadastros (SAIR/PARAR) e os limites mensais da Comunicação. Auditado.',
      ].join('\n'),
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    body: UpdateCrmNewsletterIssueWhatsAppSchema,
    responses: {
      200: {
        description: 'Versão no WhatsApp.',
        schema: CrmNewsletterIssueWhatsAppDTO,
      },
    },
    errors: [
      ...ISSUE_ERRORS,
      {
        code: 'CRM_NEWSLETTER_ISSUE_LOCKED',
        when: 'A edição saiu de rascunho/agendada',
      },
      {
        code: 'CRM_NEWSLETTER_WHATSAPP_UNAVAILABLE',
        when: 'O módulo Comunicação está desligado no workspace',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'Conexão ou template de outro workspace/conexão',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/whatsapp/recipients`,
    tags: TAGS,
    summary: 'Entrega no WhatsApp',
    description: describe(
      'Totais e a situação de cada número (paginado, filtro por situação).',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    query: ListCrmNewsletterWhatsAppRecipientsQuerySchema,
    responses: {
      200: {
        description: 'Entrega no WhatsApp.',
        schema: CrmNewsletterWhatsAppReportDTO,
      },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'post',
    path: '/newsletters/polls/{token}',
    tags: ['CRM público · Newsletter'],
    summary: 'Votar na enquete',
    description:
      'Registra o voto de uma opção do bloco "Enquete" (link assinado por envio, bloco e opção). Sem sessão. A página `/newsletter/enquete/<token>` faz este POST depois de carregar — scanners de link que só fazem GET não votam. Um voto por envio e enquete; votar de novo troca a opção. Devolve o resultado parcial quando o autor permitiu.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado do voto (envio + bloco + opção).' },
    responses: {
      200: {
        description: 'Voto registrado.',
        schema: CrmNewsletterPollVoteResultDTO,
      },
    },
    errors: [
      {
        code: 'CRM_NEWSLETTER_TOKEN_INVALID',
        when: 'Link com assinatura inválida',
      },
      POLL_NOT_FOUND,
    ],
  },
]
