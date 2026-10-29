import { z } from 'zod'
import {
  AddCrmNewsletterSubscriberSchema,
  CreateCrmNewsletterSchema,
  ImportCrmNewsletterSubscribersSchema,
  ListCrmNewsletterSubscribersQuerySchema,
  NewsletterUnsubscribeSchema,
  PublicNewsletterSubscribeSchema,
  UpdateCrmNewsletterSchema,
  UpdateNewsletterPreferencesSchema,
} from '@/src/schemas/crm-newsletter.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmNewsletterDTO,
  CrmNewsletterImportResultDTO,
  CrmNewsletterSubscriberDTO,
  CrmNewsletterSubscriberPageDTO,
  NewsletterPreferencesDTO,
  NewsletterUnsubscribeResultDTO,
  PublicNewsletterSubscribeResultDTO,
} from '../../schemas/crm/newsletters'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Newsletters (ADR 0054): newsletters e assinantes (frente nl-core).
 * As edições (`/issues/**`) ficam na frente de edições. As rotas públicas
 * (`/newsletters/**`) não têm sessão: o link assinado (ou o slug público) é
 * o acesso.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Newsletters']
const PUBLIC_TAGS: RouteConfig['tags'] = ['CRM público · Newsletter']
const BASE = '/workspaces/{id}/crm/newsletters'
const NEWSLETTER_ID = 'ID da newsletter.'
const SUBSCRIBER_ID = 'ID do assinante.'

const NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_NOT_FOUND',
  when: 'Newsletter inexistente (ou excluída) no workspace',
}
const ARCHIVED: ErrorEntry = {
  code: 'CRM_NEWSLETTER_ARCHIVED',
  when: 'Newsletter arquivada: reative para inscrever',
}
const SLUG_TAKEN: ErrorEntry = {
  code: 'CRM_NEWSLETTER_SLUG_TAKEN',
  when: 'Já existe uma newsletter com este `slug` no workspace',
}
const SUBSCRIBER_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_SUBSCRIBER_NOT_FOUND',
  when: 'Assinante inexistente nesta newsletter',
}
const TOKEN_INVALID: ErrorEntry = {
  code: 'CRM_NEWSLETTER_TOKEN_INVALID',
  when: 'Link com assinatura inválida, vencido ou de um registro que não existe mais',
}

const newsletterExample = {
  name: 'Novidades da Acme',
  description: 'O que mudou no produto, uma vez por mês.',
  cadenceLabel: 'Mensal',
  fromName: 'Acme',
  fromEmail: 'news@news.acme.com.br',
  replyTo: 'contato@acme.com.br',
  doubleOptIn: true,
}

const internalRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAGS,
    summary: 'Listar newsletters',
    description: describe(
      'Newsletters do workspace com assinantes ativos e pendentes, edições enviadas, data da última edição, situação do remetente (`senderVerified`, conferida na hora) e o endereço do arquivo público.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Newsletters.', schema: z.array(CrmNewsletterDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: BASE,
    tags: TAGS,
    summary: 'Criar newsletter',
    description: describe(
      'O `slug` é derivado do nome quando omitido (com sufixo `-2`, `-3`… se já existir). O remetente pode ser salvo antes de o domínio estar verificado: `senderVerified` avisa e o envio das edições fica bloqueado até lá.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    body: { schema: CreateCrmNewsletterSchema, example: newsletterExample },
    responses: {
      201: { description: 'Newsletter criada.', schema: CrmNewsletterDTO },
    },
    errors: [...CRM_ERRORS, SLUG_TAKEN],
  },
  {
    method: 'get',
    path: `${BASE}/{newsletterId}`,
    tags: TAGS,
    summary: 'Detalhe da newsletter',
    description: describe(crmAccess('email', 'VIEW')),
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: { description: 'Newsletter.', schema: CrmNewsletterDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/{newsletterId}`,
    tags: TAGS,
    summary: 'Editar, arquivar ou reativar newsletter',
    description: describe(
      '`status: ARCHIVED` arquiva (para inscrições e envios); `ACTIVE` reativa. Trocar `fromEmail` reconfere o domínio do remetente.',
      crmAccess('email', 'EDIT'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    consent: true,
    body: {
      schema: UpdateCrmNewsletterSchema,
      example: { status: 'ARCHIVED' },
    },
    responses: {
      200: { description: 'Newsletter.', schema: CrmNewsletterDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, SLUG_TAKEN],
  },
  {
    method: 'delete',
    path: `${BASE}/{newsletterId}`,
    tags: TAGS,
    summary: 'Excluir newsletter',
    description: describe(
      'Exclusão lógica: o endereço público fica livre e os formulários que inscreviam nela deixam de inscrever.',
      crmAccess('email', 'DELETE'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    consent: true,
    responses: {
      200: { description: 'Excluída.', schema: z.null() },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/{newsletterId}/subscribers`,
    tags: TAGS,
    summary: 'Listar assinantes',
    description: describe(
      'Paginado, com busca por e-mail ou nome e filtros de situação e origem.',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    query: ListCrmNewsletterSubscribersQuerySchema,
    responses: {
      200: {
        description: 'Página de assinantes.',
        schema: CrmNewsletterSubscriberPageDTO,
      },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/{newsletterId}/subscribers`,
    tags: TAGS,
    summary: 'Adicionar assinante',
    description: describe(
      'Fica `ACTIVE` na hora (o membro declara o consentimento) ou `PENDING` com `sendConfirmation`. Quem tinha saído só volta confirmando de novo. Liga à pessoa do CRM com o mesmo e-mail, sem criar pessoa.',
      crmAccess('email', 'CREATE'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    consent: true,
    body: {
      schema: AddCrmNewsletterSubscriberSchema,
      example: { email: 'ana@empresa.com.br', name: 'Ana' },
    },
    responses: {
      201: { description: 'Assinante.', schema: CrmNewsletterSubscriberDTO },
    },
    errors: [
      ...CRM_ERRORS,
      NOT_FOUND,
      ARCHIVED,
      {
        code: 'CRM_NEWSLETTER_SUBSCRIBER_EXISTS',
        when: 'O e-mail já está ativo ou aguardando confirmação',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'E-mail no descadastro do workspace, com retorno permanente ou que denunciou spam',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/{newsletterId}/subscribers/import`,
    tags: TAGS,
    summary: 'Importar assinantes (CSV)',
    description: describe(
      'O navegador lê o CSV e envia as linhas. Exige `consentConfirmed: true`. Linhas inválidas, repetidas, no descadastro do workspace, com retorno permanente ou denúncia de spam voltam em `rejected`. Com `sendConfirmation`, até 1.000 linhas por vez. Auditado.',
      crmAccess('email', 'CREATE'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    consent: true,
    body: {
      schema: ImportCrmNewsletterSubscribersSchema,
      example: {
        rows: [{ email: 'ana@empresa.com.br', name: 'Ana' }],
        consentConfirmed: true,
      },
    },
    responses: {
      200: {
        description: 'Resumo da importação.',
        schema: CrmNewsletterImportResultDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      NOT_FOUND,
      ARCHIVED,
      {
        code: 'CRM_NEWSLETTER_IMPORT_INVALID',
        when: 'Linhas demais para importar com o e-mail de confirmação',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/{newsletterId}/subscribers/export`,
    tags: TAGS,
    summary: 'Exportar assinantes (CSV)',
    description: describe(
      'CSV em UTF-8 com BOM, datas no fuso de São Paulo, com situação, origem e a prova do consentimento. Auditado (dado pessoal).',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: {
        description: 'Arquivo CSV (`Content-Disposition: attachment`).',
        envelope: false,
        contentType: 'text/csv',
        schema: { type: 'string' },
      },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'delete',
    path: `${BASE}/{newsletterId}/subscribers/{subscriberId}`,
    tags: TAGS,
    summary: 'Remover assinante',
    description: describe(
      'Apaga o assinante e o histórico de entregas dele (LGPD). Auditado.',
      crmAccess('email', 'DELETE'),
    ),
    params: { newsletterId: NEWSLETTER_ID, subscriberId: SUBSCRIBER_ID },
    consent: true,
    responses: { 200: { description: 'Removido.', schema: z.null() } },
    errors: [...CRM_ERRORS, NOT_FOUND, SUBSCRIBER_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/{newsletterId}/subscribers/{subscriberId}/resend-confirmation`,
    tags: TAGS,
    summary: 'Reenviar confirmação',
    description: describe(
      'Só para quem está `PENDING`; no máximo uma vez a cada 10 minutos. `sent: false` quando o provedor recusou o envio.',
      crmAccess('email', 'EDIT'),
    ),
    params: { newsletterId: NEWSLETTER_ID, subscriberId: SUBSCRIBER_ID },
    consent: true,
    responses: {
      200: {
        description: 'Resultado.',
        schema: z.object({ sent: z.boolean() }),
      },
    },
    errors: [
      ...CRM_ERRORS,
      NOT_FOUND,
      ARCHIVED,
      SUBSCRIBER_NOT_FOUND,
      { code: 'VALIDATION_ERROR', when: 'O assinante não está pendente' },
      {
        code: 'RATE_LIMITED',
        when: 'Confirmação enviada há menos de 10 minutos',
      },
    ],
  },
]

const publicRoutes: RouteConfig[] = [
  {
    method: 'post',
    path: '/newsletters/subscribe',
    tags: PUBLIC_TAGS,
    summary: 'Inscrever na newsletter',
    description: [
      'Inscrição pública (página do arquivo, elemento do Sites ou qualquer site — CORS aberto). Sem sessão; limite por IP (20 a cada 10 min) e por e-mail (5 por hora). O campo isca `website` precisa ficar vazio.',
      '',
      'A resposta é a **mesma** qualquer que seja a situação do endereço (novo, já inscrito, descadastrado do workspace, com retorno): nada vaza. Com confirmação dupla, o e-mail de confirmação sai (no máximo um a cada 10 minutos); sem ela, o assinante fica ativo na hora. Guarda IP, navegador e o texto do consentimento.',
    ].join('\n'),
    auth: 'public',
    rateLimit: 'ip',
    body: {
      schema: PublicNewsletterSubscribeSchema,
      example: {
        workspaceSlug: 'acme',
        newsletterSlug: 'novidades',
        email: 'ana@empresa.com.br',
        consent: true,
      },
    },
    responses: {
      200: {
        description: 'Pedido recebido.',
        schema: PublicNewsletterSubscribeResultDTO,
      },
    },
    errors: [
      {
        code: 'CRM_NEWSLETTER_NOT_FOUND',
        when: 'Newsletter inexistente ou arquivada',
      },
      {
        code: 'MODULE_DISABLED',
        when: 'O workspace está com o CRM desabilitado',
      },
    ],
  },
  {
    method: 'post',
    path: '/newsletters/confirm/{token}/resend',
    tags: PUBLIC_TAGS,
    summary: 'Reenviar confirmação (link vencido)',
    description:
      'Usado pela página `/newsletter/confirmar/<token>` quando o link venceu (7 dias): manda um novo e-mail de confirmação. No máximo um a cada 10 minutos.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado de confirmação (mesmo vencido).' },
    responses: {
      200: {
        description: 'Resultado.',
        schema: z.object({ sent: z.boolean() }),
      },
    },
    errors: [TOKEN_INVALID],
  },
  {
    method: 'get',
    path: '/newsletters/unsubscribe/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Link de descadastro (redireciona)',
    description:
      'Redireciona (303) para a página `/newsletter/sair/<token>`. **Nunca** descadastra em GET.',
    auth: 'public',
    rateLimit: false,
    params: { token: 'Token assinado de descadastro.' },
    responses: {
      303: { description: 'Redireciona para a página.', envelope: false },
    },
  },
  {
    method: 'post',
    path: '/newsletters/unsubscribe/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Sair da newsletter',
    description: [
      'Tira o endereço só desta newsletter. Dois usos:',
      '',
      '- **One-click (RFC 8058)** — o provedor faz `POST` com corpo `application/x-www-form-urlencoded` `List-Unsubscribe=One-Click`.',
      '- **Página** — botão de `/newsletter/sair/<token>`, corpo JSON com `reason` opcional.',
      '',
      'Idempotente (`alreadyUnsubscribed`). Quando o token vem de uma edição, marca o descadastro no relatório dela.',
    ].join('\n'),
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado de descadastro.' },
    body: {
      schema: NewsletterUnsubscribeSchema,
      required: false,
      example: { reason: 'Recebo e-mails demais' },
    },
    responses: {
      200: {
        description: 'Descadastrado.',
        schema: NewsletterUnsubscribeResultDTO,
      },
    },
    errors: [TOKEN_INVALID],
  },
  {
    method: 'get',
    path: '/newsletters/preferences/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Central de preferências',
    description:
      'Newsletters ativas do workspace e quais o endereço recebe. `optedOutOfAll` indica o descadastro de tudo (vale também para as campanhas).',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado de preferências (workspace + e-mail).' },
    responses: {
      200: { description: 'Preferências.', schema: NewsletterPreferencesDTO },
    },
    errors: [TOKEN_INVALID],
  },
  {
    method: 'put',
    path: '/newsletters/preferences/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Salvar preferências',
    description:
      'As newsletters listadas ficam (ou passam a ser) recebidas; as outras saem. Ligar alguma desfaz um "sair de tudo" anterior. `unsubscribeAll` tira de todas e grava o descadastro do workspace (origem `PREFERENCES`). Endereços com retorno permanente ou denúncia de spam não voltam.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado de preferências.' },
    body: {
      schema: UpdateNewsletterPreferencesSchema,
      example: { subscribedNewsletterIds: ['ckw1nl00000ab7d3k1e5xyz'] },
    },
    responses: {
      200: { description: 'Preferências.', schema: NewsletterPreferencesDTO },
    },
    errors: [TOKEN_INVALID],
  },
]

export const crmNewsletterRoutes: RouteConfig[] = [
  ...internalRoutes,
  ...publicRoutes,
]
