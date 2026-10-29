import { z } from 'zod'
import {
  CreateCrmNewsletterWelcomeStepSchema,
  CrmNewsletterReengagementPreviewQuerySchema,
  ReorderCrmNewsletterWelcomeStepsSchema,
  UpdateCrmNewsletterReengagementSchema,
  UpdateCrmNewsletterWelcomeStepSchema,
} from '@/src/schemas/crm-newsletter-automation.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmNewsletterReengagementDTO,
  CrmNewsletterReengagementPreviewDTO,
  CrmNewsletterWelcomeStepDTO,
  NewsletterReengagePreviewDTO,
  NewsletterReengageResultDTO,
} from '../../schemas/crm/newsletter-automation'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Newsletter: automação (newsletter2, frente nl2-automation) — série
 * de boas-vindas e reengajamento de assinantes inativos. Recurso de
 * permissão `email`.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Newsletter · Automação']
const PUBLIC_TAGS: RouteConfig['tags'] = ['CRM público · Newsletter']
const BASE = '/workspaces/{id}/crm/newsletters/{newsletterId}'
const NEWSLETTER_ID = 'ID da newsletter.'
const STEP_PARAMS = {
  newsletterId: NEWSLETTER_ID,
  stepId: 'ID da etapa de boas-vindas.',
}

const NEWSLETTER_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_NOT_FOUND',
  when: 'Newsletter inexistente no workspace',
}
const STEP_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_WELCOME_STEP_NOT_FOUND',
  when: 'Etapa inexistente na newsletter',
}
const SCOPE_ERRORS = [...CRM_ERRORS, NEWSLETTER_NOT_FOUND]
const STEP_ERRORS = [...SCOPE_ERRORS, STEP_NOT_FOUND]

export const crmNewsletterAutomationRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/welcome-steps`,
    tags: TAGS,
    summary: 'Listar a série de boas-vindas',
    description: describe(
      'Etapas em ordem, com enviados, aberturas e cliques únicos de cada uma. Cada etapa sai `delay` depois da confirmação do assinante.',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: {
        description: 'Etapas.',
        schema: z.array(CrmNewsletterWelcomeStepDTO),
      },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/welcome-steps`,
    tags: TAGS,
    summary: 'Criar etapa de boas-vindas',
    description: describe(
      'Nova etapa no fim da série, a partir do modelo da newsletter (ou em branco). No máximo 10 etapas.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    params: { newsletterId: NEWSLETTER_ID },
    body: {
      schema: CreateCrmNewsletterWelcomeStepSchema,
      example: {
        subject: 'Boas-vindas à nossa newsletter',
        delayValue: 0,
        delayUnit: 'HOURS',
      },
    },
    responses: {
      201: {
        description: 'Etapa criada.',
        schema: CrmNewsletterWelcomeStepDTO,
      },
    },
    errors: [
      ...SCOPE_ERRORS,
      { code: 'CRM_NEWSLETTER_ARCHIVED', when: 'Newsletter arquivada' },
      {
        code: 'CRM_NEWSLETTER_WELCOME_STEP_LIMIT_REACHED',
        when: 'A série já tem 10 etapas',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/welcome-steps/reorder`,
    tags: TAGS,
    summary: 'Reordenar a série de boas-vindas',
    description: describe(
      'Recebe todos os IDs das etapas, cada um uma vez, na nova ordem.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: { newsletterId: NEWSLETTER_ID },
    body: ReorderCrmNewsletterWelcomeStepsSchema,
    responses: {
      200: {
        description: 'Etapas na nova ordem.',
        schema: z.array(CrmNewsletterWelcomeStepDTO),
      },
    },
    errors: [
      ...SCOPE_ERRORS,
      { code: 'VALIDATION_ERROR', when: 'Faltou ou sobrou alguma etapa' },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/welcome-steps/{stepId}`,
    tags: TAGS,
    summary: 'Detalhe da etapa',
    description: describe(
      'Inclui o `builderDocument` (documento Steel Canvas).',
      crmAccess('email', 'VIEW'),
    ),
    params: STEP_PARAMS,
    responses: {
      200: { description: 'Etapa.', schema: CrmNewsletterWelcomeStepDTO },
    },
    errors: STEP_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/welcome-steps/{stepId}`,
    tags: TAGS,
    summary: 'Salvar etapa',
    description: describe(
      'Salvamento automático do editor e controles da lista: assunto, pré-visualização, atraso (valor e unidade juntos), ligada/desligada e documento. Blocos de HTML só OWNER/ADMIN.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: STEP_PARAMS,
    body: UpdateCrmNewsletterWelcomeStepSchema,
    responses: {
      200: { description: 'Etapa.', schema: CrmNewsletterWelcomeStepDTO },
    },
    errors: [
      ...STEP_ERRORS,
      {
        code: 'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
        when: 'Documento inválido',
      },
      {
        code: 'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
        when: 'Bloco de HTML alterado por quem não é OWNER/ADMIN',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/welcome-steps/{stepId}`,
    tags: TAGS,
    summary: 'Excluir etapa',
    description: describe(
      'Remove a etapa e o histórico de envios dela; as demais sobem uma posição.',
      crmAccess('email', 'DELETE'),
    ),
    consent: true,
    params: STEP_PARAMS,
    responses: { 200: { description: 'Excluída.', schema: z.null() } },
    errors: STEP_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/reengagement`,
    tags: TAGS,
    summary: 'Reengajamento de inativos',
    description: describe(
      'Configuração (padrão desligada), a prévia de quantos seriam afetados agora e os totais de tentativas.',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: {
        description: 'Configuração.',
        schema: CrmNewsletterReengagementDTO,
      },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'put',
    path: `${BASE}/reengagement`,
    tags: TAGS,
    summary: 'Salvar o reengajamento',
    description: describe(
      'Uma vez por mês (dia 1, 09:00 de São Paulo), quem recebeu ao menos `minIssues` edições nos últimos `inactiveDays` dias sem abrir nem clicar recebe o e-mail com o botão "Quero continuar recebendo". Quem não interagir em `graceDays` dias sai da newsletter com o motivo "inativo" (`UNSUBSCRIBE`) ou só fica marcado (`FLAG`). Auditado.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: { newsletterId: NEWSLETTER_ID },
    body: UpdateCrmNewsletterReengagementSchema,
    responses: {
      200: {
        description: 'Configuração.',
        schema: CrmNewsletterReengagementDTO,
      },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/reengagement/preview`,
    tags: TAGS,
    summary: 'Prévia do reengajamento',
    description: describe(
      'Quantos seriam afetados agora com `minIssues`/`inactiveDays` ainda não salvos (omitidos = os salvos).',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    query: CrmNewsletterReengagementPreviewQuerySchema,
    responses: {
      200: {
        description: 'Prévia.',
        schema: CrmNewsletterReengagementPreviewDTO,
      },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'get',
    path: '/newsletters/reengage/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Página "Quero continuar recebendo"',
    description:
      'Dados da página `/newsletter/continuar/<token>`. Só lê (leitores de link abrem GETs).',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado do e-mail de reengajamento.' },
    responses: {
      200: { description: 'Dados.', schema: NewsletterReengagePreviewDTO },
    },
    errors: [
      {
        code: 'CRM_NEWSLETTER_TOKEN_INVALID',
        when: 'Link com assinatura inválida ou de uma tentativa que não existe mais',
      },
    ],
  },
  {
    method: 'post',
    path: '/newsletters/reengage/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Quero continuar recebendo',
    description:
      'Marca a tentativa como reengajada e renova o engajamento do assinante. Quem tinha sido descadastrado por inatividade volta a receber; quem saiu por conta própria (ou teve retorno) não. Idempotente.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado do e-mail de reengajamento.' },
    responses: {
      200: { description: 'Resultado.', schema: NewsletterReengageResultDTO },
    },
    errors: [
      {
        code: 'CRM_NEWSLETTER_TOKEN_INVALID',
        when: 'Link com assinatura inválida ou de uma tentativa que não existe mais',
      },
    ],
  },
]
